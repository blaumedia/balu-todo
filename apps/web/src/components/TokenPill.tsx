import type { CSSProperties, ReactNode } from "react";

// Quick-add token pill — the tinted highlight the parser shows as it recognizes
// a token (DESIGN §2 functional colors).
export type PillType = "date" | "project" | "label" | "priority1" | "priority2" | "priority3";

const TYPES: Record<PillType, CSSProperties> = {
  date: { color: "var(--accent)", background: "var(--accent-wash)" },
  project: { color: "var(--token-project)", background: "rgba(124,58,237,0.12)" },
  label: { color: "var(--token-label)", background: "rgba(180,83,9,0.12)" },
  priority1: { color: "var(--priority-1)", background: "rgba(220,38,38,0.12)" },
  priority2: { color: "var(--priority-2)", background: "rgba(217,119,6,0.12)" },
  priority3: { color: "var(--accent)", background: "var(--accent-wash)" },
};

export function TokenPill({ type = "date", children, style }: { type?: PillType; children?: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-body)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.4,
        borderRadius: "var(--radius-chip)",
        ...TYPES[type],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
