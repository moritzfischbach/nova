// E2E-encrypted backups. The server stores opaque envelopes only – never plaintext, never keys.
//   GET  /api/backup/status  public -> { configured, storage, keep }
//   GET  /api/backup         auth   -> { versions: BackupMeta[] }
//   GET  /api/backup/:id     auth   -> { meta, envelope }
//   POST /api/backup         auth   { envelope, device? } -> { version, versions }
import { clientIp, requireAppAuth } from '../auth.js';
import { newBackupId, validBackupId } from './store.js';

export const BACKUP_LIMITS = { maxBytes: 8 * 1024 * 1024, writesPerWindow: 30, windowMs: 10 * 60_000 };

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Shape check: only the encrypted envelope format is accepted (no plaintext fields). */
export function validEnvelope(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const allowed = new Set(['format', 'v', 'kdf', 'cipher', 'compression', 'createdAt', 'data']);
  if (Object.keys(e).some((k) => !allowed.has(k))) return false;
  if (e.format !== 'nova-backup' || e.v !== 1) return false;
  if (!e.kdf || e.kdf.name !== 'PBKDF2' || typeof e.kdf.salt !== 'string' || !B64.test(e.kdf.salt) || !(Number(e.kdf.iterations) >= 100_000)) return false;
  if (!e.cipher || e.cipher.name !== 'AES-GCM' || typeof e.cipher.iv !== 'string' || !B64.test(e.cipher.iv)) return false;
  if (typeof e.data !== 'string' || e.data.length < 16 || !B64.test(e.data)) return false;
  return true;
}

function windowLimiter(max, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 2000) hits.clear();
    return true;
  };
}

/**
 * @param {*} app
 * @param {{ getConfig: Function, backups?: import('./store.js').BackupStore, log?: Function, keep?: number }} deps
 */
export function registerBackupRoutes(app, { getConfig, backups, log = () => {}, keep = 10 }) {
  const allowWrite = windowLimiter(BACKUP_LIMITS.writesPerWindow, BACKUP_LIMITS.windowMs);
  const unavailable = (c) => c.json({ ok: false, error: 'backup_not_configured', message: 'Backups sind auf dem Server nicht eingerichtet.' }, 503);
  const failed = (c, e) => {
    log(`backup storage error: ${e instanceof Error ? e.message : String(e)}`);
    return c.json({ ok: false, error: 'storage_failed', message: 'Backup-Speicher gerade nicht erreichbar. Bitte später erneut versuchen.' }, 502);
  };

  app.get('/api/backup/status', (c) => c.json({ ok: true, configured: Boolean(backups), storage: backups?.kind, keep }));

  app.get('/api/backup', async (c) => {
    const denied = await requireAppAuth(c, getConfig(c));
    if (denied) return denied;
    if (!backups) return unavailable(c);
    try {
      return c.json({ ok: true, versions: await backups.list(), keep });
    } catch (e) {
      return failed(c, e);
    }
  });

  app.get('/api/backup/:id', async (c) => {
    const denied = await requireAppAuth(c, getConfig(c));
    if (denied) return denied;
    if (!backups) return unavailable(c);
    const id = c.req.param('id');
    if (!validBackupId(id)) return c.json({ ok: false, error: 'invalid_id' }, 400);
    try {
      const v = await backups.get(id);
      if (!v) return c.json({ ok: false, error: 'not_found', message: 'Diese Version gibt es nicht mehr.' }, 404);
      return c.json({ ok: true, meta: v.meta, envelope: v.envelope });
    } catch (e) {
      return failed(c, e);
    }
  });

  app.post('/api/backup', async (c) => {
    const denied = await requireAppAuth(c, getConfig(c));
    if (denied) return denied;
    if (!backups) return unavailable(c);
    if (!allowWrite(clientIp(c))) return c.json({ ok: false, error: 'rate_limited', message: 'Zu viele Backups in kurzer Zeit.' }, 429);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > BACKUP_LIMITS.maxBytes) return c.json({ ok: false, error: 'too_large', message: 'Backup ist zu groß.' }, 413);
    const raw = await c.req.text();
    if (raw.length > BACKUP_LIMITS.maxBytes) return c.json({ ok: false, error: 'too_large', message: 'Backup ist zu groß.' }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (!validEnvelope(body?.envelope)) return c.json({ ok: false, error: 'invalid_envelope', message: 'Nur verschlüsselte Nova-Backups werden angenommen.' }, 400);
    const now = new Date();
    const meta = {
      id: newBackupId(now),
      createdAt: now.toISOString(),
      device: typeof body.device === 'string' ? body.device.replace(/[^\p{L}\p{N} ·()\-.,]/gu, '').slice(0, 40) : undefined,
      size: body.envelope.data.length,
    };
    try {
      const versions = await backups.put(meta, body.envelope);
      return c.json({ ok: true, version: meta, versions, keep });
    } catch (e) {
      return failed(c, e);
    }
  });
}
