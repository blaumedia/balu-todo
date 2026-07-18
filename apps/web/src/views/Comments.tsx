import { useEffect, useRef, useState } from "react";
import { commentsForTask } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { relativeTime } from "../lib/format.js";
import { canManageMembers, canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";

const bodyStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  padding: "8px 10px",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "var(--text-secondary-size)",
  fontFamily: "var(--font-sans)",
  resize: "vertical",
  outline: "none",
  lineHeight: 1.45,
};

export function CommentsSection({ snapshot, taskId }: { snapshot: Snapshot; taskId: string }) {
  const { t, locale } = useT();
  const user = useApp((s) => s.user);
  const role = useMyRole();
  const canComment = canWrite(role);
  const isAdmin = canManageMembers(role);

  const comments = commentsForTask(snapshot.comments, taskId);
  const members = new Map(snapshot.members.map((m) => [m.id, m]));
  const nowMs = Date.now();

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  function submit() {
    const body = draft.trim();
    if (!body) return;
    getSync()?.mutate({ type: "comment_add", args: { task_id: taskId, body } });
    setDraft("");
  }

  function saveEdit(id: string) {
    const body = editBody.trim();
    if (body) getSync()?.mutate({ type: "comment_update", args: { id, body } });
    setEditingId(null);
    setEditBody("");
  }

  function remove(id: string) {
    if (globalThis.confirm(t("comments.deleteConfirm"))) {
      getSync()?.mutate({ type: "comment_delete", args: { id } });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        <Icon name="message-circle" size={13} />
        {t("comments.title")}
        {comments.length > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>· {comments.length}</span>}
      </div>

      {comments.length === 0 && (
        <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("comments.empty")}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {comments.map((c) => {
          const author = members.get(c.author_id);
          const own = c.author_id === user?.id;
          const edited = c.updated_at > c.created_at;
          const editing = editingId === c.id;
          return (
            <div key={c.id} style={{ display: "flex", gap: 10 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: own ? "var(--accent-wash)" : "var(--slate-100)",
                  color: own ? "var(--accent)" : "var(--text-secondary)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: 13,
                  flex: "none",
                }}
              >
                {(author?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "var(--text-secondary-size)", fontWeight: 500, color: "var(--text-primary)" }}>
                    {author?.name ?? "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                    {relativeTime(c.created_at, nowMs, locale, t)}
                    {edited && ` · ${t("comments.edited")}`}
                  </span>
                </div>
                {editing ? (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      autoFocus
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit(c.id);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      rows={2}
                      style={bodyStyle}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => saveEdit(c.id)} style={linkBtn("var(--accent)")}>
                        {t("comments.save")}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} style={linkBtn("var(--text-tertiary)")}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 2, fontSize: "var(--text-body)", color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {c.body}
                  </div>
                )}
                {!editing && (own || isAdmin) && (
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    {own && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditBody(c.body);
                        }}
                        aria-label={t("comments.edit")}
                        style={linkBtn("var(--text-tertiary)")}
                      >
                        {t("comments.edit")}
                      </button>
                    )}
                    <button type="button" onClick={() => remove(c.id)} aria-label={t("comments.delete")} style={linkBtn("var(--text-tertiary)")}>
                      {t("comments.delete")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canComment && <Composer draft={draft} setDraft={setDraft} onSubmit={submit} placeholder={t("comments.placeholder")} hint={t("comments.hint")} sendLabel={t("comments.send")} />}
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  onSubmit,
  placeholder,
  hint,
  sendLabel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  hint: string;
  sendLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow the textarea with its content, capped so the panel stays calm.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        ref={ref}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={1}
        style={{ ...bodyStyle, minHeight: 38 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{hint}</span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!draft.trim()}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            borderRadius: "var(--radius-control)",
            border: "none",
            background: draft.trim() ? "var(--accent)" : "var(--border)",
            color: draft.trim() ? "#fff" : "var(--text-tertiary)",
            cursor: draft.trim() ? "pointer" : "default",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
          }}
        >
          <Icon name="send" size={14} color={draft.trim() ? "#fff" : "var(--text-tertiary)"} />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

function linkBtn(color: string): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color,
    fontSize: 12,
    fontFamily: "var(--font-sans)",
  };
}
