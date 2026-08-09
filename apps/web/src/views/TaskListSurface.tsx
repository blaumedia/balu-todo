import { Fragment, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IsoDate, Label, Locale, Member, Project, Task } from "@balu/domain";
import type { TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import { Icon } from "../components/Icon.js";
import { IconButton } from "../components/IconButton.js";
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
function DraggableRow({ task, draggable, meta, ...rest }: RowProps) {
  const selectTask = useApp((s) => s.selectTask);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...(draggable ? { ...attributes, ...listeners } : {})}>
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

/** Droppable wrapper for reschedule mode — the whole group opens as a target. */
function DroppableGroup({ groupKey, children }: { groupKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: groupKey });
  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: "var(--radius-card)",
        outline: isOver ? "2px dashed var(--accent)" : "2px dashed transparent",
        outlineOffset: 2,
        transition: "outline-color var(--duration-fast) var(--ease-standard)",
      }}
    >
      {children}
    </div>
  );
}

export function TaskListSurface({ groups, emptyLabel, showProject, projects, labels, today, locale, t, dnd, showEmptyGroups, onDeleteGroup }: TaskListSurfaceProps) {
  const focusedIndex = useApp((s) => s.focusedIndex);
  const selectTask = useApp((s) => s.selectTask);
  const setVisibleTaskIds = useApp((s) => s.setVisibleTaskIds);
  const user = useApp((s) => s.user);
  const snapshot = useSnapshot();
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Map each task id → its group key (for same-container reorder resolution).
  const groupOfTask = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const tk of g.tasks) m.set(tk.id, g.key);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const activeTask = activeId ? flat.find((tk) => tk.id === activeId) ?? null : null;
  const draggable = dnd != null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
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
          if (draggable) {
            return (
              <DraggableRow
                key={task.id}
                task={task}
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

        return (
          <Fragment key={g.key}>
            {g.header && (g.tasks.length > 0 || showEmptyGroups) && (
              <SectionHeader
                onDelete={
                  onDeleteGroup ? { action: () => onDeleteGroup(g.key), label: t("project.deleteSection") } : undefined
                }
              >
                {g.header}
              </SectionHeader>
            )}
            {dnd?.mode === "reorder" ? (
              <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
                {body}
              </SortableContext>
            ) : dnd?.mode === "reschedule" ? (
              <DroppableGroup groupKey={g.key}>{body}</DroppableGroup>
            ) : (
              body
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
        {hasAny && !dnd && rows}
        {hasAny && dnd && (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            {dnd.mode === "reschedule" ? (
              // reschedule uses per-group droppables and free draggables
              <SortableContext items={flat.map((tk) => tk.id)} strategy={verticalListSortingStrategy}>
                {rows}
              </SortableContext>
            ) : (
              rows
            )}
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
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
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </main>
  );
}
