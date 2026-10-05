import { useEffect, useState } from "react";
import { type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { activeProjects, archivedProjects, reorderUpdates, selectList, todayLocalISO, type Project, type SmartList } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { dragKind, projectRowData, setDragResolver } from "../lib/drag.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import type { TranslationKey } from "../i18n/index.js";
import { SidebarItem } from "../components/SidebarItem.js";
import { Button } from "../components/Button.js";
import { IconButton } from "../components/IconButton.js";
import { Icon } from "../components/Icon.js";
import type { MenuAnchor } from "../components/Menu.js";
import { ProjectMenu } from "./ProjectMenu.js";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.js";

const SMART: Array<[SmartList, string, TranslationKey]> = [
  ["inbox", "inbox", "nav.inbox"],
  ["today", "star", "nav.today"],
  ["upcoming", "calendar", "nav.upcoming"],
  ["anytime", "layers", "nav.anytime"],
  ["someday", "archive", "nav.someday"],
  ["logbook", "check-circle", "nav.logbook"],
];

/** Touch devices have no hover, so a reveal-on-hover control would stay invisible
 *  while still being tappable. Evaluated once - the input type does not change. */
const NO_HOVER = typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(hover: none)").matches;

/** A project row with its hover-revealed "..." trigger and right-click menu. `onMenu` is absent for viewers. */
function ProjectItem({ project, active, onClick, onMenu }: { project: Project; active: boolean; onClick: () => void; onMenu?: (anchor: MenuAnchor) => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); } : undefined}
    >
      <SidebarItem
        projectColor={`var(--project-${project.color})`}
        label={project.name}
        active={active}
        onClick={onClick}
        style={onMenu ? { paddingRight: 36 } : undefined}
      />
      {onMenu && (
        <IconButton
          icon="ellipsis"
          size="sm"
          label={t("project.actions")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu({ x: r.left, y: r.bottom + 4 });
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            position: "absolute",
            right: 4,
            top: 3,
            opacity: hover || focused || NO_HOVER ? 1 : 0,
            transition: "opacity var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
          }}
        />
      )}
    </div>
  );
}

function SortableProject({ project, active, onClick, draggable, onMenu }: { project: Project; active: boolean; onClick: () => void; draggable: boolean; onMenu?: (anchor: MenuAnchor) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active: dragActive } = useSortable({
    id: project.id,
    disabled: !draggable,
    data: projectRowData(project.id),
  });
  // The same dashed-outline idiom as the task surfaces: a project row lights
  // up only for a *task* drag over it (a project reorder drag never counts).
  const isMoveTarget = isOver && dragKind(dragActive?.data.current) === "task";
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        borderRadius: "var(--radius-card)",
        outline: isMoveTarget ? "2px dashed var(--accent)" : "2px dashed transparent",
        outlineOffset: 2,
      }}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      <ProjectItem project={project} active={active} onClick={onClick} onMenu={onMenu} />
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
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ projectId: string; anchor: MenuAnchor } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const user = useApp((s) => s.user);
  const today = todayLocalISO();
  const counts: Partial<Record<SmartList, number>> = {
    inbox: selectList(snapshot.tasks, "inbox", today).length,
    today: selectList(snapshot.tasks, "today", today).length,
  };

  // "Assigned to me" surfaces only in shared workspaces (contract §4).
  const shared = snapshot.members.filter((m) => !m.is_deleted).length > 1;
  const assignedCount = shared && user ? selectList(snapshot.tasks, "assigned", today, user.id).length : 0;

  const projects = activeProjects(snapshot.projects);
  const archived = archivedProjects(snapshot.projects);

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

  function startRename(p: Project) {
    setRenameValue(p.name);
    setRenamingId(p.id);
  }

  function commitRename(p: Project) {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== p.name) getSync()?.mutate({ type: "project_update", args: { id: p.id, name: trimmed } });
    setRenamingId(null);
  }

  const openMenu = writable ? (p: Project) => (anchor: MenuAnchor) => setMenu({ projectId: p.id, anchor }) : undefined;

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
    for (const { id, sort_order } of reorderUpdates(projects, ordered)) {
      sync.mutate({ type: "project_update", args: { id, sort_order } });
    }
  }

  // Same as TaskListSurface: the handler closes over `projects` rebuilt each
  // render, so re-register every render instead of risking a stale closure.
  useEffect(() => {
    setDragResolver("project", onProjectDragEnd);
    return () => setDragResolver("project", null);
  });

  // Same input as "new project", reused for an inline rename. Rendered outside
  // the sortable wrapper on purpose: text selection inside an element carrying
  // dnd-kit listeners would start a drag.
  function renameInput(p: Project) {
    return (
      <input
        key={p.id}
        autoFocus
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => commitRename(p)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename(p);
          if (e.key === "Escape") setRenamingId(null);
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
    );
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
          <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {projects.map((p) =>
              renamingId === p.id ? (
                renameInput(p)
              ) : (
                <SortableProject
                  key={p.id}
                  project={p}
                  active={view.kind === "project" && view.projectId === p.id}
                  onClick={() => setView({ kind: "project", projectId: p.id })}
                  draggable
                  onMenu={openMenu?.(p)}
                />
              ),
            )}
          </SortableContext>
        ) : (
          projects.map((p) => (
            <ProjectItem
              key={p.id}
              project={p}
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
        {archived.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "14px 12px 4px", background: "none", border: "none", cursor: "pointer",
                fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 500, letterSpacing: "0.4px",
                textTransform: "uppercase", color: "var(--text-tertiary)", textAlign: "left",
              }}
            >
              <Icon name={showArchived ? "chevron-down" : "chevron-right"} size={12} />
              {t("project.archivedProjects")} ({archived.length})
            </button>
            {showArchived &&
              archived.map((p) =>
                renamingId === p.id ? (
                  renameInput(p)
                ) : (
                  <ProjectItem
                    key={p.id}
                    project={p}
                    active={view.kind === "project" && view.projectId === p.id}
                    onClick={() => setView({ kind: "project", projectId: p.id })}
                    onMenu={openMenu?.(p)}
                  />
                ),
              )}
          </>
        )}
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
      {menu && (() => {
        const p = snapshot.projects.find((x) => x.id === menu.projectId && !x.is_deleted);
        return p ? <ProjectMenu project={p} anchor={menu.anchor} onClose={() => setMenu(null)} onRename={() => startRename(p)} /> : null;
      })()}
    </aside>
  );
}
