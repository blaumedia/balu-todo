import { useCallback, useEffect, useState } from "react";
import type { Invite, InviteRole, Member, Role } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { ApiError } from "@balu/api-client";
import { api, getSync } from "../lib/clients.js";
import { canManageMembers, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import type { TranslationKey } from "../i18n/index.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";

const ROLE_KEY: Record<Role, TranslationKey> = {
  owner: "members.role.owner",
  admin: "members.role.admin",
  member: "members.role.member",
  viewer: "members.role.viewer",
};
const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
const INVITE_ROLES: InviteRole[] = ["admin", "member", "viewer"];

const controlStyle: React.CSSProperties = {
  height: 36,
  padding: "0 10px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "var(--text-secondary-size)",
  fontFamily: "var(--font-sans)",
  outline: "none",
};

function RoleBadge({ role, t }: { role: Role; t: (k: TranslationKey) => string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        background: role === "owner" ? "var(--accent-wash)" : "var(--slate-100)",
        color: role === "owner" ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {t(ROLE_KEY[role])}
    </span>
  );
}

export function MembersSection({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useT();
  const workspace = useApp((s) => s.workspace);
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const role = useMyRole();
  const canManage = canManageMembers(role);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const members = [...snapshot.members]
    .filter((m) => !m.is_deleted)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));

  const wsId = workspace?.id;

  const loadInvites = useCallback(async () => {
    if (!wsId || !canManage) return;
    try {
      setInvites(await api.listInvites(wsId));
    } catch {
      /* backend may not be live yet — leave the list empty */
    }
  }, [wsId, canManage]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  function handleApiError(e: unknown) {
    if (e instanceof ApiError && e.code === "last_owner") showToast(t("members.leaveConfirm"));
    else showToast(t("auth.errorGeneric"));
  }

  async function changeRole(m: Member, next: Role) {
    if (!wsId || next === m.role) return;
    try {
      await api.updateMember(wsId, m.id, { role: next });
      await getSync()?.sync();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function removeMember(m: Member) {
    if (!wsId) return;
    const isSelf = m.id === user?.id;
    const ok = globalThis.confirm(
      isSelf ? t("members.leaveConfirm") : t("members.removeConfirm").replace("{name}", m.name),
    );
    if (!ok) return;
    try {
      await api.removeMember(wsId, m.id);
      await getSync()?.sync();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function createInvite() {
    if (!wsId) return;
    try {
      const invite = await api.createInvite(wsId, {
        role: inviteRole,
        ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}),
      });
      setLastLink(`${globalThis.location.origin}/invite/${invite.token}`);
      setInviteEmail("");
      setInviting(false);
      await loadInvites();
    } catch (e) {
      handleApiError(e);
    }
  }

  async function revokeInvite(id: string) {
    if (!wsId) return;
    try {
      await api.revokeInvite(wsId, id);
      await loadInvites();
    } catch (e) {
      handleApiError(e);
    }
  }

  function copyLink(link: string) {
    void globalThis.navigator?.clipboard?.writeText(link).then(() => showToast(t("members.copied")));
  }

  function fmtDate(iso: string) {
    return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { day: "numeric", month: "short" }).format(new Date(iso));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {members.length === 0 && (
        <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>—</div>
      )}
      {members.map((m) => {
        const isSelf = m.id === user?.id;
        const editable = canManage && m.role !== "owner" && !isSelf;
        return (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--accent-wash)",
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 14,
                flex: "none",
              }}
            >
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-body)", color: "var(--text-primary)" }}>
                {m.name} {isSelf && <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>· {t("members.you")}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
            </div>
            {editable ? (
              <select style={controlStyle} value={m.role} onChange={(e) => void changeRole(m, e.target.value as Role)}>
                <option value="admin">{t("members.role.admin")}</option>
                <option value="member">{t("members.role.member")}</option>
                <option value="viewer">{t("members.role.viewer")}</option>
              </select>
            ) : (
              <RoleBadge role={m.role} t={t} />
            )}
            {(isSelf || (canManage && m.role !== "owner")) && (
              <button
                type="button"
                onClick={() => void removeMember(m)}
                aria-label={isSelf ? t("members.leave") : t("members.remove")}
                title={isSelf ? t("members.leave") : t("members.remove")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 4 }}
              >
                <Icon name={isSelf ? "log-out" : "trash-2"} size={16} />
              </button>
            )}
          </div>
        );
      })}

      {canManage && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{t("members.pending")}</div>
          {invites.length === 0 && (
            <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("members.noPending")}</div>
          )}
          {invites.map((inv) => (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="link-2" size={16} color="var(--text-tertiary)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-primary)" }}>
                  {t(ROLE_KEY[inv.role])} {inv.email && <span style={{ color: "var(--text-tertiary)" }}>· {inv.email}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{t("members.expires").replace("{date}", fmtDate(inv.expires_at))}</div>
              </div>
              {/* The plaintext token only exists in the create response (stored
                  hashed server-side) — listed invites have no link to copy. */}
              {inv.token && (
                <button
                  type="button"
                  onClick={() => copyLink(`${globalThis.location.origin}/invite/${inv.token}`)}
                  aria-label={t("members.copyLink")}
                  title={t("members.copyLink")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4 }}
                >
                  <Icon name="copy" size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => void revokeInvite(inv.id)}
                aria-label={t("members.revoke")}
                title={t("members.revoke")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 4 }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}

          {lastLink && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                background: "var(--accent-wash)",
                borderRadius: "var(--radius-control)",
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {lastLink}
              </span>
              <button
                type="button"
                onClick={() => copyLink(lastLink)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12, fontFamily: "var(--font-sans)" }}
              >
                <Icon name="copy" size={14} /> {t("common.copy")}
              </button>
            </div>
          )}

          {inviting ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select style={controlStyle} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InviteRole)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_KEY[r])}
                  </option>
                ))}
              </select>
              <input
                style={{ ...controlStyle, flex: 1, minWidth: 160 }}
                placeholder={t("members.emailOptional")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <Button size="sm" icon="link-2" onClick={() => void createInvite()}>
                {t("members.createLink")}
              </Button>
            </div>
          ) : (
            <div>
              <Button variant="secondary" size="sm" icon="plus" onClick={() => setInviting(true)}>
                {t("members.invite")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
