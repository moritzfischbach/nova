// Device-code pairing (like TV logins):
//   POST /api/pair/start    public, rate-limited -> { code: "K7P-4QX", poll_id, expires_in, interval }
//   POST /api/pair/poll     { poll_id }          -> { status: pending | approved (+ token) | expired }
//   POST /api/pair/approve  { code }, admin only (X-Nova-Token = NOVA_APP_TOKEN)
// Pending codes live in memory (15 min); issued device tokens are HMAC-signed and need no storage.
import { clientIp, isAdmin } from './auth.js';
import { deviceSecret, issueDeviceToken, randomId } from './device-token.js';

export const PAIR_LIMITS = { ttlMs: 15 * 60_000, maxPending: 50, startsPerWindow: 5, windowMs: 10 * 60_000, approvesPerMinute: 20, pollIntervalS: 3 };
// no 0/O, 1/I/L, U/V – easy to read aloud and type
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';

export function normalizeCode(input) {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code) {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function windowLimiter(max, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

async function readJson(c) {
  if (!(c.req.header('content-type') ?? '').includes('application/json')) return null;
  const raw = await c.req.text();
  if (raw.length > 2000) return null;
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function registerPairRoutes(app, { getConfig, log = () => {}, now = () => Date.now() }) {
  /** @type {Map<string, { code: string, pollId: string, expiresAt: number, approved: boolean, token?: string, delivered?: boolean }>} */
  const pending = new Map(); // by code
  const byPoll = new Map(); // pollId -> code
  const startLimit = windowLimiter(PAIR_LIMITS.startsPerWindow, PAIR_LIMITS.windowMs);
  const approveLimit = windowLimiter(PAIR_LIMITS.approvesPerMinute, 60_000);

  const sweep = () => {
    const t = now();
    for (const [code, p] of pending) {
      if (p.expiresAt <= t) {
        pending.delete(code);
        byPoll.delete(p.pollId);
      }
    }
  };

  app.get('/api/pair/status', (c) => {
    const cfg = getConfig(c);
    return c.json({ ok: true, enabled: Boolean(cfg.NOVA_APP_TOKEN && deviceSecret(cfg)) });
  });

  app.post('/api/pair/start', async (c) => {
    const cfg = getConfig(c);
    if (!cfg.NOVA_APP_TOKEN || !deviceSecret(cfg)) {
      return c.json({ ok: false, error: 'pairing_disabled', message: 'Koppeln ist auf diesem Server nicht eingerichtet (NOVA_APP_TOKEN fehlt).' }, 503);
    }
    if (!startLimit(clientIp(c), now())) {
      return c.json({ ok: false, error: 'rate_limited', message: 'Zu viele Kopplungsversuche. Bitte in ein paar Minuten noch einmal.' }, 429);
    }
    sweep();
    if (pending.size >= PAIR_LIMITS.maxPending) {
      return c.json({ ok: false, error: 'busy', message: 'Gerade laufen zu viele Kopplungen. Bitte später noch einmal.' }, 429);
    }
    let code = newCode();
    while (pending.has(code)) code = newCode();
    const pollId = randomId(24);
    pending.set(code, { code, pollId, expiresAt: now() + PAIR_LIMITS.ttlMs, approved: false });
    byPoll.set(pollId, code);
    log(`pair start ${formatCode(code).slice(0, 2)}…`);
    return c.json({ ok: true, code: formatCode(code), poll_id: pollId, expires_in: Math.round(PAIR_LIMITS.ttlMs / 1000), interval: PAIR_LIMITS.pollIntervalS });
  });

  app.post('/api/pair/poll', async (c) => {
    const body = await readJson(c);
    const pollId = typeof body?.poll_id === 'string' ? body.poll_id : '';
    sweep();
    const code = byPoll.get(pollId);
    const p = code ? pending.get(code) : undefined;
    if (!p) return c.json({ ok: true, status: 'expired' });
    if (!p.approved) return c.json({ ok: true, status: 'pending', expires_in: Math.max(0, Math.round((p.expiresAt - now()) / 1000)) });
    // deliver once, then forget the code
    log('pair token delivered');
    pending.delete(p.code);
    byPoll.delete(p.pollId);
    return c.json({ ok: true, status: 'approved', token: p.token });
  });

  app.post('/api/pair/approve', async (c) => {
    const cfg = getConfig(c);
    if (!approveLimit(clientIp(c), now())) return c.json({ ok: false, error: 'rate_limited', message: 'Zu viele Versuche.' }, 429);
    if (!isAdmin(c, cfg)) return c.json({ ok: false, error: 'unauthorized', message: 'Nur mit dem Admin-Zugangscode möglich.' }, 401);
    const body = await readJson(c);
    const code = normalizeCode(body?.code);
    sweep();
    const p = pending.get(code);
    if (!p) return c.json({ ok: false, error: 'unknown_code', message: 'Code unbekannt oder abgelaufen.' }, 404);
    if (!p.approved) {
      p.approved = true;
      p.token = await issueDeviceToken(cfg);
    }
    log('pair approved');
    return c.json({ ok: true, status: 'approved' });
  });
}
