import { useEffect, useRef, useState } from "react";
import type { Workspace } from "@balu/domain";
import { api, initSync } from "../lib/clients.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";

/**
 * Bottom-of-sidebar workspace chip → popover of memberships + "New workspace".
 * Switching re-instantiates the sync client for that workspace (its own
 * persisted queue/replica keys), so replicas never mix (contract §6).
 */
export function WorkspaceSwitcher() {
  const { t } = useT();
  const workspace = useApp((s) => s.workspace);
  const memberships = useApp((s) => s.memberships);
  const user = useApp((s) => s.user);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const setMemberships = useApp((s) => s.setMemberships);
  const showToast = useApp((s) => s.showToast);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!workspace || !user) return null;

  function switchTo(ws: Workspace) {
    setOpen(false);
    if (ws.id === workspace!.id) return;
    initSync(ws.id, user!.id);
    setWorkspace(ws);
  }

  async function createWorkspace() {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    try {
      const ws = await api.createWorkspace({ name: trimmed });
      // Refresh memberships so the new workspace appears in the list.
      const me = await api.getMe().catch(() => null);
      if (me) setMemberships(me.memberships);
      initSync(ws.id, user!.id);
      setWorkspace(ws);
    } catch {
      showToast(t("auth.errorGeneric"));
    } finally {
      setName("");
      setCreating(false);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("workspace.switch")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 8px",
          background: open ? "var(--accent-wash)" : "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--radius-control)",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: 13,
          fontFamily: "var(--font-sans)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flex: "none" }} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {workspace.name}
        </span>
        <Icon name="chevrons-up-down" size={15} color="var(--text-tertiary)" />
      </button>

      {open && (
        <div
          className="balu-overlay-in"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sheet)",
            boxShadow: "var(--elevation-3)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {memberships.map((m) => {
            const isActive = m.workspace.id === workspace.id;
            return (
              <button
                key={m.workspace.id}
                type="button"
                onClick={() => switchTo(m.workspace)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  background: isActive ? "var(--accent-wash)" : "transparent",
                  color: isActive ? "var(--accent)" : "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                }}
              >
                <Icon name="building-2" size={16} color={isActive ? "var(--accent)" : "var(--text-secondary)"} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.workspace.name}
                </span>
                {isActive && <Icon name="check" size={15} color="var(--accent)" />}
              </button>
            );
          })}

          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

          {creating ? (
            <input
              autoFocus
              value={name}
              placeholder={t("workspace.newName")}
              onChange={(e) => setName(e.target.value)}
              onBlur={createWorkspace}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createWorkspace();
                if (e.key === "Escape") {
                  setName("");
                  setCreating(false);
                }
              }}
              style={{
                height: 34,
                margin: "2px",
                padding: "0 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--accent)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                fontSize: 14,
                outline: "none",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--font-sans)",
                fontSize: 14,
              }}
            >
              <Icon name="plus" size={16} color="var(--text-secondary)" />
              {t("workspace.new")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
