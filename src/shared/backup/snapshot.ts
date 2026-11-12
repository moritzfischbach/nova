/** Snapshot of all Nova data on this device (what goes into the encrypted backup). */
import { getDb, STORES, type StoreName } from '../../data/db';

export const SNAPSHOT_FORMAT = 'nova-data';

/** Device-only or secret meta keys that never leave the device. */
export const isPrivateMetaKey = (key: string) => key.startsWith('backup.');

/** Settings kept in localStorage that belong to the user (not to the device). */
export const SYNCED_LOCAL_KEYS = ['nova.chatContext', 'nova.calView', 'nova.activeTodoList', 'nova.chatActive'];
// never included: nova.appToken (device token), nova.pairPending, nova.pushEnabled (per-device), nova.backup*

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  v: 1;
  createdAt: string;
  device?: string;
  stores: Partial<Record<StoreName, unknown[]>>;
  local: Record<string, string>;
}

export const STORE_LABELS: Record<StoreName, [string, string]> = {
  todoLists: ['Liste', 'Listen'],
  todos: ['Aufgabe', 'Aufgaben'],
  events: ['Termin', 'Termine'],
  categories: ['Kategorie', 'Kategorien'],
  transactions: ['Buchung', 'Buchungen'],
  meta: ['Einstellung', 'Einstellungen'],
  botRequests: ['Grok-Anfrage', 'Grok-Anfragen'],
  goals: ['Ziel', 'Ziele'],
  chats: ['Chat', 'Chats'],
  habits: ['Gewohnheit', 'Gewohnheiten'],
};

export function countsOf(s: Snapshot): Partial<Record<StoreName, number>> {
  return Object.fromEntries(Object.entries(s.stores).map(([k, v]) => [k, (v ?? []).length])) as Partial<Record<StoreName, number>>;
}

export function summarizeCounts(counts: Partial<Record<StoreName, number>>): string {
  const order: StoreName[] = ['todos', 'events', 'transactions', 'goals', 'habits', 'chats'];
  return order
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${counts[k]} ${counts[k] === 1 ? STORE_LABELS[k][0] : STORE_LABELS[k][1]}`)
    .join(', ');
}

const ALL_STORES = Object.values(STORES) as StoreName[];
const keyOf = (store: StoreName, r: unknown) => String((r as Record<string, unknown>)[store === 'meta' ? 'key' : 'id']);

export function filterForBackup(store: StoreName, records: unknown[]): unknown[] {
  return store === 'meta' ? records.filter((r) => !isPrivateMetaKey(keyOf('meta', r))) : records;
}

export async function takeSnapshot(device?: string, now = new Date()): Promise<Snapshot> {
  const db = await getDb();
  const tx = db.transaction(ALL_STORES, 'readonly');
  const stores: Snapshot['stores'] = {};
  await Promise.all(
    ALL_STORES.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => {
            stores[name] = filterForBackup(name, req.result);
            resolve();
          };
          req.onerror = () => reject(req.error);
        }),
    ),
  );
  const local: Record<string, string> = {};
  for (const k of SYNCED_LOCAL_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) local[k] = v;
  }
  return { format: SNAPSHOT_FORMAT, v: 1, createdAt: now.toISOString(), device, stores, local };
}

export function validSnapshot(s: unknown): s is Snapshot {
  const x = s as Snapshot;
  return Boolean(x && x.format === SNAPSHOT_FORMAT && x.v === 1 && x.stores && typeof x.stores === 'object');
}

const stamp = (r: unknown) => {
  const o = r as Record<string, unknown>;
  const t = o.updatedAt ?? o.createdAt;
  return typeof t === 'string' ? t : '';
};

/**
 * Merge: keep everything on this device, add what is missing, and take a backup record
 * only when it is newer (updatedAt). Meta: wake log is merged per day (device wins).
 */
export function mergeRecords(store: StoreName, local: unknown[], incoming: unknown[]): unknown[] {
  const byKey = new Map(local.map((r) => [keyOf(store, r), r]));
  const out: unknown[] = [];
  for (const r of incoming) {
    const k = keyOf(store, r);
    const mine = byKey.get(k);
    if (!mine) out.push(r);
    else if (store === 'meta' && k === 'wake.log') {
      const a = (r as { value?: Record<string, unknown> }).value ?? {};
      const b = (mine as { value?: Record<string, unknown> }).value ?? {};
      out.push({ key: k, value: { ...a, ...b } });
    } else if (store !== 'meta' && stamp(r) > stamp(mine)) out.push(r);
  }
  return out;
}

/** Writes a snapshot into IndexedDB in one transaction. Returns the number of records written per store. */
export async function applySnapshot(s: Snapshot, mode: 'replace' | 'merge'): Promise<Partial<Record<StoreName, number>>> {
  if (!validSnapshot(s)) throw new Error('Backup-Inhalt ist ungültig.');
  const db = await getDb();
  const names = ALL_STORES.filter((n) => Array.isArray(s.stores[n]));
  const existing: Partial<Record<StoreName, unknown[]>> = {};
  if (mode === 'merge' || names.includes('meta')) {
    const rtx = db.transaction(names, 'readonly');
    await Promise.all(
      names.map(
        (n) =>
          new Promise<void>((resolve, reject) => {
            const req = rtx.objectStore(n).getAll();
            req.onsuccess = () => {
              existing[n] = req.result;
              resolve();
            };
            req.onerror = () => reject(req.error);
          }),
      ),
    );
  }
  const written: Partial<Record<StoreName, number>> = {};
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) {
    const os = tx.objectStore(n);
    const incoming = filterForBackup(n, s.stores[n] ?? []);
    let toWrite: unknown[];
    if (mode === 'replace') {
      if (n === 'meta') {
        for (const r of existing.meta ?? []) if (!isPrivateMetaKey(keyOf('meta', r))) os.delete(keyOf('meta', r));
      } else os.clear();
      toWrite = incoming;
    } else toWrite = mergeRecords(n, existing[n] ?? [], incoming);
    for (const r of toWrite) os.put(r);
    written[n] = toWrite.length;
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Wiederherstellen abgebrochen.'));
  });
  for (const [k, v] of Object.entries(s.local ?? {})) {
    if (SYNCED_LOCAL_KEYS.includes(k) && (mode === 'replace' || localStorage.getItem(k) === null)) localStorage.setItem(k, v);
  }
  return written;
}
