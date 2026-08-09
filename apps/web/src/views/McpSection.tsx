import { useState } from "react";
import type { McpSettings } from "@balu/domain";
import { api } from "../lib/clients.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";

const monoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowX: "auto",
  whiteSpace: "nowrap",
  padding: "8px 10px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
};

const iconButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-secondary)",
  padding: 4,
};

/**
 * The `balu_mcp_` prefix followed by a fixed run of dots. Fixed, not
 * proportional: the masked form should not hint at the key's length, and both
 * clients must render it identically.
 */
function maskKey(key: string): string {
  const prefix = "balu_mcp_";
  return `${key.startsWith(prefix) ? prefix : ""}${"•".repeat(16)}`;
}

export function McpSection({
  settings,
  onSettings,
}: {
  settings: McpSettings;
  onSettings: (next: McpSettings) => void;
}) {
  const { t } = useT();
  const showToast = useApp((s) => s.showToast);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = settings.key;

  function copy(value: string) {
    void globalThis.navigator?.clipboard?.writeText(value).then(() => showToast(t("common.copied")));
  }

  async function generate() {
    // Replacing a key breaks live connections; minting the first one cannot.
    if (key !== null && !globalThis.confirm(t("mcp.regenerateConfirm"))) return;
    setBusy(true);
    try {
      onSettings(await api.generateMcpKey());
      setRevealed(false);
      showToast(t(key === null ? "mcp.generated" : "mcp.regenerated"));
    } catch {
      showToast(t("auth.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("mcp.subtitle")}</div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("mcp.endpoint")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code style={monoStyle}>{settings.endpoint}</code>
          <button
            type="button"
            onClick={() => copy(settings.endpoint)}
            aria-label={t("common.copy")}
            title={t("common.copy")}
            style={iconButtonStyle}
          >
            <Icon name="copy" size={16} />
          </button>
        </div>
      </label>

      {key === null ? (
        <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("mcp.noKey")}</div>
      ) : (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("mcp.key")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={monoStyle}>{revealed ? key : maskKey(key)}</code>
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? t("mcp.hide") : t("mcp.reveal")}
                title={revealed ? t("mcp.hide") : t("mcp.reveal")}
                style={iconButtonStyle}
              >
                <Icon name={revealed ? "eye-off" : "eye"} size={16} />
              </button>
              <button
                type="button"
                onClick={() => copy(key)}
                aria-label={t("common.copy")}
                title={t("common.copy")}
                style={iconButtonStyle}
              >
                <Icon name="copy" size={16} />
              </button>
            </div>
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("mcp.hint")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* The command carries the key, so it follows the reveal toggle. */}
              <code style={monoStyle}>
                {revealed
                  ? settings.claude_code_command
                  : settings.claude_code_command?.replace(key, maskKey(key))}
              </code>
              <button
                type="button"
                onClick={() => copy(settings.claude_code_command ?? "")}
                aria-label={t("common.copy")}
                title={t("common.copy")}
                style={iconButtonStyle}
              >
                <Icon name="copy" size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          size="sm"
          icon={key === null ? "key" : "refresh-cw"}
          onClick={() => void generate()}
          disabled={busy}
        >
          {t(key === null ? "mcp.generate" : "mcp.regenerate")}
        </Button>
        {key !== null && (
          <span style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("mcp.regenerateHint")}</span>
        )}
      </div>
    </div>
  );
}
