/**
 * A tiny async key-value interface. `@balu/api-client` (token store) and
 * `@balu/sync-client` (replica + command queue) both need it and both declared
 * their own structurally identical copy (D6); this is the one declaration.
 *
 * The web app passes a localStorage adapter, mobile a SQLite-backed one.
 */
export interface AsyncKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
