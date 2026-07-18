import { useState } from "react";
import type { Locale, Theme } from "@balu/domain";
import { api, teardownSync } from "../lib/clients.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Button } from "../components/Button.js";

const controlStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "var(--text-body)",
  fontFamily: "var(--font-sans)",
  outline: "none",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.4px", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const { t } = useT();
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const setUser = useApp((s) => s.setUser);
  const setLocale = useApp((s) => s.setLocale);
  const setTheme = useApp((s) => s.setTheme);
  const reset = useApp((s) => s.reset);
  const [name, setName] = useState(user?.name ?? "");

  function saveName() {
    if (name.trim() && name !== user?.name) {
      void api.patchMe({ name: name.trim() }).then(setUser).catch(() => {});
    }
  }

  function changeLocale(locale: Locale) {
    setLocale(locale);
    void api.patchMe({ locale }).then(setUser).catch(() => {});
  }

  function changeTheme(next: Theme) {
    setTheme(next);
    void api.patchMe({ theme: next }).catch(() => {});
  }

  async function logout() {
    await api.logout();
    teardownSync();
    reset();
  }

  return (
    <main style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 24px 80px", display: "flex", flexDirection: "column", gap: 32 }}>
        <Section title={t("settings.account")}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("settings.name")}</span>
            <input style={controlStyle} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("settings.locale")}</span>
            <select style={controlStyle} value={user?.locale ?? "en"} onChange={(e) => changeLocale(e.target.value as Locale)}>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
        </Section>

        <Section title={t("settings.appearance")}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("settings.theme")}</span>
            <select style={controlStyle} value={theme} onChange={(e) => changeTheme(e.target.value as Theme)}>
              <option value="system">{t("theme.system")}</option>
              <option value="light">{t("theme.light")}</option>
              <option value="dark">{t("theme.dark")}</option>
            </select>
          </label>
        </Section>

        <div>
          <Button variant="secondary" icon="log-out" onClick={logout}>
            {t("settings.logout")}
          </Button>
        </div>
      </div>
    </main>
  );
}
