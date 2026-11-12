import { describe, expect, it } from 'vitest';
import {
  decryptWithKey,
  decryptWithSecret,
  encryptJson,
  generateRecoveryKey,
  looksLikeRecoveryKey,
  makeKeyParams,
  parseEnvelope,
  InvalidBackupError,
  WrongSecretError,
  type BackupEnvelope,
} from '../src/shared/backup/crypto';
import { filterForBackup, mergeRecords, summarizeCounts } from '../src/shared/backup/snapshot';
// @ts-ignore – plain JS server module
import { validEnvelope } from '../server/backup/routes.js';

const IT = 100_000; // fast in tests; the app uses 600 000
const data = { format: 'nova-data', v: 1, createdAt: '2026-11-12T11:00:00.000Z', stores: { todos: [{ id: 't1', title: 'Steuererklärung abgeben 🧾' }], habits: [] }, local: { 'nova.calView': 'dayGridMonth' } };

describe('backup crypto (AES-GCM + PBKDF2)', () => {
  it('round trip with a password; ciphertext contains no plaintext', async () => {
    const p = await makeKeyParams('korrekt-pferd-batterie', 'password', IT);
    const env = await encryptJson(data, p);
    expect(env).toMatchObject({ format: 'nova-backup', v: 1, kdf: { name: 'PBKDF2', iterations: IT, secret: 'password' }, cipher: { name: 'AES-GCM' } });
    const raw = JSON.stringify(env);
    expect(raw).not.toContain('Steuer');
    expect(raw).not.toContain('korrekt');
    expect(validEnvelope(env)).toBe(true);
    expect(await decryptWithKey(env, p.key)).toEqual(data);
    const { value, params } = await decryptWithSecret(env, 'korrekt-pferd-batterie');
    expect(value).toEqual(data);
    expect(params.salt).toBe(p.salt);
  });

  it('wrong password → WrongSecretError', async () => {
    const env = await encryptJson(data, await makeKeyParams('richtiges-passwort', 'password', IT));
    await expect(decryptWithSecret(env, 'falsches-passwort')).rejects.toBeInstanceOf(WrongSecretError);
    await expect(decryptWithSecret(env, 'falsches-passwort')).rejects.toThrow('Passwort oder Wiederherstellungsschlüssel ist falsch.');
  });

  it('fresh IV and salt every time', async () => {
    const p = await makeKeyParams('x'.repeat(12), 'password', IT);
    const a = await encryptJson(data, p);
    const b = await encryptJson(data, p);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect((await makeKeyParams('x'.repeat(12), 'password', IT)).salt).not.toBe(p.salt);
  });

  it('tampering with data or public parameters fails', async () => {
    const p = await makeKeyParams('tamper-test-123', 'password', IT);
    const env = await encryptJson(data, p);
    const flip = (s: string) => (s[10] === 'A' ? s.slice(0, 10) + 'B' + s.slice(11) : s.slice(0, 10) + 'A' + s.slice(11));
    await expect(decryptWithKey({ ...env, data: flip(env.data) }, p.key)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(decryptWithKey({ ...env, compression: env.compression === 'gzip' ? 'none' : 'gzip' } as BackupEnvelope, p.key)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(decryptWithKey({ ...env, kdf: { ...env.kdf, iterations: IT + 1 } }, p.key)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('recovery key: format, typed in lowercase without dashes still works', async () => {
    const k = generateRecoveryKey();
    expect(k).toMatch(/^([A-HJKMNP-TV-Z2-9]{4}-){5}[A-HJKMNP-TV-Z2-9]{4}$/);
    expect(looksLikeRecoveryKey(k.toLowerCase().replace(/-/g, ' '))).toBe(true);
    expect(new Set(Array.from({ length: 20 }, generateRecoveryKey)).size).toBe(20);
    const env = await encryptJson(data, await makeKeyParams(k, 'recovery', IT));
    expect((await decryptWithSecret(env, k.toLowerCase().replace(/-/g, ''))).value).toEqual(data);
    await expect(decryptWithSecret(env, generateRecoveryKey())).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('parseEnvelope rejects other files; server only accepts the encrypted format', async () => {
    expect(() => parseEnvelope('{"hello":1}')).toThrow(InvalidBackupError);
    expect(() => parseEnvelope('kein json')).toThrow(InvalidBackupError);
    const env = await encryptJson(data, await makeKeyParams('server-check-123', 'password', IT));
    expect(parseEnvelope(JSON.stringify(env))).toEqual(env);
    expect(validEnvelope({ ...env, plaintext: data })).toBe(false);
    expect(validEnvelope({ ...env, kdf: { ...env.kdf, iterations: 1000 } })).toBe(false);
    expect(validEnvelope({ ...env, data: 'not base64!' })).toBe(false);
  });
});

describe('snapshot helpers', () => {
  it('never includes the backup key/state meta', () => {
    expect(filterForBackup('meta', [{ key: 'backup.state', value: {} }, { key: 'morning.config', value: {} }])).toEqual([{ key: 'morning.config', value: {} }]);
  });
  it('merge keeps local, adds missing, takes newer backup records, merges the wake log per day', () => {
    const local = [{ id: 'a', title: 'lokal', updatedAt: '2026-11-12T10:00:00Z' }, { id: 'b', title: 'lokal neuer', updatedAt: '2026-11-12T12:00:00Z' }];
    const incoming = [{ id: 'a', title: 'backup neuer', updatedAt: '2026-11-12T11:00:00Z' }, { id: 'b', title: 'backup alt', updatedAt: '2026-11-11T12:00:00Z' }, { id: 'c', title: 'nur im backup' }];
    expect(mergeRecords('todos', local, incoming).map((r) => (r as { title: string }).title)).toEqual(['backup neuer', 'nur im backup']);
    const merged = mergeRecords('meta', [{ key: 'wake.log', value: { '2026-11-12': { date: '2026-11-12', wokeAt: '06:40' } } }, { key: 'morning.config', value: { x: 1 } }], [
      { key: 'wake.log', value: { '2026-11-11': { date: '2026-11-11', wokeAt: '06:50' }, '2026-11-12': { date: '2026-11-12', wokeAt: '07:30' } } },
      { key: 'morning.config', value: { x: 2 } },
      { key: 'morning.plan', value: { p: 1 } },
    ]);
    expect(merged).toEqual([
      { key: 'wake.log', value: { '2026-11-11': { date: '2026-11-11', wokeAt: '06:50' }, '2026-11-12': { date: '2026-11-12', wokeAt: '06:40' } } },
      { key: 'morning.plan', value: { p: 1 } },
    ]);
  });
  it('summarizes counts in German', () => {
    expect(summarizeCounts({ todos: 1, events: 3, transactions: 0, habits: 2, meta: 9 })).toBe('1 Aufgabe, 3 Termine, 2 Gewohnheiten');
  });
});
