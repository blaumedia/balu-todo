// @balu/api-client — thin typed REST wrapper for contract §1–2 plus a token
// store with single-flight auto-refresh on 401. Framework-free.

import type {
  AuthResult,
  AuthTokens,
  Channel,
  ChannelType,
  Invite,
  InviteRole,
  Locale,
  MeResponse,
  Role,
  Theme,
  User,
  Workspace,
} from "@balu/domain";

export interface AsyncKV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ApiClientOptions {
  /** Defaults to `/api/v1` (same-origin; the server serves the SPA). */
  baseUrl?: string;
  storage: AsyncKV;
  fetch?: typeof fetch;
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
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl ?? "/api/v1";
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);

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

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail = data?.detail ?? {};
      throw new ApiError(detail.code ?? "error", detail.message ?? res.statusText, res.status);
    }
    return data as T;
  }

  function url(path: string): string {
    return `${baseUrl}${path}`;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchImpl(url(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parse<T>(res);
  }

  async function refresh(): Promise<AuthTokens> {
    if (refreshInFlight) return refreshInFlight;
    if (!refreshToken) throw new ApiError("invalid_token", "No refresh token", 401);
    refreshInFlight = (async () => {
      try {
        const res = await fetchImpl(url("/auth/refresh"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const tokens = await parse<AuthTokens>(res);
        await setTokens(tokens);
        return tokens;
      } catch (e) {
        await clearTokens();
        throw e;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  /** Authenticated request with a single 401 → refresh → retry. */
  async function authed<T>(
    path: string,
    init: RequestInit & { method: string },
  ): Promise<T> {
    const send = (token: string | null): Promise<Response> =>
      fetchImpl(url(path), {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });

    let res = await send(accessToken);
    if (res.status === 401 && refreshToken) {
      const tokens = await refresh();
      res = await send(tokens.access_token);
    }
    return parse<T>(res);
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
  };
}
