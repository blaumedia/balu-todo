// Failure modes found after merging the server lane (what-if 715dc0eb): losses
// during a flush, busy-server handling, slow links, interrupted purges.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyncClient,
  memoryKV,
  purgeWorkspaceData,
  workspaceStorageKeys,
  type AsyncKV,
  type SyncClient,
} from "../src/index.js";
import { makeServer } from "./helpers.js";

const BASE = "http://test/api/v1";

const clients: SyncClient[] = [];
function track(c: SyncClient): SyncClient {
  clients.push(c);
  return c;
}
afterEach(() => {
  for (const c of clients.splice(0)) c.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function base(over: Partial<Parameters<typeof createSyncClient>[0]> = {}) {
  return {
    baseUrl: BASE,
    workspaceId: "w1",
    getAccessToken: () => "tok",
    storage: memoryKV(),
    fetch: makeServer().fetch,
    userId: "u1",
    flushDebounceMs: 1_000_000,
    autoSyncMs: 1_000_000,
    ...over,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const forbidden = { detail: { code: "forbidden", message: "x" } };

function emptyFull(token = "v1") {
  return {
    sync_token: token,
    full_sync: true,
    projects: [],
    sections: [],
    tasks: [],
    labels: [],
    comments: [],
    attachments: [],
    members: [],
  };
}

/**
 * Answers the first `n` requests with every command rejected as forbidden (the
 * server lane's per-command membership check), as a delta so the recovery pull
 * is still owed, then 403. Seed a sync token so the client asks for a delta.
 */
function rejectThenForbid(rejectedRequests: number) {
  let n = 0;
  const calls: any[] = [];
  const fetchImpl = (async (_u: any, init: any) => {
    const req = JSON.parse(init.body);
    calls.push(req);
    n += 1;
    if (n <= rejectedRequests) {
      const sync_status: Record<string, unknown> = {};
      for (const c of req.commands) sync_status[c.uuid] = { error_code: "forbidden", error: "removed" };
      return json({ ...emptyFull(`v${n}`), full_sync: false, sync_status });
    }
    return json(forbidden, 403);
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchImpl };
}

async function seeded(): Promise<AsyncKV> {
  const storage = memoryKV();
  await storage.setItem(workspaceStorageKeys("w1").token, "v0");
  return storage;
}

describe("access lost during a flush", () => {
  it("counts the commands the server rejected before the recovery pull found the 403", async () => {
    const server = rejectThenForbid(1);
    const onAccessLost = vi.fn();
    const onCommandsRejected = vi.fn();
    const storage = await seeded();
    const c = track(createSyncClient(base({ fetch: server.fetch, storage, onAccessLost, onCommandsRejected })));
    await c.hydrate();
    for (const t of ["a", "b", "c"]) c.mutate({ type: "task_add", args: { title: t } });
    await c.flush();
    expect(onAccessLost).toHaveBeenCalledTimes(1);
    expect(onAccessLost.mock.calls[0]![0]).toMatchObject({ reason: "removed", discarded: 3 });
    expect(onCommandsRejected).not.toHaveBeenCalled(); // the loss notice carries the count
  });

  it("adds an earlier rejected batch to the batch the 403 hit", async () => {
    const server = rejectThenForbid(1);
    const onAccessLost = vi.fn();
    const storage = await seeded();
    const c = track(createSyncClient(base({ fetch: server.fetch, storage, onAccessLost, maxBatch: 2 })));
    await c.hydrate();
    for (const t of ["a", "b", "c", "d"]) c.mutate({ type: "task_add", args: { title: t } });
    await c.flush();
    expect(onAccessLost.mock.calls[0]![0]).toMatchObject({ discarded: 4 });
  });
});

describe("busy server (503/429)", () => {
  it("shows offline, not error, and waits at least the Retry-After", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ detail: { code: "unavailable", message: "db" } }, 503, { "retry-after": "10" });
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, retryBaseMs: 2_000 })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(c.getStatus()).toBe("offline");
    await vi.advanceTimersByTimeAsync(9_900);
    expect(calls).toBe(1); // the 2 s backoff alone would have retried by now
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2);
  });

  it("a 500 is still a sync error", async () => {
    const fetchImpl = (async () => json({ detail: { code: "error", message: "x" } }, 500)) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    expect(c.getStatus()).toBe("error");
  });

  it("spreads retries with jitter (0.8x to 1.2x of the backoff)", async () => {
    const times: number[] = [];
    for (const r of [0, 1]) {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(r);
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        return json({ detail: { code: "unavailable", message: "db" } }, 503);
      }) as unknown as typeof fetch;
      const c = createSyncClient(base({ fetch: fetchImpl, retryBaseMs: 1_000 }));
      c.mutate({ type: "task_add", args: { title: "a" } });
      c.start();
      await vi.advanceTimersByTimeAsync(0);
      let t = 0;
      while (calls < 2 && t < 2_000) {
        await vi.advanceTimersByTimeAsync(10);
        t += 10;
      }
      times.push(t);
      c.stop();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
    expect(times[0]).toBeGreaterThanOrEqual(790);
    expect(times[0]).toBeLessThanOrEqual(820);
    expect(times[1]).toBeGreaterThanOrEqual(1190);
    expect(times[1]).toBeLessThanOrEqual(1220);
  });
});

