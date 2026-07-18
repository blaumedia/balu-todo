import { useEffect, useMemo, useRef, useState } from "react";
import {
  matchesList,
  searchItems,
  todayLocalISO,
  type SmartList,
  type Task,
  type Theme,
} from "@balu/domain";
import { api, getSync, teardownSync } from "../lib/clients.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp, type ViewSel } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import type { TranslationKey } from "../i18n/index.js";
import { Icon } from "../components/Icon.js";

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

const SMART_LISTS: Array<[SmartList, string, TranslationKey]> = [
  ["inbox", "inbox", "nav.inbox"],
  ["today", "star", "nav.today"],
  ["upcoming", "calendar", "nav.upcoming"],
  ["anytime", "layers", "nav.anytime"],
  ["someday", "archive", "nav.someday"],
  ["logbook", "check-circle", "nav.logbook"],
];

interface Entry {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  run: () => void;
}
interface Group {
  key: string;
  title: string;
  entries: Entry[];
}

/** Which view surfaces a given task (used when a search hit is chosen). */
function viewForTask(task: Task, today: string): ViewSel {
  if (task.completed_at != null) return { kind: "list", list: "logbook" };
  if (task.project_id) return { kind: "project", projectId: task.project_id };
  const order: SmartList[] = ["today", "upcoming", "someday", "inbox"];
  for (const list of order) if (matchesList(task, list, today)) return { kind: "list", list };
  return { kind: "list", list: "inbox" };
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setPalette = useApp((s) => s.setPalette);
  const setView = useApp((s) => s.setView);
  const setQuickAdd = useApp((s) => s.setQuickAdd);
  const selectTask = useApp((s) => s.selectTask);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const reset = useApp((s) => s.reset);
  const { t } = useT();
  const snapshot = useSnapshot();
  const writable = canWrite(useMyRole());
  const today = todayLocalISO();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after the overlay mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function close() {
    setPalette(false);
  }

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    const q = query.trim();

    if (q) {
      const results = searchItems(
        q,
        {
          tasks: snapshot.tasks.filter((tk) => !tk.is_deleted),
          projects: snapshot.projects.filter((p) => !p.is_deleted && p.archived_at == null),
          labels: snapshot.labels.filter((l) => !l.is_deleted),
        },
        24,
      );
      const taskEntries: Entry[] = [];
      const projectEntries: Entry[] = [];
      const labelEntries: Entry[] = [];
      for (const r of results) {
        if (r.kind === "task") {
          const task = snapshot.tasks.find((tk) => tk.id === r.id);
          if (!task) continue;
          taskEntries.push({
            id: `task:${r.id}`,
            icon: task.completed_at ? "check-circle" : "circle",
            label: r.text,
            run: () => {
              setView(viewForTask(task, today));
              selectTask(r.id);
              close();
            },
          });
        } else if (r.kind === "project") {
          projectEntries.push({
            id: `project:${r.id}`,
            icon: "hash",
            label: r.text,
            run: () => {
              setView({ kind: "project", projectId: r.id });
              close();
            },
          });
        } else {
          labelEntries.push({
            id: `label:${r.id}`,
            icon: "at-sign",
            label: r.text,
            run: () => {
              // Labels have no dedicated view yet — open the palette's project
              // fallback is not meaningful, so just close after selecting.
              close();
            },
          });
        }
      }
      if (taskEntries.length) out.push({ key: "tasks", title: t("palette.groupTasks"), entries: taskEntries });
      if (projectEntries.length) out.push({ key: "projects", title: t("palette.groupProjects"), entries: projectEntries });
      if (labelEntries.length) out.push({ key: "labels", title: t("palette.groupLabels"), entries: labelEntries });
    }

    // Commands (filtered by query against their label).
    const commands: Entry[] = [];
    if (writable) {
    commands.push({
      id: "cmd:newTask",
      icon: "plus",
      label: t("cmd.newTask"),
      hint: "⌘N",
      run: () => {
        close();
        setQuickAdd(true);
      },
    });
    commands.push({
      id: "cmd:newProject",
      icon: "hash",
      label: t("cmd.newProject"),
      run: () => {
        const name = globalThis.prompt(t("project.newProjectName"));
        if (name?.trim()) getSync()?.mutate({ type: "project_add", args: { name: name.trim(), color: "blue" } });
        close();
      },
    });
    }
    for (const [list, icon, key] of SMART_LISTS) {
      commands.push({
        id: `cmd:go:${list}`,
        icon,
        label: t("cmd.goto").replace("{name}", t(key)),
        run: () => {
          setView({ kind: "list", list });
          close();
        },
      });
    }
    commands.push({
      id: "cmd:theme",
      icon: theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor",
      label: t("cmd.cycleTheme"),
      run: () => {
        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]!;
        setTheme(next);
        void api.patchMe({ theme: next }).catch(() => {});
        close();
      },
    });
    commands.push({
      id: "cmd:settings",
      icon: "settings",
      label: t("cmd.settings"),
      run: () => {
        setView({ kind: "settings" });
        close();
      },
    });
    commands.push({
      id: "cmd:logout",
      icon: "log-out",
      label: t("cmd.logout"),
      run: () => {
        void api.logout().finally(() => {
          teardownSync();
          reset();
        });
        close();
      },
    });

    const ql = q.toLowerCase();
    const matched = ql ? commands.filter((c) => c.label.toLowerCase().includes(ql)) : commands;
    if (matched.length) out.push({ key: "commands", title: t("palette.groupCommands"), entries: matched });

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, snapshot, theme, today, writable]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  useEffect(() => {
    setActive((a) => (flat.length === 0 ? 0 : Math.min(a, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  let runningIndex = -1;

  return (
    <div
      onMouseDown={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.35)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 60,
      }}
    >
      <div
        className="balu-overlay-in"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 600,
          maxWidth: "92vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-sheet)",
          boxShadow: "var(--elevation-3)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="search" size={20} color="var(--text-tertiary)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: 18,
            }}
          />
        </div>

        <div ref={listRef} style={{ overflowY: "auto", padding: "6px 8px" }}>
          {flat.length === 0 && (
            <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "var(--text-secondary-size)" }}>
              {t("palette.empty")}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.4px",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                  padding: "10px 10px 4px",
                }}
              >
                {g.title}
              </div>
              {g.entries.map((entry) => {
                runningIndex += 1;
                const idx = runningIndex;
                const activeRow = idx === active;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-idx={idx}
                    onMouseMove={() => setActive(idx)}
                    onClick={entry.run}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      height: 40,
                      padding: "0 10px",
                      border: "none",
                      borderRadius: "var(--radius-control)",
                      cursor: "pointer",
                      textAlign: "left",
                      background: activeRow ? "var(--accent-wash)" : "transparent",
                      color: activeRow ? "var(--accent)" : "var(--text-primary)",
                    }}
                  >
                    <Icon name={entry.icon} size={18} color={activeRow ? "var(--accent)" : "var(--text-secondary)"} />
                    <span
                      style={{
                        flex: 1,
                        fontFamily: "var(--font-sans)",
                        fontSize: 15,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {entry.label}
                    </span>
                    {entry.hint && <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{entry.hint}</span>}
                    {activeRow && <Icon name="corner-down-left" size={15} color="var(--text-tertiary)" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface)",
            fontSize: 12,
            color: "var(--text-tertiary)",
          }}
        >
          {t("palette.hint")}
        </div>
      </div>
    </div>
  );
}
