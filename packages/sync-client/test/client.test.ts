import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyncClient,
  memoryKV,
  purgeWorkspaceData,
  workspaceStorageKeys,
  type SyncClient,
} from "../src/index.js";
import {
  makeAttachment,
  makeErrorServer,
  makeProject,
  makeRejectingServer,
  makeSeedServer,
  makeServer,
  makeTask,
} from "./helpers.js";

const BASE = "http://test/api/v1";
const WS = "w1";

const clients: SyncClient[] = [];
function track(c: SyncClient): SyncClient {
  clients.push(c);
  return c;
}
afterEach(() => {
  for (const c of clients.splice(0)) c.stop();
});

function base(over: Partial<Parameters<typeof createSyncClient>[0]> = {}) {
  return {
    baseUrl: BASE,
    workspaceId: WS,
    getAccessToken: () => "tok",
    storage: memoryKV(),
    fetch: makeServer().fetch,
    userId: "u1",
    flushDebounceMs: 1_000_000, // never auto-fire in tests; we flush manually
    ...over,
  };
}

describe("optimistic apply", () => {
  it("a mutated task appears in the snapshot before any flush", () => {
    const c = track(createSyncClient(base()));
    const { temp_id } = c.mutate({ type: "task_add", args: { title: "Buy milk" } });
    const snap = c.getSnapshot();
    expect(snap.tasks).toHaveLength(1);
    expect(snap.tasks[0]!.id).toBe(temp_id);
    expect(snap.tasks[0]!.title).toBe("Buy milk");
    expect(snap.pending).toBe(1);
  });

  it("applies task_complete optimistically (non-recurring)", () => {
    const c = track(createSyncClient(base()));
    const { temp_id } = c.mutate({ type: "task_add", args: { title: "X" } });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    expect(c.getSnapshot().tasks[0]!.completed_at).not.toBeNull();
  });

  it("recurring complete advances start_date and keeps the task open", () => {
    const c = track(createSyncClient(base({ now: () => new Date("2026-07-23T12:00:00Z") })));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: { title: "Water", start_date: "2026-07-23", recurrence: "FREQ=DAILY" },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    const t = c.getSnapshot().tasks[0]!;
    expect(t.completed_at).toBeNull();
    expect(t.start_date! > "2026-07-23").toBe(true);
  });

  it("project_delete cascades to its tasks", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "P" } });
    c.mutate({ type: "task_add", args: { title: "in project", project_id: p } });
    c.mutate({ type: "project_delete", args: { id: p } });
    const snap = c.getSnapshot();
    expect(snap.tasks[0]!.is_deleted).toBe(true);
    expect(snap.projects[0]!.is_deleted).toBe(true);
  });

  it("label_delete removes the label from tasks", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: l } = c.mutate({ type: "label_add", args: { name: "home" } });
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "T", label_ids: [l] } });
    c.mutate({ type: "label_delete", args: { id: l } });
    const task = c.getSnapshot().tasks.find((x) => x.id === t)!;
    expect(task.label_ids).toEqual([]);
  });
});

describe("comments (v1.2)", () => {
  it("applies comment_add optimistically against a task", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "T" } });
    const { temp_id: cm } = c.mutate({ type: "comment_add", args: { task_id: t, body: "hi" } });
    const comments = c.getSnapshot().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe(cm);
    expect(comments[0]!.task_id).toBe(t);
    expect(comments[0]!.body).toBe("hi");
    expect(comments[0]!.author_id).toBe("u1");
  });

  it("comment_update edits the body; comment_delete soft-removes it from the snapshot", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "T" } });
    const { temp_id: cm } = c.mutate({ type: "comment_add", args: { task_id: t, body: "draft" } });
    c.mutate({ type: "comment_update", args: { id: cm, body: "final" } });
    expect(c.getSnapshot().comments[0]!.body).toBe("final");
    c.mutate({ type: "comment_delete", args: { id: cm } });
    expect(c.getSnapshot().comments[0]!.is_deleted).toBe(true);
  });

  it("task_delete cascades to the task's comments", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "T" } });
    c.mutate({ type: "comment_add", args: { task_id: t, body: "a" } });
    c.mutate({ type: "comment_add", args: { task_id: t, body: "b" } });
    c.mutate({ type: "task_delete", args: { id: t } });
    expect(c.getSnapshot().comments.every((x) => x.is_deleted)).toBe(true);
  });

  it("project_delete cascades to the comments of its tasks (I2)", () => {
    const c = track(createSyncClient(base()));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "P" } });
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "in project", project_id: p } });
    c.mutate({ type: "comment_add", args: { task_id: t, body: "a" } });
    const { temp_id: other } = c.mutate({ type: "task_add", args: { title: "elsewhere" } });
    c.mutate({ type: "comment_add", args: { task_id: other, body: "untouched" } });

    c.mutate({ type: "project_delete", args: { id: p } });

    const snap = c.getSnapshot();
    const onDeletedTask = snap.comments.find((x) => x.task_id === t)!;
    const elsewhere = snap.comments.find((x) => x.task_id === other)!;
    expect(onDeletedTask.is_deleted).toBe(true);
    expect(elsewhere.is_deleted).toBe(false);
  });

  it("project_delete also removes subtasks whose own project_id is null", async () => {
    // A subtask inherits its parent's project visually but stores its own
    // project_id, which the UI leaves null. It used to survive the cascade and
    // sit in the list parentless — on the server this was fixed, on the client
    // it was not, so an offline delete diverged from the server's result.
    const c = track(createSyncClient(base()));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "P" } });
    const { temp_id: parent } = c.mutate({
      type: "task_add",
      args: { title: "parent", project_id: p },
    });
    const { temp_id: sub } = c.mutate({
      type: "task_add",
      args: { title: "subtask", parent_task_id: parent },
    });
    c.mutate({ type: "comment_add", args: { task_id: sub, body: "on the subtask" } });

    c.mutate({ type: "project_delete", args: { id: p } });

    const snap = c.getSnapshot();
    expect(snap.tasks.find((t) => t.id === sub)!.is_deleted).toBe(true);
    expect(snap.comments.find((x) => x.task_id === sub)!.is_deleted).toBe(true);
  });

  it("rewrites a comment's temp task_id to the real id after flush", async () => {
    const server = makeServer();
    // maxBatch 1 forces task_add and comment_add into separate requests.
    const c = track(createSyncClient(base({ fetch: server.fetch, maxBatch: 1 })));
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "T" } });
    c.mutate({ type: "comment_add", args: { task_id: t, body: "hi" } });
    await c.flush();
    const commentReq = server.calls[1]!.commands[0]!;
    expect(commentReq.args.task_id).toBe("T1"); // real id, not the temp id
    const snap = c.getSnapshot();
    expect(snap.comments[0]!.task_id).toBe("T1");
    expect(snap.comments.map((x) => x.id)).toEqual(["C2"]);
  });

  it("keeps comments durable across client re-instantiation", async () => {
    const storage = memoryKV();
    const offline: typeof fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c1 = track(createSyncClient(base({ storage, fetch: offline })));
    const { temp_id: t } = c1.mutate({ type: "task_add", args: { title: "T" } });
    c1.mutate({ type: "comment_add", args: { task_id: t, body: "persist me" } });
    await c1.flush();

    const c2 = track(createSyncClient(base({ storage, fetch: offline })));
    await c2.hydrate();
    expect(c2.getSnapshot().comments.map((x) => x.body)).toEqual(["persist me"]);
  });
});

describe("flush + batching", () => {
  it("splits > maxBatch commands across multiple requests", async () => {
    const server = makeServer();
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    for (let i = 0; i < 150; i++) c.mutate({ type: "task_add", args: { title: `t${i}` } });
    await c.flush();
    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]!.commands).toHaveLength(100);
    expect(server.calls[1]!.commands).toHaveLength(50);
    expect(c.getSnapshot().pending).toBe(0);
    expect(c.getStatus()).toBe("synced");
  });
});

