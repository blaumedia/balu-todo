import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// boot.ts owns the recovery from a lost workspace; the sync wiring, sqlite and
// the React Native modules are replaced by fakes so the flows run in node.
const fake = vi.hoisted(() => ({
  open: null as string | null,
  known: [] as string[],
  discarded: new Map<string, number>(),
  expected: new Set<string>(),
  announced: new Set<string>(),
  purged: [] as string[],
  cleared: [] as string[],
  reasons: new Map<string, 'removed' | 'deleted'>(),
  kv: new Map<string, string>(),
  alerts: [] as Array<[string, string]>,
  getMe: (async () => ({})) as () => Promise<any>,
  authed: true,
  logouts: 0,
  teardowns: 0,
  remindersStopped: 0,
  purgeCalls: [] as unknown[],
  purgeFails: false,
  nav: [] as string[],
  canDismiss: false,
  inited: [] as string[],
  events: [] as string[],
  logoutGate: null as Promise<void> | null,
}));

const fakeApi = {
  getMe: () => fake.getMe(),
  hydrate: async () => {},
  isAuthenticated: () => fake.authed,
  logout: async () => {
    fake.logouts += 1;
    fake.events.push('post start');
    await fake.logoutGate;
    fake.events.push('post done');
  },
};

vi.mock('react-native', () => ({
  Alert: { alert: (title: string, body: string) => fake.alerts.push([title, body]) },
}));
vi.mock('expo-router', () => ({
  router: {
    canDismiss: () => fake.canDismiss,
    dismissAll: () => void fake.nav.push('dismissAll'),
    replace: (to: string) => void fake.nav.push(`replace:${to}`),
  },
}));
vi.mock('../src/lib/notifications', () => ({
  getReminderPermissionGranted: async () => false,
  startReminderScheduler: () => {},
  stopReminderScheduler: () => {
    fake.remindersStopped += 1;
  },
}));
vi.mock('../src/lib/kv', () => ({
  SETTINGS: {
    serverUrl: 'serverUrl',
    theme: 'theme',
    locale: 'locale',
    remindersEnabled: 'remindersEnabled',
    lastWorkspaceId: 'last',
    session: 'session',
  },
  purgeUserData: async (opts: unknown) => {
    fake.events.push('purge');
    if (fake.purgeFails) throw new Error('sqlite');
    fake.purgeCalls.push(opts);
  },
  sqliteKV: {
    getItem: async (k: string) => fake.kv.get(k) ?? null,
    setItem: async (k: string, v: string) => void fake.kv.set(k, v),
    removeItem: async (k: string) => void fake.kv.delete(k),
  },
}));
vi.mock('../src/lib/clients', () => ({
  getApi: () => fakeApi,
  getSync: () => null,
  initApi: () => fakeApi,
  initSync: (_url: string, id: string) => {
    fake.open = id;
    fake.inited.push(id);
  },
  teardownSync: () => {
    fake.teardowns += 1;
  },
  // Closes every client and waits for their running request, like the real one.
  teardownSyncSettled: async () => {
    fake.teardowns += 1;
    fake.events.push('settle:start');
    await new Promise((r) => setTimeout(r, 5));
    fake.events.push('settle:end');
  },
  listKnownWorkspaceIds: async () => fake.known,
  purgeWorkspaceStorage: async (id: string) => {
    fake.purged.push(id);
    return { discarded: fake.discarded.get(id) ?? 0, reason: fake.reasons.get(id) ?? 'removed' };
  },
  clearWorkspaceLossNotice: async (id: string) => {
    fake.cleared.push(id);
  },
  claimAccessLossNotice: (id: string) => {
    if (fake.expected.has(id) || fake.announced.has(id)) return false;
    fake.announced.add(id);
    return true;
  },
  setAccessLostHandler: () => {},
  setSessionExpiredHandler: () => {},
}));

import { ApiError } from '@balu/api-client';
import {
  bootApp,
  discardLostWorkspaces,
  establishSession,
  expireSession,
  handleAccessLost,
  logout,
  moveOffLostWorkspace,
} from '../src/lib/boot';
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
  fake.cleared = [];
  fake.reasons.clear();
  fake.kv.clear();
  fake.alerts = [];
  fake.authed = true;
  fake.logouts = 0;
  fake.teardowns = 0;
  fake.remindersStopped = 0;
  fake.purgeCalls = [];
  fake.purgeFails = false;
  fake.nav = [];
  fake.canDismiss = false;
  fake.inited = [];
  fake.events = [];
  fake.logoutGate = null;
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

