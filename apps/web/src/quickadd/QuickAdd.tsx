import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { todayLocalISO } from "@balu/domain";
import { parseQuickAdd, type Token } from "@balu/nl-parser";
import { getSync } from "../lib/clients.js";
import { composeTaskArgs } from "../lib/quickadd.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { useSnapshot } from "../store/useSync.js";
import { Icon } from "../components/Icon.js";
import { Button } from "../components/Button.js";

const DRAFT_KEY = "balu:quickdraft";

function tokenStyle(tok: Token): CSSProperties {
  switch (tok.type) {
    case "project":
      return { color: "var(--token-project)", background: "rgba(124,58,237,0.14)" };
    case "label":
      return { color: "var(--token-label)", background: "rgba(180,83,9,0.14)" };
    case "priority":
      return tok.value === 1
        ? { color: "var(--priority-1)", background: "rgba(220,38,38,0.14)" }
        : tok.value === 2
          ? { color: "var(--priority-2)", background: "rgba(217,119,6,0.14)" }
          : { color: "var(--accent)", background: "var(--accent-wash)" };
    default:
      return { color: "var(--accent)", background: "var(--accent-wash)" };
  }
}

const SHARED_TEXT: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 20,
  lineHeight: "28px",
  letterSpacing: "normal",
  whiteSpace: "pre",
  padding: 0,
  margin: 0,
};

export function QuickAdd() {
  const open = useApp((s) => s.quickAddOpen);
  const setQuickAdd = useApp((s) => s.setQuickAdd);
  const view = useApp((s) => s.view);
  const { t, locale } = useT();
  const snapshot = useSnapshot();
  const today = todayLocalISO();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState<string>(() => globalThis.localStorage?.getItem(DRAFT_KEY) ?? "");

  useEffect(() => {
    if (open) {
      // Restore any preserved draft and focus at the end.
      const el = inputRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [open]);

  const parsed = useMemo(() => parseQuickAdd(text, { locale, referenceDate: today }), [text, locale, today]);

  function persistDraft(v: string) {
    if (v) globalThis.localStorage?.setItem(DRAFT_KEY, v);
    else globalThis.localStorage?.removeItem(DRAFT_KEY);
  }

  function close() {
    persistDraft(text); // survive accidental close
    setQuickAdd(false);
  }

  function create() {
    if (!text.trim()) return;
    const args = composeTaskArgs(text, parsed, {
      view,
      projects: snapshot.projects,
      labels: snapshot.labels,
      today,
    });
    getSync()?.mutate({ type: "task_add", args });
    setText("");
    persistDraft("");
    setQuickAdd(false);
  }

  if (!open) return null;

  // Build the highlight mirror: plain text with tinted token spans.
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  const sorted = [...parsed.tokens].sort((a, b) => a.start - b.start);
  for (const tok of sorted) {
    if (tok.start > cursor) segments.push(<span key={`p${cursor}`}>{text.slice(cursor, tok.start)}</span>);
    segments.push(
      <span key={`t${tok.start}`} style={{ ...tokenStyle(tok), borderRadius: 4, padding: "1px 0" }}>
        {text.slice(tok.start, tok.end)}
      </span>,
    );
    cursor = tok.end;
  }
  segments.push(<span key="tail">{text.slice(cursor) || "​"}</span>);

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
        paddingTop: "16vh",
        zIndex: 50,
      }}
    >
      <div
        className="balu-overlay-in"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: "92vw",
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-sheet)",
          boxShadow: "var(--elevation-3)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px" }}>
          <Icon name="plus" size={22} color="var(--accent)" style={{ marginTop: 3 }} />
          <div style={{ position: "relative", flex: 1, minHeight: 28 }}>
            <div
              aria-hidden
              style={{
                ...SHARED_TEXT,
                position: "absolute",
                inset: 0,
                color: "var(--text-primary)",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              {text ? segments : <span style={{ color: "var(--text-tertiary)" }}>{t("quickadd.placeholder")}</span>}
            </div>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                persistDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  create();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
              style={{
                ...SHARED_TEXT,
                position: "relative",
                width: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                color: "transparent",
                caretColor: "var(--text-primary)",
                resize: "none",
                overflow: "hidden",
              }}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{t("quickadd.hint")}</span>
          <div style={{ marginLeft: "auto" }}>
            <Button size="sm" icon="plus" onClick={create}>
              {t("quickadd.add")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