describe("temp_id rewrite", () => {
  it("rewrites a queued command that references an id resolved in an earlier batch", async () => {
    const server = makeServer();
    // maxBatch 1 forces the project_add and task_add into separate requests.
    const c = track(createSyncClient(base({ fetch: server.fetch, maxBatch: 1 })));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "Proj" } });
    c.mutate({ type: "task_add", args: { title: "child", project_id: p } });
    await c.flush();

    // The second request must carry the *real* project id, not the temp id.
    const taskReq = server.calls[1]!.commands[0]!;
    expect(taskReq.args.project_id).toBe("P1");

    const snap = c.getSnapshot();
    const task = snap.tasks[0]!;
    expect(task.id).toBe("T2");
    expect(task.project_id).toBe("P1");
    // No temp ids linger in the replica.
    expect(snap.projects.map((x) => x.id)).toEqual(["P1"]);
  });

  it("exposes the temp -> real mapping on the snapshot after a delta ack", async () => {
    const server = makeServer();
    const c = track(createSyncClient(base({ fetch: server.fetch, maxBatch: 1 })));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "Proj" } });
    expect(c.getSnapshot().idAliases).toEqual({});
    const { temp_id: t } = c.mutate({ type: "task_add", args: { title: "x", project_id: p } });
    const seen: ReturnType<typeof c.getSnapshot>[] = [];
    c.subscribe(() => seen.push(c.getSnapshot()));
    await c.flush();

    // Never a snapshot without the tmp project that also lacks its alias.
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      if (!s.projects.some((x) => x.id === p)) expect(s.idAliases[p!]).toBe("P1");
    }

    const snap = c.getSnapshot();
    // The second response's merge keeps the alias from the first.
    expect(snap.idAliases).toEqual({ [p!]: "P1", [t!]: "T2" });
    expect(snap.projects.map((x) => x.id)).toEqual(["P1"]);
  });

  it("rewrites a temp project id passed to mutate after the ack", async () => {
    const server = makeServer();
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "Proj" } });
    await c.flush();
    c.mutate({ type: "task_add", args: { title: "late", project_id: p } });
    await c.flush();

    const last = server.calls[server.calls.length - 1]!.commands[0]!;
    expect(last.args.project_id).toBe("P1");
    expect(c.getSnapshot().tasks.find((t) => t.title === "late")!.project_id).toBe("P1");
  });

  it("records the mapping from a full-sync response too", async () => {
    // A fresh client sends token "*", so the server answers full_sync: true.
    const server = makeRejectingServer(() => null);
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    const { temp_id: p } = c.mutate({ type: "project_add", args: { name: "Proj" } });
    await c.flush();

    const snap = c.getSnapshot();
    expect(snap.idAliases[p!]).toBe("P1");
    expect(snap.projects.map((x) => x.id)).toEqual(["P1"]);
  });
});

describe("offline queue persistence", () => {
  it("keeps the queue durable across client re-instantiation", async () => {
    const storage = memoryKV();
    const offline: typeof fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const c1 = track(createSyncClient(base({ storage, fetch: offline })));
    c1.mutate({ type: "task_add", args: { title: "offline task" } });
    await c1.flush();
    expect(c1.getStatus()).toBe("offline");
    expect(c1.getSnapshot().pending).toBe(1);

    // Fresh client, same storage: the queue and replica survive.
    const c2 = track(createSyncClient(base({ storage, fetch: offline })));
    await c2.hydrate();
    const snap = c2.getSnapshot();
    expect(snap.pending).toBe(1);
    expect(snap.tasks.map((t) => t.title)).toEqual(["offline task"]);
  });

  it("flushes and converges once back online", async () => {
    const storage = memoryKV();
    const offline: typeof fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const server = makeServer();

    const c1 = track(createSyncClient(base({ storage, fetch: offline })));
    c1.mutate({ type: "task_add", args: { title: "made offline" } });
    await c1.flush();

    const c2 = track(createSyncClient(base({ storage, fetch: server.fetch })));
    await c2.hydrate();
    await c2.flush();
    expect(server.calls).toHaveLength(1);
    expect(c2.getSnapshot().pending).toBe(0);
    expect(c2.getStatus()).toBe("synced");
  });
});

describe("full sync replace", () => {
  it("replaces the whole replica on full_sync", async () => {
    const storage = memoryKV();
    const fullSyncFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          sync_token: "v9",
          full_sync: true,
          sync_status: {},
          temp_id_mapping: {},
          projects: [],
          sections: [],
          tasks: [
            {
              id: "server-1",
              workspace_id: WS,
              project_id: null,
              section_id: null,
              parent_task_id: null,
              title: "from server",
              notes: "",
              start_date: null,
              evening: false,
              someday: false,
              deadline: null,
              reminder_at: null,
              recurrence: null,
              priority: 0,
              label_ids: [],
              assigned_to: null,
              sort_order: 1000,
              completed_at: null,
              completed_by: null,
              created_by: "u1",
              created_at: "2026-07-01T00:00:00Z",
              updated_at: "2026-07-01T00:00:00Z",
              is_deleted: false,
            },
          ],
          labels: [],
          members: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const c = track(createSyncClient(base({ storage, fetch: fullSyncFetch })));
    c.mutate({ type: "task_add", args: { title: "local optimistic" } });
    await c.sync(); // queue present → flush, response is full_sync
    const snap = c.getSnapshot();
    expect(snap.tasks.map((t) => t.id)).toEqual(["server-1"]);
    expect(snap.syncToken).toBe("v9");
  });
});

