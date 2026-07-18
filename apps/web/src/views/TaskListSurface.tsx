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
import type { IsoDate, Label, Locale, Project, Task } from "@balu/domain";
import type { TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";
import { TaskItem } from "./TaskItem.js";

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

function SectionHeader({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        padding: "18px 12px 6px",
      }}
    >
      {children}
    </div>
  );
}

interface RowProps {
  task: Task;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  showProject?: boolean;
  selected: boolean;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  draggable: boolean;
}

/** A sortable/draggable wrapper around TaskItem. A 6px activation distance keeps
 *  plain clicks (open detail) working; only a real drag lifts the row. */
function DraggableRow({ task, draggable, ...rest }: RowProps) {
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

export function TaskListSurface({ groups, emptyLabel, showProject, projects, labels, today, locale, t, dnd }: TaskListSurfaceProps) {
  const focusedIndex = useApp((s) => s.focusedIndex);
  const selectTask = useApp((s) => s.selectTask);
  const setVisibleTaskIds = useApp((s) => s.setVisibleTaskIds);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const hasAny = flat.length > 0;
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
            {g.header && g.tasks.length > 0 && <SectionHeader>{g.header}</SectionHeader>}
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
