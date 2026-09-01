import { Fragment, useEffect, useMemo, useState } from "react";
import {
  DragOverlay,
  useDndContext,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IsoDate, Label, Locale, Member, MoveTarget, Project, Task } from "@balu/domain";
import type { TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import { Icon } from "../components/Icon.js";
import { IconButton } from "../components/IconButton.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { dragKind, groupDropData, readDrop, setDragResolver, taskRowData } from "../lib/drag.js";
import { TaskItem } from "./TaskItem.js";

/** Per-row assignment/comment context, derived once from the replica. */
export interface RowMeta {
  members: Map<string, Member>;
  currentUserId: string | null;
  isShared: boolean;
  commentCounts: Map<string, number>;
}

export interface TaskGroup {
  key: string;
  header?: string;
  tasks: Task[];
  /** Destination for a task dragged in from another group; absent = this group is not a container (date groups, evening). */
  move?: MoveTarget;
}

/** Drag & drop behaviour for the surface (DESIGN §5). Absent = static list. */
export type DndConfig =
  | {
      mode: "reorder";
      /** Persist the new ordering of `groupKey`'s container. */
      onReorder: (groupKey: string, orderedIds: string[]) => void;
    }
  | {
      mode: "reschedule";
      /** Drop a task onto another day/week group → reschedule to that group. */
      onReschedule: (taskId: string, targetGroupKey: string) => void;
    };

export interface TaskListSurfaceProps {
  groups: TaskGroup[];
  emptyLabel: string;
  showProject?: boolean;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  dnd?: DndConfig;
  /** Keep empty groups visible, so a newly created (still empty) section shows up. */
  showEmptyGroups?: boolean;
  /** Render a delete affordance on group headers; called with the group key (= section id). */
  onDeleteGroup?: (groupKey: string) => void;
  /** Rows are drag sources (default true). The Logbook opts out: completed
   *  tasks are history, not move candidates. */
  draggable?: boolean;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--balu-gradient)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.9,
        }}
      >
        <Icon name="check" size={28} color="#fff" strokeWidth={3} />
      </span>
      <div style={{ marginTop: 16, fontSize: 18, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</div>
    </div>
  );
}

const SECTION_TEXT: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.4px",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

// Static surfaces (Today, Logbook, Assigned): rows are drag sources for moves,
// but the list has no ordering to rewrite - never open a reorder gap.
const NO_GAP: SortingStrategy = () => null;

/** Touch devices have no hover, so a reveal-on-hover control would stay invisible
 *  while still being tappable. Evaluated once - the input type does not change. */
const NO_HOVER = typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(hover: none)").matches;

/** The label is only meaningful together with the action, so they travel as a pair. */
interface SectionDelete {
  action: () => void;
  label: string;
}

function SectionHeader({ children, onDelete }: { children: string; onDelete?: SectionDelete }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);

  // No delete affordance: render exactly what every other surface renders.
  if (!onDelete) {
    return <div style={{ ...SECTION_TEXT, padding: "18px 12px 6px" }}>{children}</div>;
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 4, padding: "18px 12px 6px" }}
    >
      <div style={SECTION_TEXT}>{children}</div>
      <IconButton
        icon="trash-2"
        size="sm"
        label={onDelete.label}
        onClick={onDelete.action}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          // The 28px button would otherwise push the caption down; negative
          // margin keeps the header's text geometry identical to the plain one.
          margin: "-8px 0",
          opacity: hover || focused || NO_HOVER ? 1 : 0,
          transition:
            "opacity var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
        }}
      />
    </div>
  );
}

interface RowProps {
  task: Task;
  groupKey: string;
  move?: MoveTarget;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  meta: RowMeta;
  showProject?: boolean;
  selected: boolean;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  draggable: boolean;
}

/** A sortable/draggable wrapper around TaskItem. A 6px activation distance keeps
 *  plain clicks (open detail) working; only a real drag lifts the row. */