describe("401 handling", () => {
  it("calls onAuthFail and retries once", async () => {
    let calls = 0;
    let refreshed = false;
    const fetch401: typeof fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 401 });
      return new Response(
        JSON.stringify({
          sync_token: "v1",
          full_sync: false,
          sync_status: {},
          temp_id_mapping: {},
          projects: [],
          sections: [],
          tasks: [],
          labels: [],
          members: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const c = track(
      createSyncClient(base({ fetch: fetch401, onAuthFail: () => { refreshed = true; } })),
    );
    await c.sync();
    expect(refreshed).toBe(true);
    expect(calls).toBe(2);
    expect(c.getStatus()).toBe("synced");
  });
});

describe("outage recovery (contract §6.7)", () => {
  it("abandons a hung request and the next flush recovers", async () => {
    const server = makeServer();
    let calls = 0;
    let signal: AbortSignal | undefined;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (calls === 1) {
        signal = init.signal;
        return new Promise<Response>(() => {});
      }
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, requestTimeoutMs: 20 })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    expect(c.getStatus()).toBe("offline");
    expect(signal?.aborted).toBe(true);
    expect(c.getSnapshot().pending).toBe(1);
    await c.flush();
    expect(c.getStatus()).toBe("synced");
    expect(c.getSnapshot().pending).toBe(0);
  });

  it("bounds a hung token refresh by the same deadline", async () => {
    const fetchImpl = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const c = track(
      createSyncClient(
        base({
          fetch: fetchImpl,
          onAuthFail: () => new Promise<void>(() => {}),
          requestTimeoutMs: 20,
        }),
      ),
    );
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    expect(c.getStatus()).toBe("offline");
  });

  it("retries with backoff after a failure and stops once synced", async () => {
    const server = makeServer();
    let calls = 0;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (calls <= 2) throw new TypeError("network down");
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(
        base({ fetch: fetchImpl, retryBaseMs: 5, retryMaxMs: 20, autoSyncMs: 1_000_000 }),
      ),
    );
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
    expect(calls).toBe(3);
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(3);
  });

  describe("close()", () => {
    function gated() {
      const server = makeServer();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let calls = 0;
      const fetchImpl = (async (u: any, init: any) => {
        calls += 1;
        await gate;
        return server.fetch(u, init);
      }) as unknown as typeof fetch;
      const kv = memoryKV();
      const writes: string[] = [];
      const storage = {
        getItem: (k: string) => kv.getItem(k),
        setItem: (k: string, v: string) => {
          writes.push(k);
          return kv.setItem(k, v);
        },
        removeItem: (k: string) => {
          writes.push(k);
          return kv.removeItem(k);
        },
      };
      return { fetchImpl, release, storage, writes, calls: () => calls };
    }

    it("a pull answered after close() writes nothing", async () => {
      const g = gated();
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage: g.storage })));
      const p = c.sync();
      await vi.waitFor(() => expect(g.calls()).toBe(1));
      c.close();
      g.release();
      await p;
      await c.idle();
      expect(g.writes).toEqual([]);
    });

    it("a flush answered after close() writes nothing", async () => {
      const g = gated();
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage: g.storage })));
      c.mutate({ type: "task_add", args: { title: "x" } });
      g.writes.length = 0; // the optimistic persist happened before close
      const p = c.flush();
      await vi.waitFor(() => expect(g.calls()).toBe(1));
      c.close();
      g.release();
      await p;
      await c.idle();
      expect(g.writes).toEqual([]);
    });

    it("a closed client starts no network work and does not persist edits", async () => {
      const g = gated();
      g.release();
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage: g.storage })));
      c.close();
      await c.sync();
      await c.flush();
      c.mutate({ type: "task_add", args: { title: "x" } });
      await c.idle();
      expect(g.calls()).toBe(0);
      expect(g.writes).toEqual([]);
    });

    it("a closed client does not apply an edit to the replica or the queue", () => {
      const g = gated();
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage: g.storage })));
      c.close();
      c.mutate({ type: "task_add", args: { title: "x" } });
      expect(c.getSnapshot().tasks).toEqual([]);
      expect(c.getSnapshot().pending).toBe(0);
    });

    it("a client closed partway through a flush fires no rejected/relocated callbacks", async () => {
      const server = makeServer({ relocate: () => ["project_deleted"] });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let calls = 0;
      const fetchImpl = (async (u: any, init: any) => {
        calls += 1;
        if (calls === 2) await gate;
        return server.fetch(u, init);
      }) as unknown as typeof fetch;
      const onCommandsRelocated = vi.fn();
      const onCommandsRejected = vi.fn();
      const c = track(
        createSyncClient(
          base({ fetch: fetchImpl, maxBatch: 1, onCommandsRelocated, onCommandsRejected }),
        ),
      );
      c.mutate({ type: "task_add", args: { title: "a" } });
      c.mutate({ type: "task_add", args: { title: "b" } });
      const p = c.flush();
      await vi.waitFor(() => expect(calls).toBe(2));
      c.close();
      release();
      await p;
      await c.idle();
      expect(onCommandsRelocated).not.toHaveBeenCalled();
      expect(onCommandsRejected).not.toHaveBeenCalled();
    });

    it("a client closed while it purges after a lost access does not report the loss", async () => {
      const server = makeErrorServer(403, { detail: { code: "forbidden", message: "x" } });
      const kv = memoryKV();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let purging = false;
      const storage = {
        getItem: (k: string) => kv.getItem(k),
        setItem: (k: string, v: string) => kv.setItem(k, v),
        removeItem: async (k: string) => {
          purging = true;
          await gate;
          return kv.removeItem(k);
        },
      };
      const onAccessLost = vi.fn();
      const c = track(createSyncClient(base({ fetch: server.fetch, storage, onAccessLost })));
      const p = c.sync();
      await vi.waitFor(() => expect(purging).toBe(true));
      c.close(); // the user it concerned signed out meanwhile
      release();
      await p;
      await c.idle();
      expect(onAccessLost).not.toHaveBeenCalled();
    });

    it("writesSettled() also waits for the purge after a lost access", async () => {
      const server = makeErrorServer(403, { detail: { code: "forbidden", message: "x" } });
      const kv = memoryKV();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let purging = false;
      const storage = {
        getItem: (k: string) => kv.getItem(k),
        setItem: (k: string, v: string) => kv.setItem(k, v),
        removeItem: async (k: string) => {
          purging = true;
          await gate;
          return kv.removeItem(k);
        },
      };
      const c = track(createSyncClient(base({ fetch: server.fetch, storage })));
      const p = c.sync();
      await vi.waitFor(() => expect(purging).toBe(true));
      c.close();
      let settled = false;
      const w = c.writesSettled().then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false); // the deletes are still running
      release();
      await w;
      await p;
    });

    it("writesSettled() waits for a storage write already started, not for a request", async () => {
      const g = gated(); // the request never answers: its gate stays shut
      let finish: () => void = () => undefined;
      const slow = new Promise<void>((r) => {
        finish = r;
      });
      const storage = {
        ...g.storage,
        setItem: async (k: string, v: string) => {
          await slow;
          return g.storage.setItem(k, v);
        },
      };
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage })));
      const p = c.sync();
      await vi.waitFor(() => expect(g.calls()).toBe(1));
      c.mutate({ type: "task_add", args: { title: "x" } }); // starts persistQueue
      c.close();
      let settled = false;
      const w = c.writesSettled().then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false); // the write is still running
      finish();
      await w; // resolves without the hanging request ever answering
      expect(settled).toBe(true);
      g.release();
      await p;
    });

    it("idle() also waits for a sync that was still hydrating when it was called", async () => {
      const g = gated();
      g.release();
      const c = track(createSyncClient(base({ fetch: g.fetchImpl, storage: g.storage })));
      const p = c.sync(); // still awaiting hydrate(): not on the lane yet
      await c.idle();
      expect(g.calls()).toBe(1);
      expect(c.getStatus()).toBe("synced");
      await p;
    });
  });

  it("stop() cancels a pending retry", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, retryBaseMs: 20, autoSyncMs: 1_000_000 })),
    );
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("offline"));
    c.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it("wake() cancels a pending retry, syncs once and the retry never fires", async () => {
    const server = makeServer();
    let calls = 0;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, retryBaseMs: 80, autoSyncMs: 1_000_000 })),
    );
    c.start();
    await vi.waitFor(() => expect(calls).toBe(1)); // initial status is already "offline"
    await new Promise((r) => setTimeout(r, 10)); // let the failure arm the 80 ms retry
    // Two wake sources in one tick (focus + visibilitychange) share one sync.
    await Promise.all([c.wake(), c.wake()]);
    expect(c.getStatus()).toBe("synced");
    expect(calls).toBe(2);
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(2);
  });

  it("a slow response body is not cut off by the header deadline", async () => {
    const server = makeServer();
    const fetchImpl = (async (u: any, init: any) => {
      const res = await server.fetch(u, init);
      const text = await res.text();
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctrl) {
          await new Promise((r) => setTimeout(r, 60));
          ctrl.enqueue(enc.encode(text));
          ctrl.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, requestTimeoutMs: 20, bodyTimeoutMs: 2_000 })),
    );
    await c.sync();
    expect(c.getStatus()).toBe("synced");
  });

  it("a body that never finishes is abandoned after bodyTimeoutMs", async () => {
    const fetchImpl = (async () =>
      new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const c = track(
      createSyncClient(base({ fetch: fetchImpl, requestTimeoutMs: 1_000, bodyTimeoutMs: 30 })),
    );
    await c.sync();
    expect(c.getStatus()).toBe("offline");
  });

  it("a browser offline event shows offline at once, online syncs again", async () => {
    const target = new EventTarget();
    vi.stubGlobal("addEventListener", target.addEventListener.bind(target));
    vi.stubGlobal("removeEventListener", target.removeEventListener.bind(target));
    try {
      const c = track(createSyncClient(base({ retryBaseMs: 1_000_000, autoSyncMs: 1_000_000 })));
      c.start();
      await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
      target.dispatchEvent(new Event("offline"));
      expect(c.getStatus()).toBe("offline");
      target.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
      c.stop();
      target.dispatchEvent(new Event("offline"));
      expect(c.getStatus()).toBe("synced"); // stop() removed the listener
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a browser offline event leaves an existing error status alone", async () => {
    const target = new EventTarget();
    vi.stubGlobal("addEventListener", target.addEventListener.bind(target));
    vi.stubGlobal("removeEventListener", target.removeEventListener.bind(target));
    try {
      const server = makeErrorServer(400, { detail: { code: "bad_request", message: "x" } });
      const c = track(
        createSyncClient(base({ fetch: server.fetch, retryBaseMs: 1_000_000, autoSyncMs: 1_000_000 })),
      );
      c.start();
      await vi.waitFor(() => expect(c.getStatus()).toBe("error"));
      target.dispatchEvent(new Event("offline"));
      expect(c.getStatus()).toBe("error");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the retry does not poll from a hidden page with nothing queued", async () => {
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "hidden" as DocumentVisibilityState }),
    );
    try {
      let calls = 0;
      const fetchImpl = (() => {
        calls += 1;
        throw new TypeError("network down");
      }) as unknown as typeof fetch;
      const c = track(
        createSyncClient(base({ fetch: fetchImpl, retryBaseMs: 10, autoSyncMs: 1_000_000 })),
      );
      c.start();
      await vi.waitFor(() => expect(c.getStatus()).toBe("offline"));
      await new Promise((r) => setTimeout(r, 80));
      expect(calls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("runs a pull requested during a flush after it, not alongside it", async () => {
    const server = makeServer();
    let open = 0;
    let maxOpen = 0;
    let started = 0;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((r) => (releaseFirst = r));
    const fetchImpl = (async (u: any, init: any) => {
      started += 1;
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      try {
        if (started === 1) await firstGate; // the pure pull stays in flight
        else await new Promise((r) => setTimeout(r, 5));
        return await server.fetch(u, init);
      } finally {
        open -= 1;
      }
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: fetchImpl, flushDebounceMs: 1_000_000 })));
    await c.hydrate();
    const pulling = c.sync(); // queue empty: a pure pull, now in flight
    await vi.waitFor(() => expect(started).toBe(1));
    c.mutate({ type: "task_add", args: { title: "a" } });
    const flushing = c.flush(); // must queue behind the pull
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toBe(1);
    releaseFirst();
    await Promise.all([pulling, flushing]);
    expect(maxOpen).toBe(1);
    expect(started).toBeGreaterThanOrEqual(2);
    expect(c.getSnapshot().tasks.map((t) => t.title)).toEqual(["a"]);
    expect(c.getSnapshot().pending).toBe(0);
  });

  it("a 503 from /sync keeps the queue and is retried", async () => {
    const ok = makeServer();
    let calls = 0;
    let up = false;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (!up) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: { code: "unavailable", message: "db" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return ok.fetch(u, init);
    }) as unknown as typeof fetch;
    const storage = memoryKV();
    const onAccessLost = vi.fn();
    const onCommandsRejected = vi.fn();
    const c = track(
      createSyncClient(
        base({
          fetch: fetchImpl,
          storage,
          onAccessLost,
          onCommandsRejected,
          retryBaseMs: 5,
          retryMaxMs: 20,
          autoSyncMs: 1_000_000,
        }),
      ),
    );
    c.mutate({ type: "task_add", args: { title: "a" } });
    c.start();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    // A busy server is "offline, retrying", not a red sync error (contract: 503 is retryable).
    await vi.waitFor(() => expect(c.getStatus()).toBe("offline"));
    expect(c.getSnapshot().pending).toBe(1);
    expect(await storage.getItem(workspaceStorageKeys("w1").queue)).not.toBeNull();
    const failed = calls;
    up = true;
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced")); // the retry got through
    expect(calls).toBeGreaterThan(failed);
    expect(c.getSnapshot().pending).toBe(0);
    expect(onAccessLost).not.toHaveBeenCalled();
    expect(onCommandsRejected).not.toHaveBeenCalled();
  });
});

