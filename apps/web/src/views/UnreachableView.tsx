import { useMemo } from "react";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";

/** /me failed for a non-auth reason; lib/boot.ts keeps retrying and swaps this out once it answers. */
export function UnreachableView() {
  const locale = useApp((s) => s.locale);
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
        {t("boot.unreachableTitle")}
      </div>
      <div style={{ maxWidth: 360, color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
        {t("boot.unreachableHint")}
      </div>
    </div>
  );
}
