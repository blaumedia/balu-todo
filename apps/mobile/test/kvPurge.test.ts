import { describe, expect, it, vi } from 'vitest';

import { purgeUserData, SETTINGS } from '../src/lib/kv';

// purgeUserData's SQL is the only thing under test: sqlite is replaced by a recorder.
const db = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    runAsync: async (...a: unknown[]) => void db.calls.push(a),
  }),
}));

describe('purgeUserData', () => {
  it('keeps device preferences only: the pending language mark belongs to the account and goes', async () => {
    await purgeUserData();
    const [sql, ...kept] = db.calls[0] as string[];
    expect(sql).toContain('NOT IN');
    expect(kept).toEqual([SETTINGS.serverUrl, SETTINGS.theme, SETTINGS.locale, SETTINGS.remindersEnabled]);
  });
});
