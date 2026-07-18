export function ProgressRing({
  value,
  total,
  size = 28,
  stroke = 3,
  showLabel = false,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", flex: "none" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset var(--duration-medium) var(--ease-standard)" }}
        />
      </svg>
      {showLabel && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-secondary-size)",
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}/{total}
        </span>
      )}
    </span>
  );
}
