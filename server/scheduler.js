// Reminder scheduling – pure functions + a small runner. Runtime-agnostic.

export const MAX_REMINDERS = 500;
const MAX_LATE_MS = 6 * 3600_000; // drop reminders more than 6 h overdue (e.g. server was off)

/**
 * @typedef {{ id: string, at: string, title: string, body?: string, url?: string, sentAt?: string }} Reminder
 */

/** Validates and normalises reminders coming from the client. */
export function sanitizeReminders(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const r of input.slice(0, MAX_REMINDERS)) {
    if (!r || typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.at !== 'string') continue;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    out.push({
      id: r.id.slice(0, 200),
      at: new Date(t).toISOString(),
      title: r.title.slice(0, 120),
      body: typeof r.body === 'string' ? r.body.slice(0, 300) : undefined,
      url: typeof r.url === 'string' && r.url.startsWith('#/') ? r.url.slice(0, 200) : undefined,
    });
  }
  return out;
}

/** Replaces the reminder set, keeping `sentAt` for unchanged (same id + same time) reminders. */
export function mergeReminders(existing, incoming) {
  const prev = new Map(existing.map((r) => [`${r.id}|${r.at}`, r]));
  return incoming.map((r) => {
    const old = prev.get(`${r.id}|${r.at}`);
    return old?.sentAt ? { ...r, sentAt: old.sentAt } : r;
  });
}

/** Reminders that should fire now. */
export function dueReminders(reminders, now = Date.now()) {
  return reminders.filter((r) => {
    if (r.sentAt) return false;
    const t = Date.parse(r.at);
    return t <= now && now - t <= MAX_LATE_MS;
  });
}

/** Removes old sent/expired reminders to keep the store small. */
export function pruneReminders(reminders, now = Date.now()) {
  return reminders.filter((r) => Date.parse(r.at) > now - 2 * 86_400_000);
}

/**
 * One scheduler tick: send due reminders to all subscriptions.
 * `send(subscription, payload)` resolves or throws { statusCode }. 404/410 → subscription removed.
 */
export async function runTick({ store, send, now = Date.now(), log = () => {} }) {
  const reminders = (await store.get('push.reminders')) ?? [];
  const due = dueReminders(reminders, now);
  if (due.length === 0) {
    const pruned = pruneReminders(reminders, now);
    if (pruned.length !== reminders.length) await store.set('push.reminders', pruned);
    return { sent: 0, removed: 0 };
  }
  let subs = (await store.get('push.subscriptions')) ?? [];
  let sent = 0;
  const dead = new Set();
  for (const r of due) {
    const payload = JSON.stringify({ title: r.title, body: r.body ?? '', url: r.url ?? '#/', tag: r.id });
    for (const sub of subs) {
      if (dead.has(sub.endpoint)) continue;
      try {
        await send(sub, payload);
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.add(sub.endpoint);
        else log(`push send failed ${err?.statusCode ?? ''}`);
      }
    }
    r.sentAt = new Date(now).toISOString();
  }
  if (dead.size) {
    subs = subs.filter((s) => !dead.has(s.endpoint));
    await store.set('push.subscriptions', subs);
  }
  await store.set('push.reminders', pruneReminders(reminders, now));
  if (sent) log(`push sent ${sent} notification(s)`);
  return { sent, removed: dead.size };
}

export function startScheduler({ store, send, intervalMs = 30_000, log }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTick({ store, send, log });
    } catch (e) {
      log?.(`scheduler error ${e?.name ?? ''}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(timer);
}
