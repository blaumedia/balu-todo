import type { RelocationReason } from "./types.js";

/** Which notice a batch of relocated task_adds gets. */
export type RelocationNotice = "inbox" | "project" | "topLevel" | "mixed";

const BY_FIRST_REASON: Record<RelocationReason, RelocationNotice> = {
  project_deleted: "inbox",
  section_deleted: "project",
  parent_deleted: "topLevel",
};

/**
 * One notice for the relocated commands of a sync, or null when there are none.
 *
 * The server lists reasons in a fixed order (server/balu/sync/commands.py
 * h_task_add): project_deleted, then section_deleted - never both, the section is
 * not looked up once the project is gone - then parent_deleted. The first reason
 * therefore names where the task actually landed: the Inbox, the project body, or
 * the top level of its own container. Tasks that landed in different kinds of
 * places, or a reason this client does not know, get the combined notice.
 */
export function relocationNotice(
  reasonLists: ReadonlyArray<ReadonlyArray<string>>,
): RelocationNotice | null {
  let notice: RelocationNotice | null = null;
  for (const reasons of reasonLists) {
    const first = reasons[0];
    const kind: RelocationNotice =
      first !== undefined && Object.prototype.hasOwnProperty.call(BY_FIRST_REASON, first)
        ? BY_FIRST_REASON[first as RelocationReason]
        : "mixed";
    if (notice === null) notice = kind;
    else if (notice !== kind) return "mixed";
  }
  return notice;
}
