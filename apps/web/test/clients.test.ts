// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listeners: new Set<() => void>(), stop: vi.fn() }));
vi.mock("@balu/api-client", () => ({
  createApiClient: () => ({ getAccessToken: () => null, refresh: async () => {} }),
}));
vi.mock("@balu/sync-client", () => ({
  localStorageKV: () => ({}),
  createSyncClient: () => ({
    start: vi.fn(),
    stop: h.stop,
    subscribe: (l: () => void) => {
      h.listeners.add(l);
      return () => void h.listeners.delete(l);
    },
  }),
}));

import { initSync, teardownSync } from "../src/lib/clients.js";
import { useApp } from "../src/store/app.js";

describe("clients toast wiring", () => {
  let valid: boolean;
  beforeEach(() => {
    teardownSync();
    h.listeners.clear();
    useApp.getState().dismissToast();
    valid = true;
  });
  const show = () => useApp.getState().showToast("A", { action: { label: "Go", run: () => {}, isValid: () => valid } });

  it("a sync change re-validates the toast", () => {
    initSync("w1", "u1");
    show();
    expect(useApp.getState().toast).toBe("A");
    valid = false;
    h.listeners.forEach((l) => l());
    expect(useApp.getState().toast).toBeNull();
  });

  it("teardownSync re-validates and unsubscribes", () => {
    initSync("w1", "u1");
    show();
    valid = false;
    teardownSync();
    expect(useApp.getState().toast).toBeNull();
    expect(h.listeners.size).toBe(0);
  });

  it("initSync replaces the previous subscription and re-validates", () => {
    initSync("w1", "u1");
    show();
    expect(useApp.getState().toast).toBe("A");
    valid = false;
    initSync("w2", "u1");
    expect(h.listeners.size).toBe(1);
    expect(useApp.getState().toast).toBeNull();
  });
});
