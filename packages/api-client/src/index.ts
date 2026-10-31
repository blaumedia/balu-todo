// @balu/api-client — thin typed REST wrapper for contract §1–2 plus a token
// store with single-flight auto-refresh on 401. Framework-free.

import type {
  AsyncKV,
  Attachment,
  AuthResult,
  AuthTokens,
  Channel,
  ChannelType,
  Invite,
  InviteRole,
  Locale,
  McpSettings,
  MeResponse,
  Role,
  Theme,
  User,
  Workspace,
} from "@balu/domain";
import { withTimeout } from "@balu/domain";

// Declared once in @balu/domain (D6); re-exported so existing imports keep working.
export type { AsyncKV };

export interface ApiClientOptions {
  /** Defaults to `/api/v1` (same-origin; the server serves the SPA). */
  baseUrl?: string;
  storage: AsyncKV;
  fetch?: typeof fetch;
  /** Give up on a JSON request (including a token refresh) after this long. Attachment upload/download are exempt. Default 30 000. */
  requestTimeoutMs?: number;
  /**
   * Called once when the server refuses the refresh token (401 from
   * `/auth/refresh`), right after the stored tokens were cleared: the session is
   * over and the app should show its login screen. Never called for a network
   * error, a timeout, a 5xx or a 429 - those keep the tokens.
   */
  onSessionExpired?: () => void;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const ACCESS_KEY = "balu:auth:access";
const REFRESH_KEY = "balu:auth:refresh";
const REFRESH_LOCK = "balu:auth:refresh";
/** Refresh queues of clients sharing one storage, for browsers without Web Locks. */
const chains = new WeakMap<object, Promise<unknown>>();

export interface ApiClient {
  /** Load persisted tokens into memory. Call once at boot. */
  hydrate(): Promise<void>;
  isAuthenticated(): boolean;
  getAccessToken(): string | null;

  register(body: { email: string; password: string; name: string }): Promise<AuthResult>;
  login(body: { email: string; password: string }): Promise<AuthResult>;
  refresh(): Promise<AuthTokens>;
  logout(): Promise<void>;

  getMe(): Promise<MeResponse>;
  patchMe(body: Partial<{ name: string; locale: Locale; theme: Theme }>): Promise<User>;

  createWorkspace(body: { name: string }): Promise<Workspace>;
  patchWorkspace(id: string, body: { name: string }): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  // ── Invites & members (contract §7) ─────────────────────────────────
  createInvite(workspaceId: string, body: { role: InviteRole; email?: string }): Promise<Invite>;
  listInvites(workspaceId: string): Promise<Invite[]>;
  revokeInvite(workspaceId: string, inviteId: string): Promise<void>;
  acceptInvite(token: string): Promise<Workspace>;
  updateMember(workspaceId: string, userId: string, body: { role: Role }): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;

  // ── Notification channels (contract §8) ─────────────────────────────
  getChannels(): Promise<Channel[]>;
  putChannels(channels: Channel[]): Promise<Channel[]>;
  testChannel(type: ChannelType): Promise<void>;

  // ── Attachments (contract §3.7.1) ───────────────────────────────────
  /**
   * Upload a file to a task. Online-only; the metadata comes back here and
   * again through the next sync pull.
   *
   * Takes a prepared `FormData` rather than a file, because "a file" is a
   * different object on each platform: web appends a `Blob`/`File`, React
   * Native appends `{uri, name, type}`. Build it with
   * `attachmentFormData(taskId, file)` and this stays platform-agnostic.
   *
   * Throws `ApiError` - `too_large` (413) over the server's cap, `forbidden`
   * for a viewer, `not_found` for an unknown task.
   */
  uploadAttachment(workspaceId: string, form: FormData): Promise<Attachment>;
  /**
   * Fetch an attachment's bytes with the auth header attached.
   *
   * There are no signed URLs in v1, so a thumbnail cannot be an `<img src>`
   * pointing at the endpoint - the caller fetches here and makes an object URL.
   * Mobile downloads natively instead (it needs a file on disk to share).
   */
  getAttachmentBlob(workspaceId: string, attachmentId: string): Promise<Blob>;

