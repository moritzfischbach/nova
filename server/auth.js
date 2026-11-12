import { safeEqual } from './validate.js';
import { verifyDeviceToken } from './device-token.js';

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
export async function requireAppAuth(c, cfg, { allowQueryToken = false } = {}) {
  const token = c.req.header('x-nova-token') ?? (allowQueryToken ? c.req.query('t') : undefined) ?? '';
  if (cfg.NOVA_APP_TOKEN) {
    if (safeEqual(token, cfg.NOVA_APP_TOKEN)) return null;
    if (await verifyDeviceToken(cfg, token)) return null;
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

/** True if the request carries the admin token (NOVA_APP_TOKEN) – device tokens do not count. */
export function isAdmin(c, cfg) {
  return Boolean(cfg.NOVA_APP_TOKEN) && safeEqual(c.req.header('x-nova-token') ?? '', String(cfg.NOVA_APP_TOKEN));
}

/** Whether the request is authorized for app endpoints (admin or paired device token). */
export async function hasAppAccess(c, cfg) {
  if (!cfg.NOVA_APP_TOKEN) return true;
  const token = c.req.header('x-nova-token') ?? '';
  return safeEqual(token, String(cfg.NOVA_APP_TOKEN)) || (await verifyDeviceToken(cfg, token));
}
