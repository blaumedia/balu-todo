import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { selectList, todayLocalISO, type Project, type SmartList } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { spacedOrders } from "../lib/reorder.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import type { TranslationKey } from "../i18n/index.js";
import { SidebarItem } from "../components/SidebarItem.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";

const SMART: Array<[SmartList, string, TranslationKey]> = [
  ["inbox", "inbox", "nav.inbox"],
  ["today", "star", "nav.today"],
  ["upcoming", "calendar", "nav.upcoming"],
  ["anytime", "layers", "nav.anytime"],
  ["someday", "archive", "nav.someday"],
  ["logbook", "check-circle", "nav.logbook"],
];

function SortableProject({ project, active, onClick, draggable }: { project: Project; active: boolean; onClick: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      <SidebarItem projectColor={`var(--project-${project.color})`} label={project.name} active={active} onClick={onClick} />
    </div>
  );
}

export function Sidebar({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useT();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const setQuickAdd = useApp((s) => s.setQuickAdd);
  const role = useMyRole();
  const writable = canWrite(role);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const user = useApp((s) => s.user);
  const today = todayLocalISO();
  const counts: Partial<Record<SmartList, number>> = {
    inbox: selectList(snapshot.tasks, "inbox", today).length,
    today: selectList(snapshot.tasks, "today", today).length,
  };

  // "Assigned to me" surfaces only in shared workspaces (contract §4).
  const shared = snapshot.members.filter((m) => !m.is_deleted).length > 1;
  const assignedCount = shared && user ? selectList(snapshot.tasks, "assigned", today, user.id).length : 0;

  const projects = snapshot.projects
    .filter((p) => !p.is_deleted && p.archived_at == null)
    .sort((a, b) => a.sort_order - b.sort_order);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function createProject() {
    const trimmed = name.trim();
    if (trimmed) {
      const colors = ["blue", "violet", "green", "amber", "rose", "teal", "indigo", "orange"] as const;
      const color = colors[projects.length % colors.length]!;
      getSync()?.mutate({ type: "project_add", args: { name: trimmed, color } });
    }
    setName("");
    setAdding(false);
  }

  // Project reorder → per-project `project_update` sort_order (contract §5.4 has
  // no project_reorder command; sort_order patches are the sanctioned path).
  function onProjectDragEnd(e: DragEndEvent) {
    const overId = e.over ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || overId === activeId) return;
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const ordered = arrayMove(ids, from, to);
    const sync = getSync();
    if (!sync) return;
    for (const { id, sort_order } of spacedOrders(ordered)) {
      const current = projects.find((p) => p.id === id);
      if (current && current.sort_order !== sort_order) {
        sync.mutate({ type: "project_update", args: { id, sort_order } });
      }
    }
  }

  return (
    <aside
      style={{
        width: "var(--sidebar-width)",
        flex: "none",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: "18px 16px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "var(--balu-gradient)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon name="check" size={16} color="#fff" strokeWidth={3} />
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px", color: "var(--text-primary)" }}>balu</span>
      </div>

      <nav style={{ padding: "4px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {SMART.map(([id, icon, key]) => (
          <SidebarItem
            key={id}
            icon={icon}
            label={t(key)}
            count={counts[id]}
            active={view.kind === "list" && view.list === id}
            onClick={() => setView({ kind: "list", list: id })}
          />
        ))}
        {shared && (
          <SidebarItem
            icon="user-check"
            label={t("nav.assigned")}
            count={assignedCount}
            active={view.kind === "list" && view.list === "assigned"}
            onClick={() => setView({ kind: "list", list: "assigned" })}
          />
        )}
      </nav>

      <div
        style={{
          padding: "16px 20px 4px",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {t("section.projects")}
      </div>
      <nav style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
        {writable ? (
          <DndContext sensors={sensors} onDragEnd={onProjectDragEnd}>
            <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {projects.map((p) => (
                <SortableProject
                  key={p.id}
                  project={p}
                  active={view.kind === "project" && view.projectId === p.id}
                  onClick={() => setView({ kind: "project", projectId: p.id })}
                  draggable
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          projects.map((p) => (
            <SidebarItem
              key={p.id}
              projectColor={`var(--project-${p.color})`}
              label={p.name}
              active={view.kind === "project" && view.projectId === p.id}
              onClick={() => setView({ kind: "project", projectId: p.id })}
            />
          ))
        )}
        {writable &&
          (adding ? (
            <input
              autoFocus
              value={name}
              placeholder={t("project.newProjectName")}
              onChange={(e) => setName(e.target.value)}
              onBlur={createProject}
              onKeyDown={(e) => {
                if (e.key === "Enter") createProject();
                if (e.key === "Escape") {
                  setName("");
                  setAdding(false);
                }
              }}
              style={{
                height: 34,
                margin: "0 2px",
                padding: "0 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--accent)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                fontSize: 15,
                outline: "none",
              }}
            />
          ) : (
            <SidebarItem icon="plus" label={t("project.newProject")} onClick={() => setAdding(true)} />
          ))}
      </nav>

      <div style={{ marginTop: "auto", padding: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
        {writable && (
          <Button variant="secondary" icon="plus" fullWidth onClick={() => setQuickAdd(true)}>
            {t("quickadd.add")}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)", fontWeight: 400 }}>⌘N</span>
          </Button>
        )}
        <WorkspaceSwitcher />
      </div>
    </aside>
  );
}
