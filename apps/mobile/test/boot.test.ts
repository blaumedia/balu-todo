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
  pickNothing: false,
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
  patched: [] as string[],
  patchFails: false,
  noApi: false,
  patchHolds: [] as Array<Promise<void>>,
  syncCreated: 0,
}));

const fakeApi = {
  getMe: () => fake.getMe(),
  patchMe: async (body: { locale: string }) => {
    fake.patched.push(body.locale);
    const hold = fake.patchHolds.shift();
    if (hold) await hold;
    if (fake.patchFails) throw new Error('offline');
    return {};
  },
  hydrate: async () => {},
  isAuthenticated: () => fake.authed,
  logout: async () => {
    fake.logouts += 1;
    fake.events.push('post start');
    await fake.logoutGate;
    fake.events.push('post done');
  },
};

vi.mock('@balu/domain', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@balu/domain')>();
  return { ...orig, pickMembership: (...a: Parameters<typeof orig.pickMembership>) => (fake.pickNothing ? undefined : orig.pickMembership(...a)) };
});
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
    localePending: 'localePending',
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
  getApi: () => (fake.noApi ? null : fakeApi),
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
import { chooseLocale, retryLocaleOnReconnect, retryPendingLocale, watchLocaleRetries } from '../src/lib/localeChoice';
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
  fake.pickNothing = false;
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
  fake.patched = [];
  fake.patchFails = false;
  fake.noApi = false;
  fake.patchHolds = [];
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
  it('while ready: stops sync, shows the notice and leaves the navigation to the root layout', async () => {
    useApp.setState({ boot: 'ready' } as any);
    fake.canDismiss = true;
    await expireSession();
    const st = useApp.getState();
    expect(fake.remindersStopped).toBe(1);
    expect(fake.teardowns).toBe(1);
    expect(fake.logouts).toBe(1);
    expect(st.boot).toBe('onboarding');
    expect(st.loginNotice).toBe('sessionExpired');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
  });

  it.each(['reconnecting', 'noWorkspace'] as const)('while the %s notice shows: sets onboarding, no navigation of its own', async (state) => {
    useApp.setState({ boot: state } as any);
    fake.canDismiss = true;
    await expireSession();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
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

describe('language across cold starts (Android e2e f07a2ce3)', () => {
  const api = fakeApi as any;
  const serverDe = { ...user, locale: 'de' };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('an unconfirmed local choice wins over the stale server value and is sent again', async () => {
    fake.kv.set('locale', 'en');
    fake.kv.set('localePending', '1');
    fake.getMe = async () => ({ user: serverDe, memberships: [mem('a')] });
    await establishSession('https://x', api);
    await flush();
    expect(useApp.getState().locale).toBe('en');
    expect(useApp.getState().user?.locale).toBe('en');
    expect(fake.patched).toEqual(['en']);
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('a confirmed value follows the server (changed on another device) and is stored', async () => {
    fake.kv.set('locale', 'en');
    fake.getMe = async () => ({ user: serverDe, memberships: [mem('a')] });
    await establishSession('https://x', api);
    expect(useApp.getState().locale).toBe('de');
    expect(fake.kv.get('locale')).toBe('de');
    expect(fake.patched).toEqual([]);
  });

  it('a failed PATCH leaves the choice pending for the next boot', async () => {
    fake.patchFails = true;
    chooseLocale('en');
    await flush();
    expect(fake.kv.get('localePending')).toBe('1');
    expect(fake.kv.get('locale')).toBe('en');
  });

  it('a confirmed PATCH clears the pending mark', async () => {
    chooseLocale('de');
    await flush();
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('the offline boot applies the saved choice over the cached user', async () => {
    fake.kv.set('locale', 'en');
    fake.kv.set('serverUrl', 'https://x');
    fake.kv.set('session', JSON.stringify({ user: serverDe, workspace: ws('a') }));
    fake.getMe = async () => {
      throw new TypeError('network');
    };
    await bootApp();
    expect(useApp.getState().locale).toBe('en');
  });
});

describe('language choice details (review cb533720)', () => {
  const api = fakeApi as any;
  const serverDe = { ...user, locale: 'de' };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const gate = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    return { p, release };
  };

  it('a newer choice made while a request is in flight stays pending', async () => {
    const [h1, h2] = [gate(), gate()];
    fake.patchHolds = [h1.p, h2.p];
    chooseLocale('de');
    chooseLocale('en');
    h1.release();
    await flush();
    expect(fake.kv.get('localePending')).toBe('1');
    h2.release();
    await flush();
    expect(fake.patched).toEqual(['de', 'en']);
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('sends the PATCHes one at a time, so an older one cannot land last', async () => {
    const h1 = gate();
    fake.patchHolds = [h1.p];
    chooseLocale('en');
    chooseLocale('de');
    await flush();
    expect(fake.patched).toEqual(['en']);
    h1.release();
    await flush();
    expect(fake.patched).toEqual(['en', 'de']);
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('a pending choice equal to the server value clears the mark without a PATCH', async () => {
    fake.kv.set('locale', 'de');
    fake.kv.set('localePending', '1');
    fake.getMe = async () => ({ user: serverDe, memberships: [mem('a')] });
    await establishSession('https://x', api);
    await flush();
    expect(useApp.getState().locale).toBe('de');
    expect(fake.patched).toEqual([]);
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('the session is set with the chosen language, and no await separates it from initSync', async () => {
    fake.kv.set('locale', 'en');
    fake.kv.set('localePending', '1');
    fake.getMe = async () => ({ user: serverDe, memberships: [mem('a')] });
    const seen: string[] = [];
    const initedAfterTick: number[] = [];
    const unsub = useApp.subscribe((s) => {
      if (s.boot !== 'ready') return;
      seen.push(s.locale);
      // Runs at the first await after setSession: the sync client must exist by then.
      queueMicrotask(() => initedAfterTick.push(fake.inited.length));
    });
    await establishSession('https://x', api);
    unsub();
    expect(seen[0]).toBe('en');
    expect(initedAfterTick[0]).toBe(1);
    expect(fake.inited).toEqual(['a']);
  });

  it('a logout during the locale read does not bring back a sync client', async () => {
    fake.kv.set('locale', 'en');
    let wanted = true;
    fake.getMe = async () => ({ user: serverDe, memberships: [mem('a')] });
    const p = establishSession('https://x', api, null, false, () => wanted);
    wanted = false;
    expect(await p).toBe(false);
    expect(fake.inited).toEqual([]);
    expect(open()).toBe('lost');
  });

  it('setLocale keeps the cached session in step', () => {
    useApp.getState().setLocale('de');
    expect(JSON.parse(fake.kv.get('session')!).user.locale).toBe('de');
  });

  it('retryPendingLocale sends a pending choice again, and nothing otherwise', async () => {
    await retryPendingLocale();
    await flush();
    expect(fake.patched).toEqual([]);
    fake.kv.set('locale', 'de');
    fake.kv.set('localePending', '1');
    useApp.setState({ locale: 'de' } as any);
    await retryPendingLocale();
    await flush();
    expect(fake.patched).toEqual(['de']);
    expect(fake.kv.has('localePending')).toBe(false);
  });

  it('retryPendingLocale sends nothing when logged out', async () => {
    fake.kv.set('locale', 'de');
    fake.kv.set('localePending', '1');
    useApp.setState({ user: null } as any);
    await retryPendingLocale();
    await flush();
    expect(fake.patched).toEqual([]);
    expect(fake.kv.get('localePending')).toBe('1');
  });

  it('without an API client the choice stays pending', async () => {
    fake.noApi = true;
    chooseLocale('en');
    await flush();
    expect(fake.patched).toEqual([]);
    expect(fake.kv.get('localePending')).toBe('1');
  });

  const fakeSync = () => {
    let status = 'offline';
    let notify = () => {};
    return {
      set: (s: string) => {
        status = s;
        notify();
      },
      sync: {
        getStatus: () => status as any,
        subscribe: (cb: () => void) => {
          notify = cb;
          return () => {};
        },
      },
    };
  };

  it('a fresh client going offline -> syncing -> synced does not send again', async () => {
    fake.kv.set('locale', 'de');
    fake.kv.set('localePending', '1');
    const f = fakeSync();
    retryLocaleOnReconnect(f.sync);
    f.set('syncing');
    f.set('synced');
    await flush();
    expect(fake.patched).toEqual([]);
  });

  it('retries when sync comes back online, not on other status changes', async () => {
    fake.kv.set('locale', 'de');
    fake.kv.set('localePending', '1');
    const f = fakeSync();
    retryLocaleOnReconnect(f.sync);
    const status = (v: string) => f.set(v);
    status('error');
    await flush();
    expect(fake.patched).toEqual([]);
    status('synced');
    await flush();
    expect(fake.patched).toEqual(['de']);
    status('syncing');
    await flush();
    expect(fake.patched).toEqual(['de']);
  });

  describe('watchLocaleRetries', () => {
    const setup = () => {
      let appState: (s: string) => void = () => {};
      let swap: (c: any) => void = () => {};
      const log = { removed: 0, unsubscribed: 0 };
      const clients: Array<ReturnType<typeof fakeSync> & { unsubscribed: number }> = [];
      const mk = () => {
        const f = fakeSync();
        const c = { ...f, unsubscribed: 0 };
        const subscribe = f.sync.subscribe;
        f.sync.subscribe = (cb: () => void) => {
          const off = subscribe(cb);
          return () => {
            c.unsubscribed++;
            off();
          };
        };
        clients.push(c);
        return c;
      };
      const stop = watchLocaleRetries({
        onAppStateChange: (cb) => {
          appState = cb;
          return { remove: () => void log.removed++ };
        },
        subscribeSyncClient: (cb) => {
          swap = cb;
          return () => void log.unsubscribed++;
        },
      });
      return { appState: (s: string) => appState(s), swap: (c: any) => swap(c), log, clients, mk, stop };
    };

    it('foreground retries a pending choice, other app states do not', async () => {
      fake.kv.set('locale', 'de');
      fake.kv.set('localePending', '1');
      const w = setup();
      w.appState('background');
      await flush();
      expect(fake.patched).toEqual([]);
      w.appState('active');
      await flush();
      expect(fake.patched).toEqual(['de']);
    });

    it('a client swap drops the old client watcher and cleanup removes everything', async () => {
      fake.kv.set('locale', 'de');
      fake.kv.set('localePending', '1');
      const w = setup();
      const c1 = w.mk();
      const c2 = w.mk();
      w.swap(c1.sync);
      w.swap(c2.sync);
      expect(c1.unsubscribed).toBe(1);
      w.stop();
      expect(c2.unsubscribed).toBe(1);
      expect(w.log).toEqual({ removed: 1, unsubscribed: 1 });
    });
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

  it('ends the session without navigating itself', async () => {
    fake.canDismiss = true;
    await logout();
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
  });

  it('does not navigate when there is nothing to dismiss either', async () => {
    fake.canDismiss = false;
    useApp.setState({ boot: 'ready' } as any);
    await logout();
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
  });

  it('still resets the session and leaves the screen when the purge fails', async () => {
    fake.purgeFails = true;
    fake.canDismiss = true;
    useApp.setState({ boot: 'ready' } as any);
    await expect(logout()).rejects.toThrow('sqlite');
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
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
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
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
    expect(fake.nav).toEqual([]); // the rescue wait never sends the user to onboarding
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
    expect(useApp.getState().boot).toBe('ready');
    expect(fake.nav).toEqual([]);
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

describe('leaving for onboarding past the gate (review 026272d7)', () => {
  afterEach(() => vi.useRealTimers());

  // Defensive branch: establishSession declining while still waiting. With a
  // non-empty /me the real pickMembership always picks one (an empty /me throws
  // NoWorkspaceError and the wait goes on), so the pick is mocked; unreachable today.
  it('defensive: establishSession declines while still waiting: sets onboarding without navigating', async () => {
    vi.useFakeTimers();
    fake.canDismiss = true;
    useApp.setState({ memberships: [mem('lost')] } as any);
    fake.getMe = async () => me();
    await moveOffLostWorkspace('lost');
    expect(useApp.getState().boot).toBe('noWorkspace');
    expect(fake.nav).toEqual([]);
    fake.pickNothing = true; // /me answers with a workspace the pick cannot use: establishSession returns false
    fake.getMe = async () => me('a');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
  });

  it('landOutside without a client: sets onboarding, the root layout navigates', async () => {
    useApp.setState({ serverUrl: null, boot: 'ready' } as any);
    fake.canDismiss = true;
    await moveOffLostWorkspace('lost');
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]); // state only: the root layout's effect navigates
  });

  // Guard only: setSession sets boot 'ready' before any sync client exists, so an
  // access loss during 'loading' is not reachable today.
  it('landOutside before the cold-start gate: no navigation either', async () => {
    useApp.setState({ serverUrl: null, boot: 'loading' } as any);
    fake.canDismiss = true;
    await moveOffLostWorkspace('lost');
    expect(useApp.getState().boot).toBe('onboarding');
    expect(fake.nav).toEqual([]);
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
