import { useApp } from "../store/app.js";
import { Icon } from "./Icon.js";

/** Ambient bottom-center toast (DESIGN §3 — calm, non-modal). */
export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      className="balu-overlay-in"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 32,
        transform: "translateX(-50%)",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-pill)",
        boxShadow: "var(--elevation-3)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-secondary-size)",
        maxWidth: "90vw",
      }}
    >
      <Icon name="check-circle" size={16} color="var(--success)" />
      {toast}
    </div>
  );
}