describe('expireSession', () => {
  it('while ready: stops sync, shows the notice and navigates to onboarding', async () => {
    useApp.setState({ boot: 'ready' } as any);
    fake.canDismiss = true;
    await expireSession();
    const st = useApp.getState();
    expect(fake.remindersStopped).toBe(1);
    expect(fake.teardowns).toBe(1);
    expect(fake.logouts).toBe(1);
    expect(st.boot).toBe('onboarding');
    expect(st.loginNotice).toBe('sessionExpired');
    expect(fake.nav).toEqual(['dismissAll', 'replace:/onboarding']);
  });

  it.each(['reconnecting', 'noWorkspace'] as const)('while the %s notice shows: navigates to onboarding too', async (state) => {
    useApp.setState({ boot: state } as any);
    fake.canDismiss = true;
    await expireSession();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual(['dismissAll', 'replace:/onboarding']);
  });

  it('during boot: no navigation, the index gate redirects on its own', async () => {
    useApp.setState({ boot: 'loading' } as any);
    await expireSession();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(useApp.getState().loginNotice).toBe('sessionExpired');
    expect(fake.nav).toEqual([]);
  });
});

describe('bootApp', () => {
  const cached = JSON.stringify({ user, workspace: ws('a') });
  beforeEach(() => {
    fake.kv.set('serverUrl', 'https://x');
    fake.kv.set('session', cached);
    useApp.setState({ boot: 'loading', loginNotice: null, workspace: null, user: null } as any);
  });

  it('a 401 from /me expires the session instead of booting the cached one', async () => {
    fake.getMe = async () => {
      throw new ApiError('invalid_token', 'x', 401);
    };
    await bootApp();
    const st = useApp.getState();
    expect(st.boot).toBe('onboarding');
    expect(st.loginNotice).toBe('sessionExpired');
    expect(fake.inited).toEqual([]);
    expect(st.user).toBeNull();
  });

  it('a signed_out 401 from /me (a deliberate logout) does not announce an expiry', async () => {
    fake.getMe = async () => {
      throw new ApiError('signed_out', 'x', 401);
    };
    await bootApp();
    expect(useApp.getState().loginNotice).toBeNull();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.inited).toEqual([]);
    expect(fake.logouts).toBe(0);
  });

  it('a network failure still boots the cached session offline', async () => {
    fake.getMe = async () => {
      throw new TypeError('network');
    };
    await bootApp();
    const st = useApp.getState();
    expect(st.boot).toBe('ready');
    expect(st.workspace?.id).toBe('a');
    expect(fake.inited).toEqual(['a']);
    expect(st.loginNotice).toBeNull();
  });
});

describe('establishSession foreign data', () => {
  const api = fakeApi as any;

  it("purges another account's local data (keeping the new tokens) before using it", async () => {
    fake.kv.set('session', JSON.stringify({ user: { id: 'someone-else' }, workspace: ws('x') }));
    fake.getMe = async () => me('a');
    expect(await establishSession('https://x', api)).toBe(true);
    expect(fake.purgeCalls).toEqual([{ keepAuth: true }]);
    expect(fake.remindersStopped).toBe(1);
    expect(fake.teardowns).toBe(1);
    expect(fake.inited).toEqual(['a']);
  });

  it("lets the closed sync clients settle before the purge, so no late write follows it", async () => {
    fake.kv.set('session', JSON.stringify({ user: { id: 'someone-else' }, workspace: ws('x') }));
    fake.getMe = async () => me('a');
    await establishSession('https://x', api);
    expect(fake.events).toEqual(['settle:start', 'settle:end', 'purge']);
  });

  it("keeps the same user's data", async () => {
    fake.kv.set('session', JSON.stringify({ user, workspace: ws('x') }));
    fake.getMe = async () => me('a');
    await establishSession('https://x', api);
    expect(fake.purgeCalls).toEqual([]);
    expect(fake.teardowns).toBe(0);
  });
});

