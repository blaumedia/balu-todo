// createSyncClient — the framework-free local-first replica + durable command
// queue + flush/pull engine described in contract §6.

import {
  todayLocalISO,
  type Attachment,
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
  /**
   * Called with the commands the server rejected.
   *
   * Their optimistic effect has been rolled back, or will be by the next
   * successful sync — if the recovery pull could not reach the server the change
   * is still on screen for now. Word any UI accordingly ("could not be saved"
   * rather than "has been undone").
   */
  onCommandsRejected?: (rejected: RejectedCommand[]) => void;
  /** Current user id, stamped on optimistic `created_by`/`completed_by`. */
  userId?: string;
  now?: () => Date;
  autoSyncMs?: number;
  flushDebounceMs?: number;
  maxBatch?: number;
}

/** A command the server refused, paired with its error status. */
export interface RejectedCommand {
  command: SyncCommand;
  error_code: string;
  error: string;
}

export interface Snapshot {
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  labels: Label[];
  comments: Comment[];
  attachments: Attachment[];
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
  // Sticky "the replica contains a mutation the server rejected" marker. It must
  // outlive both a failing flush and a process restart: the phantom is only in
  // the local replica, so no incremental sync can ever delete it — only a full
  // sync replaces it. Holding this in memory meant an offline batch (or a crash)
  // after a rejection stranded the phantom permanently.
  const nKey = `balu:needsFullSync:${opts.workspaceId}`;

  let replica: Replica = emptyReplica();
  let queue: SyncCommand[] = [];
  let syncToken = "*";
  let status: SyncStatus = "offline";
  let flushing = false;
  let hydrated = false;
  let needsFullSync = false;

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
      attachments: [...replica.attachments.values()],
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

  /**
   * Mark the replica as untrustworthy and force the next sync to be a full one.
   *
   * Persisted before anything else can fail, so a rejection survives a dropped
   * connection mid-flush and a restart.
   */
  async function markNeedsFullSync(): Promise<void> {
    // Deliberately does NOT touch `syncToken`: `applyResponse` overwrites it
    // with the response's delta token on the very next statement, which is how
    // the first version of this fix ended up asking for a delta and never
    // recovering. `doSync` reads the flag instead, so it cannot be clobbered.
    needsFullSync = true;
    await opts.storage.setItem(nKey, "1");
  }

  async function clearNeedsFullSync(): Promise<void> {
    needsFullSync = false;
    await opts.storage.removeItem(nKey);
  }