describe("visibility (contract §6.7)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDocument(state: "visible" | "hidden") {
    const doc = Object.assign(new EventTarget(), {
      visibilityState: state as DocumentVisibilityState,
    });
    vi.stubGlobal("document", doc);
    return doc;
  }

  function countingServer() {
    const server = makeServer();
    let count = 0;
    const fetchImpl = ((u: any, init: any) => {
      count += 1;
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    return { fetch: fetchImpl, count: () => count, calls: server.calls };
  }

  it("syncs when the page becomes visible, not when hidden", async () => {
    const doc = stubDocument("visible");
    const s = countingServer();
    const c = track(createSyncClient(base({ fetch: s.fetch, autoSyncMs: 1_000_000 })));
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
    const before = s.count();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.count()).toBe(before);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(s.count()).toBe(before + 1));
  });

  it("stop() removes the listener", async () => {
    const doc = stubDocument("visible");
    const s = countingServer();
    const c = track(createSyncClient(base({ fetch: s.fetch, autoSyncMs: 1_000_000 })));
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
    c.stop();
    const before = s.count();
    doc.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.count()).toBe(before);
  });

  it("the interval skips pulls while hidden but still pushes", async () => {
    const doc = stubDocument("hidden");
    const s = countingServer();
    const c = track(createSyncClient(base({ fetch: s.fetch, autoSyncMs: 10 })));
    c.start();
    await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
    const before = s.count();
    await new Promise((r) => setTimeout(r, 60));
    expect(s.count()).toBe(before);
    c.mutate({ type: "task_add", args: { title: "a" } });
    await vi.waitFor(() => expect(s.calls.some((x) => x.commands.length === 1)).toBe(true));
    void doc;
  });
});

