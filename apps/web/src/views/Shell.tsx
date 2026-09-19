import { useCallback, useEffect, useMemo } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { todayLocalISO, type Priority } from "@balu/domain";
import { getSync } from "../lib/clients.js";
import { applyMoveDrop, dragKind, getDragResolver, makeAnnouncements } from "../lib/drag.js";
import { useT } from "../lib/useT.js";
import { markReplaceNext, useUrlSync } from "../lib/useUrlSync.js";
import { useApp } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import { Sidebar } from "./Sidebar.js";
import { Toolbar } from "./Toolbar.js";
import { TodayView } from "./TodayView.js";
import { SimpleListView } from "./SimpleListView.js";
import { UpcomingView } from "./UpcomingView.js";
import { LogbookView } from "./LogbookView.js";
import { ProjectView } from "./ProjectView.js";
import { SettingsView } from "./SettingsView.js";
import { DetailPanel } from "./DetailPanel.js";
import { FullscreenTask } from "./FullscreenTask.js";
import { QuickAdd } from "../quickadd/QuickAdd.js";
import { CommandPalette } from "../palette/CommandPalette.js";
import { Toast } from "../components/Toast.js";

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export function Shell() {
  const snapshot = useSnapshot();
  const view = useApp((s) => s.view);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const { t } = useT();
  useUrlSync();

  // The one DndContext for the whole app (DESIGN §5). Surfaces stay dumb: they
  // register a per-kind resolver and the handlers below decide whether a drop
  // is a container move (consumed here) or the surface's own drag logic.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (!applyMoveDrop(e, snapshot)) {
        const kind = dragKind(e.active.data.current);
        if (kind) getDragResolver(kind)?.(e);
      }
    },
    [snapshot],
  );
  const announcements = useMemo(() => makeAnnouncements(snapshot, t), [snapshot, t]);

  // Global keyboard map (DESIGN §7 / plan §6).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const st = useApp.getState();
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        st.setPalette(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        st.setQuickAdd(true);
        return;
      }
      if (st.quickAddOpen || st.paletteOpen) return; // overlay owns its keys

      // The full-screen task view owns its keys too - but stays below Cmd-K/Cmd-N
      // (checked above), so QuickAdd and the palette can open on top of it.
      if (st.fullscreenTaskId) {
        if (e.key === "Escape") {
          e.preventDefault();
          st.setFullscreen(null);
        }
        return;
      }

      if (isTyping(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }

      // "/" opens the command palette (search + commands).
      if (e.key === "/") {
        e.preventDefault();
        st.setPalette(true);
        return;
      }

      const ids = st.visibleTaskIds;
      const focusedId = st.focusedIndex >= 0 && st.focusedIndex < ids.length ? ids[st.focusedIndex] : null;
      const sync = getSync();
      const update = (args: Record<string, unknown>) => focusedId && sync?.mutate({ type: "task_update", args: { id: focusedId, ...args } });

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          st.moveFocus(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          st.moveFocus(-1);
          break;
        case " ":
        case "e":
          if (focusedId) {
            e.preventDefault();
            sync?.mutate({ type: "task_complete", args: { id: focusedId } });
          }
          break;
        case "1":
        case "2":
        case "3":
          update({ priority: Number(e.key) as Priority });
          break;
        case "0":
          update({ priority: 0 });
          break;
        case "t":
          update({ start_date: todayLocalISO(), someday: false });
          break;
        case "d":
          if (focusedId) st.selectTask(focusedId, true);
          break;
        case "Enter":
          if (focusedId) {
            e.preventDefault();
            st.selectTask(focusedId);
          }
          break;
        case "n":
          e.preventDefault();
          st.setQuickAdd(true);
          break;
        case "Escape":
          if (st.selectedTaskId) st.selectTask(null);
          else st.setFocusedIndex(-1);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Deep-linked project that does not exist in this workspace's replica
  // (deleted, or the link came from another workspace): fall back to Today once
  // the server has confirmed the replica - `status === "synced"` is the only
  // such signal. Do NOT gate on syncToken: hydrate() restores it from
  // localStorage before the network round-trip, so "!== '*'" only proves a
  // local cache was loaded, and a RETURNING user's stale replica would discard
  // the deep link a frame before the delta carrying its data arrives.
  // replaceState: self-healing must not pollute Back. While offline
  // ("offline"/"error") a dangling link is deliberately kept rather than
  // healed - never discard a link on unconfirmed data; this self-heals once a
  // sync succeeds.
  useEffect(() => {
    if (view.kind !== "project" || snapshot.status !== "synced") return;
    const exists = snapshot.projects.some((p) => p.id === view.projectId && !p.is_deleted);
    if (!exists) {
      markReplaceNext();
      useApp.getState().setView({ kind: "list", list: "today" });
    }
  }, [view, snapshot]);

  let content: React.ReactNode;
  if (view.kind === "settings") content = <SettingsView snapshot={snapshot} />;
  else if (view.kind === "project") content = <ProjectView snapshot={snapshot} projectId={view.projectId} />;
  else if (view.list === "today") content = <TodayView snapshot={snapshot} />;
  else if (view.list === "upcoming") content = <UpcomingView snapshot={snapshot} />;
  else if (view.list === "logbook") content = <LogbookView snapshot={snapshot} />;
  else content = <SimpleListView snapshot={snapshot} list={view.list} />;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ announcements }}>
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "var(--bg)", overflow: "hidden" }}>
        <Sidebar snapshot={snapshot} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Toolbar snapshot={snapshot} />
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>{content}</div>
            {selectedTaskId && view.kind !== "settings" && <DetailPanel snapshot={snapshot} />}
          </div>
        </div>
        <FullscreenTask />
        <QuickAdd />
        <CommandPalette />
        <Toast />
      </div>
    </DndContext>
  );
}
