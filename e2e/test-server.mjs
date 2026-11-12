// Starts Nova's combined server with mock Grok-Bot webhook, mock Google and a local push service.
// Control endpoints on CONTROL_PORT let Playwright inspect what the mocks received.
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { createMockGoogle } from '../server/testing/mock-google.js';
import { startTestPushService } from '../server/testing/test-push-service.js';
import { createMockXai } from '../server/testing/mock-xai.js';

const PORT = Number(process.env.E2E_PORT ?? 8797);
const BACKUP_DIR = mkdtempSync(join(tmpdir(), 'nova-e2e-backups-'));
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? 8798);
const WEBHOOK_KEY = 'e2e-SECRET-webhook-key-123456';

const hooks = [];
let hookMode = 'ok';
const webhook = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hooks.push({ headers: req.headers, body: JSON.parse(body || '{}') });
    res.statusCode = hookMode === 'ok' ? 200 : 500;
    res.end('{}');
  });
});
await new Promise((r) => webhook.listen(0, '127.0.0.1', r));

const google = createMockGoogle();
const { config: googleConfig } = await google.listen();
google.remote.insert({ summary: 'Aus Google', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } });

const xai = createMockXai();
const { config: xaiConfig } = await xai.listen();

const pushSvc = await startTestPushService();
const device = pushSvc.subscription('e2e-device');
const vapid = webpush.generateVAPIDKeys();

Object.assign(process.env, {
  PORT: String(PORT),
  HOST: '127.0.0.1',
  NOVA_ENV_FILE: '/nonexistent',
  NOVA_DATA_FILE: join(mkdtempSync(join(tmpdir(), 'nova-e2e-')), 'store.json'),
  NOVA_BACKUP_DIR: BACKUP_DIR,
  GROKBOT_WEBHOOK_URL: `http://127.0.0.1:${webhook.address().port}/automations/webhook/e2e`,
  GROKBOT_WEBHOOK_KEY: WEBHOOK_KEY,
  RATE_LIMIT_PER_MINUTE: '100',
  CALENDAR_FEED_TOKEN: 'e2e-feed-token',
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:e2e@example.invalid',
  SCHEDULER_INTERVAL_MS: '600000',
  NOVA_PUSH_INSECURE_AGENT: '1',
  ...googleConfig,
  ...xaiConfig,
  XAI_MODEL: 'grok-test',
  CHAT_RATE_LIMIT_PER_MINUTE: '200',
});

const { pushAgentForTests } = await import('../server/node.js');
pushAgentForTests?.(pushSvc.agent);
const { runTick } = await import('../server/scheduler.js');
const { fileStore } = await import('../server/store.js');

// Second instance with NOVA_APP_TOKEN (public-server mode) for the pairing flow.
export const E2E_ADMIN_TOKEN = 'e2e-admin-token-0123456789abcdef';
{
  const { serve } = await import('@hono/node-server');
  const { serveStatic } = await import('@hono/node-server/serve-static');
  const { createApp } = await import('../server/app.js');
  const { memoryBackupStore } = await import('../server/backup/store.js');
  const locked = createApp({ getConfig: () => ({ ...process.env, NOVA_APP_TOKEN: E2E_ADMIN_TOKEN, NOVA_DEVICE_SECRET: 'e2e-device-secret-0123456789' }), backups: memoryBackupStore(10) });
  locked.use('/*', serveStatic({ root: 'dist' }));
  locked.get('*', serveStatic({ path: 'dist/index.html' }));
  serve({ fetch: locked.fetch, port: Number(process.env.E2E_LOCKED_PORT ?? 8799), hostname: '127.0.0.1' });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (d) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify(d));
  };
  if (url.pathname === '/hooks') return json(hooks);
  if (url.pathname === '/hook-mode') {
    hookMode = url.searchParams.get('mode') ?? 'ok';
    return json({ hookMode });
  }
  if (url.pathname === '/backups/reset') {
    const { rmSync, mkdirSync } = await import('node:fs');
    rmSync(BACKUP_DIR, { recursive: true, force: true });
    mkdirSync(BACKUP_DIR, { recursive: true });
    return json({ ok: true });
  }
  if (url.pathname === '/backups/raw') {
    const { existsSync, readFileSync, readdirSync } = await import('node:fs');
    const dir = join(BACKUP_DIR, 'versions');
    return json(existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')) : []);
  }
  if (url.pathname === '/xai') return json(xai.requests.map((r) => r.body ?? r));
  if (url.pathname === '/device') return json(device.sub);
  if (url.pathname === '/push-received') return json(pushSvc.received.map((m) => ({ path: m.path, payload: device.decrypt(m.body) })));
  if (url.pathname === '/google') return json([...google.state.events.values()]);
  if (url.pathname === '/store') return json(await fileStore(process.env.NOVA_DATA_FILE).get(url.searchParams.get('key')));
  if (url.pathname === '/tick') {
    const store = fileStore(process.env.NOVA_DATA_FILE);
    const send = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60, agent: pushSvc.agent });
    return json(await runTick({ store, send, now: Date.parse(url.searchParams.get('now') ?? new Date().toISOString()) }));
  }
  res.statusCode = 404;
  res.end();
}).listen(CONTROL_PORT, '127.0.0.1');
console.log(`e2e control on ${CONTROL_PORT}`);