describe("lost access (contract §6.8)", () => {
  const forbidden = { detail: { code: "forbidden", message: "x" } };

  it("a revoked membership (403 forbidden) stops the client and deletes the workspace's data", async () => {
    const server = makeErrorServer(403, forbidden);
    const storage = memoryKV();
    const onAccessLost = vi.fn();
    const c = track(createSyncClient(base({ fetch: server.fetch, storage, onAccessLost })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    c.mutate({ type: "task_add", args: { title: "b" } });
    await c.flush();
    expect(onAccessLost).toHaveBeenCalledTimes(1);
    expect(onAccessLost).toHaveBeenCalledWith({ workspaceId: "w1", reason: "removed", discarded: 2 });
    for (const k of Object.values(workspaceStorageKeys("w1"))) {
      expect(await storage.getItem(k)).toBeNull();
    }
    expect(c.getStatus()).toBe("error");
    const calls = server.calls.length;
    await c.sync();
    await c.flush();
    c.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(server.calls.length).toBe(calls);
    const before = c.getSnapshot().tasks.length;
    c.mutate({ type: "task_add", args: { title: "c" } });
    await Promise.resolve();
    expect(c.getSnapshot().tasks.length).toBe(before); // an edit after the loss is a no-op
    expect(c.getSnapshot().pending).toBe(0);
    expect(await storage.getItem(workspaceStorageKeys("w1").queue)).toBeNull();
  });

  it("a deleted workspace (404 not_found) is reported from a pull", async () => {
    const server = makeErrorServer(404, { detail: { code: "not_found", message: "x" } });
    const onAccessLost = vi.fn();
    const c = track(createSyncClient(base({ fetch: server.fetch, onAccessLost })));
    await c.sync();
    expect(onAccessLost).toHaveBeenCalledWith({ workspaceId: "w1", reason: "deleted", discarded: 0 });
  });

  it("403/404 without the contract envelope is a transient error", async () => {
    const cases: Array<[number, unknown]> = [
      [403, "<html>Forbidden</html>"],
      [404, { detail: "Not Found" }],
    ];
    for (const [status, body] of cases) {
      const server = makeErrorServer(status, body);
      const storage = memoryKV();
      const onAccessLost = vi.fn();
      const c = track(createSyncClient(base({ fetch: server.fetch, storage, onAccessLost })));
      c.mutate({ type: "task_add", args: { title: "a" } });
      await c.flush();
      expect(c.getStatus()).toBe("error");
      expect(c.getSnapshot().pending).toBe(1);
      expect(onAccessLost).not.toHaveBeenCalled();
      expect(await storage.getItem(workspaceStorageKeys("w1").queue)).not.toBeNull();
    }
  });

  it("purgeWorkspaceData removes one workspace's keys and counts its queue", async () => {
    const storage = memoryKV();
    const k1 = workspaceStorageKeys("w1");
    const k2 = workspaceStorageKeys("w2");
    await storage.setItem(k1.queue, JSON.stringify([{}, {}]));
    await storage.setItem(k1.replica, "{}");
    await storage.setItem(k1.token, "v1");
    await storage.setItem(k1.needsFullSync, "1");
    await storage.setItem(k2.queue, JSON.stringify([{}]));
    await storage.setItem(k2.token, "v9");
    expect((await purgeWorkspaceData(storage, "w1")).discarded).toBe(2);
    for (const k of Object.values(k1)) expect(await storage.getItem(k)).toBeNull();
    expect(await storage.getItem(k2.queue)).not.toBeNull();
    expect(await storage.getItem(k2.token)).toBe("v9");
  });
});

describe("relocated (contract §5.2)", () => {
  const relocateOrphan = (cmd: any) => (cmd.args.title === "orphan" ? ["project_deleted"] : null);

  it("reports task_adds the server filed elsewhere", async () => {
    const server = makeServer({ relocate: relocateOrphan });
    const onCommandsRelocated = vi.fn();
    const onCommandsRejected = vi.fn();
    const c = track(
      createSyncClient(base({ fetch: server.fetch, onCommandsRelocated, onCommandsRejected })),
    );
    c.mutate({ type: "task_add", args: { title: "orphan" } });
    c.mutate({ type: "task_add", args: { title: "keep" } });
    await c.flush();
    expect(onCommandsRelocated).toHaveBeenCalledTimes(1);
    const got = onCommandsRelocated.mock.calls[0]![0];
    expect(got).toHaveLength(1);
    expect(got[0].reasons).toEqual(["project_deleted"]);
    expect(got[0].command.args.title).toBe("orphan");
    expect(onCommandsRejected).not.toHaveBeenCalled();
  });

  it("stays quiet when nothing was relocated and against an older server", async () => {
    const onCommandsRelocated = vi.fn();
    for (const fetchImpl of [makeServer().fetch, makeSeedServer({}, { fullSync: false }).fetch]) {
      const c = track(createSyncClient(base({ fetch: fetchImpl, onCommandsRelocated })));
      c.mutate({ type: "task_add", args: { title: "a" } });
      await c.flush();
    }
    expect(onCommandsRelocated).not.toHaveBeenCalled();
  });

  it("reports a relocation from an earlier batch when a later batch fails", async () => {
    const server = makeServer({ relocate: () => ["project_deleted"] });
    let calls = 0;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (calls === 2) throw new TypeError("network down");
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    const onCommandsRelocated = vi.fn();
    const c = track(
      createSyncClient(
        base({ fetch: fetchImpl, maxBatch: 1, onCommandsRelocated, autoSyncMs: 1_000_000 }),
      ),
    );
    c.mutate({ type: "task_add", args: { title: "a" } });
    c.mutate({ type: "task_add", args: { title: "b" } });
    await c.flush();
    expect(onCommandsRelocated).toHaveBeenCalledTimes(1);
    expect(onCommandsRelocated.mock.calls[0]![0]).toHaveLength(1);
    expect(c.getStatus()).toBe("offline");
  });

  it("reports a relocation whose first response was lost", async () => {
    const server = makeServer({ relocate: () => ["project_deleted"] });
    let calls = 0;
    const fetchImpl = ((u: any, init: any) => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    const onCommandsRelocated = vi.fn();
    const c = track(createSyncClient(base({ fetch: fetchImpl, onCommandsRelocated })));
    c.mutate({ type: "task_add", args: { title: "a" } });
    await c.flush();
    await c.flush();
    expect(onCommandsRelocated).toHaveBeenCalledTimes(1);
  });
});

describe("rejected commands (contract §5.2)", () => {
  const rejectByTitle = (title: string) => (cmd: any) =>
    cmd.type === "task_add" && cmd.args?.title === title ? "forbidden" : null;

  it("rolls back the optimistic effect of a rejected command", async () => {
    const server = makeRejectingServer(rejectByTitle("nope"));
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    c.mutate({ type: "task_add", args: { title: "keep" } });
    c.mutate({ type: "task_add", args: { title: "nope" } });
    expect(c.getSnapshot().tasks).toHaveLength(2); // both applied optimistically

    await c.flush();

    // Only the accepted task survives; the rejected one is gone.
    expect(c.getSnapshot().tasks.map((t) => t.title)).toEqual(["keep"]);
    expect(c.getSnapshot().pending).toBe(0);
  });

  it("reports the rejected commands to the app", async () => {
    const server = makeRejectingServer(rejectByTitle("nope"));
    const seen: any[] = [];
    const c = track(
      createSyncClient(base({ fetch: server.fetch, onCommandsRejected: (r) => seen.push(...r) })),
    );
    c.mutate({ type: "task_add", args: { title: "nope" } });
    await c.flush();

    expect(seen).toHaveLength(1);
    expect(seen[0].error_code).toBe("forbidden");
    expect(seen[0].command.type).toBe("task_add");
    expect(seen[0].command.args.title).toBe("nope");
  });

  it("does not let a rejected mutation survive a restart", async () => {
    const storage = memoryKV();
    const server = makeRejectingServer(rejectByTitle("nope"));
    const c1 = track(createSyncClient(base({ storage, fetch: server.fetch })));
    c1.mutate({ type: "task_add", args: { title: "nope" } });
    await c1.flush();

    const c2 = track(createSyncClient(base({ storage, fetch: server.fetch })));
    await c2.hydrate();
    expect(c2.getSnapshot().tasks).toEqual([]);
  });

  it("recovers even when a later batch fails after the rejection", async () => {
    // Regression: the rollback used to live inside the try block, so a network
    // error in a *later* batch jumped straight to the catch and the rejection
    // was silently discarded — the phantom then had no way of ever leaving,
    // since it never existed server-side for a delta sync to delete.
    const server = makeRejectingServer(rejectByTitle("nope"));
    // Call 1 is the initial sync, call 2 the rejecting batch, call 3 the next
    // batch — which is the one that must fail. (This constant was 2 while the
    // initial sync was missing; adding it shifted every call by one and left the
    // kill landing before any rejection existed, so the test stopped pinning
    // its regression.)
    let calls = 0;
    const flaky: typeof server.fetch = async (url, init) => {
      calls += 1;
      if (calls === 3) throw new TypeError("network down");
      return server.fetch(url, init);
    };
    const storage = memoryKV();
    const seen: any[] = [];
    const c = track(
      createSyncClient(
        base({ storage, fetch: flaky, maxBatch: 1, onCommandsRejected: (r) => seen.push(...r) }),
      ),
    );
    // Get past the first full sync first: otherwise the rejecting batch is the
    // client's first-ever request, its response is a full sync, and the phantom
    // is washed away incidentally rather than by the recovery path.
    await c.sync();
    c.mutate({ type: "task_add", args: { title: "nope" } });
    c.mutate({ type: "task_add", args: { title: "later" } });
    await c.flush();

    // The connection came back: the pending full sync must still happen.
    await c.sync();
    expect(c.getSnapshot().tasks.map((t) => t.title)).not.toContain("nope");
    expect(seen.map((r) => r.command.args.title)).toContain("nope");
  });

  it("survives a crash between the rejection and the recovery pull", async () => {
    // The reset used to be in-memory only, while the phantom had already been
    // persisted by the batch loop. If the recovery pull failed, a restart
    // rehydrated the phantom and resumed from the delta token — permanently.
    const server = makeRejectingServer(rejectByTitle("nope"));
    // Call 1 is an initial sync — it matters that the client is *past* its first
    // full sync, otherwise the next response is a full_sync that rebuilds the
    // replica and incidentally washes the phantom away, hiding the bug.
    // Call 2 is the rejecting batch; call 3 is the recovery pull, which we kill.
    let calls = 0;
    const cutOnPull: typeof server.fetch = async (url, init) => {
      calls += 1;
      if (calls === 3) throw new TypeError("network down");
      return server.fetch(url, init);
    };
    const storage = memoryKV();
    const c1 = track(createSyncClient(base({ storage, fetch: cutOnPull })));
    await c1.sync();
    c1.mutate({ type: "task_add", args: { title: "nope" } });
    await c1.flush();

    // Restart: the phantom was already persisted by the batch loop, so if the
    // reset was in-memory only it comes straight back — and the stored delta
    // token means no later sync can ever remove it.
    const c2 = track(createSyncClient(base({ storage, fetch: cutOnPull })));
    await c2.sync();
    expect(c2.getSnapshot().tasks.map((t) => t.title)).not.toContain("nope");
  });

  it("latches hasSynced even when the follow-up pull fails and status ends offline", async () => {
    // flush() sets "synced" and the recovery pull() sets "syncing" in the same
    // tick, so a UI never renders "synced"; the client must remember it.
    const server = makeRejectingServer(rejectByTitle("nope"));
    // Call 1 is the rejecting batch, call 2 the recovery pull. A stored delta
    // token keeps the batch from being a first-contact full sync (which would
    // wash the phantom away and skip the recovery pull).
    const storage = memoryKV();
    await storage.setItem(`balu:token:${WS}`, "t1");
    let calls = 0;
    const cutOnPull: typeof server.fetch = async (url, init) => {
      calls += 1;
      if (calls === 2) throw new TypeError("network down");
      return server.fetch(url, init);
    };
    const c = track(createSyncClient(base({ storage, fetch: cutOnPull })));
    await c.hydrate();
    expect(c.getSnapshot().hasSynced).toBe(false);
    c.mutate({ type: "task_add", args: { title: "nope" } });
    await c.flush();

    expect(c.getSnapshot().status).toBe("offline");
    expect(c.getSnapshot().hasSynced).toBe(true);
  });

  it("reports hasSynced false for a fresh client", () => {
    const c = track(createSyncClient(base({ storage: memoryKV(), fetch: makeRejectingServer(rejectByTitle("nope")).fetch })));
    expect(c.getSnapshot().hasSynced).toBe(false);
  });

  it("recovers within the session, not only after a restart", async () => {
    // Property: recovery must complete within the session, not merely on the
    // next launch. (An earlier attempt at this fix set `syncToken = "*"` in the
    // flag setter, where `applyResponse` promptly overwrote it with the delta
    // token — the recovery pull then asked for a delta, nothing replaced the
    // phantom, and the flag never cleared. Hence: the flag drives the token.)
    const server = makeRejectingServer(rejectByTitle("nope"));
    const storage = memoryKV();
    const c = track(createSyncClient(base({ storage, fetch: server.fetch })));
    await c.sync(); // past the first full sync — the steady state

    c.mutate({ type: "task_add", args: { title: "nope" } });
    await c.flush(); // every network call succeeds

    expect(c.getSnapshot().tasks.map((t) => t.title)).not.toContain("nope");
    expect(await storage.getItem(`balu:needsFullSync:${WS}`)).toBeNull();
  });

  it("keeps the flag set if the recovered replica could not be persisted", async () => {
    // The mirror image of `markNeedsFullSync`, which persists before anything can
    // fail: the *clear* must come after the clean replica is durable. Clearing
    // first left a window where a crash lost the good replica but kept the flag
    // cleared — phantom restored on restart, with nothing left to force another
    // full sync. Third attempt at this fix; pin the window.
    const server = makeRejectingServer(rejectByTitle("nope"));
    const inner = memoryKV();
    // Break the disk from the test body, not from a fetch predicate: an earlier
    // version flipped this on "full token + no commands", which also matches a
    // fresh client's first-ever sync — so the disk broke before the phantom was
    // ever written, and `mutate`'s fire-and-forget persist became an unhandled
    // rejection that failed the whole run.
    let diskBroken = false;
    const storage = {
      getItem: inner.getItem,
      removeItem: inner.removeItem,
      async setItem(k: string, v: string) {
        if (diskBroken && k === `balu:replica:${WS}`) throw new Error("disk full");
        return inner.setItem(k, v);
      },
    };

    const c = track(createSyncClient(base({ storage, fetch: server.fetch })));
    await c.sync(); // past first contact — the steady state
    c.mutate({ type: "task_add", args: { title: "nope" } });
    expect(await inner.getItem(`balu:replica:${WS}`)).toContain("nope"); // phantom on disk

    diskBroken = true;
    await c.flush().catch(() => {});

    // The recovery pull could not persist the clean replica, so the flag must
    // survive to drive another attempt rather than being cleared optimistically.
    expect(await inner.getItem(`balu:needsFullSync:${WS}`)).toBe("1");

    diskBroken = false; // disk recovers
    const c2 = track(createSyncClient(base({ storage: inner, fetch: server.fetch })));
    await c2.sync();
    expect(c2.getSnapshot().tasks.map((t) => t.title)).not.toContain("nope");
    expect(await inner.getItem(`balu:needsFullSync:${WS}`)).toBeNull();
  });

  it("keeps unsent edits visible across the recovery full sync", async () => {
    // A full response replaces the replica with pure server state. Commands
    // still waiting in the queue have not reached the server, so without
    // re-applying them the user's unsent edits blink out and only come back on
    // the next flush.
    const server = makeRejectingServer(rejectByTitle("nope"));
    let calls = 0;
    const flaky: typeof server.fetch = async (url, init) => {
      calls += 1;
      if (calls === 3) throw new TypeError("network down"); // kills batch 2
      return server.fetch(url, init);
    };
    const c = track(createSyncClient(base({ fetch: flaky, maxBatch: 1 })));
    await c.sync();
    c.mutate({ type: "task_add", args: { title: "nope" } }); // rejected
    c.mutate({ type: "task_add", args: { title: "unsent" } }); // never reaches the server
    await c.flush();

    const titles = c.getSnapshot().tasks.map((t) => t.title);
    expect(titles).not.toContain("nope"); // rejection rolled back
    expect(titles).toContain("unsent"); // still-queued edit survives the full sync
    expect(c.getSnapshot().pending).toBe(1);
  });

  it("leaves the replica alone when every command is accepted", async () => {
    const server = makeRejectingServer(() => null);
    const seen: any[] = [];
    const c = track(
      createSyncClient(base({ fetch: server.fetch, onCommandsRejected: (r) => seen.push(...r) })),
    );
    c.mutate({ type: "task_add", args: { title: "fine" } });
    await c.flush();
    expect(seen).toEqual([]);
    expect(c.getSnapshot().tasks.map((t) => t.title)).toEqual(["fine"]);
    expect(c.getStatus()).toBe("synced");
  });
});

describe("recurring task_complete mirrors the server (I1/I5)", () => {
  const at = (iso: string) => ({ now: () => new Date(`${iso}T12:00:00Z`) });

  it("advances the start_date on its own anchor phase and shifts the deadline", () => {
    const c = track(createSyncClient(base(at("2026-08-05"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: {
        title: "Standup",
        start_date: "2026-07-06",
        deadline: "2026-07-08",
        recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    const t = c.getSnapshot().tasks[0]!;
    // Anchor-aligned Monday, not "two weeks after today".
    expect(t.start_date).toBe("2026-08-17");
    expect(t.deadline).toBe("2026-08-19"); // shifted by the same 42 days
    expect(t.completed_at).toBeNull();
  });

  it("advances the deadline directly when there is no start_date", () => {
    const c = track(createSyncClient(base(at("2026-07-23"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: { title: "Rent", deadline: "2026-01-31", recurrence: "FREQ=MONTHLY" },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    const t = c.getSnapshot().tasks[0]!;
    expect(t.start_date).toBeNull();
    expect(t.deadline).toBe("2026-07-31"); // month-end kept, measured from the anchor
  });

  it("falls back to today when the task has neither date", () => {
    const c = track(createSyncClient(base(at("2026-07-23"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: { title: "Water", recurrence: "FREQ=DAILY;INTERVAL=3" },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    const t = c.getSnapshot().tasks[0]!;
    expect(t.start_date).toBe("2026-07-26");
    expect(t.deadline).toBeNull();
  });

  it("moves the reminder by the start_date delta", () => {
    const c = track(createSyncClient(base(at("2026-08-05"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: {
        title: "Standup",
        start_date: "2026-07-06",
        deadline: "2026-07-08",
        recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
        reminder_at: "2026-07-06T07:00:00Z",
      },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id, today: "2026-08-05", utc_offset: 120 } });
    expect(c.getSnapshot().tasks[0]!.reminder_at).toBe("2026-08-17T07:00:00Z");
  });

  it("leaves a reminder that is already on the next occurrence", () => {
    const c = track(createSyncClient(base(at("2026-07-23"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: { title: "Water", recurrence: "FREQ=DAILY", reminder_at: "2026-07-24T07:00:00Z" },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id, today: "2026-07-23", utc_offset: 120 } });
    const t = c.getSnapshot().tasks[0]!;
    expect(t.start_date).toBe("2026-07-24");
    expect(t.reminder_at).toBe("2026-07-24T07:00:00Z");
  });

  it("moves a dateless task's reminder from its local day", () => {
    const c = track(createSyncClient(base(at("2026-07-23"))));
    const { temp_id } = c.mutate({
      type: "task_add",
      args: { title: "Water", recurrence: "FREQ=DAILY", reminder_at: "2026-07-23T07:00:00Z" },
    });
    c.mutate({ type: "task_complete", args: { id: temp_id, today: "2026-07-23", utc_offset: 120 } });
    expect(c.getSnapshot().tasks[0]!.reminder_at).toBe("2026-07-24T07:00:00Z");
  });

  it("stamps utc_offset on task_complete", async () => {
    const storage = memoryKV();
    const c = track(createSyncClient(base({ ...at("2026-07-23"), storage })));
    const { temp_id } = c.mutate({ type: "task_add", args: { title: "Water", recurrence: "FREQ=DAILY" } });
    c.mutate({ type: "task_complete", args: { id: temp_id } });
    await vi.waitFor(async () => {
      const raw = await storage.getItem(workspaceStorageKeys(WS).queue);
      expect(raw).not.toBeNull();
      const queue = JSON.parse(raw as string) as Array<{ type: string; args: Record<string, unknown> }>;
      const cmd = queue.find((q) => q.type === "task_complete");
      expect(cmd).toBeDefined();
      expect(cmd!.args["utc_offset"]).toBe(-new Date("2026-07-23T12:00:00Z").getTimezoneOffset() || 0);
      expect(String(cmd!.args["today"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("attachments (v1.4)", () => {
  it("ingests the attachments collection from a sync response", async () => {
    const server = makeSeedServer({
      tasks: [makeTask({ id: "T1" })],
      attachments: [makeAttachment({ id: "A1", task_id: "T1", filename: "shot.png" })],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    const snap = c.getSnapshot();
    expect(snap.attachments).toHaveLength(1);
    expect(snap.attachments[0]!.filename).toBe("shot.png");
    expect(snap.attachments[0]!.task_id).toBe("T1");
  });

  it("attachment_delete soft-deletes it optimistically", async () => {
    const server = makeSeedServer({
      tasks: [makeTask({ id: "T1" })],
      attachments: [makeAttachment({ id: "A1", task_id: "T1" })],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    c.mutate({ type: "attachment_delete", args: { id: "A1" } });
    expect(c.getSnapshot().attachments[0]!.is_deleted).toBe(true);
  });

  it("task_delete cascades to the task's attachments", async () => {
    const server = makeSeedServer({
      tasks: [makeTask({ id: "T1" }), makeTask({ id: "T2" })],
      attachments: [
        makeAttachment({ id: "A1", task_id: "T1" }),
        makeAttachment({ id: "A2", task_id: "T1" }),
        makeAttachment({ id: "A3", task_id: "T2" }),
      ],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    c.mutate({ type: "task_delete", args: { id: "T1" } });

    const snap = c.getSnapshot();
    expect(snap.attachments.find((a) => a.id === "A1")!.is_deleted).toBe(true);
    expect(snap.attachments.find((a) => a.id === "A2")!.is_deleted).toBe(true);
    // Another task's attachment is untouched.
    expect(snap.attachments.find((a) => a.id === "A3")!.is_deleted).toBe(false);
  });

  it("task_delete cascades to a subtask's attachments", async () => {
    const server = makeSeedServer({
      tasks: [makeTask({ id: "T1" }), makeTask({ id: "T2", parent_task_id: "T1" })],
      attachments: [makeAttachment({ id: "A1", task_id: "T2" })],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    c.mutate({ type: "task_delete", args: { id: "T1" } });
    expect(c.getSnapshot().attachments[0]!.is_deleted).toBe(true);
  });

  it("project_delete cascades to the attachments of its tasks", async () => {
    const server = makeSeedServer({
      projects: [makeProject({ id: "P1" })],
      tasks: [makeTask({ id: "T1", project_id: "P1" }), makeTask({ id: "T2" })],
      attachments: [
        makeAttachment({ id: "A1", task_id: "T1" }),
        makeAttachment({ id: "A2", task_id: "T2" }),
      ],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    c.mutate({ type: "project_delete", args: { id: "P1" } });

    const snap = c.getSnapshot();
    expect(snap.attachments.find((a) => a.id === "A1")!.is_deleted).toBe(true);
    expect(snap.attachments.find((a) => a.id === "A2")!.is_deleted).toBe(false);
  });

  it("project_delete reaches a subtask's attachments through the null-project subtask pass", async () => {
    const server = makeSeedServer({
      projects: [makeProject({ id: "P1" })],
      // The subtask's own project_id is null - it only survives the cascade via
      // the parent pass, and its attachments have to go with it.
      tasks: [
        makeTask({ id: "T1", project_id: "P1" }),
        makeTask({ id: "T2", parent_task_id: "T1" }),
      ],
      attachments: [makeAttachment({ id: "A1", task_id: "T2" })],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch })));
    await c.sync();

    c.mutate({ type: "project_delete", args: { id: "P1" } });
    expect(c.getSnapshot().attachments[0]!.is_deleted).toBe(true);
  });

  it("a delta marking an attachment deleted drops it from the replica", async () => {
    const seed = makeSeedServer({
      tasks: [makeTask({ id: "T1" })],
      attachments: [makeAttachment({ id: "A1", task_id: "T1" })],
    });
    const storage = memoryKV();
    const c = track(createSyncClient(base({ fetch: seed.fetch, storage })));
    await c.sync();
    expect(c.getSnapshot().attachments).toHaveLength(1);

    const delta = makeSeedServer(
      { attachments: [makeAttachment({ id: "A1", task_id: "T1", is_deleted: true })] },
      { fullSync: false },
    );
    const c2 = track(createSyncClient(base({ fetch: delta.fetch, storage })));
    await c2.hydrate();
    await c2.sync();
    expect(c2.getSnapshot().attachments).toHaveLength(0);
  });

  it("keeps attachments durable across client re-instantiation", async () => {
    const storage = memoryKV();
    const server = makeSeedServer({
      tasks: [makeTask({ id: "T1" })],
      attachments: [makeAttachment({ id: "A1", task_id: "T1", filename: "keep.pdf" })],
    });
    const c = track(createSyncClient(base({ fetch: server.fetch, storage })));
    await c.sync();

    const offline: typeof fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c2 = track(createSyncClient(base({ fetch: offline, storage })));
    await c2.hydrate();
    expect(c2.getSnapshot().attachments[0]!.filename).toBe("keep.pdf");
  });

  it("hydrates a replica persisted before attachments existed", async () => {
    // A pre-v1.4 client wrote a replica with no `attachments` key at all.
    const storage = memoryKV({
      "balu:replica:w1": JSON.stringify({
        projects: [],
        sections: [],
        tasks: [makeTask({ id: "T1" })],
        labels: [],
        comments: [],
        members: [],
      }),
    });
    const offline: typeof fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c = track(createSyncClient(base({ fetch: offline, storage })));
    await c.hydrate();
    expect(c.getSnapshot().tasks).toHaveLength(1);
    expect(c.getSnapshot().attachments).toEqual([]);
  });
});

describe("status while retrying after a failure", () => {
  // Server that fails (network down, or HTTP 500 = non-transient "error") until
  // `up`, then hangs on a gate, then answers.
  function controllable() {
    const server = makeServer();
    const holder: { c?: SyncClient } = {};
    let mode: "down" | "http" | "hang" | "up" = "down";
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const atCall: string[] = []; // client status at the moment each request goes out (needs holder.c)
    const fetchImpl = (async (u: any, init: any) => {
      calls += 1;
      atCall.push(holder.c?.getStatus() ?? "?");
      if (mode === "down") throw new TypeError("network down");
      if (mode === "http") return new Response("boom", { status: 500 });
      if (mode === "hang") await gate;
      return server.fetch(u, init);
    }) as unknown as typeof fetch;
    return {
      fetchImpl,
      setMode: (m: "down" | "http" | "hang" | "up") => {
        mode = m;
      },
      release,
      calls: () => calls,
      atCall,
      holder,
    };
  }
  const opts = { retryBaseMs: 1_000_000, retryMaxMs: 1_000_000, autoSyncMs: 1_000_000 };

  for (const kind of ["flush", "pull"] as const) {
    const attempt = (c: SyncClient): Promise<void> => (kind === "flush" ? c.flush() : c.sync());
    const prime = (c: SyncClient): void => {
      if (kind === "flush") c.mutate({ type: "task_add", args: { title: "x" } });
    };

    it(`${kind}: a retry from offline stays offline while in flight, then synced`, async () => {
      const s = controllable();
      const c = track(createSyncClient(base({ fetch: s.fetchImpl, ...opts })));
      s.holder.c = c;
      prime(c);
      await attempt(c);
      expect(c.getStatus()).toBe("offline");
      s.setMode("hang");
      const seen: string[] = [];
      c.subscribe(() => seen.push(c.getStatus()));
      const p = attempt(c);
      await vi.waitFor(() => expect(s.calls()).toBeGreaterThan(1));
      expect(c.getStatus()).toBe("offline");
      s.release();
      await p;
      expect(c.getStatus()).toBe("synced");
      expect(seen).not.toContain("syncing");
      // The in-flight retry went out while the client said offline.
      expect(s.atCall.at(-1)).toBe("offline");
    });

    it(`${kind}: a retry from error stays error while in flight, then synced`, async () => {
      const s = controllable();
      s.setMode("http");
      const c = track(createSyncClient(base({ fetch: s.fetchImpl, ...opts })));
      s.holder.c = c;
      prime(c);
      await attempt(c);
      expect(c.getStatus()).toBe("error");
      s.setMode("hang");
      const seen: string[] = [];
      c.subscribe(() => seen.push(c.getStatus()));
      const p = attempt(c);
      await vi.waitFor(() => expect(s.calls()).toBeGreaterThan(1));
      expect(c.getStatus()).toBe("error");
      s.release();
      await p;
      expect(c.getStatus()).toBe("synced");
      expect(seen).not.toContain("syncing");
      expect(s.atCall.at(-1)).toBe("error");
    });

    it(`${kind}: offline moves to error on the next failure without syncing`, async () => {
      const s = controllable();
      const c = track(createSyncClient(base({ fetch: s.fetchImpl, ...opts })));
      prime(c);
      await attempt(c);
      expect(c.getStatus()).toBe("offline");
      s.setMode("http");
      const seen: string[] = [];
      c.subscribe(() => seen.push(c.getStatus()));
      await attempt(c);
      expect(c.getStatus()).toBe("error");
      expect(seen).not.toContain("syncing");
    });

    it(`${kind}: a first attempt from synced shows syncing`, async () => {
      const s = controllable();
      s.setMode("up");
      const c = track(createSyncClient(base({ fetch: s.fetchImpl, ...opts })));
      await c.sync();
      expect(c.getStatus()).toBe("synced");
      s.setMode("hang");
      prime(c);
      const p = attempt(c);
      await vi.waitFor(() => expect(c.getStatus()).toBe("syncing"));
      s.release();
      await p;
      expect(c.getStatus()).toBe("synced");
    });

    it(`${kind}: the very first attempt (initial status) shows syncing`, async () => {
      const s = controllable();
      s.setMode("hang");
      const c = track(createSyncClient(base({ fetch: s.fetchImpl, ...opts })));
      prime(c);
      const p = attempt(c);
      await vi.waitFor(() => expect(c.getStatus()).toBe("syncing"));
      s.release();
      await p;
      expect(c.getStatus()).toBe("synced");
    });

    it(`${kind}: a failing retry stays offline and the automatic retry is still scheduled`, async () => {
      const s = controllable();
      const c = track(
        createSyncClient(
          base({ fetch: s.fetchImpl, retryBaseMs: 10, retryMaxMs: 10, autoSyncMs: 1_000_000 }),
        ),
      );
      s.holder.c = c;
      prime(c);
      c.start();
      // The first attempt legitimately shows "syncing"; watch from its failure on.
      await vi.waitFor(() => expect(s.calls()).toBeGreaterThanOrEqual(1));
      await vi.waitFor(() => expect(c.getStatus()).toBe("offline"));
      const seen: string[] = [];
      c.subscribe(() => seen.push(c.getStatus()));
      await vi.waitFor(() => expect(s.calls()).toBeGreaterThanOrEqual(4)); // retries keep firing
      expect(c.getStatus()).toBe("offline");
      expect(seen).not.toContain("syncing");
      // Every retry went out while the client still said offline (the first one
      // legitimately says syncing).
      expect(s.atCall.slice(1).every((x) => x === "offline")).toBe(true);
      // Recovery still happens through the scheduled retry.
      s.setMode("up");
      await vi.waitFor(() => expect(c.getStatus()).toBe("synced"));
    });
  }
});
