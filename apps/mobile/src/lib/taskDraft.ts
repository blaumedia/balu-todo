// Which unsaved title/notes edits of the task detail sheet still have to be written.
// Pure - no React Native imports - so it can be unit-tested in plain node.

export interface DetailDraft {
  title: string;
  notes: string;
}

/**
 * The patch to write for a draft, or null when there is nothing to save.
 *
 * `saved` is the last value known to be stored (the task, or what a commit already wrote), so
 * calling this again after a commit yields null: the blur commit and the unmount commit never
 * write twice. A viewer never writes, and a blank title is not a title (the field reverts).
 */
export function pendingDraftPatch(
  draft: DetailDraft,
  saved: DetailDraft,
  writable: boolean,
): Partial<DetailDraft> | null {
  if (!writable) return null;
  const patch: Partial<DetailDraft> = {};
  const title = draft.title.trim();
  if (title && title !== saved.title) patch.title = title;
  if (draft.notes !== saved.notes) patch.notes = draft.notes;
  return Object.keys(patch).length > 0 ? patch : null;
}
