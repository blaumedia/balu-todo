// TypeScript types mirroring docs/api/CONTRACT.md §2–3 exactly.

export type Uuid = string;
/** Calendar date `YYYY-MM-DD`, no timezone (contract §0). */
export type IsoDate = string;
/** ISO 8601 UTC datetime with `Z` suffix. */
export type IsoDateTime = string;

export type ProjectColor =
  | "slate"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "cyan"
  | "blue"
  | "indigo"
  | "violet"
  | "pink"
  | "rose";

export type Role = "owner" | "admin" | "member" | "viewer";
export type Locale = "de" | "en";
export type Theme = "system" | "light" | "dark";
export type Priority = 0 | 1 | 2 | 3;

/** Common envelope fields on every synced object (contract §3). */
export interface SyncBase {
  id: string;
  workspace_id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  is_deleted: boolean;
}

export interface Project extends SyncBase {
  name: string;
  color: ProjectColor;
  sort_order: number;
  archived_at: IsoDateTime | null;
}

export interface Section extends SyncBase {
  project_id: string;
  name: string;
  sort_order: number;
}

export interface Task extends SyncBase {
  project_id: string | null;
  section_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string;
  start_date: IsoDate | null;
  evening: boolean;
  someday: boolean;
  deadline: IsoDate | null;
  reminder_at: IsoDateTime | null;
  recurrence: string | null;
  priority: Priority;
  label_ids: string[];
  assigned_to: string | null;
  sort_order: number;
  completed_at: IsoDateTime | null;
  completed_by: string | null;
  created_by: string;
}

export interface Label extends SyncBase {
  name: string;
  color: ProjectColor;
  sort_order: number;
}

export interface Member extends SyncBase {
  /** `id` equals the user id (contract §3.5). */
  name: string;
  email: string;
  role: Role;
}

export interface User {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  theme: Theme;
  created_at: IsoDateTime;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: IsoDateTime;
}

export interface Membership {
  workspace: Workspace;
  role: Role;
}

// ── Invites & members (contract §7) ───────────────────────────────────

/** Roles that can be granted through an invite (never `owner`). */
export type InviteRole = "admin" | "member" | "viewer";

export interface Invite {
  id: string;
  workspace_id: string;
  role: InviteRole;
  email: string | null;
  token: string;
  created_at: IsoDateTime;
  expires_at: IsoDateTime;
}

// ── Notification channels (contract §8) ───────────────────────────────

export type ChannelType = "ntfy" | "email" | "telegram";

export interface NtfyChannel {
  type: "ntfy";
  url: string;
}
export interface EmailChannel {
  type: "email";
  address: string;
}
export interface TelegramChannel {
  type: "telegram";
  chat_id: string;
}

/** A per-user external notification channel (contract §8). */
export type Channel = NtfyChannel | EmailChannel | TelegramChannel;

// ── Auth REST payloads (contract §1–2) ────────────────────────────────

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface AuthResult extends AuthTokens {
  user: User;
}

export interface MeResponse {
  user: User;
  memberships: Membership[];
}

// ── Sync protocol (contract §5) ───────────────────────────────────────

export type CommandType =
  | "project_add"
  | "project_update"
  | "project_delete"
  | "section_add"
  | "section_update"
  | "section_delete"
  | "task_add"
  | "task_update"
  | "task_move"
  | "task_complete"
  | "task_uncomplete"
  | "task_delete"
  | "task_reorder"
  | "label_add"
  | "label_update"
  | "label_delete";

/** A durable, queued command. `uuid` is the idempotency key (contract §5.1). */
export interface SyncCommand {
  type: CommandType;
  uuid: Uuid;
  temp_id?: string;
  args: Record<string, unknown>;
}

/** Input to `mutate()` — the client assigns `uuid` (and `temp_id` for adds). */
export interface CommandInput {
  type: CommandType;
  temp_id?: string;
  args: Record<string, unknown>;
}

export interface SyncRequest {
  sync_token: string;
  commands?: SyncCommand[];
}

export type CommandStatus = "ok" | { error_code: string; error: string };

export interface SyncResponse {
  sync_token: string;
  full_sync: boolean;
  sync_status: Record<string, CommandStatus>;
  temp_id_mapping: Record<string, string>;
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  labels: Label[];
  members: Member[];
}

export type SmartList =
  | "inbox"
  | "today"
  | "upcoming"
  | "anytime"
  | "someday"
  | "logbook";

export type SyncStatus = "synced" | "syncing" | "offline" | "error";
