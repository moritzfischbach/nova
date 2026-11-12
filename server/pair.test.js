import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { issueDeviceToken, verifyDeviceToken } from './device-token.js';
import { CODE_ALPHABET, normalizeCode } from './pair.js';

const ADMIN = 'admin-token-0123456789abcdef';
const cfg = { NOVA_APP_TOKEN: ADMIN, NOVA_DEVICE_SECRET: 'device-secret-0123456789abcdef', XAI_API_KEY: '' };
const J = { 'content-type': 'application/json' };
const mk = (over = {}) => createApp({ getConfig: () => ({ ...cfg, ...over }) });
const req = (a, path, body, headers = {}, ip = '203.0.113.7') =>
  a.request(`http://nova.local${path}`, { method: 'POST', headers: { ...J, 'x-forwarded-for': ip, ...headers }, body: JSON.stringify(body ?? {}) });

afterEach(() => vi.useRealTimers());

describe('device tokens', () => {
  it('verifies signed tokens and rejects tampering / other secrets', async () => {
    const t = await issueDeviceToken(cfg);
    expect(t).toMatch(/^nd1\.[\w-]+\.\d+\.[\w-]+$/);
    expect(await verifyDeviceToken(cfg, t)).toBe(true);
    expect(await verifyDeviceToken({ ...cfg, NOVA_DEVICE_SECRET: 'another-secret-0123456789' }, t)).toBe(false);
    expect(await verifyDeviceToken(cfg, t.slice(0, -2) + 'xx')).toBe(false);
    expect(await verifyDeviceToken(cfg, 'nd1.a.b.c')).toBe(false);
    expect(await verifyDeviceToken({}, t)).toBe(false);
  });
});

describe('pairing flow', () => {
  it('start → pending → admin approve → poll delivers a working device token once', async () => {
    const a = mk();
    const start = await (await req(a, '/api/pair/start')).json();
    expect(start.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{3}-[${CODE_ALPHABET}]{3}$`));
    expect(start.expires_in).toBe(900);
    expect(start.poll_id.length).toBeGreaterThan(20);
    expect((await (await req(a, '/api/pair/poll', { poll_id: start.poll_id })).json()).status).toBe('pending');

    // code alone is useless: approve needs the admin token, device tokens do not count
    expect((await req(a, '/api/pair/approve', { code: start.code })).status).toBe(401);
    const someDevice = await issueDeviceToken(cfg);
    expect((await req(a, '/api/pair/approve', { code: start.code }, { 'x-nova-token': someDevice })).status).toBe(401);

    const ok = await req(a, '/api/pair/approve', { code: start.code.toLowerCase().replace('-', ' ') }, { 'x-nova-token': ADMIN });
    expect(ok.status).toBe(200);
    const done = await (await req(a, '/api/pair/poll', { poll_id: start.poll_id })).json();
    expect(done.status).toBe('approved');
    expect(await verifyDeviceToken(cfg, done.token)).toBe(true);
    expect((await (await req(a, '/api/pair/poll', { poll_id: start.poll_id })).json()).status).toBe('expired');

    // the device token unlocks app endpoints, survives a "restart" (new app instance)
    const restarted = mk();
    const status = await (await restarted.request('http://nova.local/api/chat/status', { headers: { 'x-nova-token': done.token } })).json();
    expect(status.authorized).toBe(true);
    const bad = await (await restarted.request('http://nova.local/api/chat/status', { headers: { 'x-nova-token': 'nope' } })).json();
    expect(bad.authorized).toBe(false);
    const chat = await req(restarted, '/api/chat', { messages: [{ role: 'user', content: 'Hi' }] }, { 'x-nova-token': done.token });
    expect(chat.status).toBe(503); // authorized, just no xAI key in this test
  });

  it('codes expire after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const a = mk();
    const start = await (await req(a, '/api/pair/start')).json();
    vi.setSystemTime(new Date('2026-11-12T10:15:01Z'));
    expect((await (await req(a, '/api/pair/poll', { poll_id: start.poll_id })).json()).status).toBe('expired');
    expect((await req(a, '/api/pair/approve', { code: start.code }, { 'x-nova-token': ADMIN })).status).toBe(404);
  });

  it('rate-limits starts per IP and is disabled without NOVA_APP_TOKEN', async () => {
    const a = mk();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await req(a, '/api/pair/start', {}, {}, '198.51.100.1')).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await req(a, '/api/pair/start', {}, {}, '198.51.100.2')).status).toBe(200);
    expect((await req(mk({ NOVA_APP_TOKEN: '', NOVA_DEVICE_SECRET: '' }), '/api/pair/start')).status).toBe(503);
  });

  it('normalizes codes', () => {
    expect(normalizeCode(' k7p-4qx ')).toBe('K7P4QX');
  });

  it('works without NOVA_DEVICE_SECRET (derived from NOVA_APP_TOKEN)', async () => {
    const c2 = { NOVA_APP_TOKEN: ADMIN };
    const t = await issueDeviceToken(c2);
    expect(await verifyDeviceToken(c2, t)).toBe(true);
    expect(await verifyDeviceToken({ NOVA_APP_TOKEN: 'other-admin-token-xyz' }, t)).toBe(false);
  });
});
