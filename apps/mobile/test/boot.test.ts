import { beforeEach, describe, expect, it, vi } from 'vitest';

// boot.ts owns the recovery from a lost workspace; the sync wiring, sqlite and
// the React Native modules are replaced by fakes so the flows run in node.
const fake = vi.hoisted(() => ({
  open: null as string | null,
  known: [] as string[],
  discarded: new Map<string, number>(),
  expected: new Set<string>(),
  announced: new Set<string>(),
  purged: [] as string[],
  kv: new Map<string, string>(),
  alerts: [] as Array<[string, string]>,
  getMe: (async () => ({})) as () => Promise<any>,
}));

vi.mock('react-native', () => ({
  Alert: { alert: (title: string, body: string) => fake.alerts.push([title, body]) },
}));
vi.mock('expo-router', () => ({ router: { canDismiss: () => false, dismissAll: () => {} } }));
vi.mock('../src/lib/notifications', () => ({
  getReminderPermissionGranted: async () => false,
  startReminderScheduler: () => {},
  stopReminderScheduler: () => {},
}));
vi.mock('../src/lib/kv', () => ({
  SETTINGS: {
    lastWorkspaceId: 'last',
    session: 'session',
  },
  purgeUserData: async () => {},
  sqliteKV: {
    getItem: async (k: string) => fake.kv.get(k) ?? null,
    setItem: async (k: string, v: string) => void fake.kv.set(k, v),
    removeItem: async (k: string) => void fake.kv.delete(k),
  },
}));
vi.mock('../src/lib/clients', () => ({
  getApi: () => ({ getMe: () => fake.getMe() }),
  getSync: () => null,
  initApi: () => null,
  initSync: (_url: string, id: string) => {
    fake.open = id;
  },
  teardownSync: () => {},
  listKnownWorkspaceIds: async () => fake.known,
  purgeWorkspaceStorage: async (id: string) => {
    fake.purged.push(id);
    return fake.discarded.get(id) ?? 0;
  },
  claimAccessLossNotice: (id: string) => {
    if (fake.expected.has(id) || fake.announced.has(id)) return false;
    fake.announced.add(id);
    return true;
  },
  setAccessLostHandler: () => {},
  setSessionExpiredHandler: () => {},
}));

import { discardLostWorkspaces, handleAccessLost, moveOffLostWorkspace } from '../src/lib/boot';
import { useApp } from '../src/store/app';

const user = { id: 'u1', name: 'U', email: 'u@x', locale: 'en' } as any;
const ws = (id: string) => ({ id, name: `WS ${id}` }) as any;
const mem = (id: string) => ({ workspace: ws(id), role: 'owner' }) as any;
const me = (...ids: string[]) => ({ user, memberships: ids.map(mem) });
const open = () => useApp.getState().workspace?.id;

beforeEach(() => {
  fake.open = 'lost';
  fake.known = [];
  fake.discarded.clear();
  fake.expected.clear();
  fake.announced.clear();
  fake.purged = [];
  fake.kv.clear();
  fake.alerts = [];
  fake.getMe = async () => me('a', 'b');
  useApp.setState({
    user,
    serverUrl: 'https://x',
    memberships: [mem('lost'), mem('a'), mem('b')],
    workspace: ws('lost'),
    locale: 'en',
  } as any);
});

describe('handleAccessLost', () => {
  it('announces the loss with the count and moves to a survivor', async () => {
    await handleAccessLost({ workspaceId: 'lost', reason: 'removed', discarded: 3 });
    expect(fake.alerts).toHaveLength(1);
    expect(fake.alerts[0]![1]).toContain('3 unsynced change(s)');
    expect(open()).toBe('a');
    expect(fake.purged).toContain('lost');
  });

  it('an expected loss shows no notice but still moves off the workspace', async () => {
    fake.expected.add('lost');
    await handleAccessLost({ workspaceId: 'lost', reason: 'deleted', discarded: 0 });
    expect(fake.alerts).toHaveLength(0);
    expect(open()).toBe('a');
  });

  it("a stale client's loss does not move the app", async () => {
    useApp.setState({ workspace: ws('b') } as any);
    await handleAccessLost({ workspaceId: 'lost', reason: 'removed', discarded: 1 });
    expect(open()).toBe('b');
  });
});

describe('moveOffLostWorkspace', () => {
  it('keeps a workspace the user switched to while /me was in flight', async () => {
    let answer: (v: unknown) => void = () => {};
    fake.getMe = () => new Promise((r) => (answer = r));
    const moving = moveOffLostWorkspace('lost');
    useApp.setState({ workspace: ws('b') } as any); // the user switches meanwhile
    answer(me('a', 'b'));
    await moving;
    expect(open()).toBe('b');
    expect(fake.purged).toContain('lost');
  });
});

describe('discardLostWorkspaces', () => {
  it('cleans every known workspace /me no longer lists and alerts once', async () => {
    fake.known = ['a', 'gone1', 'gone2'];
    fake.discarded.set('gone1', 2);
    fake.discarded.set('gone2', 5);
    await discardLostWorkspaces(['a', 'b']);
    expect(fake.purged).toEqual(['gone1', 'gone2']);
    expect(fake.alerts).toHaveLength(1);
    expect(fake.alerts[0]![1]).toContain('2 unsynced change(s)');
    expect(fake.alerts[0]![1]).toContain('5 unsynced change(s)');
    await discardLostWorkspaces(['a', 'b']);
    expect(fake.alerts).toHaveLength(1);
  });
});