  // ── Remote MCP server (contract §10) ─────────────────────────
  /** Throws `not_found` when the server runs without `BALU_MCP_ENABLED`. */
  getMcpSettings(): Promise<McpSettings>;
  /** Mint a key, or replace the existing one. Never implicit - user action only. */
  generateMcpKey(): Promise<McpSettings>;
}

/**
 * Build the multipart body for `uploadAttachment`.
 *
 * `file` is whatever the platform's `FormData` accepts as a file part: a
 * `Blob`/`File` on web, a `{uri, name, type}` object on React Native. It is
 * passed straight through, so nothing here has to know which one it got.
 */
export function attachmentFormData(taskId: string, file: unknown): FormData {
  const form = new FormData();
  form.append("task_id", taskId);
  form.append("file", file as Blob);
  return form;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl ?? "/api/v1";
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.requestTimeoutMs ?? 30_000;

  function timed<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return withTimeout(timeoutMs, run, () => new ApiError("timeout", "Request timed out", 0));
  }

  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let refreshInFlight: Promise<AuthTokens> | null = null;

  async function setTokens(t: AuthTokens): Promise<void> {
    accessToken = t.access_token;
    refreshToken = t.refresh_token;
    await opts.storage.setItem(ACCESS_KEY, t.access_token);
    await opts.storage.setItem(REFRESH_KEY, t.refresh_token);
  }
  async function clearTokens(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    await opts.storage.removeItem(ACCESS_KEY);
    await opts.storage.removeItem(REFRESH_KEY);
  }

  /**
   * Turn a non-ok response into an `ApiError`.
   *
   * Tolerates a body that is not the contract envelope: a proxy answering 413
   * or 502 with HTML is exactly the case where a `SyntaxError` from `JSON.parse`
   * would replace the real status with a confusing one.
   */
  async function apiError(res: Response): Promise<ApiError> {
    let detail: { code?: string; message?: string } = {};
    try {
      const text = await res.text();
      detail = (text ? JSON.parse(text) : undefined)?.detail ?? {};
    } catch {
      /* not the envelope; fall back to the status text */
    }
    return new ApiError(detail.code ?? "error", detail.message ?? res.statusText, res.status);
  }

  async function parse<T>(res: Response): Promise<T> {
    if (!res.ok) throw await apiError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  function url(path: string): string {
    return `${baseUrl}${path}`;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    return timed(async (signal) =>
      parse<T>(
        await fetchImpl(url(path), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }),
      ),
    );
  }

