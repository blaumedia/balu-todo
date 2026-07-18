import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@balu/api-client";
import { api } from "../lib/clients.js";
import { bootSession } from "../lib/boot.js";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";
import { LoginView } from "./LoginView.js";

type Phase = "checking" | "needsAuth" | "accepting" | "invalid";

/**
 * `/invite/:token` — accept an invite (contract §7). Unauthenticated users sign
 * in first (the token is preserved across auth). On success we switch to the
 * invited workspace and drop into the app; invalid/expired tokens get a screen.
 */
export function InviteAcceptView({ token, onDone }: { token: string; onDone: () => void }) {
  const locale = useApp((s) => s.locale);
  const showToast = useApp((s) => s.showToast);
  const t = useMemo(() => makeT(locale), [locale]);
  const [phase, setPhase] = useState<Phase>("checking");

  const accept = useCallback(async () => {
    setPhase("accepting");
    try {
      const workspace = await api.acceptInvite(token);
      await bootSession(workspace.id);
      showToast(t("invite.joined"));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "invalid_token" || e.code === "token_expired")) {
        setPhase("invalid");
      } else if (e instanceof ApiError && e.status === 401) {
        setPhase("needsAuth");
      } else {
        setPhase("invalid");
      }
    }
  }, [token, onDone, showToast, t]);

  useEffect(() => {
    void (async () => {
      await api.hydrate();
      if (api.isAuthenticated()) void accept();
      else setPhase("needsAuth");
    })();
  }, [accept]);

  if (phase === "needsAuth") {
    // Reuse the auth screen; on success, continue accepting with the same token.
    return <LoginView onAuthenticated={accept} />;
  }

  const busy = phase === "checking" || phase === "accepting";

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
          textAlign: "center",
        }}
      >
        <span
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: phase === "invalid" ? "var(--danger)" : "var(--balu-gradient)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={phase === "invalid" ? "x" : "users"} size={24} color="#fff" strokeWidth={2.5} />
        </span>

        {phase === "invalid" ? (
          <>
            <h1 style={{ margin: "16px 0 8px", fontSize: "var(--text-title)", fontWeight: 600, color: "var(--text-primary)" }}>
              {t("invite.invalidTitle")}
            </h1>
            <p style={{ margin: "0 0 20px", color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
              {t("invite.invalidBody")}
            </p>
            <Button variant="secondary" fullWidth onClick={onDone}>
              {t("invite.back")}
            </Button>
          </>
        ) : (
          <>
            <h1 style={{ margin: "16px 0 8px", fontSize: "var(--text-title)", fontWeight: 600, color: "var(--text-primary)" }}>
              {t("invite.title")}
            </h1>
            <p style={{ margin: "0 0 20px", color: "var(--text-secondary)", fontSize: "var(--text-secondary-size)" }}>
              {busy ? t("invite.accepting") : t("invite.body")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