describe('logout', () => {
  it('lets the closed sync clients settle before the user data is purged', async () => {
    await logout();
    expect(fake.events).toEqual(['settle:start', 'settle:end', 'post start', 'purge', 'post done']);
    expect(fake.logouts).toBe(1);
  });

  it('clears the navigation stack before replacing with onboarding', async () => {
    fake.canDismiss = true;
    await logout();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual(['dismissAll', 'replace:/onboarding']);
  });

  it('only replaces with onboarding when there is nothing to dismiss (deep link, single screen)', async () => {
    fake.canDismiss = false;
    useApp.setState({ boot: 'ready' } as any);
    await logout();
    expect(fake.nav).toEqual(['replace:/onboarding']);
  });

  it('still resets the session and leaves the screen when the purge fails', async () => {
    fake.purgeFails = true;
    fake.canDismiss = true;
    useApp.setState({ boot: 'ready' } as any);
    await expect(logout()).rejects.toThrow('sqlite');
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual(['dismissAll', 'replace:/onboarding']);
  });
});

describe('logout during an outage (what-if 3)', () => {
  it('purges and leaves the screen before the revoke request has finished', async () => {
    let release!: () => void;
    fake.logoutGate = new Promise<void>((r) => (release = r));
    fake.canDismiss = true;
    const out = logout();
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.events).toContain('purge');
    expect(fake.events).not.toContain('post done');
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual(['dismissAll', 'replace:/onboarding']);
    release();
    await out;
    expect(fake.events.indexOf('purge')).toBeLessThan(fake.events.indexOf('post done'));
  });
});

describe('accounts without a workspace (what-if 6)', () => {
  beforeEach(() => {
    fake.kv.set('serverUrl', 'https://x');
    useApp.setState({ boot: 'loading', loginNotice: null, workspace: null, user: null } as any);
  });

  afterEach(() => vi.useRealTimers());

  it('shows the no-workspace notice, keeps the tokens and boots once /me lists a workspace', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fake.getMe = async () => (++calls <= 2 ? me() : me('a'));
    await bootApp();
    expect(useApp.getState().boot).toBe('noWorkspace');
    expect(fake.alerts).toHaveLength(0);
    expect(fake.logouts).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
    expect(useApp.getState().boot).toBe('ready');
  });

  it('stops asking once the user logs out from the notice', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      return me();
    };
    await bootApp();
    expect(useApp.getState().boot).toBe('noWorkspace');
    const out = logout(); // what the notice's button calls
    await vi.advanceTimersByTimeAsync(10);
    await out;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    expect(useApp.getState().boot).toBe('onboarding');
  });
});

describe('landing outside a lost workspace while /me fails (what-if 11)', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps retrying instead of dropping a signed-in user on onboarding', async () => {
    vi.useFakeTimers();
    useApp.setState({ memberships: [mem('lost')] } as any); // offline boot: nothing else known
    let calls = 0;
    fake.getMe = async () => {
      if (++calls <= 3) throw new TypeError('503 blip');
      return me('a');
    };
    const moving = moveOffLostWorkspace('lost');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(useApp.getState().boot).toBe('reconnecting'); // visible, not silent
    expect(fake.teardowns).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await moving;
    expect(calls).toBe(4);
    expect(open()).toBe('a');
    expect(useApp.getState().boot).not.toBe('onboarding');
  });

  it('jitters the retry wait by +-20% (0.8x at the low end)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    useApp.setState({ memberships: [mem('lost')] } as any);
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      throw new TypeError('down');
    };
    void moveOffLostWorkspace('lost');
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toBe(3);
    vi.restoreAllMocks();
    useApp.getState().reset(); // the user leaves: the retry loop ends
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('an empty /me explains itself instead of retrying silently', async () => {
    vi.useFakeTimers();
    useApp.setState({ memberships: [mem('lost')] } as any);
    fake.getMe = async () => me();
    await moveOffLostWorkspace('lost');
    expect(useApp.getState().boot).toBe('noWorkspace');
    useApp.getState().reset(); // the user leaves: the retry loop ends
    await vi.advanceTimersByTimeAsync(60_000);
  });
});

describe('discardLostWorkspaces details (review f9966f34)', () => {
  it('uses the recorded reason and clears the notice of a live workspace', async () => {
    fake.known = ['a', 'gone'];
    fake.discarded.set('gone', 2);
    fake.reasons.set('gone', 'deleted');
    await discardLostWorkspaces(['a']);
    expect(fake.cleared).toEqual(['a']);
    expect(fake.alerts[0]![1]).toContain('deleted');
  });
});
