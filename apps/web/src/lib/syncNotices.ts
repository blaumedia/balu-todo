import { relocationNotice, type RelocationNotice } from "@balu/domain";
import type { AccessLost, RelocatedCommand } from "@balu/sync-client";
import type { TranslationKey } from "../i18n/en.js";

type T = (key: TranslationKey) => string;

const RELOCATED_KEY: Record<RelocationNotice, TranslationKey> = {
  inbox: "sync.relocatedInbox",
  project: "sync.relocatedProject",
  topLevel: "sync.relocatedTopLevel",
  mixed: "sync.relocatedMixed",
};

/** The toast for a flush's relocated task_adds, or null when there were none. */
export function relocatedMessage(t: T, relocated: ReadonlyArray<RelocatedCommand>): string | null {
  const kind = relocationNotice(relocated.map((r) => r.reasons));
  return kind ? t(RELOCATED_KEY[kind]).replace("{n}", String(relocated.length)) : null;
}

/** "You no longer have access to X. N unsynced change(s) could not be saved." */
export function accessLostMessage(
  t: T,
  reason: AccessLost["reason"],
  discarded: number,
  workspaceName: string | null,
): string {
  // A function replacement: a name containing "$&" must not be read as a pattern.
  const head =
    reason === "removed"
      ? workspaceName
        ? t("sync.accessRemoved").replace("{workspace}", () => workspaceName)
        : t("sync.accessRemovedUnnamed")
      : workspaceName
        ? t("sync.workspaceGone").replace("{workspace}", () => workspaceName)
        : t("sync.workspaceGoneUnnamed");
  return discarded > 0 ? `${head} ${t("sync.changesDiscarded").replace("{n}", String(discarded))}` : head;
}
