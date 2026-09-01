import { useEffect, useState } from "react";
import { todayLocalISO, type Locale, type Member, type Priority, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { timestampLabel } from "../lib/format.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import type { TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { IconButton } from "../components/IconButton.js";
import { Icon } from "../components/Icon.js";
import { AssigneeChip } from "../components/AssigneeChip.js";
import { DateField } from "./DateField.js";
import { ReminderField } from "./ReminderField.js";
import { CommentsSection } from "./Comments.js";
import { AttachmentsSection } from "./Attachments.js";

const PRIORITY_COLORS: Record<number, string> = {
  1: "var(--priority-1)",
  2: "var(--priority-2)",
  3: "var(--accent)",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 36 }}>
      <span style={{ width: 96, flex: "none", fontSize: "var(--text-secondary-size)", color: "var(--text-secondary)" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

/**
 * Read-only lifecycle line: created, last changed, and - for a finished task -
 * completed. Rendered outside the editable block on purpose: it is not a
 * control, and a viewer (whose fields are inert) must still be able to read it.
 *
 * "Changed", not "Edited": `updated_at` also moves when a task is reordered or
 * ticked (contract §5.4 task_reorder / task_complete), so "Edited" would claim
 * a content change that never happened.
 */
function MetaLine({ task, locale, t }: { task: Task; locale: Locale; t: (k: TranslationKey) => string }) {
  const nowMs = Date.now();
  const changed = task.updated_at > task.created_at; // same test as the comment "edited" marker
  const items = [`${t("detail.metaCreated")} ${timestampLabel(task.created_at, nowMs, locale)}`];
  if (changed) items.push(`${t("detail.metaChanged")} ${timestampLabel(task.updated_at, nowMs, locale)}`);
  if (task.completed_at) items.push(`${t("detail.metaCompleted")} ${timestampLabel(task.completed_at, nowMs, locale)}`);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 12, color: "var(--text-tertiary)" }}>
      {items.map((item) => (
        <span key={item} style={{ whiteSpace: "nowrap" }}>
          {item}
        </span>
      ))}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 40,
        height: 24,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        background: on ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background var(--duration-fast) var(--ease-standard)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 19 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left var(--duration-fast) var(--ease-standard)",
        }}
      />
    </button>
  );
}

