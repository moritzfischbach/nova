import { startTestPushService } from './testing/test-push-service.js';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { dueReminders, mergeReminders, pruneReminders, runTick, sanitizeReminders } from './scheduler.js';
import { memoryStore } from './store.js';

const T = Date.parse('2026-11-12T08:00:00Z');

describe('scheduler', () => {
  it('sanitizes input', () => {
    const r = sanitizeReminders([{ id: 'a', at: '2026-11-12T09:00:00+01:00', title: 'X', url: 'javascript:alert(1)' }, { id: 'b' }, null, { id: 'c', at: 'nope', title: 'y' }]);
    expect(r).toEqual([{ id: 'a', at: '2026-11-12T08:00:00.000Z', title: 'X', body: undefined, url: undefined }]);
  });
  it('due = past, unsent, not too late', () => {
    const list = [
      { id: 'a', at: new Date(T - 1000).toISOString(), title: 'a' },
      { id: 'b', at: new Date(T + 60_000).toISOString(), title: 'b' },
      { id: 'c', at: new Date(T - 1000).toISOString(), title: 'c', sentAt: 'x' },
      { id: 'd', at: new Date(T - 7 * 3600_000).toISOString(), title: 'd' },
    ];
    expect(dueReminders(list, T).map((r) => r.id)).toEqual(['a']);
  });
  it('merge keeps sentAt only for unchanged id+time', () => {
    const at = new Date(T).toISOString();
    const merged = mergeReminders([{ id: 'a', at, title: 'a', sentAt: 's' }, { id: 'b', at, title: 'b', sentAt: 's' }], [
      { id: 'a', at, title: 'a2' },
      { id: 'b', at: new Date(T + 1).toISOString(), title: 'b moved' },
    ]);
    expect(merged.map((r) => r.sentAt)).toEqual(['s', undefined]);
    expect(merged[0].title).toBe('a2');
  });
  it('prunes old reminders', () => {
    expect(pruneReminders([{ id: 'x', at: new Date(T - 3 * 86_400_000).toISOString(), title: '' }], T)).toEqual([]);
  });
  it('tick sends once per subscription and removes gone subscriptions', async () => {
    const store = memoryStore({
      'push.subscriptions': [{ endpoint: 'https://push.example/ok', keys: {} }, { endpoint: 'https://push.example/gone', keys: {} }],
      'push.reminders': [{ id: 'r1', at: new Date(T - 1000).toISOString(), title: 'Zahnarzt', url: '#/kalender' }],
    });
    const calls = [];
    const send = async (sub, payload) => {
      calls.push([sub.endpoint, JSON.parse(payload)]);
      if (sub.endpoint.endsWith('gone')) throw { statusCode: 410 };
    };
    const r1 = await runTick({ store, send, now: T });
    expect(r1).toEqual({ sent: 1, removed: 1 });
    expect(calls[0][1]).toEqual({ title: 'Zahnarzt', body: '', url: '#/kalender', tag: 'r1' });
    expect(await store.get('push.subscriptions')).toHaveLength(1);
    const r2 = await runTick({ store, send, now: T + 30_000 });
    expect(r2.sent).toBe(0); // not sent twice
  });
});

describe('real Web Push encryption to a local test push service', () => {
  it('web-push delivers a VAPID-signed, aes128gcm-encrypted payload that decrypts correctly', async () => {
    const svc = await startTestPushService();
    const device = svc.subscription('iphone');
    const vapid = webpush.generateVAPIDKeys();
    const send = (sub, payload) =>
      webpush.sendNotification(sub, payload, { TTL: 60, agent: svc.agent, vapidDetails: { subject: 'mailto:test@example.invalid', publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
    const store = memoryStore();
    const app = createApp({ getConfig: () => ({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, NOVA_APP_TOKEN: 'tok' }), store, push: { send } });
    const H = { 'x-nova-token': 'tok', 'content-type': 'application/json' };

    const status = await (await app.request('http://nova.local/api/push/status')).json();
    expect(status).toMatchObject({ configured: true, publicKey: vapid.publicKey, subscriptions: 0 });
    expect(JSON.stringify(status)).not.toContain(vapid.privateKey);
    expect((await app.request('http://nova.local/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: device.sub }) })).status).toBe(401);
    expect((await app.request('http://nova.local/api/push/subscribe', { method: 'POST', headers: H, body: JSON.stringify({ subscription: device.sub }) })).status).toBe(200);

    const test = await app.request('http://nova.local/api/push/test', { method: 'POST', headers: H, body: '{}' });
    expect(await test.json()).toEqual({ ok: true, sent: 1 });

    const put = await app.request('http://nova.local/api/push/reminders', { method: 'PUT', headers: H, body: JSON.stringify({ reminders: [{ id: 'event:1', at: new Date(Date.now() - 1000).toISOString(), title: 'Zahnarzt', body: '10:00 Uhr', url: '#/kalender' }] }) });
    expect((await put.json()).count).toBe(1);
    expect((await runTick({ store, send })).sent).toBe(1);
    expect((await runTick({ store, send })).sent).toBe(0);
    await svc.close();

    expect(svc.received).toHaveLength(2);
    const msg = svc.received[1];
    expect(msg.headers['content-encoding']).toBe('aes128gcm');
    expect(msg.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(msg.headers.ttl).toBe('60');
    expect(device.decrypt(msg.body)).toEqual({ title: 'Zahnarzt', body: '10:00 Uhr', url: '#/kalender', tag: 'event:1' });
    expect(device.decrypt(svc.received[0].body).title).toBe('Nova');
  });
});
