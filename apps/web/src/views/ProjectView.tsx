import { useState } from "react";
import { todayLocalISO, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import { Icon } from "../components/Icon.js";
import { TaskListSurface, type TaskGroup } from "./TaskListSurface.js";

export function ProjectView({ snapshot, projectId }: { snapshot: Snapshot; projectId: string }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const today = todayLocalISO();
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");

  const open = snapshot.tasks.filter(
    (tk) => !tk.is_deleted && tk.completed_at == null && tk.project_id === projectId && tk.parent_task_id == null,
  );
  const bySort = (a: Task, b: Task) => a.sort_order - b.sort_order;

  const sections = snapshot.sections
    .filter((s) => !s.is_deleted && s.project_id === projectId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const groups: TaskGroup[] = [];
  groups.push({ key: "body", tasks: open.filter((tk) => tk.section_id == null).sort(bySort) });
  for (const s of sections) {
    groups.push({ key: s.id, header: s.name, tasks: open.filter((tk) => tk.section_id === s.id).sort(bySort) });
  }

  function createSection() {
    const trimmed = sectionName.trim();
    if (trimmed) getSync()?.mutate({ type: "section_add", args: { project_id: projectId, name: trimmed } });
    setSectionName("");
    setAddingSection(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <TaskListSurface
        groups={groups}
        emptyLabel={t("empty.project")}
        projects={maps.projects}
        labels={maps.labels}
        today={today}
        locale={locale}
        t={t}
      />
      <div style={{ maxWidth: "var(--content-max)", width: "100%", margin: "0 auto", padding: "0 24px 24px" }}>
        {addingSection ? (
          <input
            autoFocus
            value={sectionName}
            placeholder={t("project.sectionName")}
            onChange={(e) => setSectionName(e.target.value)}
            onBlur={createSection}
            onKeyDown={(e) => {
              if (e.key === "Enter") createSection();
              if (e.key === "Escape") {
                setSectionName("");
                setAddingSection(false);
              }
            }}
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--accent)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: 15,
              outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "var(--text-secondary-size)",
              fontFamily: "var(--font-sans)",
              padding: "6px 8px",
            }}
          >
            <Icon name="plus" size={16} />
            {t("project.addSection")}
          </button>
        )}
      </div>
    </div>
  );
}
