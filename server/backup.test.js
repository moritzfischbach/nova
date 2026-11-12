import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { issueDeviceToken } from './device-token.js';
import { dirBackupStore, gitBackupStore, memoryBackupStore, newBackupId, validBackupId } from './backup/store.js';

const ADMIN = 'admin-token-0123456789abcdef';
const cfg = { NOVA_APP_TOKEN: ADMIN, NOVA_DEVICE_SECRET: 'device-secret-0123456789abcdef' };
const env = (n = 0) => ({
  format: 'nova-backup',
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'c2FsdHNhbHRzYWx0c2FsdA==', secret: 'password' },
  cipher: { name: 'AES-GCM', iv: 'aXZpdml2aXZpdml2' },
  compression: 'gzip',
  createdAt: new Date().toISOString(),
  data: Buffer.from(`ciphertext-${n}-`.repeat(4)).toString('base64'),
});
const mk = (backups = memoryBackupStore(3)) => createApp({ getConfig: () => cfg, backups, backupKeep: 3 });
const call = (a, path, { method = 'GET', body, token } = {}) =>
  a.request(`http://nova.local${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...(token ? { 'x-nova-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });

describe('backup API', () => {
  it('status is public, everything else needs a paired device', async () => {
    const a = mk();
    expect(await (await call(a, '/api/backup/status')).json()).toEqual({ ok: true, configured: true, storage: 'memory', keep: 3 });
    expect((await call(a, '/api/backup')).status).toBe(401);
    expect((await call(a, '/api/backup', { method: 'POST', body: { envelope: env() } })).status).toBe(401);
    expect((await call(a, '/api/backup', { token: 'nd1.fake.1.x' })).status).toBe(401);
  });

  it('stores versions newest first, keeps the last N, returns one version by id', async () => {
    const a = mk();
    const token = await issueDeviceToken(cfg);
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await (await call(a, '/api/backup', { method: 'POST', token, body: { envelope: env(i), device: 'iPhone · Safari<script>' } })).json();
      expect(r.ok).toBe(true);
      expect(validBackupId(r.version.id)).toBe(true);
      ids.push(r.version.id);
      await new Promise((res) => setTimeout(res, 1100));
    }
    const list = await (await call(a, '/api/backup', { token })).json();
    expect(list.versions.map((v) => v.id)).toEqual(ids.slice(2).reverse());
    expect(list.versions[0].device).toBe('iPhone · Safariscript');
    const one = await (await call(a, `/api/backup/${ids[4]}`, { token })).json();
    expect(one.envelope.data).toBe(env(4).data);
    expect((await call(a, `/api/backup/${ids[0]}`, { token })).status).toBe(404);
    expect((await call(a, '/api/backup/..%2F..%2Fetc', { token })).status).toBe(400);
  }, 15000);

  it('rejects anything that is not an encrypted envelope', async () => {
    const a = mk();
    const token = await issueDeviceToken(cfg);
    expect((await call(a, '/api/backup', { method: 'POST', token, body: { envelope: { todos: [] } } })).status).toBe(400);
    expect((await call(a, '/api/backup', { method: 'POST', token, body: { envelope: { ...env(), extra: 'plain' } } })).status).toBe(400);
  });

  it('503 without storage', async () => {
    const a = createApp({ getConfig: () => cfg });
    const token = await issueDeviceToken(cfg);
    expect((await call(a, '/api/backup', { token })).status).toBe(503);
    expect((await (await call(a, '/api/backup/status')).json()).configured).toBe(false);
  });
});

describe('backup stores', () => {
  it('ids sort by time', () => {
    const a = newBackupId(new Date('2026-11-12T10:00:00Z'));
    expect(a).toMatch(/^20261112T100000Z-[a-z0-9]{6}$/);
  });

  it('dir store keeps N on disk', async () => {
    const s = dirBackupStore(mkdtempSync(join(tmpdir(), 'nova-bk-')), 2);
    for (let i = 0; i < 3; i += 1) await s.put({ id: newBackupId(new Date(Date.UTC(2026, 10, 12, 10, i))), createdAt: new Date(Date.UTC(2026, 10, 12, 10, i)).toISOString(), size: 1 }, env(i));
    const list = await s.list();
    expect(list.length).toBe(2);
    expect((await s.get(list[0].id)).envelope.data).toBe(env(2).data);
  });

  it('git store: pushes one orphan commit holding only the last N versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nova-git-'));
    const remote = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const s = gitBackupStore({ repo: remote, keyB64: Buffer.from('unused').toString('base64'), keep: 2, workDir: join(root, 'work') });
    expect(await s.list()).toEqual([]);
    for (let i = 0; i < 3; i += 1) await s.put({ id: newBackupId(new Date(Date.UTC(2026, 10, 12, 9, i))), createdAt: new Date(Date.UTC(2026, 10, 12, 9, i)).toISOString(), size: 10 }, env(i));
    expect((await s.list()).length).toBe(2);
    const log = execFileSync('git', ['--git-dir', remote, 'log', '--oneline', 'main']).toString().trim().split('\n');
    expect(log.length).toBe(1);
    const files = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main']).toString().trim().split('\n');
    expect(files.filter((f) => f.startsWith('versions/')).length).toBe(2);
    expect(files).toContain('index.json');
    // a second server instance (fresh work dir) sees the same versions
    const s2 = gitBackupStore({ repo: remote, keyB64: 'dW51c2Vk', keep: 2, workDir: join(root, 'work2') });
    const l2 = await s2.list();
    expect(l2.map((v) => v.id)).toEqual((await s.list()).map((v) => v.id));
    expect((await s2.get(l2[0].id)).envelope.data).toBe(env(2).data);
  }, 30000);
});
