import { resolveProjectId } from "@balu/nl-parser";
import { makeT } from "../i18n/index.js";
import { useApp } from "../store/app.js";
import { canWrite, roleIn } from "./role.js";
import { getSync } from "./clients.js";
import { archivedViewProjectId } from "./quickadd.js";
import { unarchiveProject } from "./unarchiveProject.js";

/**
 * Cmd-N / n: open quick-add - or, on an archived project's view, say why not
 * and offer Unarchive (mobile hides its add button there, the web sidebar and
 * palette do too). Callers check the role first; viewers never get here.
 */
export function requestQuickAdd(): void {
  const st = useApp.getState();
  const sync = getSync();
  const snap = sync?.getSnapshot();
  const archivedId = snap ? archivedViewProjectId(st.view, snap.projects, snap.idAliases) : null;
  if (archivedId === null) {
    st.setQuickAdd(true);
    return;
  }
  const t = makeT(st.locale);
  // The toast outlives the view: the project must still be the archived project
  // the view shows. archivedViewProjectId is null once the project is gone,
  // deleted or unarchived, or the view moved elsewhere (Back/Forward changes the
  // view without going through setView), and resolves temp ids the server
  // replaced meanwhile.
  const stillArchivedHere = (s: NonNullable<typeof sync>): string | null => {
    const snap = s.getSnapshot();
    const id = resolveProjectId(snap.idAliases, archivedId);
    return archivedViewProjectId(useApp.getState().view, snap.projects, snap.idAliases) === id ? id : null;
  };
  const action = {
    label: t("project.unarchive"),
    // Unarchived or deleted elsewhere, navigated away (Back/Forward), another
    // session or demoted to viewer: the store drops the toast, since its button would do nothing.
    isValid: () =>
      !!sync && getSync() === sync && canWrite(roleIn(useApp.getState())) && stillArchivedHere(sync) !== null,
    run: () => {
      // Nothing to do if the workspace/session changed.
      if (!sync || getSync() !== sync) return;
      // The role may have dropped to viewer while the toast was up.
      if (!canWrite(roleIn(useApp.getState()))) return;
      const id = stillArchivedHere(sync);
      if (id === null) return;
      // Same mutation as the toolbar's Unarchive button.
      unarchiveProject(sync, id);
    },
  };
  st.showToast(t("quickadd.archivedNotice"), { tone: "info", action });
}
