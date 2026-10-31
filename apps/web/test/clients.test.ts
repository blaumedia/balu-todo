import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake sync client with a controllable in-flight request: close() is what the
// real client honours by never writing again; the fake records when a late
// "write" would have landed.
const fakes = vi.hoisted(() => ({
  made: [] as Array<{
    workspaceId: string;
    closed: boolean;
    stopped: boolean;
    release: () => void;
    lateWrites: string[];
  }>,
}));

vi.mock("@balu/sync-client", async (orig) => ({
  ...(await orig<typeof import("@balu/sync-client")>()),
  localStorageKV: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
  createSyncClient: (opts: { workspaceId: string }) => {
    let release: () => void = () => {};
    const flight = new Promise<void>((r) => {
      release = r;
    });
    const rec = { workspaceId: opts.workspaceId, closed: false, stopped: false, release, lateWrites: [] as string[] };
    fakes.made.push(rec);
    return {
      start: () => {},
      stop: () => {
        rec.stopped = true;
      },
      close: () => {
        rec.closed = true;
        rec.stopped = true;
      },
      // The in-flight flush lands when released: a write unless the client was closed.
      idle: async () => {
        await flight;
        if (!rec.closed) rec.lateWrites.push(`balu:queue:${rec.workspaceId}`);
      },
    };
  },
}));

import { closeSync, initSync, teardownSync } from "../src/lib/clients.js";

beforeEach(() => {
  closeSync();
  fakes.made.length = 0;
});

describe("closeSync reaches stopped clients", () => {
  it("a client stopped by a workspace switch is closed by a later logout", async () => {
    initSync("w1", "u1");
    initSync("w2", "u1"); // w1 stopped, its flush still running
    const [w1, w2] = fakes.made;
    expect(w1!.stopped).toBe(true);
    expect(w1!.closed).toBe(false);
    closeSync();
    expect(w1!.closed).toBe(true);
    expect(w2!.closed).toBe(true);
    w1!.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(w1!.lateWrites).toEqual([]);
  });

  it("a client stopped by a session expiry is closed when another user signs in", () => {
    initSync("w1", "u1");
    teardownSync(); // expireSession
    const [w1] = fakes.made;
    expect(w1!.closed).toBe(false);
    closeSync(); // adoptLocalDataFor(u2, closeSync)
    expect(w1!.closed).toBe(true);
  });

  it("forgets a stopped client once its work has settled", async () => {
    initSync("w1", "u1");
    teardownSync();
    const [w1] = fakes.made;
    w1!.release();
    await new Promise((r) => setTimeout(r, 0));
    closeSync();
    expect(w1!.closed).toBe(false); // settled and dropped: nothing left to close
  });

  it("switching back to a workspace closes its stopped client, so two never share its keys", () => {
    initSync("w1", "u1");
    initSync("w2", "u1"); // w1 stopped, still winding down
    initSync("w1", "u1");
    const [oldW1, w2, newW1] = fakes.made;
    expect(oldW1!.closed).toBe(true);
    expect(w2!.closed).toBe(false); // another workspace: left to wind down
    expect(newW1!.closed).toBe(false);
  });

  it("re-initialising the current workspace closes the client it replaces", () => {
    initSync("w1", "u1");
    initSync("w1", "u1");
    const [first, second] = fakes.made;
    expect(first!.closed).toBe(true);
    expect(second!.closed).toBe(false);
  });
});
