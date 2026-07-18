import type { CSSProperties, ReactNode } from "react";

type Tone = "count" | "neutral" | "accent" | "danger";

const TONES: Record<Tone, CSSProperties> = {
  count: { color: "var(--text-tertiary)", background: "transparent" },
  neutral: { color: "var(--text-secondary)", background: "var(--slate-100)" },
  accent: { color: "var(--on-accent)", background: "var(--accent)" },
  danger: { color: "#fff", background: "var(--danger)" },
};

export function Badge({ tone = "count", children }: { tone?: Tone; children?: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 6px",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        fontWeight: "var(--weight-medium)",
        fontVariantNumeric: "tabular-nums",
        borderRadius: "var(--radius-pill)",
        lineHeight: 1,
        ...TONES[tone],
      }}
    >
      {children}
    </span>
  );
}
