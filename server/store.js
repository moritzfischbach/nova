// Tiny key-value store. Node: JSON file (atomic write). Tests: memory.
// For Cloudflare Workers swap in a KV-backed implementation with the same interface.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** @typedef {{ get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void>, delete: (key: string) => Promise<void> }} Store */

/** @returns {Store} */
export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      const v = data.get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

/** @returns {Store} */
export function fileStore(file) {
  let cache = null;
  let chain = Promise.resolve();
  const load = () => {
    if (cache) return cache;
    cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8') || '{}') : {};
    return cache;
  };
  const persist = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const queue = (fn) => (chain = chain.then(fn, fn));
  return {
    async get(key) {
      const v = load()[key];
      return v === undefined ? undefined : structuredClone(v);
    },
    set(key, value) {
      return queue(() => {
        load()[key] = structuredClone(value);
        persist();
      });
    },
    delete(key) {
      return queue(() => {
        delete load()[key];
        persist();
      });
    },
  };
}
