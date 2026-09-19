import { useEffect, useRef } from "react";
import type { Task } from "@balu/domain";
import { dateWithYear } from "../lib/format.js";
import { markReplaceNext } from "../lib/useUrlSync.js";
import { useT } from "../lib/useT.js";
import type { TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import { IconButton } from "../components/IconButton.js";

const PRIORITY_KEY: Record<number, TranslationKey> = { 1: "priority.p1", 2: "priority.p2", 3: "priority.p3" };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px",
        borderRadius: "var(--radius-pill)", border: "1px solid var(--border)",
        color: "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Read-only full-screen reading view for one task (/task/:id). Deliberately
 * not an editor: editing stays in DetailPanel, which remains open underneath -
 * closing this modal lands on the same task in the panel.
 */
export function FullscreenTask() {
  const fullscreenTaskId = useApp((s) => s.fullscreenTaskId);
  const setFullscreen = useApp((s) => s.setFullscreen);
  const showToast = useApp((s) => s.showToast);
  const { t, locale } = useT();
  const snapshot = useSnapshot();
  const scrollRef = useRef<HTMLDivElement>(null);

  const task: Task | undefined = snapshot.tasks.find((tk) => tk.id === fullscreenTaskId && !tk.is_deleted);

  // Self-heal a dangling /task/:id - but only once the server has confirmed
  // the replica (status === "synced"), same rule and same reasoning as
  // DetailPanel's selection heal: syncToken only proves a local cache loaded.
  // markReplaceNext: healing must not pollute Back (closing is a path change
  // and would otherwise push). The toast is not optional: a /task/:id link is
  // the shareable artifact of this feature, so "silently shows Today" is
  // indistinguishable from "the link did nothing".
  useEffect(() => {
    if (fullscreenTaskId && !task && snapshot.status === "synced") {
      showToast(t("fullscreen.notFound"));
      markReplaceNext();
      setFullscreen(null);
    }
  }, [fullscreenTaskId, task, snapshot.status, setFullscreen, showToast, t]);

  // Initial focus goes to the SCROLLER, not the dialog box. Browsers scroll the
  // nearest scrollable ancestor of the focused node; every ancestor here is
  // unscrollable (fixed backdrop, Shell root and body both overflow:hidden), so
  // focusing the box left a long description unreadable by keyboard and screen
  // reader. Escape is handled by Shell's window-level key map either way.
  useEffect(() => {
    if (fullscreenTaskId && task) scrollRef.current?.focus();
  }, [fullscreenTaskId, task?.id]);

  if (!task) return null;

  const project = task.project_id ? snapshot.projects.find((p) => p.id === task.project_id && !p.is_deleted) : undefined;
  const labels = snapshot.labels.filter((l) => !l.is_deleted && task.label_ids.includes(l.id));
  const assignee = task.assigned_to ? snapshot.members.find((m) => !m.is_deleted && m.id === task.assigned_to) : undefined;

  return (
    <div
      onMouseDown={() => setFullscreen(null)}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 45, // above DetailPanel dropdowns (41), below QuickAdd (50) and palette (60)
      }}
    >
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="balu-overlay-in"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 760, maxWidth: "92vw", maxHeight: "86vh", display: "flex", flexDirection: "column",
          background: "var(--surface-raised)", borderRadius: "var(--radius-sheet)",
          boxShadow: "var(--elevation-3)", border: "1px solid var(--border)", overflow: "hidden", outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 12px 0" }}>
          <IconButton icon="x" label={t("fullscreen.close")} onClick={() => setFullscreen(null)} />
        </div>
        <div
          ref={scrollRef}
          tabIndex={0}
          style={{ overflowY: "auto", padding: "0 32px 32px", display: "flex", flexDirection: "column", gap: 16, outline: "none" }}
        >
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)", overflowWrap: "break-word" }}>
            {task.title}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Chip>{project ? project.name : t("detail.noProject")}</Chip>
            {task.start_date && <Chip>{`${t("detail.startDate")}: ${dateWithYear(task.start_date, locale)}`}</Chip>}
            {task.deadline && <Chip>{`${t("detail.deadline")}: ${dateWithYear(task.deadline, locale)}`}</Chip>}
            {task.priority > 0 && <Chip>{t(PRIORITY_KEY[task.priority]!)}</Chip>}
            {labels.map((l) => <Chip key={l.id}>@{l.name}</Chip>)}
            {assignee && <Chip>{assignee.name}</Chip>}
          </div>
          {task.notes ? (
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", fontSize: 16, lineHeight: 1.7, color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
              {task.notes}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>{t("fullscreen.noNotes")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
