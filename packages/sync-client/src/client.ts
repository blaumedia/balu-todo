// createSyncClient — the framework-free local-first replica + durable command
// queue + flush/pull engine described in contract §6.

import {
  todayLocalISO,
  type Comment,
  type CommandInput,
  type IsoDate,
  type Label,
  type Member,
  type Project,
  type Section,
  type SyncCommand,
  type SyncResponse,
  type SyncStatus,
  type Task,
} from "@balu/domain";
import { applyCommand, type ApplyContext } from "./apply.js";
import {
  emptyReplica,
  hydrateReplica,
  serializeReplica,
  type Replica,
} from "./replica.js";
import { removeTempEntries, rewriteCommandRefs, rewriteReplicaRefs } from "./rewrite.js";
import type { AsyncKV } from "./storage.js";

export interface SyncClientOptions {
  baseUrl: string;
  workspaceId: string;
  getAccessToken: () => string | null | Promise<string | null>;
  storage: AsyncKV;
  /** Overridable for tests / SSR. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Called on a 401 so the app can refresh the token; the request retries once. */
  onAuthFail?: () => void | Promise<void>;
  /** Current user id, stamped on optimistic `created_by`/`completed_by`. */
  userId?: string;
  now?: () => Date;
  autoSyncMs?: number;
  flushDebounceMs?: number;
  maxBatch?: number;
}

export interface Snapshot {
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  labels: Label[];
  comments: Comment[];
  members: Member[];
  status: SyncStatus;
  syncToken: string;
  pending: number;
}

export interface SyncClient {
  getSnapshot(): Snapshot;
  subscribe(cb: () => void): () => void;
  getStatus(): SyncStatus;
  mutate(input: CommandInput): { uuid: string; temp_id?: string };
  sync(): Promise<void>;
  flush(): Promise<void>;
  hydrate(): Promise<void>;
  start(): void;
  stop(): void;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const uuid = (): string => globalThis.crypto.randomUUID();

export function createSyncClient(opts: SyncClientOptions): SyncClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const nowDate = opts.now ?? (() => new Date());
  const autoSyncMs = opts.autoSyncMs ?? 60_000;
  const debounceMs = opts.flushDebounceMs ?? 400;
  const maxBatch = opts.maxBatch ?? 100;

  const qKey = `balu:queue:${opts.workspaceId}`;
  const tKey = `balu:token:${opts.workspaceId}`;
  const rKey = `balu:replica:${opts.workspaceId}`;

  let replica: Replica = emptyReplica();
  let queue: SyncCommand[] = [];
  let syncToken = "*";
  let status: SyncStatus = "offline";
  let flushing = false;
  let hydrated = false;

  const subscribers = new Set<() => void>();
  let snapshot: Snapshot | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTimer: ReturnType<typeof setInterval> | null = null;

  const ctx: ApplyContext = {
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? "local",
    now: () => nowDate().toISOString(),
    today: (): IsoDate => todayLocalISO(nowDate()),
  };

  function invalidate(): void {
    snapshot = null;
    for (const cb of subscribers) cb();
  }

  function setStatus(s: SyncStatus): void {
    if (status !== s) {
      status = s;
      invalidate();
    }
  }

  function buildSnapshot(): Snapshot {
    return {
      projects: [...replica.projects.values()],
      sections: [...replica.sections.values()],
      tasks: [...replica.tasks.values()],
      labels: [...replica.labels.values()],
      comments: [...replica.comments.values()],
      members: [...replica.members.values()],
      status,
      syncToken,
      pending: queue.length,
    };
  }

  async function persistQueue(): Promise<void> {
    await opts.storage.setItem(qKey, JSON.stringify(queue));
  }
  async function persistToken(): Promise<void> {
    await opts.storage.setItem(tKey, syncToken);
  }
  async function persistReplica(): Promise<void> {
    await opts.storage.setItem(rKey, JSON.stringify(serializeReplica(replica)));
  }

