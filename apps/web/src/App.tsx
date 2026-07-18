import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/clients.js";
import { bootSession } from "./lib/boot.js";
import { applyTheme } from "./lib/theme.js";
import { useApp } from "./store/app.js";
import { LoginView } from "./views/LoginView.js";
import { Shell } from "./views/Shell.js";
import { InviteAcceptView } from "./views/InviteAcceptView.js";
import { Icon } from "./components/Icon.js";

/** Extract the invite token from `/invite/:token`, or null. */
function matchInvite(pathname: string): string | null {
  const m = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function App() {
  const boot = useApp((s) => s.boot);
  const theme = useApp((s) => s.theme);
  const setBoot = useApp((s) => s.setBoot);

  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    matchInvite(globalThis.location?.pathname ?? ""),
  );

  // Theme: apply now and react to system changes when following the OS.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || !globalThis.matchMedia) return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const authenticate = useCallback(async () => {
    await bootSession();
  }, []);

  useEffect(() => {
    if (inviteToken) return; // the invite flow drives its own boot
    void (async () => {
      await api.hydrate();
      if (!api.isAuthenticated()) {
        setBoot("login");
        return;
      }
      await bootSession();
    })();
  }, [inviteToken, setBoot]);

  if (inviteToken) {
    return (
      <InviteAcceptView
        token={inviteToken}
        onDone={() => {
          globalThis.history?.replaceState(null, "", "/");
          setInviteToken(null);
          if (!api.isAuthenticated()) setBoot("login");
        }}
      />
    );
  }

  if (boot === "loading") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
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
      </div>
    );
  }

  if (boot === "login") return <LoginView onAuthenticated={authenticate} />;
  return <Shell />;
}
