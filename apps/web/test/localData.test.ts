import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptLocalDataFor, purgeLocalData } from "../src/lib/localData.js";

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

const ls = (): Storage => globalThis.localStorage;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  for (const k of [
    "balu:auth:access",
    "balu:auth:refresh",
    "balu:theme",
    "balu:workspace",
    "balu:queue:w1",
    "balu:owner",
    "other:key",
  ]) {
    ls().setItem(k, "v");
  }
});
afterEach(() => vi.unstubAllGlobals());

const keys = (): string[] => {
  const out: string[] = [];
  for (let i = 0; i < ls().length; i += 1) out.push(ls().key(i) as string);
  return out.sort();
};

describe("purgeLocalData", () => {
  it("leaves only the theme and foreign keys", () => {
    purgeLocalData();
    expect(keys()).toEqual(["balu:theme", "other:key"]);
  });

  it("keepAuth also keeps the tokens", () => {
    purgeLocalData({ keepAuth: true });
    expect(keys()).toEqual(["balu:auth:access", "balu:auth:refresh", "balu:theme", "other:key"]);
    expect(ls().getItem("balu:queue:w1")).toBeNull();
    expect(ls().getItem("balu:workspace")).toBeNull();
  });
});

describe("adoptLocalDataFor", () => {
  it("keeps the data of the same user", () => {
    ls().setItem("balu:owner", "u1");
    const spy = vi.fn();
    expect(adoptLocalDataFor("u1", spy)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(ls().getItem("balu:queue:w1")).not.toBeNull();
  });

  it("wipes another user's data but keeps the new tokens", () => {
    ls().setItem("balu:owner", "u1");
    const spy = vi.fn();
    expect(adoptLocalDataFor("u2", spy)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ls().getItem("balu:queue:w1")).toBeNull();
    expect(ls().getItem("balu:workspace")).toBeNull();
    expect(ls().getItem("balu:auth:access")).not.toBeNull();
    expect(ls().getItem("balu:auth:refresh")).not.toBeNull();
    expect(ls().getItem("balu:owner")).toBe("u2");
  });

  it("adopts data without an owner", () => {
    ls().removeItem("balu:owner");
    expect(adoptLocalDataFor("u2")).toBe(false);
    expect(ls().getItem("balu:queue:w1")).not.toBeNull();
    expect(ls().getItem("balu:owner")).toBe("u2");
  });
});
