// Optimistic client-side apply for every command in contract §5.4, including
// the documented cascades (§5.4) and recurring-complete behavior (§3.3).

import {
  nextSortOrder,
  type Comment,
  type IsoDate,
  type Label,
  type Priority,
  type Project,
  type ProjectColor,
  type Section,
  type SyncCommand,
  type Task,
} from "@balu/domain";
import { addDaysISO, diffDaysISO } from "@balu/domain";
import { nextOccurrence } from "./recurrence.js";
import type { Replica } from "./replica.js";

export interface ApplyContext {
  workspaceId: string;
  userId: string;
  /** ISO datetime "now". */
  now: () => string;
  /** Local calendar "today" (YYYY-MM-DD). */
  today: () => IsoDate;
}

type Args = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Copy present keys from `args` onto `target`, honoring patch semantics. */
function patch<T extends object>(target: T, args: Args, keys: (keyof T)[]): void {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(args, k as string)) {
      (target as Record<string, unknown>)[k as string] = args[k as string];
    }
  }
}

export function applyCommand(replica: Replica, cmd: SyncCommand, ctx: ApplyContext): void {
  const a = cmd.args ?? {};
  const now = ctx.now();
  const id = cmd.temp_id ?? str(a["id"]) ?? "";

  switch (cmd.type) {
    case "project_add": {
      const siblings = [...replica.projects.values()].filter((p) => !p.is_deleted);
      const project: Project = {
        id,
        workspace_id: ctx.workspaceId,
        name: str(a["name"]) ?? "",
        color: (str(a["color"]) as ProjectColor) ?? "slate",
        sort_order: typeof a["sort_order"] === "number" ? (a["sort_order"] as number) : nextSortOrder(siblings),
        archived_at: null,
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };
      replica.projects.set(id, project);
      break;
    }
    case "project_update": {
      const p = replica.projects.get(id);
      if (!p) break;
      patch(p, a, ["name", "color", "sort_order", "archived_at"]);
      p.updated_at = now;
      break;
    }
    case "project_delete": {
      const p = replica.projects.get(id);
      if (p) {
        p.is_deleted = true;
        p.updated_at = now;
      }
      for (const s of replica.sections.values()) {
        if (s.project_id === id) {
          s.is_deleted = true;
          s.updated_at = now;
        }
      }
      const deletedTaskIds = new Set<string>();
      for (const t of replica.tasks.values()) {
        if (t.project_id === id) {
          t.is_deleted = true;
          t.updated_at = now;
          deletedTaskIds.add(t.id);
        }
      }
      // Deleting a task cascades to its comments (§3.4) — deleting the project
      // that holds those tasks has to do the same.
      for (const c of replica.comments.values()) {
        if (deletedTaskIds.has(c.task_id) && !c.is_deleted) {
          c.is_deleted = true;
          c.updated_at = now;
        }
      }
      break;
    }
    case "section_add": {
      const projectId = str(a["project_id"]) ?? null;
      const siblings = [...replica.sections.values()].filter((s) => s.project_id === projectId && !s.is_deleted);
      const section: Section = {
        id,
        workspace_id: ctx.workspaceId,
        project_id: projectId ?? "",
        name: str(a["name"]) ?? "",
        sort_order: typeof a["sort_order"] === "number" ? (a["sort_order"] as number) : nextSortOrder(siblings),
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };
      replica.sections.set(id, section);
      break;
    }
    case "section_update": {
      const s = replica.sections.get(id);
      if (!s) break;
      patch(s, a, ["name", "sort_order"]);
      s.updated_at = now;
      break;
    }
    case "section_delete": {
      const s = replica.sections.get(id);
      if (s) {
        s.is_deleted = true;
        s.updated_at = now;
      }
      for (const t of replica.tasks.values()) {
        if (t.section_id === id) {
          t.section_id = null;
          t.updated_at = now;
        }
      }
      break;
    }
    case "task_add": {
      const someday = a["someday"] === true;
      const container = {
        project_id: (str(a["project_id"]) ?? null) as string | null,
        section_id: (str(a["section_id"]) ?? null) as string | null,
        parent_task_id: (str(a["parent_task_id"]) ?? null) as string | null,
      };
      const siblings = [...replica.tasks.values()].filter(
        (t) =>
          !t.is_deleted &&
          t.parent_task_id === container.parent_task_id &&
          t.project_id === container.project_id &&
          t.section_id === container.section_id,
      );
      const task: Task = {
        id,
        workspace_id: ctx.workspaceId,
        project_id: container.project_id,
        section_id: container.section_id,
        parent_task_id: container.parent_task_id,
        title: str(a["title"]) ?? "",
        notes: str(a["notes"]) ?? "",
        start_date: someday ? null : (str(a["start_date"]) ?? null),
        evening: a["evening"] === true,
        someday,
        deadline: (str(a["deadline"]) ?? null),
        reminder_at: (str(a["reminder_at"]) ?? null),
        recurrence: (str(a["recurrence"]) ?? null),
        priority: (typeof a["priority"] === "number" ? (a["priority"] as Priority) : 0),
        label_ids: Array.isArray(a["label_ids"]) ? (a["label_ids"] as string[]) : [],
        assigned_to: (str(a["assigned_to"]) ?? null),
        sort_order: typeof a["sort_order"] === "number" ? (a["sort_order"] as number) : nextSortOrder(siblings),
        completed_at: null,
        completed_by: null,
        created_by: ctx.userId,
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };
      replica.tasks.set(id, task);
      break;
    }
    case "task_update": {
      const t = replica.tasks.get(id);
      if (!t) break;
      patch(t, a, [
        "title", "notes", "start_date", "evening", "someday", "deadline",
        "reminder_at", "recurrence", "priority", "label_ids", "assigned_to",
      ]);
      if (t.someday) t.start_date = null; // someday ⟹ start_date null (§3.3)
      t.updated_at = now;
      break;
    }
    case "task_move": {
      const t = replica.tasks.get(id);
      if (!t) break;
      patch(t, a, ["project_id", "section_id", "parent_task_id", "sort_order"]);
      // A section always belongs to one project, so moving between projects
      // without naming a new section clears it — same as the server (I4).
      if (
        Object.prototype.hasOwnProperty.call(a, "project_id") &&
        !Object.prototype.hasOwnProperty.call(a, "section_id")
      ) {
        t.section_id = null;
      }
      t.updated_at = now;
      break;
    }
    case "task_complete": {
      const t = replica.tasks.get(id);
      if (!t) break;
      if (t.recurrence) {
        // Mirrors the server's h_task_complete exactly (contract §3.3): anchor on
        // the task's own date so the rule keeps its phase, and advance the
        // deadline directly when there is no start date.
        const today = ctx.today();
        if (t.start_date != null) {
          const from = t.start_date;
          const next = nextOccurrence(t.recurrence, from, from > today ? from : today);
          if (next) {
            const delta = diffDaysISO(from, next);
            t.start_date = next;
            if (t.deadline) t.deadline = addDaysISO(t.deadline, delta);
          }
        } else if (t.deadline != null) {
          const from = t.deadline;
          const next = nextOccurrence(t.recurrence, from, from > today ? from : today);
          if (next) t.deadline = next;
        } else {
          const next = nextOccurrence(t.recurrence, today, today);
          if (next) t.start_date = next;
        }
      } else {
        t.completed_at = now;
        t.completed_by = ctx.userId;
      }
      t.updated_at = now;
      break;
    }
    case "task_uncomplete": {
      const t = replica.tasks.get(id);
      if (!t) break;
      t.completed_at = null;
      t.completed_by = null;
      t.updated_at = now;
      break;
    }
    case "task_delete": {
      // Collect the task and its subtasks — deleting a task cascades to its
      // subtasks (contract §5.4) and to every one of their comments (§3.4).
      const deletedIds = new Set<string>([id]);
      const t = replica.tasks.get(id);
      if (t) {
        t.is_deleted = true;
        t.updated_at = now;
      }
      for (const sub of replica.tasks.values()) {
        if (sub.parent_task_id === id) {
          sub.is_deleted = true;
          sub.updated_at = now;
          deletedIds.add(sub.id);
        }
      }
      for (const c of replica.comments.values()) {
        if (deletedIds.has(c.task_id) && !c.is_deleted) {
          c.is_deleted = true;
          c.updated_at = now;
        }
      }
      break;
    }
    case "task_reorder": {
      const items = Array.isArray(a["items"]) ? (a["items"] as Array<{ id: string; sort_order: number }>) : [];
      for (const it of items) {
        const t = replica.tasks.get(it.id);
        if (t) {
          t.sort_order = it.sort_order;
          t.updated_at = now;
        }
      }
      break;
    }
    case "label_add": {
      const siblings = [...replica.labels.values()].filter((l) => !l.is_deleted);
      const label: Label = {
        id,
        workspace_id: ctx.workspaceId,
        name: str(a["name"]) ?? "",
        color: (str(a["color"]) as ProjectColor) ?? "slate",
        sort_order: typeof a["sort_order"] === "number" ? (a["sort_order"] as number) : nextSortOrder(siblings),
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };
      replica.labels.set(id, label);
      break;
    }
    case "label_update": {
      const l = replica.labels.get(id);
      if (!l) break;
      patch(l, a, ["name", "color", "sort_order"]);
      l.updated_at = now;
      break;
    }
    case "label_delete": {
      const l = replica.labels.get(id);
      if (l) {
        l.is_deleted = true;
        l.updated_at = now;
      }
      for (const t of replica.tasks.values()) {
        if (t.label_ids.includes(id)) {
          t.label_ids = t.label_ids.filter((x) => x !== id);
          t.updated_at = now;
        }
      }
      break;
    }
    case "comment_add": {
      const comment: Comment = {
        id,
        workspace_id: ctx.workspaceId,
        task_id: str(a["task_id"]) ?? "",
        author_id: ctx.userId,
        body: str(a["body"]) ?? "",
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };
      replica.comments.set(id, comment);
      break;
    }
    case "comment_update": {
      const c = replica.comments.get(id);
      if (!c) break;
      patch(c, a, ["body"]);
      c.updated_at = now;
      break;
    }
    case "comment_delete": {
      const c = replica.comments.get(id);
      if (c) {
        c.is_deleted = true;
        c.updated_at = now;
      }
      break;
    }
  }
}
