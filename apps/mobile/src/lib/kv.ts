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

/**
 * Wipe every `balu:*` row that belongs to the signed-in account: the
 * api-client's tokens, the sync-client's replica/queue/token for every
 * workspace, and the cached session. Device-level preferences (server URL,
 * theme, locale) survive — they are not the user's data.
 *
 * Without this the next person to open the app on this device still has the
 * previous user's tasks, notes and comments in SQLite, and any queued command
 * would be flushed under whichever account signs in next.
 */
export async function purgeUserData(): Promise<void> {
  const db = await getDb();
  // Device preferences survive; anything tied to the account goes. Note that
  // `remindersEnabled` is a device setting ('1'/'0', no user data) — wiping it
  // silently turned local reminders off again after every re-login.
  // `lastWorkspaceId` is deliberately NOT kept: it names the previous user's
  // workspace.
  await db.runAsync(
    "DELETE FROM kv WHERE k LIKE 'balu:%' AND k NOT IN (?, ?, ?, ?)",
    'balu:settings:serverUrl',
    'balu:settings:theme',
    'balu:settings:locale',
    'balu:settings:remindersEnabled',
  );
}

// Settings keys (app-owned; @balu/* packages own their own `balu:*` keys).
export const SETTINGS = {
  serverUrl: 'balu:settings:serverUrl',
  theme: 'balu:settings:theme',
  locale: 'balu:settings:locale',
  session: 'balu:settings:session', // cached {user, workspace} for offline boot
  lastWorkspaceId: 'balu:settings:lastWorkspaceId', // boot preference (§7)
  remindersEnabled: 'balu:settings:remindersEnabled', // '1' | '0' — local reminders
} as const;
