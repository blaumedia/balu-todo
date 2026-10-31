import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// boot.ts owns the recovery from a lost workspace; clients.ts (sync client,
// localStorage, api) is replaced by a small fake so the flows run in node.
const fake = vi.hoisted(() => {
  const state = {
    open: null as string | null,
    stored: [] as string[],
    discarded: new Map<string, number>(),
    expected: new Set<string>(),
    announced: new Set<string>(),
    purged: [] as string[],
    getMe: (async () => ({})) as () => Promise<any>,
    accessToken: null as string | null,
    loggedOut: 0,
    hydrated: 0,
    teardowns: 0,
    closes: 0,
  };
  return state;
});

vi.mock("../src/lib/clients.js", () => ({
  api: {
    getMe: () => fake.getMe(),
    logout: async () => {
      fake.loggedOut += 1;
    },
    hydrate: async () => {
      fake.hydrated += 1;
      fake.accessToken = globalThis.localStorage.getItem("balu:auth:refresh") ? "tok" : null;
    },
    isAuthenticated: () => fake.accessToken !== null,
    getAccessToken: () => fake.accessToken,
  },
  initSync: (id: string) => {
    fake.open = id;
  },
  getSyncWorkspaceId: () => fake.open,
  listStoredWorkspaceIds: () => fake.stored,
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
  setSessionEndedElsewhereHandler: () => {},
  teardownSync: () => {
    fake.teardowns += 1;
  },
  closeSync: () => {
    fake.closes += 1;
  },
}));

import { ApiError } from "@balu/api-client";
import {
  bootSession,
  discardLostWorkspaces,
  expireSession,
  handleAccessLost,
  moveOffLostWorkspace,
  onStorageEvent,
  reconcileSession,
} from "../src/lib/boot.js";
import { useApp } from "../src/store/app.js";

const user = { id: "u1", name: "U", email: "u@x", locale: "en" } as any;
const ws = (id: string) => ({ id, name: `WS ${id}` }) as any;
const mem = (id: string) => ({ workspace: ws(id), role: "owner" }) as any;

function me(...ids: string[]) {
  return { user, memberships: ids.map(mem) };
}

