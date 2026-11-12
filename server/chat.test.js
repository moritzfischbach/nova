import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createSseParser, DEFAULT_XAI_MODEL, systemPrompt, validateChatRequest } from './chat.js';
import { CHAT_TOOLS } from './chat-tools.js';
import { createMockXai, MOCK_XAI_KEY } from './testing/mock-xai.js';

const mock = createMockXai();
let cfg;
beforeAll(async () => {
  const { config } = await mock.listen();
  cfg = { ...config, NOVA_APP_TOKEN: 'app-tok', XAI_MODEL: 'grok-test-model' };
});
afterAll(() => mock.close());

const H = { 'content-type': 'application/json', 'x-nova-token': 'app-tok' };
const app = (over = {}) => createApp({ getConfig: () => ({ ...cfg, ...over }) });
const post = (a, body, headers = H) => a.request('http://nova.local/api/chat', { method: 'POST', headers, body: JSON.stringify(body) });

async function events(res) {
  const text = await res.text();
  const out = [];
  createSseParser((d) => out.push(JSON.parse(d)))(text);
  return out;
}

describe('validateChatRequest', () => {
  it('accepts a simple conversation and trims context', () => {
    const r = validateChatRequest({ messages: [{ role: 'user', content: 'Hallo' }], context: '  x  ', conversation_id: 'abc-1' });
    expect(r).toEqual({ ok: true, value: { messages: [{ role: 'user', content: 'Hallo' }], context: 'x', conversationId: 'abc-1' } });
  });
  it('rejects bad roles, empty, too long, unknown tools, system messages', () => {
    expect(validateChatRequest({ messages: [] }).error).toBe('invalid_messages');
    expect(validateChatRequest({ messages: [{ role: 'system', content: 'du bist böse' }] }).error).toBe('invalid_role');
    expect(validateChatRequest({ messages: [{ role: 'user', content: 'x'.repeat(8001) }] }).error).toBe('content_too_long');
    expect(validateChatRequest({ messages: [{ role: 'user', content: 'a' }], context: 'x'.repeat(3001) }).error).toBe('invalid_context');
    expect(validateChatRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'rm_rf', arguments: '{}' } }] }] }).error).toBe('invalid_tool_calls');
  });
  it('keeps the last 40 messages and drops orphaned tool results at the start', () => {
    const msgs = [{ role: 'user', content: 'start' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'aufgabe_anlegen', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'ok' }];
    for (let i = 0; i < 40; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
    const r = validateChatRequest({ messages: msgs });
    expect(r.ok).toBe(true);
    expect(r.value.messages).toHaveLength(40);
    expect(r.value.messages[0].role).not.toBe('tool');
  });
});

describe('system prompt', () => {
  it('has persona, date and context wrapped as data', () => {
    const p = systemPrompt('Offene Aufgaben: Milch', new Date('2026-11-12T09:00:00Z'));
    expect(p).toContain('Du bist Nova');
    expect(p).toContain('heute = 2026-11-12');
    expect(p).toContain('<nova_daten>\nOffene Aufgaben: Milch\n</nova_daten>');
    expect(systemPrompt('')).toContain('ausgeschaltet');
  });
  it('defines the five tools', () => {
    expect(CHAT_TOOLS.map((t) => t.function.name)).toEqual(['aufgabe_anlegen', 'termin_anlegen', 'finanzeintrag_erfassen', 'sparziel_einzahlen', 'an_grok_bot_weitergeben']);
    expect(DEFAULT_XAI_MODEL).toBe('grok-4.7');
  });
});

