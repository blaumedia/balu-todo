export interface AssigneeChipProps {
  name: string;
  /** Assigned to the current user — rendered in the accent tone with a label. */
  me?: boolean;
  meLabel?: string;
  size?: number;
}

/** A calm initial avatar for a task's assignee (tertiary; accent for "me"). */
export function AssigneeChip({ name, me = false, meLabel, size = 20 }: AssigneeChipProps) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      title={name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "var(--text-secondary-size)",
        color: me ? "var(--accent)" : "var(--text-tertiary)",
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: me ? "var(--accent-wash)" : "var(--slate-100)",
          color: me ? "var(--accent)" : "var(--text-secondary)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: size * 0.55,
          flex: "none",
        }}
      >
        {initial}
      </span>
      {me && meLabel && <span>{meLabel}</span>}
    </span>
  );
}
