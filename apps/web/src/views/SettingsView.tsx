import { useEffect, useState } from "react";
import type { Locale, McpSettings, Theme } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { bootSession } from "../lib/boot.js";
import { api, initSync } from "../lib/clients.js";
import { logout } from "../lib/logout.js";
import { useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Button } from "../components/Button.js";
import { MembersSection } from "./MembersSection.js";
import { ChannelsSection } from "./ChannelsSection.js";
import { McpSection } from "./McpSection.js";

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

export function SettingsView({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useT();
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const workspace = useApp((s) => s.workspace);
  const setUser = useApp((s) => s.setUser);
  const setLocale = useApp((s) => s.setLocale);
  const setTheme = useApp((s) => s.setTheme);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const setMemberships = useApp((s) => s.setMemberships);
  const showToast = useApp((s) => s.showToast);
  const role = useMyRole();
  const [name, setName] = useState(user?.name ?? "");
  const [deleting, setDeleting] = useState(false);
  // Null until the server answers. A 404 means this instance runs without
  // BALU_MCP_ENABLED (or predates the feature) - either way the section stays hidden.
  const [mcp, setMcp] = useState<McpSettings | null>(null);

  useEffect(() => {
    void api
      .getMcpSettings()
      .then(setMcp)
      .catch(() => setMcp(null));
  }, []);

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

  async function signOut() {
    await logout();
  }

  async function deleteWorkspace() {
    if (deleting || !workspace || !user) return;
    const typed = globalThis.prompt(t("workspace.deletePrompt"));
    if (typed === null) return;
    // Trimmed on both sides: the server stores names raw, so a workspace called
    // " Team " could otherwise never be confirmed.
    if (typed.trim() !== workspace.name.trim()) {
      showToast(t("workspace.deleteNameMismatch"));
      return;
    }
    setDeleting(true);
    let deleted = false;
    try {
      await api.deleteWorkspace(workspace.id);
      deleted = true;
      // The server never leaves an account workspace-less: deleting the last one
      // mints a fresh default, so /me always answers with something to land in.
      const me = await api.getMe();
      setMemberships(me.memberships);
      const next = me.memberships[0]!;
      initSync(next.workspace.id, user.id);
      setWorkspace(next.workspace);
      showToast(t("workspace.deleted"));
    } catch {
      // Once the DELETE went through, the store and the sync client point at a
      // workspace that no longer exists, and a failure in one of the follow-up
      // steps would leave them there 404-polling until a manual reload. Re-boot
      // the session exactly as startup does instead: it re-reads /me and picks a
      // surviving workspace (or drops to login if even that fails).
      if (deleted) await bootSession();
      else showToast(t("auth.errorGeneric"));
    } finally {
      setDeleting(false);
    }
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

        {workspace && (
          <Section title={t("settings.workspace")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, fontSize: 15, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {workspace.name}
              </span>
              {role === "owner" && (
                <Button variant="danger" icon="trash-2" disabled={deleting} onClick={() => void deleteWorkspace()}>
                  {t("workspace.delete")}
                </Button>
              )}
            </div>
          </Section>
        )}

        <Section title={t("settings.members")}>
          <MembersSection snapshot={snapshot} />
        </Section>

        <Section title={t("settings.notifications")}>
          <ChannelsSection />
        </Section>

        {mcp && (
          <Section title={t("settings.mcp")}>
            <McpSection settings={mcp} onSettings={setMcp} />
          </Section>
        )}

        <div>
          <Button variant="secondary" icon="log-out" onClick={signOut}>
            {t("settings.logout")}
          </Button>
        </div>
      </div>
    </main>
  );
}
