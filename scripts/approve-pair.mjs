#!/usr/bin/env node
// Approves a Nova device pairing code. Usage: node scripts/approve-pair.mjs <CODE> [serverUrl]
// Reads the admin token (NOVA_APP_TOKEN) from /workspace/nova-secrets/NOVA_APP_TOKEN or .env.
// Prints only success/failure – never the token.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = process.env.NOVA_SECRETS_DIR ?? '/workspace/nova-secrets';
const readEnv = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
      )
    : {};
const fromFile = (name) => (existsSync(join(SECRETS, name)) ? readFileSync(join(SECRETS, name), 'utf8').trim() : '');
const env = readEnv(join(root, '.env'));

const code = process.argv[2];
if (!code) {
  console.log('Fehlgeschlagen: Bitte den Code angeben, z. B. node scripts/approve-pair.mjs K7P-4QX');
  process.exit(2);
}
const token = process.env.NOVA_APP_TOKEN || fromFile('NOVA_APP_TOKEN') || env.NOVA_APP_TOKEN || '';
const base = (process.argv[3] || process.env.NOVA_SERVER_URL || fromFile('PUBLIC_BASE_URL') || env.PUBLIC_BASE_URL || 'https://nova-server-vp4n.onrender.com').replace(/\/$/, '');
if (!token) {
  console.log('Fehlgeschlagen: Kein NOVA_APP_TOKEN gefunden.');
  process.exit(2);
}
try {
  const res = await fetch(`${base}/api/pair/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nova-token': token },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(90_000), // free instance may need to wake up
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) {
    console.log('Erfolg: Kopplung bestätigt.');
    process.exit(0);
  }
  console.log(`Fehlgeschlagen: ${data.error ?? `HTTP ${res.status}`}${data.message ? ` – ${data.message}` : ''}`);
  process.exit(1);
} catch (err) {
  console.log(`Fehlgeschlagen: Server nicht erreichbar (${err?.name ?? 'Fehler'}).`);
  process.exit(1);
}