  async function hydrate(): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    const [q, t, r] = await Promise.all([
      opts.storage.getItem(qKey),
      opts.storage.getItem(tKey),
      opts.storage.getItem(rKey),
    ]);
    if (q) {
      try {
        queue = JSON.parse(q) as SyncCommand[];
      } catch {
        queue = [];
      }
    }
    if (t) syncToken = t;
    if (r) {
      try {
        replica = hydrateReplica(JSON.parse(r));
      } catch {
        /* ignore corrupt cache */
      }
    }
    invalidate();
  }

  function applyResponse(resp: SyncResponse): void {
    const mapping = resp.temp_id_mapping ?? {};
    const hasMapping = Object.keys(mapping).length > 0;

    if (hasMapping) rewriteCommandRefs(queue, mapping);

    if (resp.full_sync) {
      replica = emptyReplica();
      for (const p of resp.projects) if (!p.is_deleted) replica.projects.set(p.id, p);
      for (const s of resp.sections) if (!s.is_deleted) replica.sections.set(s.id, s);
      for (const t of resp.tasks) if (!t.is_deleted) replica.tasks.set(t.id, t);
      for (const l of resp.labels) if (!l.is_deleted) replica.labels.set(l.id, l);
      for (const c of resp.comments ?? []) if (!c.is_deleted) replica.comments.set(c.id, c);
      for (const m of resp.members) if (!m.is_deleted) replica.members.set(m.id, m);
    } else {
      if (hasMapping) {
        rewriteReplicaRefs(replica, mapping);
        removeTempEntries(replica, mapping);
      }
      mergeInto(replica.projects, resp.projects);
      mergeInto(replica.sections, resp.sections);
      mergeInto(replica.tasks, resp.tasks);
      mergeInto(replica.labels, resp.labels);
      mergeInto(replica.comments, resp.comments ?? []);
      mergeInto(replica.members, resp.members);
    }

    syncToken = resp.sync_token;
  }

  async function doSync(commands: SyncCommand[]): Promise<SyncResponse> {
    const url = `${opts.baseUrl}/workspaces/${opts.workspaceId}/sync`;
    const body = JSON.stringify({ sync_token: syncToken, commands });

    const send = async (): Promise<Response> => {
      const token = await opts.getAccessToken();
      return fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
    };

    let res = await send();
    if (res.status === 401 && opts.onAuthFail) {
      await opts.onAuthFail();
      res = await send();
    }
    if (!res.ok) throw new HttpError(res.status);
    return (await res.json()) as SyncResponse;
  }

  async function flush(): Promise<void> {
    if (flushing || queue.length === 0) return;
    flushing = true;
    setStatus("syncing");
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, maxBatch);
        const resp = await doSync(batch);
        applyResponse(resp); // may rewrite the rest of `queue` in place
        const sent = new Set(batch.map((c) => c.uuid));
        queue = queue.filter((c) => !sent.has(c.uuid));
        await persistQueue();
        await persistToken();
        await persistReplica();
        invalidate();
      }
      setStatus("synced");
    } catch (e) {
      setStatus(e instanceof HttpError ? "error" : "offline");
    } finally {
      flushing = false;
    }
  }

  async function pull(): Promise<void> {
    setStatus("syncing");
    try {
      const resp = await doSync([]);
      applyResponse(resp);
      await persistToken();
      await persistReplica();
      setStatus("synced");
      invalidate();
    } catch (e) {
      setStatus(e instanceof HttpError ? "error" : "offline");
    }
  }

  async function sync(): Promise<void> {
    await hydrate();
    if (queue.length > 0) await flush();
    else await pull();
  }

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, debounceMs);
  }

  function mutate(input: CommandInput): { uuid: string; temp_id?: string } {
    const isAdd = input.type.endsWith("_add");
    const tempId = isAdd ? input.temp_id ?? `tmp-${uuid()}` : input.temp_id;
    const cmd: SyncCommand = {
      type: input.type,
      uuid: uuid(),
      args: { ...input.args },
      ...(tempId ? { temp_id: tempId } : {}),
    };
    applyCommand(replica, cmd, ctx);
    queue.push(cmd);
    void persistQueue();
    void persistReplica();
    invalidate();
    scheduleFlush();
    return { uuid: cmd.uuid, temp_id: tempId };
  }

  const onFocus = (): void => {
    void sync();
  };

  function start(): void {
    void hydrate().then(() => void sync());
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => void sync(), autoSyncMs);
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("focus", onFocus);
      globalThis.addEventListener("online", onFocus);
    }
  }

  function stop(): void {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (typeof globalThis.removeEventListener === "function") {
      globalThis.removeEventListener("focus", onFocus);
      globalThis.removeEventListener("online", onFocus);
    }
  }

  return {
    getSnapshot() {
      if (!snapshot) snapshot = buildSnapshot();
      return snapshot;
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getStatus: () => status,
    mutate,
    sync,
    flush,
    hydrate,
    start,
    stop,
  };
}

function mergeInto<T extends { id: string; is_deleted: boolean }>(m: Map<string, T>, items: T[]): void {
  for (const obj of items) {
    if (obj.is_deleted) m.delete(obj.id);
    else m.set(obj.id, obj);
  }
}