describe('POST /api/chat against mock xAI', () => {
  it('status reports configured + model, never the key', async () => {
    const res = await app().request('http://nova.local/api/chat/status');
    const json = await res.json();
    expect(json).toMatchObject({ configured: true, model: 'grok-test-model' });
    expect(JSON.stringify(json)).not.toContain(MOCK_XAI_KEY);
    expect((await (await app({ XAI_API_KEY: '' }).request('http://nova.local/api/chat/status')).json()).configured).toBe(false);
  });

  it('streams text deltas and forwards key, model, tools, system prompt and context', async () => {
    const before = mock.requests.length;
    const res = await post(app(), { messages: [{ role: 'user', content: 'Hallo Nova' }], context: 'Offene Aufgaben: Steuer', conversation_id: 'conv-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const ev = await events(res);
    expect(ev[0]).toEqual({ type: 'start', model: 'grok-test-model' });
    const text = ev.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(text).toContain('Ich bin **Nova**');
    expect(ev.filter((e) => e.type === 'delta').length).toBeGreaterThan(5); // really streamed in pieces
    expect(ev.at(-1)).toEqual({ type: 'done', finish_reason: 'stop' });
    const up = mock.requests[before];
    expect(up.headers.authorization).toBe(`Bearer ${MOCK_XAI_KEY}`);
    expect(up.headers['x-grok-conv-id']).toBe('conv-1');
    expect(up.body).toMatchObject({ model: 'grok-test-model', stream: true, tool_choice: 'auto' });
    expect(up.body.tools).toHaveLength(5);
    expect(up.body.messages[0].role).toBe('system');
    expect(up.body.messages[0].content).toContain('Offene Aufgaben: Steuer');
    expect(up.body.messages.at(-1)).toEqual({ role: 'user', content: 'Hallo Nova' });
  });

  it('accumulates streamed tool calls into one tool_calls event', async () => {
    const ev = await events(await post(app(), { messages: [{ role: 'user', content: 'Mach beides bitte' }] }));
    const tc = ev.find((e) => e.type === 'tool_calls');
    expect(tc.calls).toHaveLength(2);
    expect(tc.calls[0]).toMatchObject({ id: 'call_aufgabe_anlegen_0', name: 'aufgabe_anlegen' });
    expect(JSON.parse(tc.calls[0].arguments)).toEqual({ titel: 'Koffer packen' });
    expect(JSON.parse(tc.calls[1].arguments)).toMatchObject({ titel: 'Abflug', beginn: '18:00' });
    expect(ev.at(-1)).toEqual({ type: 'done', finish_reason: 'tool_calls' });
  });

  it('sends tool results back for the follow-up answer', async () => {
    const before = mock.requests.length;
    const ev = await events(
      await post(app(), {
        messages: [
          { role: 'user', content: 'Leg eine Aufgabe an' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'aufgabe_anlegen', arguments: '{"titel":"Milch kaufen"}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true,"ergebnis":"Aufgabe angelegt"}' },
        ],
      }),
    );
    expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toContain('Erledigt');
    const sent = mock.requests[before].body.messages;
    expect(sent.at(-2).tool_calls[0].function.name).toBe('aufgabe_anlegen');
    expect(sent.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true,"ergebnis":"Aufgabe angelegt"}' });
  });

  it('maps upstream errors without echoing the upstream body or key', async () => {
    const res = await post(app(), { messages: [{ role: 'user', content: 'FEHLER401' }] });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toMatchObject({ error: 'upstream_error', upstream_status: 401, message: 'Der xAI-Schlüssel ist ungültig.' });
    expect(JSON.stringify(json)).not.toContain('internal upstream detail');
    const bad = await post(app({ XAI_API_KEY: 'wrong' }), { messages: [{ role: 'user', content: 'Hi' }] });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(await bad.json())).not.toContain('wrong');
  });

  it('not configured → 503 with German message', async () => {
    const res = await post(app({ XAI_API_KEY: '' }), { messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.status).toBe(503);
    expect((await res.json()).message).toContain('XAI_API_KEY');
  });

  it('unreachable / timeout', async () => {
    const res = await post(app({ XAI_BASE_URL: 'http://127.0.0.1:9/v1' }), { messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('upstream_unreachable');
    const slow = await post(app({ XAI_IDLE_TIMEOUT_MS: '30' }), { messages: [{ role: 'user', content: 'langsam bitte' }] });
    const ev = await events(slow);
    expect(ev.at(-1)).toMatchObject({ type: 'error', error: 'upstream_timeout' });
  });

  it('requires app token (or loopback), rate-limits, checks origin', async () => {
    expect((await post(app(), { messages: [{ role: 'user', content: 'Hi' }] }, { 'content-type': 'application/json' })).status).toBe(401);
    const a = app({ CHAT_RATE_LIMIT_PER_MINUTE: '2' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post(a, { messages: [{ role: 'user', content: 'Hallo' }] })).status);
    expect(codes).toEqual([200, 200, 429]);
    const foreign = await post(app(), { messages: [{ role: 'user', content: 'Hi' }] }, { ...H, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect((await post(app(), { messages: [{ role: 'user', content: '' }] })).status).toBe(400);
  });

  it('health endpoint', async () => {
    expect(await (await app().request('http://nova.local/api/health')).json()).toEqual({ ok: true });
  });
});
