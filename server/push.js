// Web Push routes (VAPID). Sending is injected (`push.send`) so the app stays runtime-agnostic.
import { requireAppAuth } from './auth.js';
import { mergeReminders, sanitizeReminders } from './scheduler.js';

function validSubscription(s) {
  return (
    s &&
    typeof s.endpoint === 'string' &&
    /^https?:\/\//.test(s.endpoint) &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

/**
 * @param {*} app
 * @param {{ getConfig: Function, store: import('./store.js').Store, log?: Function, push?: { send: (sub: any, payload: string) => Promise<any> } }} deps
 */
export function registerPushRoutes(app, { getConfig, store, log = () => {}, push }) {
  app.get('/api/push/status', async (c) => {
    const cfg = getConfig(c);
    const subs = (await store.get('push.subscriptions')) ?? [];
    return c.json({
      ok: true,
      configured: Boolean(cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY && push),
      publicKey: cfg.VAPID_PUBLIC_KEY || undefined,
      subscriptions: subs.length,
    });
  });

  app.post('/api/push/subscribe', async (c) => {
    const cfg = getConfig(c);
    const denied = await requireAppAuth(c, cfg);
    if (denied) return denied;
    const body = await c.req.json().catch(() => null);
    const sub = body?.subscription;
    if (!validSubscription(sub)) return c.json({ ok: false, error: 'invalid_subscription', message: 'Ungültiges Abo.' }, 400);
    const subs = ((await store.get('push.subscriptions')) ?? []).filter((s) => s.endpoint !== sub.endpoint);
    subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: new Date().toISOString(), label: typeof body.label === 'string' ? body.label.slice(0, 60) : undefined });
    await store.set('push.subscriptions', subs.slice(-20));
    log(`push subscription added (${subs.length})`);
    return c.json({ ok: true, subscriptions: subs.length });
  });

  app.post('/api/push/unsubscribe', async (c) => {
    const cfg = getConfig(c);
    const denied = await requireAppAuth(c, cfg);
    if (denied) return denied;
    const body = await c.req.json().catch(() => null);
    const subs = ((await store.get('push.subscriptions')) ?? []).filter((s) => s.endpoint !== body?.endpoint);
    await store.set('push.subscriptions', subs);
    return c.json({ ok: true, subscriptions: subs.length });
  });

  app.put('/api/push/reminders', async (c) => {
    const cfg = getConfig(c);
    const denied = await requireAppAuth(c, cfg);
    if (denied) return denied;
    const body = await c.req.json().catch(() => null);
    const incoming = sanitizeReminders(body?.reminders);
    const merged = mergeReminders((await store.get('push.reminders')) ?? [], incoming);
    await store.set('push.reminders', merged);
    return c.json({ ok: true, count: merged.length });
  });

  app.post('/api/push/test', async (c) => {
    const cfg = getConfig(c);
    const denied = await requireAppAuth(c, cfg);
    if (denied) return denied;
    if (!push || !cfg.VAPID_PUBLIC_KEY) return c.json({ ok: false, error: 'not_configured', message: 'VAPID-Schlüssel fehlen auf dem Server (npm run gen:vapid).' }, 503);
    const subs = (await store.get('push.subscriptions')) ?? [];
    if (!subs.length) return c.json({ ok: false, error: 'no_subscription', message: 'Noch kein Gerät für Mitteilungen angemeldet.' }, 409);
    const payload = JSON.stringify({ title: 'Nova', body: 'Mitteilungen funktionieren. ✨', url: '#/einstellungen', tag: 'nova-test' });
    let sent = 0;
    const keep = [];
    for (const s of subs) {
      try {
        await push.send(s, payload);
        sent += 1;
        keep.push(s);
      } catch (err) {
        if (err?.statusCode !== 404 && err?.statusCode !== 410) keep.push(s);
        log(`push test failed ${err?.statusCode ?? ''} ${String(err?.body ?? '').slice(0, 120)}`);
      }
    }
    await store.set('push.subscriptions', keep);
    return sent ? c.json({ ok: true, sent }) : c.json({ ok: false, error: 'push_failed', message: 'Mitteilung konnte nicht zugestellt werden.' }, 502);
  });
}
