import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type AsyncKV } from "../src/index.js";

function memoryKV(): AsyncKV {
  const m = new Map<string, string>();
  return {
    async getItem(k) {
      return m.get(k) ?? null;
    },
    async setItem(k, v) {
      m.set(k, v);
    },
    async removeItem(k) {
      m.delete(k);
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USER = {
  id: "u1", email: "d@example.com", name: "Dennis",
  locale: "de", theme: "system", created_at: "2026-07-01T00:00:00Z",
};

describe("auth", () => {
  it("register stores tokens and marks authenticated", async () => {
    const fetchImpl = (async () =>
      json({ user: USER, access_token: "a1", refresh_token: "r1" })) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl });
    const res = await c.register({ email: "d@example.com", password: "password1", name: "Dennis" });
    expect(res.user.name).toBe("Dennis");
    expect(c.isAuthenticated()).toBe(true);
    expect(c.getAccessToken()).toBe("a1");
  });

  it("tokens persist and rehydrate into a fresh client", async () => {
    const storage = memoryKV();
    const fetchImpl = (async () =>
      json({ user: USER, access_token: "a1", refresh_token: "r1" })) as unknown as typeof fetch;
    const c1 = createApiClient({ storage, fetch: fetchImpl });
    await c1.login({ email: "d@example.com", password: "pw" });

    const c2 = createApiClient({ storage, fetch: fetchImpl });
    expect(c2.isAuthenticated()).toBe(false);
    await c2.hydrate();
    expect(c2.getAccessToken()).toBe("a1");
  });

  it("401 triggers a single refresh + retry, and rotates the refresh token", async () => {
    const storage = memoryKV();
    const calls: string[] = [];
    let meAttempts = 0;
    const fetchImpl = (async (u: any, init: any) => {
      const path = String(u);
      calls.push(`${init.method} ${path}`);
      if (path.endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      if (path.endsWith("/auth/refresh")) {
        const body = JSON.parse(init.body);
        expect(body.refresh_token).toBe("r1");
        return json({ access_token: "a2", refresh_token: "r2" });
      }
      if (path.endsWith("/me")) {
        meAttempts += 1;
        const auth = init.headers.authorization;
        if (auth === "Bearer a1") return json({ detail: { code: "token_expired", message: "" } }, 401);
        return json({ user: USER, memberships: [] });
      }
      return json({}, 404);
    }) as unknown as typeof fetch;

    const c = createApiClient({ storage, fetch: fetchImpl });
    await c.login({ email: "d@example.com", password: "pw" });
    const me = await c.getMe();
    expect(me.user.id).toBe("u1");
    expect(meAttempts).toBe(2); // first 401, retried after refresh
    expect(c.getAccessToken()).toBe("a2");
    expect(calls.filter((x) => x.includes("/auth/refresh"))).toHaveLength(1);
  });

  async function expiredSession(
    refreshReply: () => Promise<Response> | Response,
    storage = memoryKV(),
    onSessionExpired?: () => void,
  ) {
    const fetchImpl = (async (u: any) => {
      const path = String(u);
      if (path.endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      if (path.endsWith("/auth/refresh")) return refreshReply();
      return json({ detail: { code: "token_expired", message: "" } }, 401);
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl, onSessionExpired });
    await c.login({ email: "d@example.com", password: "pw" });
    return { c, storage, fetchImpl };
  }

  it("a network error during refresh keeps the tokens", async () => {
    const spy = vi.fn();
    const { c, storage, fetchImpl } = await expiredSession(
      () => {
        throw new TypeError("network down");
      },
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toBeInstanceOf(TypeError);
    expect(c.isAuthenticated()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const fresh = createApiClient({ storage, fetch: fetchImpl });
    await fresh.hydrate();
    expect(fresh.isAuthenticated()).toBe(true);
  });

  it("a 5xx during refresh keeps the tokens", async () => {
    const spy = vi.fn();
    const { c, storage, fetchImpl } = await expiredSession(
      () => new Response("<html>bad gateway</html>", { status: 502 }),
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 502 });
    expect(c.isAuthenticated()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const fresh = createApiClient({ storage, fetch: fetchImpl });
    await fresh.hydrate();
    expect(fresh.isAuthenticated()).toBe(true);
  });

  it("a rejected refresh token (401) clears the tokens", async () => {
    const spy = vi.fn();
    const { c } = await expiredSession(
      () => json({ detail: { code: "invalid_token", message: "" } }, 401),
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 401 });
    expect(c.isAuthenticated()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a 429 during refresh keeps the tokens and does not end the session", async () => {
    const spy = vi.fn();
    const { c } = await expiredSession(
      () => json({ detail: { code: "rate_limited", message: "" } }, 429),
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 429 });
    expect(c.isAuthenticated()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("two concurrent requests report one expired session", async () => {
    const spy = vi.fn();
    const { c } = await expiredSession(
      () => json({ detail: { code: "invalid_token", message: "" } }, 401),
      memoryKV(),
      spy,
    );
    const results = await Promise.allSettled([c.getMe(), c.getMe()]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a hung request times out with ApiError timeout", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = ((_u: any, init: any) => {
      signal = init.signal;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl, requestTimeoutMs: 20 });
    await expect(c.getMe()).rejects.toMatchObject({ code: "timeout", status: 0 });
    expect(signal?.aborted).toBe(true);
  });

  it("surfaces contract error codes as ApiError", async () => {
    const fetchImpl = (async () =>
      json({ detail: { code: "email_taken", message: "Email already registered" } }, 409)) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl });
    await expect(c.register({ email: "d@example.com", password: "pw", name: "D" })).rejects.toMatchObject({
      code: "email_taken",
    });
    await expect(
      c.register({ email: "d@example.com", password: "pw", name: "D" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("logout clears tokens", async () => {
    const fetchImpl = (async (u: any) => {
      if (String(u).endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl });
    await c.login({ email: "d@example.com", password: "pw" });
    await c.logout();
    expect(c.isAuthenticated()).toBe(false);
  });
});

const INVITE = {
  id: "inv1", workspace_id: "w1", role: "member", email: null,
  token: "tok-abc", created_at: "2026-07-01T00:00:00Z", expires_at: "2026-07-15T00:00:00Z",
};

/** A client already holding an access token, plus a recorder of requests. */
async function authedClient(handler: (path: string, init: any) => Response) {
  const storage = memoryKV();
  const calls: Array<{ method: string; path: string; body: any }> = [];
  const fetchImpl = (async (u: any, init: any) => {
    const path = String(u);
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
    return handler(path, init);
  }) as unknown as typeof fetch;
  const c = createApiClient({ storage, fetch: fetchImpl });
  await c.login({ email: "d@example.com", password: "pw" });
  return { c, calls };
}

describe("invites & members (contract §7)", () => {
  it("createInvite posts role/email and unwraps {invite}", async () => {
    const { c, calls } = await authedClient((path) =>
      path.endsWith("/workspaces/w1/invites") ? json({ invite: INVITE }, 201) : json({}, 404),
    );
    const invite = await c.createInvite("w1", { role: "member", email: "x@example.com" });
    expect(invite.token).toBe("tok-abc");
    const req = calls.find((x) => x.path.endsWith("/workspaces/w1/invites"))!;
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ role: "member", email: "x@example.com" });
  });

  it("listInvites unwraps {invites}", async () => {
    const { c } = await authedClient((path) =>
      path.endsWith("/workspaces/w1/invites") ? json({ invites: [INVITE] }) : json({}, 404),
    );
    expect(await c.listInvites("w1")).toHaveLength(1);
  });

  it("revokeInvite issues a DELETE", async () => {
    const { c, calls } = await authedClient(() => new Response(null, { status: 204 }));
    await c.revokeInvite("w1", "inv1");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: expect.stringContaining("/workspaces/w1/invites/inv1") });
  });

  it("acceptInvite posts the token and returns the workspace", async () => {
    const ws = { id: "w2", name: "Team", created_at: "2026-07-01T00:00:00Z" };
    const { c, calls } = await authedClient((path) =>
      path.endsWith("/invites/accept") ? json({ workspace: ws }) : json({}, 404),
    );
    const workspace = await c.acceptInvite("tok-abc");
    expect(workspace.id).toBe("w2");
    expect(calls.at(-1)!.body).toEqual({ token: "tok-abc" });
  });

  it("acceptInvite surfaces invalid_token as ApiError", async () => {
    const { c } = await authedClient((path) =>
      path.endsWith("/invites/accept")
        ? json({ detail: { code: "invalid_token", message: "expired" } }, 400)
        : json({}, 404),
    );
    await expect(c.acceptInvite("bad")).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("updateMember PATCHes a role; last_owner surfaces as ApiError", async () => {
    const { c, calls } = await authedClient((path) =>
      path.includes("/members/u9")
        ? json({ detail: { code: "last_owner", message: "cannot demote" } }, 400)
        : json({}, 404),
    );
    await expect(c.updateMember("w1", "u9", { role: "member" })).rejects.toMatchObject({ code: "last_owner" });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH" });
  });

  it("removeMember issues a DELETE on the member path", async () => {
    const { c, calls } = await authedClient(() => new Response(null, { status: 204 }));
    await c.removeMember("w1", "u9");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: expect.stringContaining("/workspaces/w1/members/u9") });
  });
});

describe("notification channels (contract §8)", () => {
  it("getChannels unwraps {channels}", async () => {
    const { c } = await authedClient((path) =>
      path.endsWith("/me/channels") ? json({ channels: [{ type: "ntfy", url: "https://ntfy.sh/x" }] }) : json({}, 404),
    );
    const channels = await c.getChannels();
    expect(channels).toEqual([{ type: "ntfy", url: "https://ntfy.sh/x" }]);
  });

  it("putChannels sends {channels} and returns the saved list", async () => {
    const list = [{ type: "email" as const, address: "d@example.com" }];
    const { c, calls } = await authedClient((path, init) =>
      path.endsWith("/me/channels") && init.method === "PUT" ? json({ channels: list }) : json({}, 404),
    );
    expect(await c.putChannels(list)).toEqual(list);
    expect(calls.at(-1)!.body).toEqual({ channels: list });
  });

  it("testChannel posts the type; channel_unavailable surfaces as ApiError", async () => {
    const { c, calls } = await authedClient((path) =>
      path.endsWith("/me/channels/test")
        ? json({ detail: { code: "channel_unavailable", message: "no SMTP" } }, 400)
        : json({}, 404),
    );
    await expect(c.testChannel("email")).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(calls.at(-1)!.body).toEqual({ type: "email" });
  });
});

describe("refresh across clients sharing one storage (two tabs)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A server that rotates tokens and burns the family on a replayed refresh token. */
  function rotatingServer() {
    let current = "r1";
    let access = "a1";
    let n = 1;
    const state = { refreshCalls: 0, burned: false };
    const fetchImpl = (async (u: any, init: any) => {
      const path = String(u);
      if (path.endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      if (path.endsWith("/auth/refresh")) {
        state.refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 5));
        if (JSON.parse(init.body).refresh_token !== current || state.burned) {
          state.burned = true;
          return json({ detail: { code: "invalid_token", message: "" } }, 401);
        }
        n += 1;
        current = `r${n}`;
        access = `a${n}`;
        return json({ access_token: access, refresh_token: current });
      }
      if (init.headers.authorization !== `Bearer ${access}`) {
        return json({ detail: { code: "token_expired", message: "" } }, 401);
      }
      return json({ user: USER, memberships: [] });
    }) as unknown as typeof fetch;
    return { state, fetchImpl };
  }

  async function twoTabs() {
    const storage = memoryKV();
    const { state, fetchImpl } = rotatingServer();
    const expired = vi.fn();
    const a = createApiClient({ storage, fetch: fetchImpl, onSessionExpired: expired });
    await a.login({ email: "d@example.com", password: "pw" });
    const b = createApiClient({ storage, fetch: fetchImpl, onSessionExpired: expired });
    await b.hydrate();
    return { a, b, state, expired };
  }

  it.each([
    ["fallback (no Web Locks)", false],
    ["Web Locks", true],
  ])("concurrent expiry in two tabs - %s", async (_name, withLocks) => {
    if (withLocks) {
      let tail: Promise<unknown> = Promise.resolve();
      vi.stubGlobal("navigator", {
        locks: {
          request: <T>(_n: string, cb: () => Promise<T>) => {
            const run = tail.then(cb, cb);
            tail = run.catch(() => undefined);
            return run;
          },
        },
      });
    }
    const { a, b, state, expired } = await twoTabs();
    // Rotate server-side so both tabs hold a stale access token.
    await a.refresh();
    expect(state.refreshCalls).toBe(1);
    // b still has a1/r1 in memory; a's refresh stored a2/r2.
    const me = await b.getMe();
    expect(me.user.id).toBe("u1");
    expect(state.refreshCalls).toBe(1); // b adopted the stored tokens, no replay
    expect(b.getAccessToken()).toBe("a2");
    expect(state.burned).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("simultaneous refresh() calls from two clients send one request", async () => {
    const { a, b, state, expired } = await twoTabs();
    const [ta, tb] = await Promise.all([a.refresh(), b.refresh()]);
    expect(state.refreshCalls).toBe(1);
    expect(tb.refresh_token).toBe(ta.refresh_token);
    expect(state.burned).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("concurrent refresh() calls in one tab share one request", async () => {
    const { a, state } = await twoTabs();
    await Promise.all([a.refresh(), a.refresh(), a.refresh()]);
    expect(state.refreshCalls).toBe(1);
  });
});
