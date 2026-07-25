import { afterEach, describe, expect, it } from "vitest";
import { createSyncClient, memoryKV, type SyncClient } from "../src/index.js";
import { makeRejectingServer, makeServer } from "./helpers.js";

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
});
