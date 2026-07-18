import { afterEach, describe, expect, it } from "vitest";
import { createSyncClient, memoryKV, type SyncClient } from "../src/index.js";
import { makeServer } from "./helpers.js";

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
