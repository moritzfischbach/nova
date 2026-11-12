/**
 * Client for the Grok Bot bridge (POST /api/bot on Nova's server).
 * The webhook key lives only on the server – never in this bundle.
 * Requests are stored locally (IndexedDB) with status; offline requests are queued.
 */
import { getAll, getById, putRecord, removeRecord, STORES } from '../data/db';
import type { BotModule, BotRequest } from '../types';
import { apiHeaders, apiUrl, fetchWithTimeout, STATIC_ONLY } from './api';
import { createId } from './id';

export const BOT_MODULES: { value: BotModule; label: string }[] = [
  { value: 'allgemein', label: 'Allgemein' },
  { value: 'todos', label: 'Aufgaben' },
  { value: 'kalender', label: 'Kalender' },
  { value: 'finanzen', label: 'Finanzen' },
  { value: 'ziele', label: 'Ziele' },
];

export const TASK_MAX = 2000;
export const CONTEXT_MAX = 4000;

export interface BotStatus {
  staticOnly?: boolean;
  reachable: boolean;
  configured: boolean;
  tokenRequired: boolean;
}

export async function getBotStatus(): Promise<BotStatus> {
  if (STATIC_ONLY) return { staticOnly: true, reachable: false, configured: false, tokenRequired: false };
  try {
    const res = await fetchWithTimeout(apiUrl('api/bot/status'), { headers: apiHeaders(false) }, 5000);
    if (!res.ok) return { reachable: false, configured: false, tokenRequired: false };
    const data = (await res.json()) as { configured?: boolean; token_required?: boolean };
    return { reachable: true, configured: Boolean(data.configured), tokenRequired: Boolean(data.token_required) };
  } catch {
    return { reachable: false, configured: false, tokenRequired: false };
  }
}

export function botErrorMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'not_configured':
      return 'Die Grok-Bot-Verbindung ist noch nicht eingerichtet. Webhook-URL und Schlüssel müssen auf dem Nova-Server hinterlegt werden.';
    case 'unauthorized':
      return 'Der Zugangscode fehlt oder ist falsch (Einstellungen → Zugangscode).';
    case 'rate_limited':
      return 'Zu viele Anfragen in kurzer Zeit. Bitte gleich noch einmal versuchen.';
    case 'upstream_timeout':
      return 'Grok Bot hat nicht rechtzeitig geantwortet.';
    case 'upstream_error':
    case 'upstream_unreachable':
      return fallback ?? 'Grok Bot hat die Anfrage nicht angenommen.';
    case 'forbidden_origin':
      return 'Diese Nova-Adresse ist auf dem Server nicht freigegeben.';
    case 'offline':
      return 'Keine Verbindung – wird gesendet, sobald du wieder online bist.';
    default:
      return fallback ?? 'Senden fehlgeschlagen.';
  }
}

export async function listBotRequests(): Promise<BotRequest[]> {
  const items = await getAll<BotRequest>(STORES.botRequests);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteBotRequest(id: string): Promise<void> {
  await removeRecord(STORES.botRequests, id);
}

async function deliver(record: BotRequest): Promise<BotRequest> {
  const next: BotRequest = { ...record, attempts: record.attempts + 1 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return putRecord(STORES.botRequests, { ...next, status: 'wartend', errorCode: 'offline', error: botErrorMessage('offline') });
  }
  try {
    const res = await fetchWithTimeout(apiUrl('api/bot'), {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        task: record.task,
        module: record.module,
        ...(record.context ? { context: record.context } : {}),
        request_id: record.requestId,
      }),
    });
    let data: { ok?: boolean; error?: string; message?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    if (res.ok && data.ok) {
      return putRecord(STORES.botRequests, {
        ...next,
        status: 'gesendet',
        sentAt: new Date().toISOString(),
        error: undefined,
        errorCode: undefined,
      });
    }
    return putRecord(STORES.botRequests, {
      ...next,
      status: 'fehler',
      errorCode: data.error ?? `http_${res.status}`,
      error: botErrorMessage(data.error, data.message),
    });
  } catch {
    // network failure / server down → keep in queue
    return putRecord(STORES.botRequests, {
      ...next,
      status: 'wartend',
      errorCode: 'offline',
      error: 'Nova-Server nicht erreichbar – wird später erneut gesendet.',
    });
  }
}

export async function sendToGrokBot(input: { task: string; module?: BotModule; context?: string }): Promise<BotRequest> {
  const task = input.task.trim();
  if (!task) throw new Error('Bitte eine Nachricht eingeben.');
  if (task.length > TASK_MAX) throw new Error(`Höchstens ${TASK_MAX} Zeichen.`);
  if (input.context && input.context.length > CONTEXT_MAX) throw new Error('Der Kontext ist zu lang.');
  const id = createId();
  const record: BotRequest = {
    id,
    requestId: `nova-${id}`,
    task,
    module: input.module ?? 'allgemein',
    context: input.context?.trim() || undefined,
    status: 'wartend',
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await putRecord(STORES.botRequests, record);
  return deliver(record);
}

export async function retryBotRequest(id: string): Promise<BotRequest | undefined> {
  const record = await getById<BotRequest>(STORES.botRequests, id);
  if (!record) return undefined;
  return deliver(record);
}

/** Re-send queued (offline) requests. Returns number delivered. */
export async function flushBotQueue(): Promise<number> {
  if (STATIC_ONLY) return 0;
  const queued = (await listBotRequests()).filter((r) => r.status === 'wartend');
  let sent = 0;
  for (const record of queued.reverse()) {
    const result = await deliver(record);
    if (result.status === 'gesendet') sent += 1;
    if (result.status === 'wartend') break;
  }
  return sent;
}

let flushing = false;
export function installBotQueueFlush(onFlushed?: (n: number) => void): void {
  window.addEventListener('online', async () => {
    if (flushing) return;
    flushing = true;
    try {
      const n = await flushBotQueue();
      window.dispatchEvent(new CustomEvent('nova:bot-queue', { detail: n }));
      if (n > 0) onFlushed?.(n);
    } finally {
      flushing = false;
    }
  });
}
