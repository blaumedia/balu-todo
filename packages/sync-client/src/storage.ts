// A tiny async key-value interface. The web app passes a localStorage adapter;
// mobile will pass a SQLite/AsyncStorage-backed one.

export interface AsyncKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

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
