// Stateless device tokens for paired devices: nd1.<deviceId>.<issuedAt>.<hmac>
// HMAC-SHA256 over "nd1.<deviceId>.<issuedAt>" with NOVA_DEVICE_SECRET (fallback: derived from
// NOVA_APP_TOKEN). No storage needed, so they survive restarts of the free Render instance.
// Revoke all devices by rotating NOVA_DEVICE_SECRET. Uses Web Crypto (Node 20+ and Workers).
import { safeEqual } from './validate.js';

const enc = new TextEncoder();
const PREFIX = 'nd1';

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(bytes = 12) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Signing secret, or '' when pairing is not possible (no NOVA_APP_TOKEN and no NOVA_DEVICE_SECRET). */
export function deviceSecret(cfg) {
  if (cfg.NOVA_DEVICE_SECRET && String(cfg.NOVA_DEVICE_SECRET).length >= 16) return `ds:${cfg.NOVA_DEVICE_SECRET}`;
  if (cfg.NOVA_APP_TOKEN) return `at:${cfg.NOVA_APP_TOKEN}`;
  return '';
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`nova-device-v1|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export async function issueDeviceToken(cfg, { deviceId = randomId(), now = Date.now() } = {}) {
  const secret = deviceSecret(cfg);
  if (!secret) throw new Error('no device secret');
  const body = `${PREFIX}.${deviceId}.${Math.floor(now / 1000)}`;
  return `${body}.${await sign(secret, body)}`;
}

export async function verifyDeviceToken(cfg, token) {
  if (typeof token !== 'string' || token.length > 200 || !token.startsWith(`${PREFIX}.`)) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || !/^[\w-]{8,40}$/.test(parts[1]) || !/^\d{9,11}$/.test(parts[2])) return false;
  const secret = deviceSecret(cfg);
  if (!secret) return false;
  const expected = await sign(secret, parts.slice(0, 3).join('.'));
  return safeEqual(parts[3], expected);
}
