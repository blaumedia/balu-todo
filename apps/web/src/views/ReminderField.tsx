import { useEffect, useRef, useState } from "react";
import type { IsoDate, IsoDateTime, Locale } from "@balu/domain";
import { parseQuickAdd } from "@balu/nl-parser";
import type { TranslationKey } from "../i18n/index.js";
import { Icon } from "../components/Icon.js";

export interface ReminderFieldProps {
  value: IsoDateTime | null;
  today: IsoDate;
  locale: Locale;
  t: (k: TranslationKey) => string;
  onChange: (value: IsoDateTime | null) => void;
}

/** Convert a UTC `reminder_at` to the `datetime-local` input value (local tz). */
function toLocalInput(iso: IsoDateTime): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` (local tz) → UTC ISO with `Z` (contract §3.3 reminder_at). */
function fromLocalInput(local: string): IsoDateTime | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatDisplay(iso: IsoDateTime, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "Remind me" control: NL date field (defaults to 09:00 local) + native
 *  datetime picker for precision (DESIGN — capture is calm and forgiving). */
export function ReminderField({ value, today, locale, t, onChange }: ReminderFieldProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

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
    const date = r.startDate ?? r.deadline;
    if (date) {
      // Default reminder time to 09:00 local on the parsed day.
      const iso = fromLocalInput(`${date}T09:00`);
      if (iso) {
        onChange(iso);
        setText("");
        setOpen(false);
      }
    }
  }

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
          color: value ? "var(--accent)" : "var(--text-tertiary)",
          cursor: "pointer",
          fontSize: "var(--text-secondary-size)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <Icon name="bell" size={15} />
        {value ? formatDisplay(value, locale) : t("detail.reminderPlaceholder")}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 40,
            width: 260,
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
            placeholder={t("detail.reminderPlaceholder")}
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
            type="datetime-local"
            value={value ? toLocalInput(value) : ""}
            onChange={(e) => {
              onChange(fromLocalInput(e.target.value));
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
              {t("detail.reminderClear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
