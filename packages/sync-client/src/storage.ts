// Storage adapters for the durable replica + command queue. The `AsyncKV`
// interface itself lives in @balu/domain (D6) and is re-exported here so
// existing imports keep working.

import type { AsyncKV } from "@balu/domain";

export type { AsyncKV };

/** localStorage adapter (browser). */
export function localStorageKV(): AsyncKV {
  return {
    async getItem(k) {
      return globalThis.localStorage.getItem(k);
    },
    async setItem(k, v) {
      globalThis.localStorage.setItem(k, v);
    },
    async removeItem(k) {
      globalThis.localStorage.removeItem(k);
    },
  };
}

/** In-memory adapter — used by tests and as an SSR fallback. */
export function memoryKV(seed?: Record<string, string>): AsyncKV {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    async getItem(k) {
      return store.has(k) ? (store.get(k) as string) : null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
  };
}
