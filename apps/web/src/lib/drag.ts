// Shared drag & drop vocabulary for the app's single DndContext (DESIGN §5).
//
// The context lives in Shell; each surface registers a resolver for its own
// drag kind while mounted. Only one task surface and one project list are
// mounted at a time, so the registry is a plain module singleton (the
// clients.ts pattern), not zustand state.
//
// Two things travel through dnd-kit `data`: the drag's identity (`baluDrag`)
// and, on droppables, what a drop onto them means (`baluDrop`). Reading them
// back goes through `read*` so the payload shape stays in one place.

import type { Announcements, Data, DragEndEvent } from "@dnd-kit/core";
import { moveTaskArgs, type MoveTarget, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import type { TranslationKey } from "../i18n/index.js";
import { makeT } from "../i18n/index.js";
import { getSync } from "./clients.js";
import { useApp } from "../store/app.js";

export interface TaskDrag {
  kind: "task";
  taskId: string;
  groupKey: string;
  /** The task's container when the payload was built - the row's pre-move state. */
  origin: Pick<Task, "project_id" | "section_id">;
}
export interface ProjectDrag {
  kind: "project";
  projectId: string;
}
export interface DropInfo {
  type: "taskRow" | "group" | "project";
  groupKey?: string;
  taskId?: string;
  projectId?: string;
  move?: MoveTarget;
}

/** dnd-kit payload for a task row: draggable (in its group) and droppable. */
export const taskRowData = (
  taskId: string,
  groupKey: string,
  origin: TaskDrag["origin"],
  move?: MoveTarget,
) => ({
  baluDrag: { kind: "task" as const, taskId, groupKey, origin } satisfies TaskDrag,
  baluDrop: { type: "taskRow" as const, groupKey, taskId, move } satisfies DropInfo,
});
/** dnd-kit payload for a group droppable (reschedule target or move target). */
export const groupDropData = (groupKey: string, move?: MoveTarget) => ({
  baluDrop: { type: "group" as const, groupKey, move } satisfies DropInfo,
});
/** dnd-kit payload for a sidebar project row: draggable and a move target. */
export const projectRowData = (projectId: string) => ({
  baluDrag: { kind: "project" as const, projectId } satisfies ProjectDrag,
  baluDrop: { type: "project" as const, projectId } satisfies DropInfo,
});

/** The active task drag, if the drag is a task drag (else null). */
export function readDrag(data: Data | undefined): TaskDrag | null {
  const drag = data?.baluDrag;
  return drag && drag.kind === "task" ? (drag as TaskDrag) : null;
}
/** The active project drag, if the drag is a project drag (else null). */
export function readProjectDrag(data: Data | undefined): ProjectDrag | null {
  const drag = data?.baluDrag;
  return drag && drag.kind === "project" ? (drag as ProjectDrag) : null;
}
/** What a drop onto this node means, if it carries a drop payload (else null). */
export function readDrop(data: Data | undefined): DropInfo | null {
  const drop = data?.baluDrop;
  return drop == null ? null : (drop as DropInfo);
}

/** The destination if this drop means "move", else null (= let the surface handle it). */
export function moveTargetFor(drag: TaskDrag, drop: DropInfo | null): MoveTarget | null {
  if (!drop) return null;
  if (drop.type === "project") return { project_id: drop.projectId ?? null, section_id: null };
  // A group only counts when it is a container (carries `move`) AND it is a
  // *different* group. The groupKey rule is the "only when the group actually
  // changed" rule the existing reschedule branch uses (TaskListSurface
  // onDragEnd), and it keeps a drop inside a task's own group from silently
  // clearing a section: e.g. Anytime list groups ARE projects, so dropping a
  // section task back onto its own project's group must reorder, not
  // de-section.
  if (drop.move && drop.groupKey !== drag.groupKey) return drop.move;
  return null;
}

/**
 * Whether a move-target drop actually moves the task. A drop onto the task's
 * own project's sidebar row resolves to its project body, which would read as
 * a "clear the section" move - but the row names the project, not its body,
 * so it is a consumed no-op instead. (The drop type is what tells the two
 * apart: the same origin/target pair over the project's *body group* in a
 * project view IS a real de-sectioning move.) Every other container drop
 * moves the task unless it is already in exactly that container (the null
 * rule of moveTaskArgs).
 */
export function isNoOpMove(drag: TaskDrag, drop: DropInfo | null, target: MoveTarget): boolean {
  if (drop != null && drop.type === "project" && target.project_id === drag.origin.project_id) return true;
  return drag.origin.project_id === target.project_id && drag.origin.section_id === target.section_id;
}

/**
 * Pre-flight for a move drop: the dragged task and the resolved container
 * must both still exist in the snapshot and not be soft-deleted. A queued
 * drop can name a container that no longer exists (an offline gap, or a
 * delete while the drag was in flight), and the task itself can be deleted
 * by a concurrent pull while the drag is in flight. applyMoveDrop and
 * makeAnnouncements share this predicate so a refused drop is the specific
 * toast plus a neutral "dropped" announcement - never a queued server
 * rejection or a "moved to <gone target>".
 */
export function isStaleMove(drag: TaskDrag, target: MoveTarget, snapshot: Snapshot): boolean {
  const task = snapshot.tasks.find((t) => t.id === drag.taskId);
  return (
    task == null ||
    task.is_deleted ||
    (target.section_id != null && !snapshot.sections.some((s) => s.id === target.section_id && !s.is_deleted)) ||
    (target.project_id != null && !snapshot.projects.some((p) => p.id === target.project_id && !p.is_deleted))
  );
}

/** Emit the move. False when the drop was not a container move at all. */
export function applyMoveDrop(e: DragEndEvent, snapshot: Snapshot): boolean {
  const drag = readDrag(e.active.data.current);
  if (!drag) return false;
  const drop = readDrop(e.over?.data.current);
  const target = moveTargetFor(drag, drop);
  if (!target) return false; // fall through to the surface handler
  // Consumed no-ops (same-project sidebar drop, task already in the
  // container) send nothing.
  if (isNoOpMove(drag, drop, target)) return true;
  // Pre-flight: refuse a stale drop here instead of letting the server
  // reject the move and force a full workspace re-pull with a generic
  // toast (isStaleMove covers the cases).
  if (isStaleMove(drag, target, snapshot)) {
    console.warn("balu: task or drop target no longer exists, move skipped", { taskId: drag.taskId, target });
    const { locale, showToast } = useApp.getState();
    showToast(makeT(locale)("dnd.staleTarget"));
    return true;
  }
  const task = snapshot.tasks.find((t) => t.id === drag.taskId)!;
  const args = moveTaskArgs(task, target, snapshot.tasks);
  if (args) getSync()?.mutate({ type: "task_move", args: { ...args } });
  // Consumed even when args === null (the live task already reached the
  // target, e.g. via another device): if it fell through in
  // UpcomingView, the reschedule branch would take a project UUID as a date
  // (groupKeyToDate) and queue a task_update with a garbage date, which the
  // server rejects - dropping the replica and toasting sync.rejected.
  return true;
}

// ── Per-kind resolution registry ───────────────────────────────────────
// Surfaces that keep their own drag logic (project reorder, same-group
// reorder/reschedule) register a handler for their kind; Shell calls the
// resolver only when a move drop did not consume the event.

export type DragKind = "task" | "project";
type Resolver = (e: DragEndEvent) => void;
const resolvers = new Map<DragKind, Resolver>();

export function setDragResolver(kind: DragKind, r: Resolver | null): void {
  if (r) resolvers.set(kind, r);
  else resolvers.delete(kind);
}
export function getDragResolver(kind: DragKind): Resolver | undefined {
  return resolvers.get(kind);
}
/** The active drag's kind, from its payload (null when it carries none). */
export function dragKind(data: Data | undefined): DragKind | null {
  const kind = data?.baluDrag?.kind;
  return kind === "task" || kind === "project" ? kind : null;
}

// ── Screen-reader announcements ────────────────────────────────────────
// dnd-kit's defaults read out raw UUIDs in English; now that a drop can move
// a task, announce real names instead.

/** A human name for a move destination, or null when it cannot be resolved. */
export function targetName(target: MoveTarget | null, snapshot: Snapshot, t: (k: TranslationKey) => string): string | null {
  if (target == null) return null;
  if (target.section_id != null) {
    return snapshot.sections.find((s) => s.id === target.section_id)?.name ?? null;
  }
  if (target.project_id != null) {
    return snapshot.projects.find((p) => p.id === target.project_id)?.name ?? null;
  }
  return t("detail.noProject");
}

export function makeAnnouncements(snapshot: Snapshot, t: (k: TranslationKey) => string): Announcements {
  const title = (id: unknown) => snapshot.tasks.find((tk) => tk.id === String(id))?.title ?? "";
  const projectName = (id: unknown) => snapshot.projects.find((p) => p.id === String(id))?.name ?? "";
  const destination = (active: { data: { current: Data | undefined } }, over: { data: { current: Data | undefined } } | null) => {
    const drag = readDrag(active.data.current);
    return drag ? moveTargetFor(drag, readDrop(over?.data.current)) : null;
  };
  return {
    onDragStart({ active }) {
      // A project drag reorders the sidebar, not a task - the task title
      // lookup would come up empty for a project id.
      if (readProjectDrag(active.data.current)) return t("dnd.projectPickedUp").replace("{name}", projectName(active.id));
      return t("dnd.pickedUp").replace("{title}", title(active.id));
    },
    onDragOver({ active, over }) {
      const name = targetName(destination(active, over), snapshot, t);
      if (name != null) return t("dnd.overTarget").replace("{target}", name);
      return over ? t("dnd.overGeneric") : undefined;
    },
    onDragEnd({ active, over }) {
      if (readProjectDrag(active.data.current)) return t("dnd.projectDropped");
      const drag = readDrag(active.data.current);
      if (drag == null) return t("dnd.dropped");
      const drop = readDrop(over?.data.current);
      const target = moveTargetFor(drag, drop);
      if (target == null) return t("dnd.dropped");
      // A no-op move (same-project sidebar drop, task already in this
      // container) is consumed but changes nothing, so it announces as a
      // plain drop instead of a move. Same rule as applyMoveDrop, same origin
      // source: the container captured in the drag payload (pre-move), not a
      // task lookup - the optimistic mutation from the drop may already have
      // run, and the live task would then reflect the destination,
      // misclassifying a real move as a no-op.
      if (isNoOpMove(drag, drop, target)) return t("dnd.dropped");
      // Same stale check as applyMoveDrop (shared predicate): a stale drop
      // is refused there with the specific toast, so it announces as a
      // plain drop instead of "moved to <gone target>".
      if (isStaleMove(drag, target, snapshot)) return t("dnd.dropped");
      const name = targetName(target, snapshot, t);
      if (name != null) return t("dnd.droppedTarget").replace("{target}", name);
      return t("dnd.dropped");
    },
    onDragCancel() {
      return t("dnd.cancelled");
    },
  };
}
