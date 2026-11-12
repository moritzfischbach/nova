/**
 * Web Push client: subscription handling and reminder upload.
 * The VAPID private key stays on the server; the public key is fetched at runtime.
 */
import { getAll, STORES } from '../data/db';
import type { CalendarEvent, Goal, TodoItem } from '../types';
import { apiHeaders, apiUrl, fetchWithTimeout, STATIC_ONLY } from './api';
import { planReminders } from './reminderPlan';

const ENABLED_KEY = 'nova.pushEnabled';

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export type PushSupport = 'ok' | 'ios-not-installed' | 'insecure' | 'unsupported';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (isIOS() && !isStandalone()) return 'ios-not-installed';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

export function pushEnabledLocally(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export async function getPushServerStatus(): Promise<{ staticOnly?: boolean; reachable: boolean; configured: boolean; publicKey?: string; subscriptions: number }> {
  if (STATIC_ONLY) return { staticOnly: true, reachable: false, configured: false, subscriptions: 0 };
  try {
    const res = await fetchWithTimeout(apiUrl('api/push/status'), {}, 5000);
    const data = await res.json();
    return { reachable: true, configured: Boolean(data.configured), publicKey: data.publicKey, subscriptions: data.subscriptions ?? 0 };
  } catch {
    return { reachable: false, configured: false, subscriptions: 0 };
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function postJson(path: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; message?: string; [k: string]: unknown }> {
  const res = await fetchWithTimeout(apiUrl(path), { method, headers: apiHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.message ?? `Fehler ${res.status}`);
  return data;
}

export async function enablePush(): Promise<void> {
  const support = pushSupport();
  if (support !== 'ok') throw new Error('Mitteilungen werden hier nicht unterstützt.');
  const status = await getPushServerStatus();
  if (!status.reachable) throw new Error('Nova-Server nicht erreichbar.');
  if (!status.configured || !status.publicKey) throw new Error('Mitteilungen sind auf dem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt. Du kannst das in den Einstellungen des Geräts ändern.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(status.publicKey) });
  }
  await postJson('api/push/subscribe', { subscription: sub.toJSON(), label: isIOS() ? 'iPhone' : navigator.platform });
  localStorage.setItem(ENABLED_KEY, '1');
  await syncReminders();
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(ENABLED_KEY);
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await postJson('api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}

export async function sendTestPush(): Promise<void> {
  await postJson('api/push/test', {});
}

let pending: Promise<void> | null = null;
/** Recomputes reminders from local data and uploads them (only if push is enabled). */
export function syncReminders(): Promise<void> {
  if (STATIC_ONLY || !pushEnabledLocally()) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      const [events, todos, goals] = await Promise.all([
        getAll<CalendarEvent>(STORES.events),
        getAll<TodoItem>(STORES.todos),
        getAll<Goal>(STORES.goals),
      ]);
      const reminders = planReminders({ events, todos, goals });
      await postJson('api/push/reminders', { reminders }, 'PUT');
    } catch {
      /* offline – next change or app start retries */
    } finally {
      pending = null;
    }
  })();
  return pending;
}