function DraggableRow({ task, groupKey, move, draggable, meta, ...rest }: RowProps) {
  const selectTask = useApp((s) => s.selectTask);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
    data: taskRowData(task.id, groupKey, { project_id: task.project_id, section_id: task.section_id }, move),
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(
        draggable
          ? {
              ...attributes,
              ...listeners,
              // dnd-kit's attributes advertise a keyboard-activatable button
              // (role "button", tabIndex 0, described-by instructions, a
              // "draggable" roledescription, aria-disabled and aria-pressed
              // while the row is dragged). This app has a PointerSensor only
              // - no KeyboardSensor - so strip the whole activation contract
              // here, in the one place every surface spreads it. The row keeps
              // the plain TaskItem a11y contract (no role, not in the tab
              // order, as the non-draggable branch renders); pointer drag
              // still activates via the listeners above.
              role: undefined,
              tabIndex: undefined,
              "aria-disabled": undefined,
              "aria-pressed": undefined,
              "aria-roledescription": undefined,
              "aria-describedby": undefined,
            }
          : {}
      )}
    >
      <TaskItem
        task={task}
        projects={rest.projects}
        labels={rest.labels}
        members={meta.members}
        currentUserId={meta.currentUserId}
        isShared={meta.isShared}
        commentCount={meta.commentCounts.get(task.id) ?? 0}
        showProject={rest.showProject}
        selected={rest.selected}
        today={rest.today}
        locale={rest.locale}
        t={rest.t}
        onOpen={() => selectTask(task.id)}
      />
    </div>
  );
}

/** Droppable wrapper for reschedule mode - the whole group opens as a target. */
function DroppableGroup({ groupKey, children }: { groupKey: string; children: React.ReactNode }) {
  const { active, isOver, over, setNodeRef } = useDroppable({ id: groupKey });
  // The highlight follows the current over state, not only this wrapper: a
  // child task row (or the group's own id) usually wins collision detection
  // over the wrapper. A row belongs to the group when the over payload's
  // groupKey matches (taskRowData carries it; the group's own id has no
  // payload, so its own isOver is OR'd in).
  const isTaskDrag = dragKind(active?.data.current) === "task";
  const overDrop = readDrop(over?.data.current);
  const overBelongsHere = overDrop != null && overDrop.groupKey === groupKey;
  const isTarget = isTaskDrag && (isOver || overBelongsHere);
  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: "var(--radius-card)",
        outline: isTarget ? "2px dashed var(--accent)" : "2px dashed transparent",
        outlineOffset: 2,
        transition: "outline-color var(--duration-fast) var(--ease-standard)",
      }}
    >
      {children}
    </div>
  );
}

/** Drop zone for a group that is also a move target (project body, section,
 *  Anytime project groups). Highlights for any task drag over it - same-group
 *  and no-op drops included: the zone still lights up when a task from its own
 *  group is dragged over it. Move-enabled groups render their section header
 *  inside the zone (the caller decides), so an empty section has real
 *  header-height geometry from drag start - no mid-drag layout shift, and the
 *  title bar itself is a valid drop target. */
function GroupDropZone({ groupKey, move, header, children }: { groupKey: string; move?: MoveTarget; header?: React.ReactNode; children: React.ReactNode }) {
  const { active, isOver, over, setNodeRef } = useDroppable({ id: `group:${groupKey}`, data: groupDropData(groupKey, move) });
  // The highlight follows the current over state, not only this wrapper: a
  // child task row (or the zone's own id) usually wins collision detection
  // over the wrapper. A row belongs to the group when the over payload's
  // groupKey matches (taskRowData and groupDropData both carry it). A
  // sidebar project row belongs to the project-body zone whose group key is
  // that project's id (the Anytime list keys its groups by project).
  const isTaskDrag = dragKind(active?.data.current) === "task";
  const overDrop = readDrop(over?.data.current);
  const overBelongsHere =
    overDrop != null &&
    ((overDrop.groupKey != null && overDrop.groupKey === groupKey) ||
      (overDrop.type === "project" && overDrop.projectId === groupKey && move != null && move.section_id == null));
  const isTarget = isTaskDrag && move != null && (isOver || overBelongsHere);
  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: "var(--radius-card)",
        outline: isTarget ? "2px dashed var(--accent)" : "2px dashed transparent",
        outlineOffset: 2,
        transition: "outline-color var(--duration-fast) var(--ease-standard)",
      }}
    >
      {header}
      {children}
    </div>
  );
}