describe("slow links", () => {
  it("gives a body read twice the time after it timed out, so a large full sync lands", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { cancel: async () => undefined },
        json: () => new Promise((r) => setTimeout(() => r(emptyFull()), 80)),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, bodyTimeoutMs: 50, retryBaseMs: 5, retryMaxMs: 10 })),
    );
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced"), { timeout: 2_000 });
    expect(calls).toBe(2);
  });

  it("sends a smaller batch after a request timed out and restores it after a success", async () => {
    const ok = makeServer();
    const sizes: number[] = [];
    let first = true;
    const fetchImpl = ((u: any, init: any) => {
      sizes.push(JSON.parse(init.body).commands.length);
      if (first) {
        first = false;
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return ok.fetch(u, init);
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, maxBatch: 40, requestTimeoutMs: 30, retryBaseMs: 5 })),
    );
    for (let i = 0; i < 45; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().pending).toBe(0), { timeout: 3_000 });
    expect(sizes.slice(0, 3)).toEqual([40, 20, 25]);
  });
});

describe("mutate on a client that cannot save", () => {
  it("flags the edit as dropped after close() and after access was lost", async () => {
    const live = track(createSyncClient(base()));
    expect(live.mutate({ type: "task_add", args: { title: "a" } }).dropped).toBeUndefined();
    live.close();
    expect(live.mutate({ type: "task_add", args: { title: "b" } }).dropped).toBe(true);

    const lostFetch = (async () => json(forbidden, 403)) as unknown as typeof fetch;
    const lost = track(createSyncClient(base({ fetch: lostFetch })));
    await lost.sync();
    expect(lost.mutate({ type: "task_add", args: { title: "c" } }).dropped).toBe(true);
  });
});

describe("loss notice survives a kill during the purge", () => {
  it("removes the queue after the other keys", async () => {
    const inner = memoryKV();
    const removed: string[] = [];
    const storage: AsyncKV = {
      getItem: (k) => inner.getItem(k),
      setItem: (k, v) => inner.setItem(k, v),
      removeItem: async (k) => {
        removed.push(k);
        await inner.removeItem(k);
      },
    };
    const lostFetch = (async () => json(forbidden, 403)) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: lostFetch, storage })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    const keys = workspaceStorageKeys("w1");
    expect(removed.indexOf(keys.queue)).toBe(removed.findIndex((k) => k === keys.queue));
    expect(removed.indexOf(keys.queue)).toBeGreaterThan(removed.indexOf(keys.replica));
    expect(removed.indexOf(keys.queue)).toBeGreaterThan(removed.indexOf(keys.token));
    expect(removed.indexOf(keys.queue)).toBeGreaterThan(removed.indexOf(keys.needsFullSync));
  });

  it("a later purge still reports how many changes were lost", async () => {
    const inner = memoryKV();
    const keys = workspaceStorageKeys("w1");
    // The app is killed right after the queue key is gone.
    const storage: AsyncKV = {
      getItem: (k) => inner.getItem(k),
      setItem: (k, v) => inner.setItem(k, v),
      removeItem: async (k) => {
        await inner.removeItem(k);
        if (k === keys.queue) throw new Error("killed");
      },
    };
    const lostFetch = (async () => json(forbidden, 403)) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: lostFetch, storage })));
    for (const t of ["a", "b"]) c.mutate({ type: "task_add", args: { title: t } });
    await c.flush().catch(() => undefined);
    expect(await inner.getItem(keys.queue)).toBeNull();
    expect(await inner.getItem(keys.lossNotice)).not.toBeNull();
    // The next boot: nothing is queued any more, yet the loss is still counted.
    expect(await purgeWorkspaceData(inner, "w1")).toBe(2);
    expect(await inner.getItem(keys.lossNotice)).toBeNull();
  });

  it("leaves no notice behind once the app has been told", async () => {
    const storage = memoryKV();
    const lostFetch = (async () => json(forbidden, 403)) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: lostFetch, storage, onAccessLost: () => {} })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    expect(await storage.getItem(workspaceStorageKeys("w1").lossNotice)).toBeNull();
  });
});
