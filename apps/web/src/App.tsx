import { useCallback, useEffect } from "react";
import { api, initSync } from "./lib/clients.js";
import { applyTheme } from "./lib/theme.js";
import { useApp } from "./store/app.js";
import { LoginView } from "./views/LoginView.js";
import { Shell } from "./views/Shell.js";
import { Icon } from "./components/Icon.js";

export function App() {
  const boot = useApp((s) => s.boot);
  const theme = useApp((s) => s.theme);
  const setBoot = useApp((s) => s.setBoot);
  const setSession = useApp((s) => s.setSession);

  // Theme: apply now and react to system changes when following the OS.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || !globalThis.matchMedia) return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const bootSession = useCallback(async () => {
    try {
      const me = await api.getMe();
      const first = me.memberships[0];
      if (!first) {
        setBoot("login");
        return;
      }
      initSync(first.workspace.id, me.user.id);
      setSession(me.user, me.memberships, first.workspace);
    } catch {
      setBoot("login");
    }
  }, [setBoot, setSession]);

  useEffect(() => {
    void (async () => {
      await api.hydrate();
      if (!api.isAuthenticated()) {
        setBoot("login");
        return;
      }
      await bootSession();
    })();
  }, [bootSession, setBoot]);

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

  if (boot === "login") return <LoginView onAuthenticated={bootSession} />;
  return <Shell />;
}
