import { useEffect, useRef, useState } from "react";
import type { IsoDate, Locale } from "@balu/domain";
import { parseQuickAdd } from "@balu/nl-parser";
import { relativeDate, type DateTone } from "../lib/format.js";
import type { TranslationKey } from "../i18n/index.js";
import { Icon } from "../components/Icon.js";

const TONE: Record<DateTone, string> = {
  today: "var(--accent)",
  overdue: "var(--danger)",
  future: "var(--text-primary)",
};

export interface DateFieldProps {
  value: IsoDate | null;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  onChange: (value: IsoDate | null) => void;
  autoOpen?: boolean;
  /** When true, a bare date parses to a deadline rather than a start date. */
  asDeadline?: boolean;
}

export function DateField({ value, today, locale, t, onChange, autoOpen = false, asDeadline = false }: DateFieldProps) {
  const [open, setOpen] = useState(autoOpen);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function commitText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const r = parseQuickAdd(trimmed, { locale, referenceDate: today });
    const iso = asDeadline ? (r.deadline ?? r.startDate) : (r.startDate ?? r.deadline);
    if (iso) {
      onChange(iso);
      setText("");
      setOpen(false);
    }
  }

  const rel = value ? relativeDate(value, today, locale, t) : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: "0 10px",
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: rel ? TONE[rel.tone] : "var(--text-tertiary)",
          cursor: "pointer",
          fontSize: "var(--text-secondary-size)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <Icon name={asDeadline ? "flag" : "calendar"} size={15} />
        {rel ? rel.text : t("detail.datePlaceholder")}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 40,
            width: 240,
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sheet)",
            boxShadow: "var(--elevation-3)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            autoFocus
            value={text}
            placeholder={t("detail.datePlaceholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") setOpen(false);
            }}
            style={{
              height: 36,
              padding: "0 10px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: "var(--text-body)",
              outline: "none",
            }}
          />
          <input
            type="date"
            value={value ?? ""}
            onChange={(e) => {
              onChange(e.target.value || null);
              setOpen(false);
            }}
            style={{
              height: 34,
              padding: "0 8px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              colorScheme: "light dark",
            }}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "var(--text-secondary-size)",
                textAlign: "left",
                padding: "2px 2px",
                fontFamily: "var(--font-sans)",
              }}
            >
              {t("detail.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
