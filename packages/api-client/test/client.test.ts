import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
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

  it("a refresh that settles after logout leaves storage empty and stays silent", async () => {
    const spy = vi.fn();
    const { c, storage } = await expiredSession(
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return json({ access_token: "a2", refresh_token: "r2" });
      },
      memoryKV(),
      spy,
    );
    const me = c.getMe().catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0)); // the 401 has started the refresh
    await c.logout();
    await me;
    await new Promise((r) => setTimeout(r, 40));
    expect(c.isAuthenticated()).toBe(false);
    expect(await storage.getItem("balu:auth:access")).toBeNull();
    expect(await storage.getItem("balu:auth:refresh")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a refresh refused after logout does not announce an expired session", async () => {
    const spy = vi.fn();
    const { c } = await expiredSession(
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return json({ detail: { code: "invalid_token", message: "" } }, 401);
      },
      memoryKV(),
      spy,
    );
    const me = c.getMe().catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    await c.logout();
    await me;
    expect(spy).not.toHaveBeenCalled();
  });

  it("a refresh that lands after logout rejects as signed_out, not as a refused token", async () => {
    const { c } = await expiredSession(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return json({ access_token: "a2", refresh_token: "r2" });
    });
    const me = c.getMe().catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    await c.logout();
    expect(await me).toMatchObject({ code: "signed_out", status: 401 });
  });

  it("a logout between the two token writes leaves storage empty", async () => {
    const inner = memoryKV();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const reachedAccess = new Promise<void>((r) => (started = r));
    let armed = false;
    const storage: AsyncKV = {
      ...inner,
      async setItem(k, v) {
        if (armed && k === "balu:auth:access") {
          started();
          await gate;
        }
        await inner.setItem(k, v);
      },
    };
    const fetchImpl = (async (u: any) => {
      if (String(u).endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl });
    armed = true;
    const login = c.login({ email: "d@example.com", password: "pw" });
    await reachedAccess;
    await c.logout();
    release();
    // The caller must not see a successful login for a session that was ended.
    await expect(login).rejects.toMatchObject({ code: "signed_out", status: 401 });
    expect(c.isAuthenticated()).toBe(false);
    expect(await inner.getItem("balu:auth:access")).toBeNull();
    expect(await inner.getItem("balu:auth:refresh")).toBeNull();
  });

  it("a logout during the refresh-key write leaves storage empty and rejects the login", async () => {
    const inner = memoryKV();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const reachedRefresh = new Promise<void>((r) => (started = r));
    let armed = false;
    const storage: AsyncKV = {
      ...inner,
      async setItem(k, v) {
        if (armed && k === "balu:auth:refresh") {
          started();
          await gate;
        }
        await inner.setItem(k, v);
      },
    };
    const fetchImpl = (async (u: any) => {
      if (String(u).endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl });
    armed = true;
    const login = c.login({ email: "d@example.com", password: "pw" });
    await reachedRefresh;
    await c.logout();
    release();
    await expect(login).rejects.toMatchObject({ code: "signed_out", status: 401 });
    expect(c.isAuthenticated()).toBe(false);
    expect(await inner.getItem("balu:auth:access")).toBeNull();
    expect(await inner.getItem("balu:auth:refresh")).toBeNull();
  });

  it("a logout during the token write of a refresh fails the request instead of retrying it", async () => {
    const inner = memoryKV();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const reachedAccess = new Promise<void>((r) => (started = r));
    let armed = false;
    const storage: AsyncKV = {
      ...inner,
      async setItem(k, v) {
        if (armed && k === "balu:auth:access") {
          started();
          await gate;
        }
        await inner.setItem(k, v);
      },
    };
    const { c } = await expiredSession(
      () => json({ access_token: "a2", refresh_token: "r2" }),
      storage,
    );
    armed = true;
    const me = c.getMe().catch((e: unknown) => e);
    await reachedAccess;
    await c.logout();
    release();
    expect(await me).toMatchObject({ code: "signed_out", status: 401 });
    expect(await inner.getItem("balu:auth:access")).toBeNull();
  });

  it("an older setTokens that gives up does not erase a newer login's stored tokens", async () => {
    const inner = memoryKV();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const reachedAccess = new Promise<void>((r) => (started = r));
    let gated = false;
    const storage: AsyncKV = {
      ...inner,
      async setItem(k, v) {
        await inner.setItem(k, v);
        // Hold the old write's completion, so the newer login lands in between.
        if (!gated && k === "balu:auth:access" && v === "a1") {
          gated = true;
          started();
          await gate;
        }
      },
    };
    let n = 0;
    const fetchImpl = (async (u: any) => {
      if (String(u).endsWith("/auth/login")) {
        n += 1;
        return json({ user: USER, access_token: `a${n}`, refresh_token: `r${n}` });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl });
    const first = c.login({ email: "d@example.com", password: "pw" }).catch((e: unknown) => e);
    await reachedAccess;
    await c.logout();
    await c.login({ email: "d@example.com", password: "pw" });
    release();
    expect(await first).toMatchObject({ code: "signed_out" });
    expect(c.getAccessToken()).toBe("a2");
    expect(await inner.getItem("balu:auth:access")).toBe("a2");
    expect(await inner.getItem("balu:auth:refresh")).toBe("r2");
  });

  it("a refresh started while logout posts fails at once and stays silent", async () => {
    const spy = vi.fn();
    const calls: string[] = [];
    let releasePost!: () => void;
    const postGate = new Promise<void>((r) => (releasePost = r));
    const fetchImpl = (async (u: any) => {
      const path = String(u);
      calls.push(path);
      if (path.endsWith("/auth/login")) {
        return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      }
      if (path.endsWith("/auth/logout")) {
        await postGate;
        return new Response(null, { status: 204 });
      }
      return json({ detail: { code: "invalid_token", message: "" } }, 401);
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl, onSessionExpired: spy });
    await c.login({ email: "d@example.com", password: "pw" });
    const out = c.logout();
    await new Promise((r) => setTimeout(r, 0)); // the logout post is pending
    await expect(c.refresh()).rejects.toMatchObject({ code: "signed_out" });
    releasePost();
    await out;
    expect(calls.filter((x) => x.endsWith("/auth/refresh"))).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("logout removes the stored tokens before the post finishes", async () => {
    const inner = memoryKV();
    let releasePost!: () => void;
    const postGate = new Promise<void>((r) => (releasePost = r));
    const fetchImpl = (async (u: any) => {
      if (String(u).endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      await postGate;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage: inner, fetch: fetchImpl });
    await c.login({ email: "d@example.com", password: "pw" });
    const out = c.logout();
    await new Promise((r) => setTimeout(r, 0)); // the post is pending (an outage)
    expect(await inner.getItem("balu:auth:access")).toBeNull();
    expect(await inner.getItem("balu:auth:refresh")).toBeNull();
    releasePost();
    await out;
  });

  it("a refresh slower than the request timeout still completes (own, longer timeout)", async () => {
    const storage = memoryKV();
    const fetchImpl = (async (u: any) => {
      const path = String(u);
      if (path.endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      if (path.endsWith("/auth/refresh")) {
        await new Promise((r) => setTimeout(r, 60));
        return json({ access_token: "a2", refresh_token: "r2" });
      }
      return json({ user: USER, memberships: [] });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl, requestTimeoutMs: 20, refreshTimeoutMs: 500 });
    await c.login({ email: "d@example.com", password: "pw" });
    await expect(c.refresh()).resolves.toMatchObject({ refresh_token: "r2" });
    expect(await storage.getItem("balu:auth:refresh")).toBe("r2");
  });

  it("a refresh past its own timeout gives up and keeps the tokens", async () => {
    const storage = memoryKV();
    const fetchImpl = (async (u: any) => {
      const path = String(u);
      if (path.endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl, refreshTimeoutMs: 30 });
    await c.login({ email: "d@example.com", password: "pw" });
    await expect(c.refresh()).rejects.toMatchObject({ code: "timeout" });
    expect(await storage.getItem("balu:auth:refresh")).toBe("r1");
  });

  it("a refresh attempt gives up after 30 s and the whole refresh after 50 s, inside the server's 60 s reuse grace window", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryKV();
      let attempts = 0;
      const fetchImpl = (async (u: any) => {
        if (String(u).endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
        attempts++;
        return new Promise<Response>(() => {});
      }) as unknown as typeof fetch;
      const c = createApiClient({ storage, fetch: fetchImpl, crossContextLock: "none" });
      await c.login({ email: "d@example.com", password: "pw" });
      let state = "pending";
      const out = c.refresh();
      const settled = expect(out).rejects.toMatchObject({ code: "timeout" });
      void out.catch(() => (state = "rejected"));
      await vi.advanceTimersByTimeAsync(29_999);
      expect(attempts).toBe(1); // still waiting for the first answer
      await vi.advanceTimersByTimeAsync(2);
      expect(attempts).toBe(2); // the first one timed out, the second started
      await vi.advanceTimersByTimeAsync(19_000);
      expect(state).toBe("pending"); // 49 s
      await vi.advanceTimersByTimeAsync(1_100);
      await settled;
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refresh whose answer was lost is repeated and takes the successor the server hands back", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryKV();
      let attempts = 0;
      const fetchImpl = (async (u: any) => {
        if (String(u).endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
        attempts++;
        if (attempts === 1) return new Promise<Response>(() => {});
        return json({ access_token: "a2", refresh_token: "r2" });
      }) as unknown as typeof fetch;
      const c = createApiClient({ storage, fetch: fetchImpl, crossContextLock: "none" });
      await c.login({ email: "d@example.com", password: "pw" });
      const out = c.refresh();
      await vi.advanceTimersByTimeAsync(30_001);
      await expect(out).resolves.toMatchObject({ refresh_token: "r2" });
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logout still posts the revoke when clearing the stored tokens fails", async () => {
    const inner = memoryKV();
    const storage = {
      ...inner,
      getItem: inner.getItem.bind(inner),
      setItem: inner.setItem.bind(inner),
      removeItem: async () => {
        throw new Error("quota");
      },
    };
    const posted: string[] = [];
    const fetchImpl = (async (u: any) => {
      posted.push(String(u));
      if (String(u).endsWith("/auth/login")) return json({ user: USER, access_token: "a1", refresh_token: "r1" });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage, fetch: fetchImpl });
    await c.login({ email: "d@example.com", password: "pw" });
    await expect(c.logout()).resolves.toBeUndefined();
    expect(posted.some((u) => u.endsWith("/auth/logout"))).toBe(true);
  });

  it("carries a 503's Retry-After on the error", async () => {
    const mk = (value: string | null) =>
      createApiClient({
        storage: memoryKV(),
        fetch: (async () =>
          json({ detail: { code: "unavailable", message: "db" } }, 503, value ? { "retry-after": value } : {})) as unknown as typeof fetch,
      });
    await expect(mk("7").getMe()).rejects.toMatchObject({ status: 503, retryAfterMs: 7000 });
    await expect(mk(null).getMe()).rejects.toMatchObject({ retryAfterMs: null });
    await expect(mk("soon").getMe()).rejects.toMatchObject({ retryAfterMs: null });
    await expect(mk("99999").getMe()).rejects.toMatchObject({ retryAfterMs: 300_000 });
  });

  it("a network error during refresh keeps the tokens", async () => {
    const spy = vi.fn();
    let refreshes = 0;
    const { c, storage, fetchImpl } = await expiredSession(
      () => {
        refreshes++;
        throw new TypeError("network down");
      },
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toBeInstanceOf(TypeError);
    expect(refreshes).toBe(2); // a lost answer is repeated exactly once
    expect(c.isAuthenticated()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const fresh = createApiClient({ storage, fetch: fetchImpl });
    await fresh.hydrate();
    expect(fresh.isAuthenticated()).toBe(true);
  });

  it("a 5xx during refresh keeps the tokens", async () => {
    const spy = vi.fn();
    let refreshes = 0;
    const { c, storage, fetchImpl } = await expiredSession(
      () => {
        refreshes++;
        return new Response("<html>bad gateway</html>", { status: 502 });
      },
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 502 });
    expect(refreshes).toBe(1); // an answer, not a lost one
    expect(c.isAuthenticated()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const fresh = createApiClient({ storage, fetch: fetchImpl });
    await fresh.hydrate();
    expect(fresh.isAuthenticated()).toBe(true);
  });

  it("a rejected refresh token (401) clears the tokens", async () => {
    const spy = vi.fn();
    let refreshes = 0;
    const { c } = await expiredSession(
      () => {
        refreshes++;
        return json({ detail: { code: "invalid_token", message: "" } }, 401);
      },
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 401 });
    expect(refreshes).toBe(1);
    expect(c.isAuthenticated()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a 429 during refresh keeps the tokens and does not end the session", async () => {
    const spy = vi.fn();
    let refreshes = 0;
    const { c } = await expiredSession(
      () => {
        refreshes++;
        return json({ detail: { code: "rate_limited", message: "" } }, 429);
      },
      memoryKV(),
      spy,
    );
    await expect(c.getMe()).rejects.toMatchObject({ status: 429 });
    expect(refreshes).toBe(1);
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

describe("refresh across tabs sharing one storage", () => {
  // Node ships its own navigator.locks; plain http on a LAN address has none.
  beforeEach(() => vi.stubGlobal("navigator", {}));
  afterEach(() => vi.unstubAllGlobals());

  type Mod = typeof import("../src/index.js");

  /** A page of its own: nothing is shared with other "tabs" except the storage. */
  async function loadTab(): Promise<Mod> {
    vi.resetModules();
    return (await import("../src/index.js")) as Mod;
  }

  /** A fake JWT: only the payload matters to the client. */
  function jwt(sub: string, n = 0): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${b64({ alg: "HS256" })}.${b64({ sub, n })}.sig`;
  }

  /** A server that rotates tokens and burns the family on a replayed refresh token. */
  function rotatingServer(sub = "u1") {
    let current = "r1";
    let access = jwt(sub, 1);
    let n = 1;
    const state = { refreshCalls: 0, burned: false };
    const fetchImpl = (async (u: any, init: any) => {
      const path = String(u);
      if (path.endsWith("/auth/login")) {
        return json({ user: USER, access_token: access, refresh_token: "r1" });
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
        access = jwt(sub, n);
        return json({ access_token: access, refresh_token: current });
      }
      if (init.headers.authorization !== `Bearer ${access}`) {
        return json({ detail: { code: "token_expired", message: "" } }, 401);
      }
      return json({ user: USER, memberships: [] });
    }) as unknown as typeof fetch;
    return { state, fetchImpl, currentAccess: () => access };
  }

  async function twoTabs() {
    const storage = memoryKV();
    const server = rotatingServer();
    const expired = vi.fn();
    const elsewhere = vi.fn();
    const tabA = await loadTab();
    const tabB = await loadTab();
    expect(tabA).not.toBe(tabB); // separate module instances: no shared in-page queue
    const mk = (m: Mod) =>
      m.createApiClient({
        storage,
        fetch: server.fetchImpl,
        onSessionExpired: expired,
        onSessionEndedElsewhere: elsewhere,
      });
    const a = mk(tabA);
    await a.login({ email: "d@example.com", password: "pw" });
    const b = mk(tabB);
    await b.hydrate();
    return { a, b, storage, expired, elsewhere, ...server };
  }

  it.each([
    ["lease (no Web Locks)", false],
    ["Web Locks", true],
  ])("a tab adopts the tokens another tab rotated - %s", async (_name, withLocks) => {
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
    const { a, b, state, expired, currentAccess } = await twoTabs();
    await a.refresh();
    expect(state.refreshCalls).toBe(1);
    const me = await b.getMe(); // b still holds the spent tokens
    expect(me.user.id).toBe("u1");
    expect(state.refreshCalls).toBe(1); // adopted, not replayed
    expect(b.getAccessToken()).toBe(currentAccess());
    expect(state.burned).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("simultaneous refresh() from two tabs without Web Locks sends one request", async () => {
    const { a, b, state, expired } = await twoTabs();
    const [ta, tb] = await Promise.all([a.refresh(), b.refresh()]);
    expect(state.refreshCalls).toBe(1);
    expect(tb.refresh_token).toBe(ta.refresh_token);
    expect(state.burned).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("three tabs refreshing at once still send one request", async () => {
    const { a, b, storage, state, fetchImpl } = await twoTabs();
    const c = (await loadTab()).createApiClient({ storage, fetch: fetchImpl });
    await c.hydrate();
    await Promise.all([a.refresh(), b.refresh(), c.refresh()]);
    expect(state.refreshCalls).toBe(1);
    expect(state.burned).toBe(false);
  });

  it("the lease is released after a refresh", async () => {
    const { a, storage } = await twoTabs();
    await a.refresh();
    expect(await storage.getItem("balu:auth:refreshLease")).toBeNull();
  });

  it("an expired lease of a crashed tab does not block a refresh", async () => {
    const { a, storage, state } = await twoTabs();
    await storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "dead-tab", exp: Date.now() - 1 }));
    await a.refresh();
    expect(state.refreshCalls).toBe(1);
  });

  it("waits while another tab holds a live lease, then refreshes", async () => {
    const { a, storage, state } = await twoTabs();
    await storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "other-tab", exp: Date.now() + 20_000 }));
    let done = false;
    const refreshed = a.refresh().then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 350));
    expect(done).toBe(false);
    expect(state.refreshCalls).toBe(0);
    await storage.removeItem("balu:auth:refreshLease");
    await refreshed;
    expect(state.refreshCalls).toBe(1);
  });

  it("a lease whose expiry is far in the future (clock moved back) is taken over", async () => {
    const { a, storage, state } = await twoTabs();
    await storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "skewed", exp: Date.now() + 3_600_000 }));
    await a.refresh();
    expect(state.refreshCalls).toBe(1);
  });

  /** The tab's storage, with a hook on every read and write for the lease tests. */
  async function hookedTab(
    base: ReturnType<typeof memoryKV>,
    fetchImpl: typeof fetch,
    hook: { get?: (k: string) => void; set?: (k: string) => void },
  ) {
    const storage: ReturnType<typeof memoryKV> = {
      getItem: async (k) => {
        hook.get?.(k);
        return base.getItem(k);
      },
      setItem: async (k, v) => {
        hook.set?.(k);
        return base.setItem(k, v);
      },
      removeItem: (k) => base.removeItem(k),
    };
    const c = (await loadTab()).createApiClient({ storage, fetch: fetchImpl });
    await c.hydrate();
    return c;
  }

  it("a lease lost right before the request is re-acquired before POSTing", async () => {
    const { storage, state, fetchImpl } = await twoTabs();
    let armed = false;
    const c = await hookedTab(storage, fetchImpl, {
      get: (k) => {
        if (k !== "balu:auth:refresh" || !armed) return;
        armed = false; // first read inside the locked section
        void storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "other-tab", exp: Date.now() + 300 }));
      },
    });
    armed = true;
    await c.refresh();
    expect(state.refreshCalls).toBe(1); // never POSTed without the lease, and only once after it
    expect(state.burned).toBe(false);
    expect(await storage.getItem("balu:auth:refreshLease")).toBeNull();
  });

  it("a refresh() called after the lease was lost joins the retry instead of starting a second POST", async () => {
    const { storage, state, fetchImpl } = await twoTabs();
    let armed = false;
    let stolen = false;
    let lostSeen = false;
    let late: Promise<unknown> | null = null;
    let cRef: Awaited<ReturnType<typeof hookedTab>> | null = null;
    const c = await hookedTab(storage, fetchImpl, {
      get: (k) => {
        if (k === "balu:auth:refresh" && armed) {
          armed = false;
          stolen = true;
          void storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "other-tab", exp: Date.now() + 300 }));
          return;
        }
        // The next lease read after the steal is the retry loop, which only runs
        // once the lost attempt has been abandoned: the second call comes after it.
        if (k === "balu:auth:refreshLease" && stolen && !late && lostSeen) late = cRef!.refresh();
        if (k === "balu:auth:refreshLease" && stolen) lostSeen = true;
      },
    });
    cRef = c;
    armed = true;
    const first = c.refresh();
    const t1 = await first;
    const t2 = await late;
    expect(late).not.toBeNull();
    expect(state.refreshCalls).toBe(1);
    expect(t2).toBe(t1);
  });

  it("a lease that expired during a long settle is renewed instead of lost", async () => {
    const { storage, state, fetchImpl } = await twoTabs();
    let offset = 0;
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    let leaseWrites = 0;
    let jumped = false;
    const c = await hookedTab(storage, fetchImpl, {
      set: (k) => {
        if (k === "balu:auth:refreshLease") leaseWrites += 1;
      },
      get: (k) => {
        // The read after the first settle: the throttled tab slept past the expiry.
        if (k === "balu:auth:refreshLease" && leaseWrites === 1 && !jumped) {
          jumped = true;
          offset += 60_000;
        }
      },
    });
    const started = realNow();
    await c.refresh();
    vi.restoreAllMocks();
    expect(state.refreshCalls).toBe(1);
    expect(leaseWrites).toBe(2);
    expect(realNow() - started).toBeLessThan(1000);
  });

  it("releases its lease on pagehide while a refresh is running", async () => {
    const ls = new Map<string, string>();
    const handlers: Array<() => void> = [];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
    });
    vi.stubGlobal("addEventListener", (type: string, h: () => void) => {
      if (type === "pagehide") handlers.push(h);
    });
    vi.stubGlobal("removeEventListener", () => undefined);
    const storage: ReturnType<typeof memoryKV> = {
      getItem: async (k) => ls.get(k) ?? null,
      setItem: async (k, v) => void ls.set(k, v),
      removeItem: async (k) => void ls.delete(k),
    };
    const server = rotatingServer();
    const mod = await loadTab();
    const first = mod.createApiClient({ storage, fetch: server.fetchImpl });
    await first.login({ email: "d@example.com", password: "pw" });
    let leaseDuringRequest: string | null = null;
    const c = mod.createApiClient({
      storage,
      fetch: (async (u: any, init: any) => {
        if (String(u).endsWith("/auth/refresh")) {
          leaseDuringRequest = ls.get("balu:auth:refreshLease") ?? null;
          for (const h of handlers) h(); // the page is going away mid-refresh
        }
        return server.fetchImpl(u, init);
      }) as unknown as typeof fetch,
    });
    await c.hydrate();
    const refreshing = c.refresh();
    await vi.waitFor(() => expect(leaseDuringRequest).not.toBeNull());
    expect(ls.get("balu:auth:refreshLease")).toBeUndefined(); // released by the handler, not by the finally
    await refreshing;
  });

  it("crossContextLock none refreshes without touching a lease", async () => {
    const { storage, state, fetchImpl } = await twoTabs();
    await storage.setItem("balu:auth:refreshLease", JSON.stringify({ id: "other-tab", exp: Date.now() + 20_000 }));
    const solo = (await loadTab()).createApiClient({ storage, fetch: fetchImpl, crossContextLock: "none" });
    await solo.hydrate();
    await solo.refresh();
    expect(state.refreshCalls).toBe(1);
    expect(await storage.getItem("balu:auth:refreshLease")).toContain("other-tab");
  });

  it("does not adopt the tokens of a different user", async () => {
    const { b, storage, state, expired, elsewhere } = await twoTabs();
    // Another tab logged out and user u2 signed in there.
    await storage.setItem("balu:auth:access", jwt("u2", 9));
    await storage.setItem("balu:auth:refresh", "r-of-u2");
    await expect(b.refresh()).rejects.toMatchObject({ status: 401 });
    expect(state.refreshCalls).toBe(0); // no replay of the spent token
    expect(b.getAccessToken()).toBeNull(); // not u2's, not u1's
    expect(elsewhere).toHaveBeenCalledWith("replaced");
    expect(expired).not.toHaveBeenCalled();
    // u2's tokens are not ours to clear.
    expect(await storage.getItem("balu:auth:refresh")).toBe("r-of-u2");
  });

  it("reports a logout in another tab as gone, without expiry and without clearing", async () => {
    const { b, storage, expired, elsewhere } = await twoTabs();
    await storage.removeItem("balu:auth:access");
    await storage.removeItem("balu:auth:refresh");
    await expect(b.refresh()).rejects.toMatchObject({ status: 401 });
    expect(elsewhere).toHaveBeenCalledWith("gone");
    expect(expired).not.toHaveBeenCalled();
  });

  it("concurrent refresh() calls in one tab share one request", async () => {
    const { a, state } = await twoTabs();
    await Promise.all([a.refresh(), a.refresh(), a.refresh()]);
    expect(state.refreshCalls).toBe(1);
  });
});

describe("tokenSubject", () => {
  it("reads sub from the payload and tolerates anything else", async () => {
    const { tokenSubject } = await import("../src/index.js");
    const payload = btoa(JSON.stringify({ sub: "u9" })).replace(/=+$/, "");
    expect(tokenSubject(`h.${payload}.s`)).toBe("u9");
    expect(tokenSubject("a1")).toBeNull();
    expect(tokenSubject("h.!!!.s")).toBeNull();
    expect(tokenSubject(null)).toBeNull();
  });
});
