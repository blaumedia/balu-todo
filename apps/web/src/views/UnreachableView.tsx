import { useMemo } from "react";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";
import { logout } from "../lib/logout.js";

/**
 * Shown while lib/boot.ts keeps retrying: /me failed for a non-auth reason
 * (`unreachable`), or answered with an account that has no workspace
 * (`noWorkspace`). The loop swaps this out once /me answers usably; the logout
 * button is the way out meanwhile.
 */
export function UnreachableView() {
  const locale = useApp((s) => s.locale);
  const noWorkspace = useApp((s) => s.boot === "noWorkspace");
  const t = useMemo(() => makeT(locale), [locale]);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--bg)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "var(--balu-gradient)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="check" size={22} color="#fff" strokeWidth={3} />
      </span>
      <div style={{ fontSize: "var(--text-title)", fontWeight: 600, color: "var(--text-primary)" }}>
        {t(noWorkspace ? "boot.noWorkspaceTitle" : "boot.unreachableTitle")}
      </div>
      <div style={{ maxWidth: 360, color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
        {t(noWorkspace ? "boot.noWorkspaceHint" : "boot.unreachableHint")}
      </div>
      {/* No other way out while the server is down: a shared computer must be able to sign out. */}
      <button
        type="button"
        onClick={() => void logout()}
        style={{
          background: "none",
          border: "none",
          padding: 4,
          color: "var(--text-secondary)",
          fontSize: "var(--text-secondary-size)",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {t("boot.logout")}
      </button>
    </div>
  );
}
