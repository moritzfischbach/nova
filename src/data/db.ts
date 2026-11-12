import type { MetaRecord } from '../types';

const DB_NAME = 'nova';
const DB_VERSION = 3;

export const STORES = {
  todoLists: 'todoLists',
  todos: 'todos',
  events: 'events',
  categories: 'categories',
  transactions: 'transactions',
  meta: 'meta',
  botRequests: 'botRequests',
  goals: 'goals',
  chats: 'chats',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;
        if (!db.objectStoreNames.contains(STORES.todoLists)) {
          db.createObjectStore(STORES.todoLists, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.todos)) {
          const store = db.createObjectStore(STORES.todos, { keyPath: 'id' });
          store.createIndex('listId', 'listId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.events)) {
          const store = db.createObjectStore(STORES.events, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('uid', 'uid', { unique: true });
        }
        if (!db.objectStoreNames.contains(STORES.categories)) {
          db.createObjectStore(STORES.categories, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.transactions)) {
          const store = db.createObjectStore(STORES.transactions, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('categoryId', 'categoryId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
        // v2: Grok-Bot-Anfragen, Sparziele, Kalender-Felder (calendarId, color, rrule, Sync-Status)
        if (!db.objectStoreNames.contains(STORES.botRequests)) {
          const store = db.createObjectStore(STORES.botRequests, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.goals)) {
          db.createObjectStore(STORES.goals, { keyPath: 'id' });
        }
        // v3: Nova-Chat-Verläufe
        if (!db.objectStoreNames.contains(STORES.chats)) {
          db.createObjectStore(STORES.chats, { keyPath: 'id' });
        }
        if (oldVersion > 0 && oldVersion < 2) {
          const tx = request.transaction;
          if (tx) migrateEventsToV2(tx.objectStore(STORES.events));
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDb();
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function getById<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await getDb();
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(id)) as Promise<T | undefined>;
}

export async function putRecord<T>(store: StoreName, value: T): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return value;
}

export async function removeRecord(store: StoreName, id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getByIndex<T>(store: StoreName, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await getDb();
  const index = db.transaction(store, 'readonly').objectStore(store).index(indexName);
  return requestToPromise(index.getAll(value)) as Promise<T[]>;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const record = await getById<MetaRecord>(STORES.meta, key);
  return record?.value as T | undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putRecord<MetaRecord>(STORES.meta, { key, value });
}

/** v1 → v2: give every existing event the new calendar fields. */
export function migrateEventV1(event: Record<string, unknown>): Record<string, unknown> {
  return {
    calendarId: 'nova',
    exdates: [],
    syncDirty: true,
    ...event,
  };
}

function migrateEventsToV2(store: IDBObjectStore): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    cursor.update(migrateEventV1(cursor.value as Record<string, unknown>));
    cursor.continue();
  };
}
