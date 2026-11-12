// Local / Node entry: API + built PWA (dist/) from one process.
//   node server/node.js            (reads .env if present)
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { fileStore } from './store.js';
import { dirBackupStore, gitBackupStore } from './backup/store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(process.env.NOVA_ENV_FILE ?? join(root, '.env'));

const log = (msg) => console.log(`[nova-server] ${msg}`);
const store = fileStore(process.env.NOVA_DATA_FILE ?? join(root, 'server', 'data', 'store.json'));

let push;
let testAgent; // only set by e2e/test-server.mjs (self-signed local push service)
export function pushAgentForTests(agent) {
  if (process.env.NOVA_PUSH_INSECURE_AGENT === '1') testAgent = agent;
}
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:nova@example.invalid', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  push = { send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high', ...(testAgent ? { agent: testAgent } : {}) }) };
  startScheduler({ store, send: push.send, intervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000), log });
}

const backupKeep = Math.max(1, Math.min(50, Number(process.env.NOVA_BACKUP_KEEP ?? 10) || 10));
// durable: private GitHub repo via deploy key (Render free has no persistent disk); local fallback: server/data/backups
const backups =
  process.env.NOVA_BACKUP_REPO && process.env.NOVA_BACKUP_SSH_KEY_B64
    ? gitBackupStore({ repo: process.env.NOVA_BACKUP_REPO, keyB64: process.env.NOVA_BACKUP_SSH_KEY_B64, keep: backupKeep, log })
    : process.env.NOVA_BACKUP_DISABLED === '1'
      ? undefined
      : dirBackupStore(process.env.NOVA_BACKUP_DIR ?? join(root, 'server', 'data', 'backups'), backupKeep);

const app = createApp({ getConfig: () => process.env, log, store, push, backups, backupKeep });

const distDir = process.env.NOVA_DIST_DIR ?? join(root, 'dist');
const distRel = relative(process.cwd(), distDir) || '.';
app.use('/*', serveStatic({ root: distRel }));
app.get('*', serveStatic({ path: join(distRel, 'index.html') }));

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '0.0.0.0';
serve({ fetch: app.fetch, port, hostname }, (info) => {
  const configured = Boolean(process.env.GROKBOT_WEBHOOK_URL && process.env.GROKBOT_WEBHOOK_KEY);
  console.log(`[nova-server] http://localhost:${info.port}  (Grok Bot ${configured ? 'konfiguriert' : 'nicht konfiguriert'}, Push ${push ? 'aktiv' : 'aus'}, Google ${process.env.GOOGLE_CLIENT_ID ? 'konfiguriert' : 'nicht konfiguriert'}, Chat ${process.env.XAI_API_KEY ? 'konfiguriert' : 'nicht konfiguriert'}, Backup ${backups?.kind ?? 'aus'})`);
});