  async function hydrate(): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    const [q, t, r, n] = await Promise.all([
      opts.storage.getItem(qKey),
      opts.storage.getItem(tKey),
      opts.storage.getItem(rKey),
      opts.storage.getItem(nKey),
    ]);
    needsFullSync = n === "1";
    if (q) {
      try {
        queue = JSON.parse(q) as SyncCommand[];
      } catch {
        queue = [];
      }
    }
    if (t) syncToken = t; // `doSync` applies the needsFullSync override
    if (r) {
      try {
        replica = hydrateReplica(JSON.parse(r));
      } catch {
        /* ignore corrupt cache */
      }
    }
    invalidate();
  }

  /**
   * The commands in `batch` the server refused. Their optimistic effect is still
   * sitting in the replica and has to be undone (contract §5.2).
   */
  function rejectedIn(batch: SyncCommand[], resp: SyncResponse): RejectedCommand[] {
    const status = resp.sync_status ?? {};
    const out: RejectedCommand[] = [];
    for (const command of batch) {
      const s = status[command.uuid];
      if (s != null && s !== "ok") {
        out.push({ command, error_code: s.error_code, error: s.error });
      }
    }
    return out;
  }

  /**
   * Fold a sync response into the replica.
   *
   * `stillQueued` are the commands that have NOT been accepted by this response
   * and are still waiting to be sent. A full response replaces the replica with
   * pure server state, which would otherwise blank out their optimistic effects
   * until the next flush re-sent them — unsent edits visibly vanishing and
   * reappearing. Re-applying them on top restores the "server state + what I
   * have not sent yet" view the user expects.
   */
  function applyResponse(resp: SyncResponse, stillQueued: SyncCommand[] = []): void {
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
      for (const a of resp.attachments ?? []) if (!a.is_deleted) replica.attachments.set(a.id, a);
      for (const m of resp.members) if (!m.is_deleted) replica.members.set(m.id, m);
      // Refs were rewritten above, so these carry real ids where the server has
      // assigned them. Rejected commands are never in `stillQueued` — they are
      // dropped from the queue — so this cannot resurrect one.
      for (const cmd of stillQueued) applyCommand(replica, cmd, ctx);
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
      // `?? []` because an older server simply has no `attachments` key.
      mergeInto(replica.attachments, resp.attachments ?? []);
      mergeInto(replica.members, resp.members);
    }

    syncToken = resp.sync_token;
  }

  async function doSync(commands: SyncCommand[]): Promise<SyncResponse> {
    const url = `${opts.baseUrl}/workspaces/${opts.workspaceId}/sync`;
    // While a rejection is outstanding, every request asks for a full sync —
    // only a full response replaces the replica, and the phantom exists
    // nowhere but locally, so no delta can ever delete it.
    const body = JSON.stringify({ sync_token: needsFullSync ? "*" : syncToken, commands });

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
    const rejected: RejectedCommand[] = [];
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, maxBatch);
        const resp = await doSync(batch);
        const batchRejected = rejectedIn(batch, resp);
        if (batchRejected.length > 0) {
          rejected.push(...batchRejected);
          // Record it durably *now*, not after the loop: a rejection in batch 1
          // followed by a network error in batch 2 used to skip the recovery
          // entirely, stranding the phantom for good.
          await markNeedsFullSync();
        }
        const sent = new Set(batch.map((c) => c.uuid));
        const remaining = queue.filter((c) => !sent.has(c.uuid));
        applyResponse(resp, remaining); // may rewrite `queue` refs in place
        queue = remaining;
        await persistQueue();
        await persistToken();
        await persistReplica();
        // Only now: a full response replaced the replica, and that replacement is
        // on disk. Clearing before the persist left a window where a crash lost
        // the clean replica but kept the cleared flag — phantom back, and nothing
        // left to force another full sync. Clearing late only ever costs one
        // redundant full sync.
        if (resp.full_sync) await clearNeedsFullSync();
        invalidate();
      }
      setStatus("synced");
    } catch (e) {
      setStatus(e instanceof HttpError ? "error" : "offline");
    } finally {
      flushing = false;
    }

    // Outside the try/finally so it runs whether the flush completed or threw.
    // A rejected command's optimistic mutation is still in the replica and there
    // is no per-command inverse, so the only cure is a full sync — which the
    // persisted flag guarantees will happen, retrying on every later sync until
    // one succeeds.

    if (needsFullSync) await pull();
    if (rejected.length > 0) opts.onCommandsRejected?.(rejected);
  }

  async function pull(): Promise<void> {
    setStatus("syncing");
    try {
      const resp = await doSync([]);
      // Nothing was sent, so everything queued is still pending.
      applyResponse(resp, queue);
      await persistToken();
      await persistReplica();
      // Only a *full* response actually replaced the replica (a delta would have
      // left the phantom in place), and only once that replacement is persisted —
      // clearing first meant a crash in between re-stranded the phantom for good.
      if (resp.full_sync) await clearNeedsFullSync();
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
    // A rejection recorded in an earlier session (or an earlier failed attempt)
    // keeps forcing a full sync until one lands.
    if (needsFullSync && queue.length === 0) await pull();
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
    const args: Record<string, unknown> = { ...input.args };
    // Recurrence rolls forward from "today", and the optimistic apply uses the
    // *device's* calendar day. Stamping it here — rather than at each call site —
    // keeps the server on the same day: without it a user far from UTC saw the
    // completed task jump to a different date once the response landed.
    if (input.type === "task_complete" && args["today"] === undefined) {
      args["today"] = ctx.today();
    }
    const cmd: SyncCommand = {
      type: input.type,
      uuid: uuid(),
      args,
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