/** A fake JWT: only the payload matters to the code under test. */
function jwt(sub: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub })}.sig`;
}

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

const replaceState = vi.fn();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("history", { replaceState });
  replaceState.mockClear();
  globalThis.localStorage.setItem("balu:auth:refresh", "r");
  fake.accessToken = "tok";
  fake.loggedOut = 0;
  fake.hydrated = 0;
  fake.teardowns = 0;
  fake.closes = 0;
  fake.open = "lost";
  fake.stored = [];
  fake.discarded.clear();
  fake.expected.clear();
  fake.announced.clear();
  fake.purged = [];
  fake.getMe = async () => me("a", "b");
  useApp.setState({
    user,
    memberships: [mem("lost"), mem("a"), mem("b")],
    workspace: ws("lost"),
    toast: null,
    locale: "en",
  });
});

describe("handleAccessLost", () => {
  it("announces the loss with the count and moves to a survivor", async () => {
    await handleAccessLost({ workspaceId: "lost", reason: "removed", discarded: 3 });
    expect(useApp.getState().toast).toContain("3 unsynced change(s)");
    expect(fake.open).toBe("a");
    expect(useApp.getState().workspace?.id).toBe("a");
    expect(fake.purged).toContain("lost");
  });

  it("an expected loss shows no notice but still moves off the workspace", async () => {
    fake.expected.add("lost");
    await handleAccessLost({ workspaceId: "lost", reason: "deleted", discarded: 0 });
    expect(useApp.getState().toast).toBeNull();
    expect(fake.open).toBe("a");
  });

  it("a stale client's loss does not move the app", async () => {
    fake.open = "b";
    useApp.setState({ workspace: ws("b") });
    await handleAccessLost({ workspaceId: "lost", reason: "removed", discarded: 1 });
    expect(fake.open).toBe("b");
    expect(useApp.getState().workspace?.id).toBe("b");
  });
});

describe("moveOffLostWorkspace", () => {
  it("keeps a workspace the user switched to while /me was in flight", async () => {
    let answer: (v: unknown) => void = () => {};
    fake.getMe = () => new Promise((r) => (answer = r));
    const moving = moveOffLostWorkspace("lost");
    fake.open = "b"; // the user switches meanwhile
    useApp.setState({ workspace: ws("b") });
    answer(me("a", "b"));
    await moving;
    expect(fake.open).toBe("b");
    expect(useApp.getState().workspace?.id).toBe("b");
    expect(fake.purged).toEqual(["lost"]);
  });

  it("concurrent calls share one move", async () => {
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      return me("a");
    };
    await Promise.all([moveOffLostWorkspace("lost"), moveOffLostWorkspace("lost")]);
    expect(calls).toBe(1);
  });
});

describe("discardLostWorkspaces", () => {
  it("cleans every stored workspace /me no longer lists and announces once", async () => {
    fake.stored = ["a", "gone1", "gone2"];
    fake.discarded.set("gone1", 2);
    fake.discarded.set("gone2", 5);
    await discardLostWorkspaces(["a", "b"]);
    expect(fake.purged).toEqual(["gone1", "gone2"]);
    const toast = useApp.getState().toast ?? "";
    expect(toast).toContain("2 unsynced change(s)");
    expect(toast).toContain("5 unsynced change(s)");
    // A second pass finds nothing new to announce.
    useApp.setState({ toast: null });
    await discardLostWorkspaces(["a", "b"]);
    expect(useApp.getState().toast).toBeNull();
  });

  it("says nothing when the lost workspaces held no unsynced changes", async () => {
    fake.stored = ["gone"];
    await discardLostWorkspaces(["a"]);
    expect(fake.purged).toEqual(["gone"]);
    expect(useApp.getState().toast).toBeNull();
  });
});

describe("expireSession", () => {
  it("stops sync, shows the login screen with the notice and clears the address", async () => {
    useApp.setState({ boot: "ready" });
    await expireSession();
    const st = useApp.getState();
    expect(fake.teardowns).toBe(1);
    expect(fake.loggedOut).toBe(1);
    expect(st.boot).toBe("login");
    expect(st.loginNotice).toBe("sessionExpired");
    expect(st.user).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("leaves the address alone when it runs during boot", async () => {
    useApp.setState({ boot: "loading" });
    await expireSession();
    expect(useApp.getState().boot).toBe("login");
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("bootSession (attemptBoot classification)", () => {
  const apiError = (status: number) => new ApiError("x", "x", status);

  beforeEach(() => {
    useApp.setState({ boot: "loading", user: null, workspace: null, memberships: [], loginNotice: null });
    fake.getMe = async () => me("a");
  });

  it("a 401 goes to login with the expiry notice and is not retried", async () => {
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      throw apiError(401);
    };
    expect(await bootSession()).toBe(false);
    expect(calls).toBe(1);
    expect(useApp.getState().boot).toBe("login");
    expect(useApp.getState().loginNotice).toBe("sessionExpired");
  });

  it("backs off when the stored login and /me keep disagreeing, instead of looping on /me", async () => {
    vi.useFakeTimers();
    globalThis.localStorage.setItem("balu:auth:access", jwt("u2"));
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      return me("a"); // always answers for u1 while u2 is stored
    };
    const booted = bootSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(3); // two immediate re-asks, then it waits
    expect(useApp.getState().boot).toBe("unreachable"); // with a screen, not a blank "loading"
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(3);
    globalThis.localStorage.setItem("balu:auth:access", jwt("u1"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await booted).toBe(true);
    expect(calls).toBe(4);
  });

  it("replaced rounds do not raise the backoff of a later outage", async () => {
    vi.useFakeTimers();
    globalThis.localStorage.setItem("balu:auth:access", jwt("u2"));
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      if (calls <= 3) return me("a"); // disagrees with the stored u2: replaced rounds
      throw apiError(503);
    };
    const booted = bootSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1000); // the replaced backoff ends, the outage starts
    expect(calls).toBe(4);
    fake.getMe = async () => {
      calls += 1;
      throw apiError(503);
    };
    await vi.advanceTimersByTimeAsync(1000); // the first outage wait is 1 s, not 8 s
    expect(calls).toBe(5);
    fake.getMe = async () => me("a");
    globalThis.localStorage.setItem("balu:auth:access", jwt("u1"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await booted).toBe(true); // leave no loop running for the next test
  });

  it("a 5xx shows the unreachable screen, retries, then becomes ready", async () => {
    vi.useFakeTimers();
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      if (calls === 1) throw apiError(503);
      return me("a");
    };
    const booted = bootSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(useApp.getState().boot).toBe("unreachable");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await booted).toBe(true);
    expect(calls).toBe(2);
    expect(useApp.getState().boot).toBe("ready");
    expect(fake.open).toBe("a");
  });

  it("a network error is treated like a 5xx", async () => {
    vi.useFakeTimers();
    fake.getMe = async () => {
      throw new TypeError("fetch failed");
    };
    void bootSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(useApp.getState().boot).toBe("unreachable");
    fake.getMe = async () => me("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(useApp.getState().boot).toBe("ready");
  });

  it("ends on the login screen, purging, when another tab logged out while unreachable", async () => {
    vi.useFakeTimers();
    globalThis.localStorage.setItem("balu:queue:w1", "[]");
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      throw apiError(502);
    };
    const booted = bootSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(useApp.getState().boot).toBe("unreachable");
    globalThis.localStorage.removeItem("balu:auth:refresh");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await booted).toBe(false);
    expect(calls).toBe(1); // never asked /me again with the stale access token
    expect(useApp.getState().boot).toBe("login");
    expect(useApp.getState().loginNotice).toBeNull();
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBeNull();
  });

  it("does not even ask /me when the stored login is already gone", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      return me("a");
    };
    expect(await bootSession()).toBe(false);
    expect(calls).toBe(0);
    expect(useApp.getState().boot).toBe("login");
  });
});

describe("cross-tab session changes", () => {
  beforeEach(() => {
    useApp.setState({ boot: "ready", user, workspace: ws("a"), memberships: [mem("a")], loginNotice: null });
    globalThis.localStorage.setItem("balu:owner", "u1");
    globalThis.localStorage.setItem("balu:queue:w1", "[]");
  });

  it("logout in another tab: sync stops, data is purged, no expiry notice", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    globalThis.localStorage.removeItem("balu:owner");
    expect(await reconcileSession()).toBe(false);
    expect(fake.closes).toBe(1);
    expect(useApp.getState().boot).toBe("login");
    expect(useApp.getState().loginNotice).toBeNull();
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBeNull();
  });

  it("session expired in another tab (owner still stored): login screen with notice, queue kept", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    expect(await reconcileSession()).toBe(false);
    expect(fake.closes).toBeGreaterThan(0);
    expect(useApp.getState().boot).toBe("login");
    expect(useApp.getState().loginNotice).toBe("sessionExpired");
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBe("[]");
    expect(globalThis.localStorage.getItem("balu:owner")).toBe("u1");
  });

  it("a storage event for an expired login keeps the queue", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    onStorageEvent({ key: "balu:auth:refresh" });
    await vi.waitFor(() => expect(useApp.getState().loginNotice).toBe("sessionExpired"));
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBe("[]");
  });

  it("logout in another tab while /me is in flight: boots nothing, purges", async () => {
    useApp.setState({ boot: "loading", user: null });
    fake.getMe = async () => {
      globalThis.localStorage.removeItem("balu:auth:refresh");
      globalThis.localStorage.removeItem("balu:owner");
      return me("a");
    };
    expect(await bootSession()).toBe(false);
    expect(useApp.getState().boot).toBe("login");
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBeNull();
  });

  it("a storage event for a removed login reconciles at once", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    globalThis.localStorage.removeItem("balu:owner");
    onStorageEvent({ key: "balu:auth:refresh" });
    await vi.waitFor(() => expect(useApp.getState().boot).toBe("login"));
    expect(fake.closes).toBe(1);
  });

  it("another user signing in elsewhere: this tab restarts as that user", async () => {
    // As the other tab's adopt leaves storage: u1's data purged, owner = u2.
    globalThis.localStorage.setItem("balu:auth:access", jwt("u2"));
    globalThis.localStorage.setItem("balu:owner", "u2");
    globalThis.localStorage.removeItem("balu:queue:w1");
    fake.getMe = async () => ({ user: { ...user, id: "u2" }, memberships: [mem("z")] });
    onStorageEvent({ key: "balu:auth:refresh" });
    await vi.waitFor(() => expect(useApp.getState().user?.id).toBe("u2"));
    // The old client was closed (it can never write u1's queue back), not merely stopped.
    expect(fake.closes).toBe(1);
    expect(globalThis.localStorage.getItem("balu:queue:w1")).toBeNull();
    expect(fake.hydrated).toBe(1);
    expect(fake.open).toBe("z");
  });

  it("clears the previous user's screen at once and closes the old clients without waiting for them", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    globalThis.localStorage.removeItem("balu:owner");
    const done = reconcileSession();
    expect(useApp.getState().user).toBeNull();
    expect(useApp.getState().boot).toBe("loading");
    expect(fake.closes).toBe(1);
    expect(await done).toBe(false);
    expect(useApp.getState().boot).toBe("login");
  });

  it("an expiry elsewhere still rewrites the address bar after the early reset", async () => {
    globalThis.localStorage.removeItem("balu:auth:refresh");
    await reconcileSession();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("another user signing in while /me is in flight: asks again instead of adopting the old answer", async () => {
    useApp.setState({ boot: "loading", user: null });
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      if (calls === 1) {
        // This /me was for u1; meanwhile another tab logged u2 in.
        globalThis.localStorage.setItem("balu:auth:access", jwt("u2"));
        globalThis.localStorage.setItem("balu:owner", "u2");
        globalThis.localStorage.removeItem("balu:queue:w1");
        return me("a");
      }
      return { user: { ...user, id: "u2" }, memberships: [mem("z")] };
    };
    expect(await bootSession()).toBe(true);
    expect(calls).toBe(2);
    expect(useApp.getState().user?.id).toBe("u2");
    expect(globalThis.localStorage.getItem("balu:owner")).toBe("u2");
    expect(fake.open).toBe("z");
  });

  it("a token rotation by the same user is ignored", () => {
    globalThis.localStorage.setItem("balu:auth:access", jwt("u1"));
    onStorageEvent({ key: "balu:auth:refresh" });
    expect(fake.teardowns).toBe(0);
    expect(useApp.getState().boot).toBe("ready");
  });
});