/** Member picker for a task's assignee (avatar + name, "Nobody" to clear). */
function AssigneeField({
  members,
  value,
  currentUserId,
  disabled,
  t,
  onChange,
}: {
  members: Member[];
  value: string | null;
  currentUserId: string | null;
  disabled: boolean;
  t: (k: TranslationKey) => string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? members.find((m) => m.id === value) : undefined;

  const optionStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    border: "none",
    background: active ? "var(--accent-wash)" : "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
    fontSize: "var(--text-secondary-size)",
    fontFamily: "var(--font-sans)",
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: "0 10px",
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: selected ? "var(--text-primary)" : "var(--text-secondary)",
          cursor: disabled ? "default" : "pointer",
          fontSize: "var(--text-secondary-size)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {selected ? (
          <AssigneeChip name={selected.name} me={selected.id === currentUserId} size={18} />
        ) : (
          <Icon name="user-check" size={14} color="var(--text-tertiary)" />
        )}
        <span>{selected ? selected.name : t("detail.assignNobody")}</span>
        <Icon name="chevron-down" size={13} color="var(--text-tertiary)" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: 200,
              maxHeight: 260,
              overflowY: "auto",
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              boxShadow: "var(--elevation-2)",
              zIndex: 41,
              padding: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              style={optionStyle(value == null)}
            >
              <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name="x" size={13} color="var(--text-tertiary)" />
              </span>
              {t("detail.assignNobody")}
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                style={optionStyle(value === m.id)}
              >
                <AssigneeChip name={m.name} me={m.id === currentUserId} size={18} />
                {m.name}
                {m.id === currentUserId && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)" }}>{t("assign.me")}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DetailPanel({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useT();
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const focusDeadline = useApp((s) => s.focusDeadline);
  const selectTask = useApp((s) => s.selectTask);
  const currentUserId = useApp((s) => s.user?.id) ?? null;
  const writable = canWrite(useMyRole());
  const today = todayLocalISO();

  const task = snapshot.tasks.find((tk) => tk.id === selectedTaskId && !tk.is_deleted);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");

  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
  }, [task?.id, task?.title, task?.notes]);

  useEffect(() => {
    if (selectedTaskId && !task) selectTask(null);
  }, [selectedTaskId, task, selectTask]);

  if (!task) return null;

  const sync = getSync();
  const update = (args: Record<string, unknown>) => {
    if (!writable) return; // viewers are read-only (contract §2)
    sync?.mutate({ type: "task_update", args: { id: task.id, ...args } });
  };

  const projects = snapshot.projects
    .filter((p) => !p.is_deleted && p.archived_at == null)
    .sort((a, b) => a.sort_order - b.sort_order);
  const sections = snapshot.sections
    .filter((s) => !s.is_deleted && s.project_id === task.project_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const labels = snapshot.labels.filter((l) => !l.is_deleted).sort((a, b) => a.sort_order - b.sort_order);
  const members = snapshot.members
    .filter((m) => !m.is_deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
  const shared = members.length > 1; // assignment only meaningful in shared workspaces

  function toggleLabel(id: string) {
    if (!task) return;
    const next = task.label_ids.includes(id) ? task.label_ids.filter((x) => x !== id) : [...task.label_ids, id];
    update({ label_ids: next });
  }

  return (
    <aside
      className="balu-panel-in"
      style={{
        width: 380,
        flex: "none",
        height: "100%",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 12px 20px" }}>
        {writable ? (
          <IconButton icon="trash-2" label={t("detail.delete")} onClick={() => {
            sync?.mutate({ type: "task_delete", args: { id: task.id } });
            selectTask(null);
          }} />
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="users" size={13} /> {t("members.readonlyHint")}
          </span>
        )}
        <IconButton icon="x" label={t("common.cancel")} onClick={() => selectTask(null)} />
      </div>

      <div style={{ padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <input
          value={title}
          readOnly={!writable}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && update({ title: title.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: "var(--text-title)",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
          }}
        />

        <textarea
          value={notes}
          readOnly={!writable}
          placeholder={t("detail.notesPlaceholder")}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== task.notes && update({ notes })}
          rows={3}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            padding: 10,
            background: "var(--surface)",
            color: "var(--text-primary)",
            fontSize: "var(--text-secondary-size)",
            fontFamily: "var(--font-sans)",
            resize: "vertical",
            outline: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            ...(writable ? {} : { pointerEvents: "none", opacity: 0.7 }),
          }}
        >
          <Row label={t("detail.startDate")}>
            <DateField value={task.start_date} today={today} locale={locale} t={t} onChange={(v) => update({ start_date: v, ...(v ? { someday: false } : {}) })} />
          </Row>
          <Row label={t("detail.evening")}>
            <Toggle on={task.evening} onClick={() => update({ evening: !task.evening })} />
          </Row>
          <Row label={t("detail.deadline")}>
            <DateField value={task.deadline} today={today} locale={locale} t={t} asDeadline autoOpen={focusDeadline} onChange={(v) => update({ deadline: v })} />
          </Row>
          <Row label={t("detail.reminder")}>
            <ReminderField value={task.reminder_at} today={today} locale={locale} t={t} onChange={(v) => update({ reminder_at: v })} />
          </Row>
          <Row label={t("detail.priority")}>
            {[0, 1, 2, 3].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => update({ priority: p as Priority })}
                style={{
                  height: 28,
                  minWidth: 34,
                  padding: "0 8px",
                  borderRadius: "var(--radius-chip)",
                  border: "1px solid",
                  borderColor: task.priority === p ? (PRIORITY_COLORS[p] ?? "var(--accent)") : "var(--border)",
                  background: task.priority === p ? "var(--accent-wash)" : "var(--surface)",
                  color: p === 0 ? "var(--text-secondary)" : (PRIORITY_COLORS[p] ?? "var(--accent)"),
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {p === 0 ? t("priority.none") : `P${p}`}
              </button>
            ))}
          </Row>
          <Row label={t("detail.someday")}>
            <Toggle on={task.someday} onClick={() => update({ someday: !task.someday })} />
          </Row>
          <Row label={t("detail.project")}>
            <select
              value={task.project_id ?? ""}
              onChange={(e) => {
                if (!writable) return; // pointerEvents:none does not block keyboard selection
                sync?.mutate({ type: "task_move", args: { id: task.id, project_id: e.target.value || null, section_id: null } });
              }}
              style={{
                height: 32,
                padding: "0 8px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                fontSize: "var(--text-secondary-size)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <option value="">{t("detail.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Row>
          {task.project_id != null && sections.length > 0 && (
            <Row label={t("detail.section")}>
              <select
                value={task.section_id ?? ""}
                onChange={(e) => {
                  if (!writable) return; // pointerEvents:none does not block keyboard selection
                  // No project_id in the args - task_move then keeps the current
                  // project and only validates the section against it.
                  sync?.mutate({ type: "task_move", args: { id: task.id, section_id: e.target.value || null } });
                }}
                style={{
                  height: 32,
                  padding: "0 8px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-primary)",
                  fontSize: "var(--text-secondary-size)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <option value="">{t("detail.noSection")}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {shared && (
            <Row label={t("detail.assignee")}>
              <AssigneeField
                members={members}
                value={task.assigned_to}
                currentUserId={currentUserId}
                disabled={!writable}
                t={t}
                onChange={(id) => update({ assigned_to: id })}
              />
            </Row>
          )}
          {task.recurrence && (
            <Row label={t("detail.recurrence")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
                <Icon name="repeat" size={14} />
                {task.recurrence}
                <button type="button" onClick={() => update({ recurrence: null })} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>
                  <Icon name="x" size={13} />
                </button>
              </span>
            </Row>
          )}
          {labels.length > 0 && (
            <Row label={t("detail.labels")}>
              {labels.map((l) => {
                const on = task.label_ids.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    style={{
                      height: 26,
                      padding: "0 10px",
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid",
                      borderColor: on ? "var(--token-label)" : "var(--border)",
                      background: on ? "rgba(180,83,9,0.12)" : "var(--surface)",
                      color: on ? "var(--token-label)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    @{l.name}
                  </button>
                );
              })}
            </Row>
          )}
        </div>

        <MetaLine task={task} locale={locale} t={t} />

        <AttachmentsSection snapshot={snapshot} taskId={task.id} />

        <CommentsSection snapshot={snapshot} taskId={task.id} />
      </div>
    </aside>
  );
}
