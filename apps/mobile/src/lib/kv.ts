// expo-sqlite-backed async key-value store. Serves as the durable `storage`
// adapter for BOTH @balu/sync-client (replica + command queue) and
// @balu/api-client (token store) — the two AsyncKV interfaces are structurally
// identical — plus app settings (server URL, theme, locale, cached session).
import * as SQLite from 'expo-sqlite';
import type { AsyncKV } from '@balu/sync-client';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('balu.db');
      await db.execAsync(
        'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);',
      );
      return db;
    })();
  }
  return dbPromise;
}

export const sqliteKV: AsyncKV = {
  async getItem(key) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', key);
    return row ? row.v : null;
  },
  async setItem(key, value) {
    const db = await getDb();
    await db.runAsync(
      'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      value,
    );
  },
  async removeItem(key) {
    const db = await getDb();
    await db.runAsync('DELETE FROM kv WHERE k = ?', key);
  },
};

// Settings keys (app-owned; @balu/* packages own their own `balu:*` keys).
export const SETTINGS = {
  serverUrl: 'balu:settings:serverUrl',
  theme: 'balu:settings:theme',
  locale: 'balu:settings:locale',
  session: 'balu:settings:session', // cached {user, workspace} for offline boot
} as const;
