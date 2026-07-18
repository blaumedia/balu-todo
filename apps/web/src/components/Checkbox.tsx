import type { CSSProperties } from "react";

// The task checkbox — a brand asset (DESIGN §5). Squircle ring that pops a fill
// on complete; priority colors the ring (P1 red, P2 amber, P3 accent). The
// ~600ms linger + slide is owned by TaskRow.
const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--priority-1)",
  2: "var(--priority-2)",
  3: "var(--accent)",
};

export interface CheckboxProps {
  checked?: boolean;
  priority?: 1 | 2 | 3 | 0 | null;
  size?: number;
  disabled?: boolean;
  onChange?: () => void;
  style?: CSSProperties;
}

export function Checkbox({ checked = false, priority = null, size = 22, disabled = false, onChange, style }: CheckboxProps) {
  const p = priority && priority > 0 ? priority : null;
  const ringColor = p ? PRIORITY_COLOR[p] : "var(--slate-300)";
  const fill = checked ? (p ? PRIORITY_COLOR[p] : "var(--accent)") : "transparent";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.();
      }}
      className="balu-checkbox"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "none",
        padding: 0,
        border: `2px solid ${checked ? fill : ringColor}`,
        borderRadius: Math.round(size * 0.42),
        background: fill,
        cursor: disabled ? "not-allowed" : "pointer",
        transition:
          "background var(--duration-fast) var(--ease-emphasized), border-color var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          opacity: checked ? 1 : 0,
          transform: checked ? "scale(1)" : "scale(0.6)",
          transition:
            "opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-emphasized)",
        }}
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}
