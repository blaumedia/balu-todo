import type { SyncStatus } from "@balu/domain";

const STATES: Record<SyncStatus, { color: string; key: string }> = {
  synced: { color: "var(--success)", key: "sync.synced" },
  syncing: { color: "var(--accent)", key: "sync.syncing" },
  offline: { color: "var(--text-tertiary)", key: "sync.offline" },
  error: { color: "var(--danger)", key: "sync.error" },
};

export function SyncIndicator({ state, label }: { state: SyncStatus; label: string }) {
  const s = STATES[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-secondary-size)",
        color: "var(--text-tertiary)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: s.color,
          flex: "none",
          animation: state === "syncing" ? "balu-pulse 1s var(--ease-standard) infinite" : "none",
        }}
      />
      <span>{label}</span>
    </span>
  );
}

export const syncLabelKey = (state: SyncStatus) => STATES[state].key;
