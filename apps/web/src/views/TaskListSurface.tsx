import { Fragment, useEffect } from "react";
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

export interface TaskListSurfaceProps {
  groups: TaskGroup[];
  emptyLabel: string;
  showProject?: boolean;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
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

export function TaskListSurface({ groups, emptyLabel, showProject, projects, labels, today, locale, t }: TaskListSurfaceProps) {
  const focusedIndex = useApp((s) => s.focusedIndex);
  const selectTask = useApp((s) => s.selectTask);
  const setVisibleTaskIds = useApp((s) => s.setVisibleTaskIds);

  const flat = groups.flatMap((g) => g.tasks);
  const idsKey = flat.map((t) => t.id).join(",");

  useEffect(() => {
    setVisibleTaskIds(flat.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const hasAny = flat.length > 0;
  let runningIndex = -1;

  return (
    <main style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "12px 24px 96px" }}>
        {!hasAny && <EmptyState label={emptyLabel} />}
        {hasAny && (
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
            {groups.map((g) => (
              <Fragment key={g.key}>
                {g.header && g.tasks.length > 0 && <SectionHeader>{g.header}</SectionHeader>}
                {g.tasks.map((task) => {
                  runningIndex += 1;
                  const selected = runningIndex === focusedIndex;
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
                })}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
