import { safeEqual } from './validate.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientIp(c) {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.env?.incoming?.socket?.remoteAddress ??
    'unknown'
  );
}

/**
 * Sensitive endpoints (calendar sync, push): require NOVA_APP_TOKEN if set.
 * Without a token, only direct loopback requests (local mode) are allowed.
 * Returns a Response to short-circuit, or null when allowed.
 */
export function requireAppAuth(c, cfg, { allowQueryToken = false } = {}) {
  const token = c.req.header('x-nova-token') ?? (allowQueryToken ? c.req.query('t') : undefined) ?? '';
  if (cfg.NOVA_APP_TOKEN) {
    if (safeEqual(token, cfg.NOVA_APP_TOKEN)) return null;
    return c.json({ ok: false, error: 'unauthorized', message: 'Zugangscode fehlt oder ist falsch.' }, 401);
  }
  const forwarded = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip');
  const remote = c.env?.incoming?.socket?.remoteAddress;
  if (!forwarded && remote && LOOPBACK.has(remote)) return null;
  if (cfg.NOVA_ALLOW_UNAUTHENTICATED === '1') return null; // tests / trusted LAN only
  return c.json(
    { ok: false, error: 'unauthorized', message: 'Für diesen Zugriff muss auf dem Server NOVA_APP_TOKEN gesetzt sein.' },
    401,
  );
}
