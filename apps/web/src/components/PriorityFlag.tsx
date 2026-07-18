import type { CSSProperties } from "react";

const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--priority-1)",
  2: "var(--priority-2)",
  3: "var(--accent)",
};

export function PriorityFlag({ priority, size = 15, style }: { priority: 1 | 2 | 3 | 0 | null; size?: number; style?: CSSProperties }) {
  if (!priority) return null;
  const color = PRIORITY_COLOR[priority] ?? "var(--accent)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "none", ...style }}
      aria-label={`P${priority}`}
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill={color} fillOpacity="0.15" />
      <path d="M4 22v-7" />
    </svg>
  );
}