  /**
   * Run `fn` while no other tab (or client on the same storage) refreshes.
   *
   * The server treats a second use of one refresh token as a replay and burns the
   * whole token family, so two tabs refreshing with the same token log both out.
   * Web Locks serialise across tabs where the browser offers them (secure
   * contexts); otherwise refreshes of clients sharing one storage object are
   * chained in this realm, and the re-read below narrows the cross-tab window.
   */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (globalThis as { navigator?: { locks?: { request<R>(n: string, cb: () => Promise<R>): Promise<R> } } })
      .navigator?.locks;
    if (locks?.request) return locks.request(REFRESH_LOCK, fn);
    const prev = chains.get(opts.storage) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(opts.storage, run.catch(() => undefined));
    return run;
  }

  async function refresh(): Promise<AuthTokens> {
    if (refreshInFlight) return refreshInFlight;
    if (!refreshToken) throw new ApiError("invalid_token", "No refresh token", 401);
    refreshInFlight = exclusive(async () => {
      try {
        // Another tab may have rotated the tokens while we waited (or before we
        // noticed our access token expired): its refresh token is the live one and
        // ours is already spent. Use what it stored instead of replaying ours.
        const storedRefresh = await opts.storage.getItem(REFRESH_KEY);
        if (storedRefresh !== refreshToken) {
          const storedAccess = await opts.storage.getItem(ACCESS_KEY);
          if (storedRefresh && storedAccess) {
            accessToken = storedAccess;
            refreshToken = storedRefresh;
            return { access_token: storedAccess, refresh_token: storedRefresh };
          }
          // Another tab ended the session (logout or a refused refresh).
          throw new ApiError("invalid_token", "Session ended in another tab", 401);
        }
        const tokens = await timed(async (signal) =>
          parse<AuthTokens>(
            await fetchImpl(url("/auth/refresh"), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ refresh_token: refreshToken }),
              signal,
            }),
          ),
        );
        await setTokens(tokens);
        return tokens;
      } catch (e) {
        // Only the server refusing the refresh token ends the session (401
        // invalid_token / token_expired). A network error, a timeout, a 5xx or a 429
        // during an outage says nothing about the token, and clearing it there logged
        // the user out of a session that was still valid.
        if (e instanceof ApiError && e.status === 401) {
          await clearTokens();
          try {
            opts.onSessionExpired?.();
          } catch {
            /* the app's hook must not replace the auth error */
          }
        }
        throw e;
      } finally {
        refreshInFlight = null;
      }
    });
    return refreshInFlight;
  }

  /**
   * Authenticated request with a single 401 → refresh → retry, returning the
   * raw `Response`.
   *
   * Split out of `authed` for the two attachment routes: one sends a
   * `FormData` body (which must NOT carry a hand-written `content-type`) and
   * the other reads bytes rather than JSON.
   */
  async function authedRaw(
    path: string,
    init: RequestInit & { method: string },
    defaultHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const send = (token: string | null): Promise<Response> =>
      fetchImpl(url(path), {
        ...init,
        headers: {
          ...defaultHeaders,
          ...(init.headers ?? {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });

    let res = await send(accessToken);
    if (res.status === 401 && refreshToken) {
      const tokens = await refresh();
      res = await send(tokens.access_token);
    }
    return res;
  }

  /** Authenticated JSON request. */
  async function authed<T>(
    path: string,
    init: RequestInit & { method: string },
  ): Promise<T> {
    return timed(async (signal) =>
      parse<T>(await authedRaw(path, { ...init, signal }, { "content-type": "application/json" })),
    );
  }

  return {
    async hydrate() {
      accessToken = await opts.storage.getItem(ACCESS_KEY);
      refreshToken = await opts.storage.getItem(REFRESH_KEY);
    },
    isAuthenticated: () => accessToken != null,
    getAccessToken: () => accessToken,

    async register(body) {
      const result = await post<AuthResult>("/auth/register", body);
      await setTokens(result);
      return result;
    },
    async login(body) {
      const result = await post<AuthResult>("/auth/login", body);
      await setTokens(result);
      return result;
    },
    refresh,
    async logout() {
      if (refreshToken) {
        try {
          await post<void>("/auth/logout", { refresh_token: refreshToken });
        } catch {
          /* best-effort */
        }
      }
      await clearTokens();
    },

    getMe: () => authed<MeResponse>("/me", { method: "GET" }),
    patchMe: (body) => authed<User>("/me", { method: "PATCH", body: JSON.stringify(body) }),

    createWorkspace: (body) => authed<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
    patchWorkspace: (id, body) =>
      authed<Workspace>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteWorkspace: (id) => authed<void>(`/workspaces/${id}`, { method: "DELETE" }),

    createInvite: (workspaceId, body) =>
      authed<{ invite: Invite }>(`/workspaces/${workspaceId}/invites`, {
        method: "POST",
        body: JSON.stringify(body),
      }).then((r) => r.invite),
    listInvites: (workspaceId) =>
      authed<{ invites: Invite[] }>(`/workspaces/${workspaceId}/invites`, { method: "GET" }).then(
        (r) => r.invites,
      ),
    revokeInvite: (workspaceId, inviteId) =>
      authed<void>(`/workspaces/${workspaceId}/invites/${inviteId}`, { method: "DELETE" }),
    acceptInvite: (token) =>
      authed<{ workspace: Workspace }>("/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      }).then((r) => r.workspace),
    updateMember: (workspaceId, userId, body) =>
      authed<void>(`/workspaces/${workspaceId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    removeMember: (workspaceId, userId) =>
      authed<void>(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }),

    getChannels: () =>
      authed<{ channels: Channel[] }>("/me/channels", { method: "GET" }).then((r) => r.channels),
    putChannels: (channels) =>
      authed<{ channels: Channel[] }>("/me/channels", {
        method: "PUT",
        body: JSON.stringify({ channels }),
      }).then((r) => r.channels),
    testChannel: (type) =>
      authed<void>("/me/channels/test", { method: "POST", body: JSON.stringify({ type }) }),

    async uploadAttachment(workspaceId, form) {
      // No `content-type` here on purpose: fetch derives
      // `multipart/form-data; boundary=…` from the FormData body, and a
      // hand-written header loses the boundary - the server then sees a body it
      // cannot parse and answers 422 for a perfectly good file.
      const res = await authedRaw(`/workspaces/${workspaceId}/attachments`, {
        method: "POST",
        body: form,
      });
      return parse<Attachment>(res);
    },

    async getAttachmentBlob(workspaceId, attachmentId) {
      const res = await authedRaw(
        `/workspaces/${workspaceId}/attachments/${attachmentId}/file`,
        { method: "GET" },
      );
      if (!res.ok) throw await apiError(res);
      return res.blob();
    },

    getMcpSettings: () => authed<McpSettings>("/me/mcp", { method: "GET" }),
    generateMcpKey: () => authed<McpSettings>("/me/mcp/key", { method: "POST" }),
  };
}
