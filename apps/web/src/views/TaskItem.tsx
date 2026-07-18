import { useState, type AnimationEvent } from "react";
import type { IsoDate, Label, Locale, Project, Task } from "@balu/domain";
import { getSync } from "../lib/clients.js";
import { relativeDate, type DateTone } from "../lib/format.js";
import type { TranslationKey } from "../i18n/index.js";
import { Checkbox } from "../components/Checkbox.js";
import { PriorityFlag } from "../components/PriorityFlag.js";
import { Icon } from "../components/Icon.js";

const DATE_TONE: Record<DateTone, string> = {
  today: "var(--accent)",
  overdue: "var(--danger)",
  future: "var(--text-secondary)",
};

export interface TaskItemProps {
  task: Task;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  showProject?: boolean;
  selected?: boolean;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  onOpen: () => void;
}

export function TaskItem({ task, projects, labels, showProject = false, selected = false, today, locale, t, onOpen }: TaskItemProps) {
  const [hover, setHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isCompleted = task.completed_at != null;
  const priority = task.priority > 0 ? (task.priority as 1 | 2 | 3) : null;

  function toggle() {
    const sync = getSync();
    if (!sync) return;
    if (isCompleted) {
      sync.mutate({ type: "task_uncomplete", args: { id: task.id } });
      return;
    }
    // Play the completion animation, then commit when the row finishes leaving.
    setLeaving(true);
  }

  function onAnimEnd(e: AnimationEvent<HTMLDivElement>) {
    if (e.animationName.startsWith("balu-row")) {
      getSync()?.mutate({ type: "task_complete", args: { id: task.id } });
    }
  }

  const project = task.project_id ? projects.get(task.project_id) : undefined;
  const start = task.start_date ? relativeDate(task.start_date, today, locale, t) : null;
  const deadline = task.deadline ? relativeDate(task.deadline, today, locale, t) : null;
  const taskLabels = task.label_ids.map((id) => labels.get(id)).filter((l): l is Label => l != null && !l.is_deleted);

  return (
    <div
      className={leaving ? "balu-leaving balu-completing" : undefined}
      onAnimationEnd={onAnimEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: "var(--row-web)",
        padding: "0 12px",
        borderRadius: "var(--radius-card)",
        cursor: "pointer",
        background: selected ? "var(--accent-wash)" : hover ? "var(--accent-hover-wash)" : "transparent",
        boxShadow: selected ? "inset 0 0 0 1.5px var(--accent)" : "none",
        transition: "background var(--duration-fast) var(--ease-standard)",
      }}
    >
      <Checkbox checked={isCompleted || leaving} priority={priority} onChange={toggle} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-body)",
              color: isCompleted ? "var(--text-tertiary)" : "var(--text-primary)",
              textDecoration: isCompleted ? "line-through" : "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {task.title}
          </span>
          {task.notes && <Icon name="align-left" size={13} color="var(--text-tertiary)" />}
          {task.recurrence && <Icon name="repeat" size={13} color="var(--text-tertiary)" />}
        </div>
        {(start || deadline || taskLabels.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "var(--text-secondary-size)", flexWrap: "wrap" }}>
            {start && (
              <span style={{ color: DATE_TONE[start.tone], display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" }}>
                <Icon name="calendar" size={13} />
                {start.text}
              </span>
            )}
            {deadline && (
              <span style={{ color: DATE_TONE[deadline.tone], display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" }}>
                <Icon name="flag" size={13} />
                {deadline.text}
              </span>
            )}
            {taskLabels.map((l) => (
              <span key={l.id} style={{ color: "var(--token-label)" }}>
                @{l.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        {priority && <PriorityFlag priority={priority} />}
        {showProject && project && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-secondary-size)", color: "var(--text-secondary)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: `var(--project-${project.color}, var(--slate-400))`, flex: "none" }} />
            {project.name}
          </span>
        )}
      </div>
    </div>
  );
}
