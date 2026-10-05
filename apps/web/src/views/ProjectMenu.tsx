import { PROJECT_COLORS, type Project } from "@balu/domain";
import { getSync } from "../lib/clients.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Menu, type MenuAnchor, type MenuItem } from "../components/Menu.js";

export function ProjectMenu({ project, anchor, onClose, onRename }: { project: Project; anchor: MenuAnchor; onClose: () => void; onRename: () => void }) {
  const { t } = useT();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const archived = project.archived_at != null;

  function update(args: Record<string, unknown>) {
    getSync()?.mutate({ type: "project_update", args: { id: project.id, ...args } });
    onClose();
  }

  function remove() {
    onClose();
    if (!globalThis.confirm(t("project.deleteConfirm"))) return;
    // Leave the view first: offline, Shell's self-heal waits for a confirmed
    // sync and would otherwise keep showing the deleted project's empty page.
    if (view.kind === "project" && view.projectId === project.id) setView({ kind: "list", list: "today" });
    getSync()?.mutate({ type: "project_delete", args: { id: project.id } });
  }

  const items: MenuItem[] = [
    { id: "rename", label: t("project.rename"), icon: "pencil", onSelect: () => { onClose(); onRename(); } },
    archived
      ? { id: "unarchive", label: t("project.unarchive"), icon: "archive-restore", onSelect: () => update({ archived_at: null }) }
      : { id: "archive", label: t("project.archive"), icon: "archive", onSelect: () => update({ archived_at: new Date().toISOString() }) },
    { id: "delete", label: t("project.delete"), icon: "trash-2", danger: true, onSelect: remove },
  ];

  return (
    <Menu anchor={anchor} items={items} onClose={onClose}>
      <div role="group" aria-label={t("project.color")} style={{ display: "grid", gridTemplateColumns: "repeat(6, 24px)", gap: 6, padding: "6px 10px 8px" }}>
        {PROJECT_COLORS.map((c) => {
          const selected = c === project.color;
          return (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={selected}
              onClick={() => update({ color: c })}
              style={{
                width: 24,
                height: 24,
                padding: 3,
                borderRadius: "50%",
                border: selected ? "2px solid var(--text-primary)" : "2px solid transparent",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%", background: `var(--project-${c})` }} />
            </button>
          );
        })}
      </div>
      <div style={{ height: 1, background: "var(--border)", margin: "2px 0 4px" }} />
    </Menu>
  );
}