export function TaskListSurface({ groups, emptyLabel, showProject, projects, labels, today, locale, t, dnd, showEmptyGroups, onDeleteGroup, draggable = true }: TaskListSurfaceProps) {
  const focusedIndex = useApp((s) => s.focusedIndex);
  const selectTask = useApp((s) => s.selectTask);
  const setVisibleTaskIds = useApp((s) => s.setVisibleTaskIds);
  const user = useApp((s) => s.user);
  const snapshot = useSnapshot();
  // The role hook must run unconditionally (hook order may not depend on
  // props); the combined flag further down applies the surface opt-out to it.
  const role = useMyRole();
  // The active drag comes from the ambient DndContext (Shell); a project drag
  // resolves to null here, so the overlay stays task-only.
  const { active } = useDndContext();

  // Assignment + comment context, derived once per snapshot for every row.
  const meta = useMemo<RowMeta>(() => {
    const members = new Map(snapshot.members.filter((m) => !m.is_deleted).map((m) => [m.id, m]));
    const commentCounts = new Map<string, number>();
    for (const c of snapshot.comments) {
      if (!c.is_deleted) commentCounts.set(c.task_id, (commentCounts.get(c.task_id) ?? 0) + 1);
    }
    return { members, currentUserId: user?.id ?? null, isShared: members.size > 1, commentCounts };
  }, [snapshot.members, snapshot.comments, user?.id]);

  const flat = groups.flatMap((g) => g.tasks);
  const idsKey = flat.map((t) => t.id).join(",");

  useEffect(() => {
    setVisibleTaskIds(flat.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Map each task id → its group key (for same-container reorder resolution).
  const groupOfTask = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const tk of g.tasks) m.set(tk.id, g.key);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const activeTask = active ? flat.find((tk) => tk.id === active.id) ?? null : null;
  // Rows are draggable whenever the user may write and the surface has not
  // opted out (`draggable` - the Logbook: completed tasks are history, not
  // move sources) - not only when this surface has its own drag mode -
  // because a row can also be lifted to move it into another container
  // (project body, section). Viewers stay read-only.
  const rowsDraggable = draggable && canWrite(role);

  function onDragEnd(e: DragEndEvent) {
    if (!dnd) return;
    const activeTaskId = String(e.active.id);
    const over = e.over;
    if (!over) return;

    if (dnd.mode === "reschedule") {
      // over.id is either another task (map to its group) or a group key.
      const overId = String(over.id);
      const targetGroup = groupOfTask.has(overId) ? groupOfTask.get(overId)! : overId;
      if (groupOfTask.get(activeTaskId) !== targetGroup) dnd.onReschedule(activeTaskId, targetGroup);
      return;
    }

    // reorder: only within the same container.
    const overId = String(over.id);
    const fromGroup = groupOfTask.get(activeTaskId);
    const toGroup = groupOfTask.get(overId);
    if (!fromGroup || fromGroup !== toGroup || activeTaskId === overId) return;
    const group = groups.find((g) => g.key === fromGroup);
    if (!group) return;
    const ids = group.tasks.map((tk) => tk.id);
    const from = ids.indexOf(activeTaskId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    dnd.onReorder(fromGroup, arrayMove(ids, from, to));
  }

  // The handler closes over `groups`/`dnd` rebuilt each render, so re-register
  // every render instead of risking a stale closure. It stays the complement of
  // the move path: cross-container drops are consumed before we get here.
  useEffect(() => {
    setDragResolver("task", onDragEnd);
    return () => setDragResolver("task", null);
  });

  // With showEmptyGroups the headers alone are worth rendering, so an empty
  // project still shows its sections. Zero tasks and zero headers stays empty.
  const hasAny = flat.length > 0 || (showEmptyGroups === true && groups.some((g) => g.header));
  let runningIndex = -1;

  const rows = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--elevation-1)",
        border: "1px solid var(--border)",
        padding: "6px 8px",
      }}
    >
      {groups.map((g) => {
        const groupIds = g.tasks.map((tk) => tk.id);
        const body = g.tasks.map((task) => {
          runningIndex += 1;
          const selected = runningIndex === focusedIndex;
          if (rowsDraggable) {
            return (
              <DraggableRow
                key={task.id}
                task={task}
                groupKey={g.key}
                move={g.move}
                projects={projects}
                labels={labels}
                meta={meta}
                showProject={showProject}
                selected={selected}
                today={today}
                locale={locale}
                t={t}
                draggable
              />
            );
          }
          return (
            <TaskItem
              key={task.id}
              task={task}
              projects={projects}
              labels={labels}
              members={meta.members}
              currentUserId={meta.currentUserId}
              isShared={meta.isShared}
              commentCount={meta.commentCounts.get(task.id) ?? 0}
              showProject={showProject}
              selected={selected}
              today={today}
              locale={locale}
              t={t}
              onOpen={() => selectTask(task.id)}
            />
          );
        });

        const header = g.header && (g.tasks.length > 0 || showEmptyGroups) ? (
          <SectionHeader
            onDelete={
              onDeleteGroup ? { action: () => onDeleteGroup(g.key), label: t("project.deleteSection") } : undefined
            }
          >
            {g.header}
          </SectionHeader>
        ) : null;

        // Empty containers still accept drops: the sidebar project row covers
        // an empty project body; the header-in-zone below covers an empty
        // section (a zero-height zone is not a droppable).
        return (
          <Fragment key={g.key}>
            {dnd?.mode === "reschedule" ? (
              <>
                {header}
                <DroppableGroup groupKey={g.key}>{body}</DroppableGroup>
              </>
            ) : (
              // Move-enabled groups keep their header inside the zone, so an
              // empty section has real geometry from drag start (no layout
              // shift) and the title bar itself is a valid drop target.
              // Groups without a move keep the header outside, as before.
              <>
                {g.move == null ? header : null}
                <GroupDropZone groupKey={g.key} move={g.move} header={g.move != null ? header : null}>
                  <SortableContext items={groupIds} strategy={dnd?.mode === "reorder" ? verticalListSortingStrategy : NO_GAP}>
                    {body}
                  </SortableContext>
                </GroupDropZone>
              </>
            )}
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <main style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "12px 24px 96px" }}>
        {!hasAny && <EmptyState label={emptyLabel} />}
        {hasAny && (dnd?.mode === "reschedule" ? (
          // reschedule uses per-group droppables and free draggables
          <SortableContext items={flat.map((tk) => tk.id)} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        ) : (
          rows
        ))}
        {hasAny && rowsDraggable && activeTask && (
          <DragOverlay dropAnimation={null}>
            <div
              className="balu-drag-lift"
              style={{
                background: "var(--surface)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--elevation-3)",
                border: "1px solid var(--border)",
                padding: "0 8px",
              }}
            >
              <TaskItem
                task={activeTask}
                projects={projects}
                labels={labels}
                members={meta.members}
                currentUserId={meta.currentUserId}
                isShared={meta.isShared}
                commentCount={meta.commentCounts.get(activeTask.id) ?? 0}
                showProject={showProject}
                selected={false}
                today={today}
                locale={locale}
                t={t}
                onOpen={() => {}}
              />
            </div>
          </DragOverlay>
        )}
      </div>
    </main>
  );
}
