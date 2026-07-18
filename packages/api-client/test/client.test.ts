import { describe, expect, it } from "vitest";
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
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;
    const c = createApiClient({ storage: memoryKV(), fetch: fetchImpl });
    await c.login({ email: "d@example.com", password: "pw" });
    await c.logout();
    expect(c.isAuthenticated()).toBe(false);
  });
});
