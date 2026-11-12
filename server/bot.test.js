import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createRateLimiter } from './app.js';
import { isValidWebhookUrl, MODULES, safeEqual, validateBotRequest } from './validate.js';

const KEY = 'test-secret-KEY-9f8e7d6c5b4a';

describe('validateBotRequest', () => {
  it('requires a non-empty task', () => {
    expect(validateBotRequest({}).ok).toBe(false);
    expect(validateBotRequest({ task: '   ' }).ok).toBe(false);
    expect(validateBotRequest(null).ok).toBe(false);
    expect(validateBotRequest([]).ok).toBe(false);
  });
  it('accepts a minimal task and generates request_id + default module', () => {
    const r = validateBotRequest({ task: ' ping ' }, () => 'abc');
    expect(r).toEqual({ ok: true, value: { task: 'ping', module: 'allgemein', request_id: 'nova-abc' } });
  });
  it('enforces module whitelist', () => {
    for (const m of MODULES) expect(validateBotRequest({ task: 'x', module: m }).ok).toBe(true);
    const bad = validateBotRequest({ task: 'x', module: 'admin' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_module');
  });
  it('enforces length limits', () => {
    expect(validateBotRequest({ task: 'a'.repeat(2001) }).error).toBe('task_too_long');
    expect(validateBotRequest({ task: 'a', context: 'b'.repeat(4001) }).error).toBe('context_too_long');
    expect(validateBotRequest({ task: 'a', context: 5 }).error).toBe('invalid_context');
  });
  it('validates request_id format', () => {
    expect(validateBotRequest({ task: 'a', request_id: 'ok-123_x.y:z' }).value.request_id).toBe('ok-123_x.y:z');
    expect(validateBotRequest({ task: 'a', request_id: 'bad id<script>' }).error).toBe('invalid_request_id');
  });
  it('webhook url must be https (http only for localhost)', () => {
    expect(isValidWebhookUrl('https://api2.cursor.sh/automations/webhook/abc')).toBe(true);
    expect(isValidWebhookUrl('http://127.0.0.1:9999/hook')).toBe(true);
    expect(isValidWebhookUrl('http://example.com/hook')).toBe(false);
    expect(isValidWebhookUrl('')).toBe(false);
  });
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('rate limiter allows N per minute', () => {
    const allow = createRateLimiter(2);
    expect(allow('ip', 0)).toBe(true);
    expect(allow('ip', 1)).toBe(true);
    expect(allow('ip', 2)).toBe(false);
    expect(allow('ip', 61_000)).toBe(true);
  });
});

describe('POST /api/bot against a mock webhook', () => {
  /** @type {import('node:http').Server} */
  let server;
  let url = '';
  /** @type {{ headers: Record<string, string | string[] | undefined>, body: string }[]} */
  const received = [];
  let mode = 'ok';
  const logs = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        if (mode === 'slow') return setTimeout(() => res.end('{}'), 1500);
        res.statusCode = mode === 'ok' ? 200 : mode === 'unauth' ? 401 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ echo: req.headers.authorization, secret: KEY }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/automations/webhook/test`;
  });
  afterAll(() => server.close());

  const make = (cfg = {}) =>
    createApp({
      getConfig: () => ({ GROKBOT_WEBHOOK_URL: url, GROKBOT_WEBHOOK_KEY: KEY, RATE_LIMIT_PER_MINUTE: 100, ...cfg }),
      log: (m) => logs.push(m),
    });
  const post = (app, body, headers = {}) =>
    app.request('http://nova.local/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('forwards with both auth headers and the expected JSON body', async () => {
    mode = 'ok';
    received.length = 0;
    const res = await post(make(), { task: 'ping', module: 'todos', context: 'Liste: Arbeit' });
    const text = await res.text();
    expect(res.status).toBe(200);
    const data = JSON.parse(text);
    expect(data).toMatchObject({ ok: true, status: 'sent' });
    expect(data.request_id).toMatch(/^nova-/);
    expect(received).toHaveLength(1);
    const h = received[0].headers;
    expect(h['content-type']).toBe('application/json');
    expect(h.authorization).toBe(`Bearer ${KEY}`);
    expect(h['x-automation-key']).toBe(KEY);
    expect(JSON.parse(received[0].body)).toEqual({ task: 'ping', module: 'todos', context: 'Liste: Arbeit', request_id: data.request_id });
    expect(text).not.toContain(KEY);
  });

  it('maps upstream errors without leaking the key or upstream body', async () => {
    mode = 'unauth';
    const res = await post(make(), { task: 'ping' });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: 'upstream_error', upstream_status: 401 });
    expect(text).not.toContain(KEY);
    mode = 'fail';
    const res2 = await post(make(), { task: 'ping' });
    expect((await res2.json()).upstream_status).toBe(500);
  });

  it('times out (single try)', async () => {
    mode = 'slow';
    received.length = 0;
    const res = await post(make({ UPSTREAM_TIMEOUT_MS: 200 }), { task: 'ping' });
    expect(res.status).toBe(504);
    expect((await res.json()).error).toBe('upstream_timeout');
    expect(received).toHaveLength(1);
  });

  it('reports unreachable upstream', async () => {
    const res = await post(make({ GROKBOT_WEBHOOK_URL: 'http://127.0.0.1:1/hook' }), { task: 'ping' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('upstream_unreachable');
  });

  it('returns not_configured when URL or key are missing', async () => {
    const app = createApp({ getConfig: () => ({}) });
    const res = await post(app, { task: 'ping' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_configured');
    const st = await app.request('http://nova.local/api/bot/status');
    expect(await st.json()).toEqual({ ok: true, configured: false, token_required: false });
  });

  it('status never exposes the key or URL', async () => {
    const st = await make().request('http://nova.local/api/bot/status');
    const text = await st.text();
    expect(JSON.parse(text).configured).toBe(true);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('webhook');
  });

  it('rejects bad input, content type, invalid json', async () => {
    mode = 'ok';
    expect((await post(make(), { task: '' })).status).toBe(400);
    expect((await post(make(), { task: 'x', module: 'root' })).status).toBe(400);
    expect((await post(make(), '{nope')).status).toBe(400);
    const r = await make().request('http://nova.local/api/bot', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'task' });
    expect(r.status).toBe(415);
  });

  it('enforces origin allowlist and CORS', async () => {
    const app = make({ ALLOWED_ORIGINS: 'https://user.github.io' });
    expect((await post(app, { task: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
    const ok = await post(app, { task: 'ping' }, { origin: 'https://user.github.io' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://user.github.io');
    expect((await post(app, { task: 'ping' }, { origin: 'http://nova.local' })).status).toBe(200);
    const pre = await app.request('http://nova.local/api/bot', { method: 'OPTIONS', headers: { origin: 'https://user.github.io' } });
    expect(pre.status).toBe(204);
  });

  it('requires the app token when configured', async () => {
    const app = make({ NOVA_APP_TOKEN: 'open-sesame' });
    expect((await post(app, { task: 'ping' })).status).toBe(401);
    expect((await post(app, { task: 'ping' }, { 'x-nova-token': 'wrong' })).status).toBe(401);
    expect((await post(app, { task: 'ping' }, { 'x-nova-token': 'open-sesame' })).status).toBe(200);
  });

  it('rate limits per IP', async () => {
    const app = make({ RATE_LIMIT_PER_MINUTE: 2 });
    const h = { 'x-forwarded-for': '9.9.9.9' };
    expect((await post(app, { task: 'a' }, h)).status).toBe(200);
    expect((await post(app, { task: 'b' }, h)).status).toBe(200);
    expect((await post(app, { task: 'c' }, h)).status).toBe(429);
    expect((await post(app, { task: 'd' }, { 'x-forwarded-for': '8.8.8.8' })).status).toBe(200);
  });

  it('never logs the key', () => {
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(KEY);
  });
});
