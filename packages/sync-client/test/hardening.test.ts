// Failure modes found after merging the server lane (what-if 715dc0eb): losses
// during a flush, busy-server handling, slow links, interrupted purges.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyncClient,
  memoryKV,
  clearLossNotice,
  purgeWorkspaceData,
  wasSaved,
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

  it("holds back the debounced flush, the interval and a wake until the Retry-After is over", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return json({ detail: { code: "unavailable", message: "busy" } }, 429, { "retry-after": "10" });
      return json(emptyFull());
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, flushDebounceMs: 100, autoSyncMs: 1_000, retryBaseMs: 500 })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    c.mutate({ type: "task_add", args: { title: "typing" } });
    void c.wake();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(calls).toBe(2);
  });

  it("a longer Retry-After moves a pending shorter retry timer", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return json({ detail: { code: "unavailable", message: "db" } }, 503);
      return json({ detail: { code: "unavailable", message: "busy" } }, 429, { "retry-after": "30" });
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, flushDebounceMs: 100, retryBaseMs: 2_000 })));
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1); // 503: retry timer of about 2 s pending
    c.mutate({ type: "task_add", args: { title: "a" } });
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2); // 429 asks for 30 s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(3);
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

describe("batch size recovery", () => {
  function hangFirst(n: number) {
    const ok = makeServer();
    const sizes: number[] = [];
    let hung = 0;
    const fetchImpl = ((u: any, init: any) => {
      sizes.push(JSON.parse(init.body).commands.length);
      if (hung < n) {
        hung += 1;
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return ok.fetch(u, init);
    }) as unknown as typeof fetch;
    return { sizes, fetch: fetchImpl };
  }

  it("grows back step by step and stays below the size that timed out", async () => {
    const s = hangFirst(2);
    const c = track(createSyncClient(base({ fetch: s.fetch, maxBatch: 40, requestTimeoutMs: 30, retryBaseMs: 5 })));
    for (let i = 0; i < 100; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().pending).toBe(0), { timeout: 3_000 });
    // 40 and 20 time out; 10 passes and 20 is not tried again until 5 batches passed at the cap,
    // then the ceiling lifts and the batch grows 20, 30.
    expect(s.sizes.slice(0, 9)).toEqual([40, 20, 10, 10, 10, 10, 10, 20, 30]);
  });

  it("never sends a size that timed out twice in a row", async () => {
    const ok = makeServer();
    const sizes: number[] = [];
    const fetchImpl = ((u: any, init: any) => {
      const n = JSON.parse(init.body).commands.length;
      sizes.push(n);
      if (n > 25) {
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return ok.fetch(u, init);
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, maxBatch: 40, requestTimeoutMs: 30, retryBaseMs: 5 })));
    for (let i = 0; i < 400; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().pending).toBe(0), { timeout: 5_000 });
    expect(sizes.some((n) => n > 25)).toBe(true);
    // After the first timeout a size above 25 comes back only after 5 passes at the cap.
    const firstBig = sizes.findIndex((n) => n > 25);
    expect(sizes.slice(firstBig + 1).some((n) => n > 25)).toBe(true);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]! > 25 && sizes[i - 1]! > 25).toBe(false);
  });

  it("small flushes do not lift the ceiling of a size that timed out", async () => {
    const s = hangFirst(1);
    const c = track(createSyncClient(base({ fetch: s.fetch, maxBatch: 40, requestTimeoutMs: 30, retryBaseMs: 5 })));
    for (let i = 0; i < 40; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().pending).toBe(0), { timeout: 3_000 });
    for (let i = 0; i < 8; i++) {
      c.mutate({ type: "task_add", args: { title: `s${i}` } });
      await c.flush();
    }
    s.sizes.length = 0;
    for (let i = 0; i < 100; i++) c.mutate({ type: "task_add", args: { title: `b${i}` } });
    await c.flush();
    expect(s.sizes[0]).toBeLessThan(40); // 40 timed out and only single-command flushes passed since
  });

  it("a timed-out pull does not shrink the next push", async () => {
    const s = hangFirst(1);
    const c = track(createSyncClient(base({ fetch: s.fetch, maxBatch: 40, requestTimeoutMs: 30, retryBaseMs: 5 })));
    c.start();
    // The first pull hangs and times out; the retry pull succeeds.
    await vi.waitFor(() => expect(s.sizes.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 });
    await c.idle();
    for (let i = 0; i < 45; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    await c.flush();
    expect(s.sizes.slice(0, 3)).toEqual([0, 0, 40]);
  });
});

describe("purge details", () => {
  it("returns the reason a loss notice recorded", async () => {
    const storage = memoryKV();
    const keys = workspaceStorageKeys("w1");
    await storage.setItem(keys.lossNotice, JSON.stringify({ reason: "deleted", discarded: 3 }));
    expect(await purgeWorkspaceData(storage, "w1")).toEqual({ discarded: 3, reason: "deleted" });
  });

  it("clearLossNotice removes only that workspace's notice", async () => {
    const storage = memoryKV();
    await storage.setItem(workspaceStorageKeys("w1").lossNotice, "{}");
    await storage.setItem(workspaceStorageKeys("w2").lossNotice, "{}");
    await clearLossNotice(storage, "w1");
    expect(await storage.getItem(workspaceStorageKeys("w1").lossNotice)).toBeNull();
    expect(await storage.getItem(workspaceStorageKeys("w2").lossNotice)).not.toBeNull();
  });

  it("wasSaved is false for a dropped or missing result", () => {
    expect(wasSaved({ dropped: true })).toBe(false);
    expect(wasSaved(undefined)).toBe(false);
    expect(wasSaved({})).toBe(true);
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
    expect(await purgeWorkspaceData(inner, "w1")).toEqual({ discarded: 2, reason: "removed" });
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
