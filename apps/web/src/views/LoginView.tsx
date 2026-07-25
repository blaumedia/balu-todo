import { useMemo, useState } from "react";
import { ApiError } from "@balu/api-client";
import { api } from "../lib/clients.js";
import { makeT, type TranslationKey } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";

export function LoginView({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const locale = useApp((s) => s.locale);
  const t = useMemo(() => makeT(locale), [locale]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await api.register({ email, password, name });
        // Accounts default to "en" server-side; adopt the browser language so
        // German NL parsing works from the very first quick-add.
        if (navigator.language?.toLowerCase().startsWith("de")) {
          await api.patchMe({ locale: "de" }).catch(() => {});
        }
      } else {
        await api.login({ email, password });
      }
      await onAuthenticated();
    } catch (err) {
      // `rate_limited` must be here: without it a throttled user is told
      // "something went wrong" and retries, when they just need to wait.
      const known = ["invalid_credentials", "email_taken", "registration_disabled", "rate_limited"];
      if (err instanceof ApiError && known.includes(err.code)) {
        setError(t(`auth.${err.code}` as TranslationKey));
      } else {
        setError(t("auth.errorGeneric"));
      }
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    height: 44,
    padding: "0 14px",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontSize: "var(--text-body)",
    fontFamily: "var(--font-sans)",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 400,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--elevation-2)",
          padding: 32,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--balu-gradient)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="check" size={18} color="#fff" strokeWidth={3} />
          </span>
          <span
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              background: "var(--balu-gradient)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            balu
          </span>
        </div>
        <p style={{ margin: "0 0 24px", color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
          {t("auth.tagline")}
        </p>

        <h1 style={{ margin: "0 0 20px", fontSize: "var(--text-title)", fontWeight: 600, color: "var(--text-primary)" }}>
          {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
        </h1>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "register" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("auth.name")}</span>
              <input style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("auth.email")}</span>
            <input
              style={fieldStyle}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("auth.password")}</span>
            <input
              style={fieldStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {error && (
            <div style={{ color: "var(--danger)", fontSize: "var(--text-secondary-size)" }}>{error}</div>
          )}

          <Button type="submit" size="lg" fullWidth disabled={busy} style={{ marginTop: 4 }}>
            {mode === "login" ? t("auth.login") : t("auth.register")}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          style={{
            marginTop: 18,
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "var(--text-secondary-size)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {mode === "login" ? t("auth.toRegister") : t("auth.toLogin")}
        </button>
      </div>
    </div>
  );
}
