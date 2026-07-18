import type { Theme } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { api } from "../lib/clients.js";
import { syncLabelKey } from "../components/SyncIndicator.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import { IconButton } from "../components/IconButton.js";
import { Input } from "../components/Input.js";
import { ProgressRing } from "../components/ProgressRing.js";
import type { TranslationKey } from "../i18n/index.js";

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICON: Record<Theme, string> = { system: "monitor", light: "sun", dark: "moon" };

export function Toolbar({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useT();
  const view = useApp((s) => s.view);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const setView = useApp((s) => s.setView);

  let title = "Balu";
  let progress: { value: number; total: number } | null = null;

  if (view.kind === "list") title = t(`nav.${view.list}` as TranslationKey);
  else if (view.kind === "settings") title = t("settings.title");
  else if (view.kind === "project") {
    const project = snapshot.projects.find((p) => p.id === view.projectId);
    title = project?.name ?? "Balu";
    const inProject = snapshot.tasks.filter((tk) => !tk.is_deleted && tk.project_id === view.projectId && tk.parent_task_id == null);
    const done = inProject.filter((tk) => tk.completed_at != null).length;
    if (inProject.length > 0) progress = { value: done, total: inProject.length };
  }

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]!;
    setTheme(next);
    void api.patchMe({ theme: next }).catch(() => {});
  }

  return (
    <header
      style={{
        height: 60,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
        {title}
      </h1>
      {progress && <ProgressRing value={progress.value} total={progress.total} showLabel />}
      <div style={{ flex: 1 }} />
      <div style={{ width: 200 }}>
        <Input icon="search" placeholder={t("toolbar.search")} size="sm" disabled />
      </div>
      <SyncIndicator state={snapshot.status} label={t(syncLabelKey(snapshot.status) as TranslationKey)} />
      <IconButton icon={THEME_ICON[theme]} label={t("settings.theme")} onClick={cycleTheme} />
      <IconButton
        icon="settings"
        label={t("settings.title")}
        active={view.kind === "settings"}
        onClick={() => setView({ kind: "settings" })}
      />
    </header>
  );
}
