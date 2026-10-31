import { beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as string[]);

vi.mock("../src/lib/clients.js", () => ({
  api: {
    logout: async () => {
      events.push(`api.logout owner=${globalThis.localStorage.getItem("balu:owner")}`);
    },
  },
  closeSync: () => {
    events.push("close");
  },
}));
vi.mock("../src/lib/localData.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/localData.js")>()),
  purgeLocalData: () => {
    events.push("purge");
  },
}));

import { logout } from "../src/lib/logout.js";

beforeEach(() => {
  events.length = 0;
  const m = new Map<string, string>([["balu:owner", "u1"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  vi.stubGlobal("history", { replaceState: () => {} });
});

describe("logout", () => {
  it("closes the sync clients before anything is purged", async () => {
    await logout();
    expect(events.indexOf("close")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("close")).toBeLessThan(events.indexOf("purge"));
  });

  it("removes the owner key before the tokens are revoked, so other tabs see a logout, not an expiry", async () => {
    await logout();
    expect(events).toContain("api.logout owner=null");
  });
});
