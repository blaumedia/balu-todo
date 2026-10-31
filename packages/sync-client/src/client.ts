// createSyncClient — the framework-free local-first replica + durable command
// queue + flush/pull engine described in contract §6.

import {
  parseRetryAfter,
  todayLocalISO,
  withTimeout,
  type Attachment,
  type Comment,
  type CommandInput,
  type IsoDate,
  type Label,
  type Member,
  type Project,
  type RelocationReason,
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
  /**
   * Called after a flush with the `task_add`s the server accepted but filed
   * elsewhere because their project, section or parent task was deleted meanwhile
   * (contract §5.2, §5.5). The tasks are already in the replica at their real
   * place; this only lets the app say where they went.
   */
  onCommandsRelocated?: (relocated: RelocatedCommand[]) => void;
  /**
   * Called once when the sync endpoint answers 403 `forbidden` (membership
   * revoked) or 404 `not_found` (workspace deleted) with the contract error
   * envelope. Before the call the client has stopped for good and deleted this
   * workspace's queue, replica, token and full-sync marker from `storage`.
   */
  onAccessLost?: (info: AccessLost) => void;
  /**
   * Abandon a sync request, including its `onAuthFail` refresh, if the response
   * headers have not arrived after this long. Default 30 000. Reading the body
   * is bounded separately by `bodyTimeoutMs`.
   */
  requestTimeoutMs?: number;
  /**
   * Abandon reading a response body after this long. Default 120 000. Separate
   * from `requestTimeoutMs` so a large full sync on a slow link can finish
   * downloading instead of being aborted and re-requested forever. A true idle
   * timeout needs a streamed body, which is not available in every runtime we
   * ship (React Native's fetch has no `body` stream), so this is a plain, more
   * generous limit.
   */
  bodyTimeoutMs?: number;
  /** First retry delay after a failed sync; doubles per failure. Default 2 000. */
  retryBaseMs?: number;
  /** Upper bound for the retry delay. Default 30 000. */
  retryMaxMs?: number;
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

/** A `task_add` the server accepted but filed elsewhere (contract §5.2 `relocated`). */
export interface RelocatedCommand {
  command: SyncCommand;
  reasons: RelocationReason[];
}

/** The server says this user can no longer reach the workspace. */
export interface AccessLost {
  workspaceId: string;
  /** "removed": 403 forbidden, the membership was revoked (§7). "deleted": 404 not_found, the workspace is gone. */
  reason: "removed" | "deleted";
  /** Queued changes the server never accepted, discarded with the local data. */
  discarded: number;
}

/** The storage keys one workspace's client persists under. */
export function workspaceStorageKeys(workspaceId: string) {
  return {
    queue: `balu:queue:${workspaceId}`,
    token: `balu:token:${workspaceId}`,
    replica: `balu:replica:${workspaceId}`,
    needsFullSync: `balu:needsFullSync:${workspaceId}`,
    /** Written before an access-loss purge so a kill mid-purge cannot swallow the notice. */
    lossNotice: `balu:lossNotice:${workspaceId}`,
  };
}

/** What a purge removed: the queued commands lost, and why the workspace was lost. */
export interface PurgedWorkspace {
  discarded: number;
  /** From the loss notice a purge left behind; "removed" when there is none. */
  reason: AccessLost["reason"];
}

/**
 * Delete one workspace's persisted queue, replica, sync token, full-sync marker
 * and loss notice. `discarded` is the queue's length, or the count a loss notice
 * left behind when a purge was interrupted after the queue was already gone (0 if
 * none or unreadable); `reason` is that notice's reason.
 */
export async function purgeWorkspaceData(storage: AsyncKV, workspaceId: string): Promise<PurgedWorkspace> {
  const keys = workspaceStorageKeys(workspaceId);
  let discarded = 0;
  let reason: AccessLost["reason"] = "removed";
  try {
    const raw = await storage.getItem(keys.queue);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    discarded = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    discarded = 0;
  }
  try {
    const raw = await storage.getItem(keys.lossNotice);
    const notice = raw ? (JSON.parse(raw) as { discarded?: unknown; reason?: unknown }) : null;
    if (typeof notice?.discarded === "number") discarded = Math.max(discarded, notice.discarded);
    if (notice?.reason === "removed" || notice?.reason === "deleted") reason = notice.reason;
  } catch {
    /* an unreadable notice counts nothing */
  }
  await removeWorkspaceKeys(storage, keys, true);
  return { discarded, reason };
}

/**
 * Remove a loss notice left behind for a workspace that turned out to be
 * reachable after all (re-invited before the next boot): it would never be shown,
 * and its count would inflate a later, unrelated loss.
 */
export async function clearLossNotice(storage: AsyncKV, workspaceId: string): Promise<void> {
  await storage.removeItem(workspaceStorageKeys(workspaceId).lossNotice);
}

/** The queue goes last: while it exists, a boot after a kill still finds what was lost. */
async function removeWorkspaceKeys(
  storage: AsyncKV,
  keys: ReturnType<typeof workspaceStorageKeys>,
  withNotice: boolean,
): Promise<void> {
  await Promise.all(
    [keys.replica, keys.token, keys.needsFullSync].map((k) => storage.removeItem(k)),
  );
  await storage.removeItem(keys.queue);
  if (withNotice) await storage.removeItem(keys.lossNotice);
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
  /**
   * temp_id -> real id for every object the server created this session
   * (contract §5.3). Lets a screen still holding a temp id find the real object
   * after the ack. In memory only; never pruned.
   */
  idAliases: Readonly<Record<string, string>>;
  /**
   * True once this client has reached "synced" at least once. Latched in the
   * client (not derived from rendered status) because flush() sets "synced" and
   * a follow-up pull() sets "syncing" in the same tick, so a UI may never see it.
   */
  hasSynced: boolean;
}

/** What `mutate()` returns. */
export interface MutateResult {
  uuid: string;
  temp_id?: string;
  dropped?: boolean;
}

/**
 * Whether `mutate()` (or a wrapper around it) actually saved the edit. A client
 * without access, a closed one, or none at all drops it: show no success
 * feedback then, it would be false, and on web a success toast would replace the
 * notice that explains the loss.
 */
export function wasSaved(result: { dropped?: boolean } | undefined): boolean {
  return result !== undefined && !result.dropped;
}

export interface SyncClient {
  getSnapshot(): Snapshot;
  subscribe(cb: () => void): () => void;
  getStatus(): SyncStatus;
  /**
   * Apply `input` optimistically and queue it. `dropped: true` means the client
   * is closed or has lost access to its workspace: nothing was applied or queued,
   * so a caller must not tell the user the edit was saved.
   */
  mutate(input: CommandInput): MutateResult;
  sync(): Promise<void>;
  flush(): Promise<void>;
  hydrate(): Promise<void>;
  start(): void;
  stop(): void;
  /**
   * Stop for good: like `stop()`, and from now on the client never writes to
   * storage again (queue, token, replica, full-sync flag) and starts no new
   * network work. Work already in flight may still finish, but its results stay
   * in memory. `mutate()` becomes a no-op (the edit is neither applied nor shown),
   * and the rejected, relocated and access-lost callbacks no longer fire. Use it
   * when another user's data is about to be wiped or adopted.
   */
  close(): void;
  /**
   * Resolves once the storage writes already started have settled. After `close()`
   * no new write can start, so this is all a purge has to wait for: unlike `idle()`
   * it does not wait for a slow network request, which `close()` has made harmless.
   */
  writesSettled(): Promise<void>;
  /**
   * Resolves once the network work already running (a pull or flush) has settled
   * and written what it was writing. `stop()` does not cancel that work; wait here
   * before wiping this client's storage, or its late write lands after the wipe.
   * Waits for work that joins the lane meanwhile too (not only the work running now).
   */
  idle(): Promise<void>;
  /** The app regained attention (focus, visible, online, foreground): reset the retry backoff and sync now. */
  wake(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null,
    /** The server's `Retry-After`, in ms, when it sent a usable one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Statuses the contract calls retryable: the server (or a proxy) is busy, not refusing. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
/** What a failed sync means for the status: a busy server is "offline, retrying", not an error. */
function failureStatus(e: unknown): SyncStatus {
  return e instanceof HttpError && !TRANSIENT_STATUSES.has(e.status) ? "error" : "offline";
}

class RequestTimeoutError extends Error {
  constructor() {
    super("sync request timed out");
  }
}

/** The contract error code (`{"detail":{"code":...}}`), or null for any other body. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: { code?: unknown } } | null;
    const code = body?.detail?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/**
 * Whether a failed sync means the user can no longer reach this workspace.
 * Only the contract envelope counts: a proxy's 403 page or FastAPI's
 * route-miss `{"detail":"Not Found"}` must not wipe local data.
 */
function lostAccessReason(e: unknown): AccessLost["reason"] | null {
  if (!(e instanceof HttpError)) return null;
  if (e.status === 403 && e.code === "forbidden") return "removed";
  if (e.status === 404 && e.code === "not_found") return "deleted";
  return null;
}

const uuid = (): string => globalThis.crypto.randomUUID();

export function createSyncClient(opts: SyncClientOptions): SyncClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const nowDate = opts.now ?? (() => new Date());
  const autoSyncMs = opts.autoSyncMs ?? 60_000;
  const debounceMs = opts.flushDebounceMs ?? 400;
  const maxBatch = opts.maxBatch ?? 100;
  // After a request times out the next flush sends fewer commands (a slow server
  // is working through each one) and a body read gets twice the time; a success
  // restores the body timeout. The batch grows back additively and stays below
  // the size that timed out until CEILING_PROBE_OK batches in a row passed at the
  // cap, then that size is tried once: doubling, or restoring the full size at
  // once, alternated a batch that times out with a half one that passes and
  // burned a full timeout on every second request.
  const minBatch = Math.min(10, maxBatch);
  const CEILING_PROBE_OK = 5;
  let batchSize = maxBatch;
  let timedOutSize: number | null = null;
  let okAtCap = 0;
  const BODY_TIMEOUT_CAP_MS = 600_000;

  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  const baseBodyTimeoutMs = opts.bodyTimeoutMs ?? 120_000;
  let bodyTimeoutMs = baseBodyTimeoutMs;
  const retryBaseMs = opts.retryBaseMs ?? 2_000;
  const retryMaxMs = opts.retryMaxMs ?? 30_000;

  const keys = workspaceStorageKeys(opts.workspaceId);
  const qKey = keys.queue;
  const tKey = keys.token;
  const rKey = keys.replica;
  // Sticky "the replica contains a mutation the server rejected" marker. It must
  // outlive both a failing flush and a process restart: the phantom is only in
  // the local replica, so no incremental sync can ever delete it — only a full
  // sync replaces it. Holding this in memory meant an offline batch (or a crash)
  // after a rejection stranded the phantom permanently.
  const nKey = keys.needsFullSync;

  let replica: Replica = emptyReplica();
  let queue: SyncCommand[] = [];
  let syncToken = "*";
  let status: SyncStatus = "offline";
  let flushing = false;
  let hydrated = false;
  let needsFullSync = false;
  let hasSynced = false;
  let idAliases: Record<string, string> = {};
  let accessLost = false;
  let closed = false;
  const syncs = new Set<Promise<void>>(); // sync() calls running, including their hydrate phase
  let started = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 0;
  // When the pending retry timer fires (epoch ms), to tell whether a later reply
  // asks for a longer wait.
  let retryDue = 0;
  // The server asked for no requests before this time (Retry-After, epoch ms; 0 =
  // no such request). Absolute, so it expires on its own and never lingers.
  let notBefore = 0;
  // Rejected commands of a flush whose recovery pull has not reported them yet;
  // they are already off the queue, so a loss found by that pull must count them.
  let rejectedUnreported = 0;
  let lane: Promise<unknown> = Promise.resolve();
  let waking: Promise<void> | null = null;

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

  /**
   * Run network work one at a time. A pull answered after a flush (or the
   * other way round) would otherwise apply an older response over a newer one:
   * stale objects, the token moving backwards, a just-created task vanishing
   * until the next sync.
   */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = lane.then(fn);
    lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function armRetry(delay: number): void {
    retryDue = Date.now() + delay;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      // Same rule as the interval: a hidden tab does not poll, but still pushes
      // queued changes. The visibilitychange wake resumes syncing on return.
      if (isHidden() && queue.length === 0) return;
      void sync();
    }, delay);
  }

  function scheduleRetry(): void {
    if (!started || accessLost) return;
    const wait = Math.max(0, notBefore - Date.now());
    if (retryTimer) {
      // A later reply can ask for a longer wait than the pending timer has left.
      if (retryDue - Date.now() >= wait) return;
      clearTimeout(retryTimer);
      armRetry(wait);
      return;
    }
    retryDelay = retryDelay === 0 ? retryBaseMs : Math.min(retryDelay * 2, retryMaxMs);
    // Jitter so clients that failed together (a database restart) do not retry in
    // lockstep, then never sooner than the server asked.
    const jittered = retryDelay * (0.8 + Math.random() * 0.4);
    armRetry(Math.max(jittered, wait));
  }

  /**
   * True while the server's Retry-After holds back network work (flush, pull, the
   * interval, a wake, the debounced flush after an edit). Makes sure a timer will
   * pick the work up when the wait is over, even if a wake cleared the old one.
   */
  function throttled(): boolean {
    const wait = notBefore - Date.now();
    if (wait <= 0) return false;
    if (started && !accessLost && !retryTimer) armRetry(wait);
    return true;
  }

  function resetRetry(): void {
    retryDelay = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function isHidden(): boolean {
    return globalThis.document?.visibilityState === "hidden";
  }

  function setStatus(s: SyncStatus): void {
    if (s === "synced") {
      hasSynced = true;
      notBefore = 0;
      resetRetry();
    } else if (s === "offline" || s === "error") {
      // Without this the only retry was the 60 s interval, so recovering from an
      // outage took up to a minute after the server was back - longer behind a
      // hung request.
      scheduleRetry();
    }
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
      idAliases,
      hasSynced,
    };
  }

  // Storage writes started and not yet settled, for writesSettled().
  const pendingWrites = new Set<Promise<unknown>>();
  function tracked<T>(write: Promise<T>): Promise<T> {
    pendingWrites.add(write);
    const done = (): void => {
      pendingWrites.delete(write);
    };
    write.then(done, done);
    return write;
  }

  async function persistQueue(): Promise<void> {
    if (accessLost || closed) return;
    await tracked(opts.storage.setItem(qKey, JSON.stringify(queue)));
  }
  async function persistToken(): Promise<void> {
    if (accessLost || closed) return;
    await tracked(opts.storage.setItem(tKey, syncToken));
  }
  async function persistReplica(): Promise<void> {
    if (accessLost || closed) return;
    await tracked(opts.storage.setItem(rKey, JSON.stringify(serializeReplica(replica))));
  }

  /**
   * Mark the replica as untrustworthy and force the next sync to be a full one.
   *
   * Persisted before anything else can fail, so a rejection survives a dropped
   * connection mid-flush and a restart.
   */
  async function markNeedsFullSync(): Promise<void> {
    if (accessLost || closed) return;
    // Deliberately does NOT touch `syncToken`: `applyResponse` overwrites it
    // with the response's delta token on the very next statement, which is how
    // the first version of this fix ended up asking for a delta and never
    // recovering. `doSync` reads the flag instead, so it cannot be clobbered.
    needsFullSync = true;
    await tracked(opts.storage.setItem(nKey, "1"));
  }

  async function clearNeedsFullSync(): Promise<void> {
    needsFullSync = false;
    if (closed) return;
    await tracked(opts.storage.removeItem(nKey));
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

  /** The `task_add`s in `batch` the server filed elsewhere (contract §5.2 `relocated`). */
  function relocatedIn(batch: SyncCommand[], resp: SyncResponse): RelocatedCommand[] {
    const entries = resp.relocated ?? {};
    const out: RelocatedCommand[] = [];
    for (const command of batch) {
      const entry = entries[command.uuid];
      if (entry && Array.isArray(entry.reasons)) {
        out.push({ command, reasons: [...entry.reasons] });
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

    // Before either branch: the full-sync branch drops temp records too, and the
    // snapshot built after this call must carry the replica and the aliases together.
    if (hasMapping) {
      idAliases = { ...idAliases, ...mapping };
      rewriteCommandRefs(queue, mapping);
    }

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

    const headers = await withTimeout(
      requestTimeoutMs,
      async (signal) => {
        const send = async (): Promise<Response> => {
          const token = await opts.getAccessToken();
          return fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body,
            signal,
          });
        };
        let res = await send();
        if (res.status === 401 && opts.onAuthFail) {
          await opts.onAuthFail();
          res = await send();
        }
        return res;
      },
      () => new RequestTimeoutError(),
    );
    // The headers are in; the body gets its own, longer limit.
    const budget = bodyTimeoutMs;
    const resp = await withTimeout(
      budget,
      async () => {
        if (!headers.ok) {
          throw new HttpError(headers.status, await errorCode(headers), parseRetryAfter(headers.headers?.get("retry-after")));
        }
        return (await headers.json()) as SyncResponse;
      },
      () => {
        void headers.body?.cancel().catch(() => undefined);
        // A body that did not finish in time would not finish next time either
        // on the same link: ask for twice the time, so a large full sync lands.
        bodyTimeoutMs = Math.min(budget * 2, BODY_TIMEOUT_CAP_MS);
        return new RequestTimeoutError();
      },
    );
    bodyTimeoutMs = baseBodyTimeoutMs;
    return resp;
  }

  /** The status a failed sync leaves behind; also stores the server's Retry-After for the retry timer. */
  function failed(e: unknown): SyncStatus {
    // Only an HTTP reply can carry a Retry-After; any other failure (and a reply
    // without one) ends a wait an earlier reply asked for.
    notBefore = e instanceof HttpError && e.retryAfterMs !== null ? Date.now() + e.retryAfterMs : 0;
    return failureStatus(e);
  }

  async function loseAccess(reason: AccessLost["reason"], alsoDiscarded = 0): Promise<void> {
    if (accessLost || closed) return;
    accessLost = true;
    // The queue plus rejected commands that were already taken off it: all of
    // them are gone for good, and the notice has to say so.
    const discarded = queue.length + alsoDiscarded;
    stop();
    // Notice first, queue last: a kill in between must not leave a boot that
    // finds nothing queued and says nothing (see purgeWorkspaceData).
    await tracked(
      (async () => {
        try {
          await opts.storage.setItem(keys.lossNotice, JSON.stringify({ reason, discarded }));
        } catch {
          /* the purge still has to run */
        }
        await removeWorkspaceKeys(opts.storage, keys, false);
      })(),
    );
    queue = []; // counted above; nothing will ever send them
    setStatus("error");
    invalidate();
    if (closed) return; // closed during the purge: the user it concerned is gone
    opts.onAccessLost?.({ workspaceId: opts.workspaceId, reason, discarded });
    // The app has the count now (its handler reports before it first awaits), so
    // the safety copy has done its job.
    await tracked(opts.storage.removeItem(keys.lossNotice));
  }

  async function flush(): Promise<void> {
    if (accessLost || closed || flushing || queue.length === 0 || throttled()) return;
    flushing = true;
    setStatus("syncing");
    const rejected: RejectedCommand[] = [];
    const relocated: RelocatedCommand[] = [];
    let sentSize = 0; // size of the batch in flight, for the timeout reaction below
    const lost = await exclusive(async (): Promise<AccessLost["reason"] | null> => {
      try {
        if (accessLost || closed) return null;
        while (queue.length > 0) {
          const batch = queue.slice(0, batchSize);
          sentSize = batch.length;
          const resp = await doSync(batch);
          if (closed) return null; // stopped for good meanwhile: keep the response out of storage
          relocated.push(...relocatedIn(batch, resp));
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
          // Only a full batch says anything about the size: a flush of one command
          // would otherwise grow the batch and lift the ceiling after a few edits.
          if (batch.length >= batchSize) {
            const limit = timedOutSize === null ? maxBatch : Math.max(minBatch, timedOutSize - minBatch);
            if (batchSize < limit) {
              batchSize = Math.min(limit, batchSize + minBatch);
            } else if (timedOutSize !== null && ++okAtCap >= CEILING_PROBE_OK) {
              timedOutSize = null; // probe the size that timed out once more
              okAtCap = 0;
              batchSize = Math.min(maxBatch, batchSize + minBatch);
            }
          }
        }
        setStatus("synced");
        return null;
      } catch (e) {
        const reason = lostAccessReason(e);
        // A slow server is working through each command: send fewer. Only a push
        // shrinks the batch - a timed-out pull says nothing about its size.
        if (e instanceof RequestTimeoutError && sentSize > 0) {
          timedOutSize = sentSize;
          okAtCap = 0;
          batchSize = Math.max(minBatch, Math.floor(sentSize / 2));
        }
        if (!reason) setStatus(failed(e));
        return reason;
      } finally {
        flushing = false;
      }
    });
    if (lost) {
      await loseAccess(lost, rejected.length);
      return;
    }

    // Outside the try/finally so it runs whether the flush completed or threw.
    // A rejected command's optimistic mutation is still in the replica and there
    // is no per-command inverse, so the only cure is a full sync — which the
    // persisted flag guarantees will happen, retrying on every later sync until
    // one succeeds.

    rejectedUnreported = rejected.length;
    try {
      if (needsFullSync) await pull();
    } finally {
      rejectedUnreported = 0;
    }
    if (accessLost) return; // the recovery pull can discover the loss too
    // Closed meanwhile (logout, another user): these notices belong to a session
    // that is over and would show on the login screen or in the next user's.
    if (closed) return;
    // Rejections first; a handler with a single message slot can show only one,
    // so apps that want both queue them (see apps/*/src/lib/clients.ts).
    if (rejected.length > 0) opts.onCommandsRejected?.(rejected);
    if (relocated.length > 0) opts.onCommandsRelocated?.(relocated);
  }

  async function pull(): Promise<void> {
    if (accessLost || closed || throttled()) return;
    setStatus("syncing");
    const lost = await exclusive(async (): Promise<AccessLost["reason"] | null> => {
      if (accessLost || closed) return null;
      try {
        const resp = await doSync([]);
        if (closed) return null;
        // Nothing was sent, so everything queued is still pending.
        applyResponse(resp, queue);
        await persistToken();
        await persistReplica();
        // Only a *full* response actually replaced the replica (a delta would have
        // left the phantom in place), and only once that replacement is persisted -
        // clearing first meant a crash in between re-stranded the phantom for good.
        if (resp.full_sync) await clearNeedsFullSync();
        setStatus("synced");
        invalidate();
        return null;
      } catch (e) {
        const reason = lostAccessReason(e);
        if (!reason) setStatus(failed(e));
        return reason;
      }
    });
    if (lost) await loseAccess(lost, rejectedUnreported);
  }

  function sync(): Promise<void> {
    const run = syncOnce();
    syncs.add(run);
    const done = (): void => {
      syncs.delete(run);
    };
    run.then(done, done);
    return run;
  }

  async function syncOnce(): Promise<void> {
    if (closed) return;
    await hydrate();
    if (accessLost || closed) return;
    if (queue.length > 0) await flush();
    else await pull();
    // A rejection recorded in an earlier session (or an earlier failed attempt)
    // keeps forcing a full sync until one lands.
    if (needsFullSync && queue.length === 0) await pull();
  }

  function scheduleFlush(): void {
    if (accessLost || closed) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, debounceMs);
  }

  function mutate(input: CommandInput): MutateResult {
    const isAdd = input.type.endsWith("_add");
    const tempId = isAdd ? input.temp_id ?? `tmp-${uuid()}` : input.temp_id;
    // The workspace is gone for this user: an edit could never be saved or sent,
    // so do not show it on screen either. A no-op (rather than a throw) keeps
    // every call site safe while the app moves away.
    // A closed client is the same: it never writes again, so the edit would show
    // as saved and be lost.
    if (accessLost || closed) return { uuid: uuid(), temp_id: tempId, dropped: true };
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
    // A flush may have rewritten the replica but not yet notified React, so the
    // caller can still hold a temp id that no longer exists in the replica.
    if (Object.keys(idAliases).length) rewriteCommandRefs([cmd], idAliases);
    applyCommand(replica, cmd, ctx);
    queue.push(cmd);
    void persistQueue();
    void persistReplica();
    invalidate();
    scheduleFlush();
    return { uuid: cmd.uuid, temp_id: tempId };
  }

  function wake(): Promise<void> {
    resetRetry();
    // focus and visibilitychange both fire when a tab comes back; one sync is enough.
    if (!waking) {
      waking = sync().finally(() => {
        waking = null;
      });
    }
    return waking;
  }

  const onWake = (): void => {
    void wake();
  };
  const onVisibility = (): void => {
    if (!isHidden()) void wake();
  };
  // Contract §6.7: pull every 60 s *while visible*. Queued changes still go out
  // from a background tab - the user typed them and may close the tab next.
  const onTick = (): void => {
    if (isHidden() && queue.length === 0) return;
    void sync();
  };

  function start(): void {
    if (accessLost || closed) return;
    started = true;
    void hydrate().then(() => void sync());
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(onTick, autoSyncMs);
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("focus", onWake);
      globalThis.addEventListener("online", onWake);
    }
    globalThis.document?.addEventListener("visibilitychange", onVisibility);
  }

  function stop(): void {
    started = false;
    resetRetry();
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (typeof globalThis.removeEventListener === "function") {
      globalThis.removeEventListener("focus", onWake);
      globalThis.removeEventListener("online", onWake);
    }
    globalThis.document?.removeEventListener("visibilitychange", onVisibility);
  }

  async function idle(): Promise<void> {
    let seen: Promise<unknown>;
    do {
      seen = lane;
      await Promise.allSettled([seen, ...syncs]);
    } while (lane !== seen || syncs.size > 0);
  }

  function close(): void {
    closed = true;
    stop();
  }

  async function writesSettled(): Promise<void> {
    while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);
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
    close,
    writesSettled,
    idle,
    wake,
  };
}

function mergeInto<T extends { id: string; is_deleted: boolean }>(m: Map<string, T>, items: T[]): void {
  for (const obj of items) {
    if (obj.is_deleted) m.delete(obj.id);
    else m.set(obj.id, obj);
  }
}
