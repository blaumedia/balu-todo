import { buildAppUrl, type AppRoute, type ViewSel } from "./url.js";

/** history.state marker on the entry we pushed when the full-screen reader opened. */
export const READER_STATE = { baluReader: true } as const;

function isReaderEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { baluReader?: unknown }).baluReader === true;
}

export type HistoryOp = "none" | "push" | "replace" | "back" | "replace-reader";

export interface HistoryInput {
  /** Route parsed from the current location; null when the app does not own it. */
  current: AppRoute | null;
  /** pathname + search currently in the address bar. */
  currentUrl: string;
  /** history.state of the current entry. */
  currentState: unknown;
  view: ViewSel;
  selectedTaskId: string | null;
  fullscreenTaskId: string | null;
  replaceNext: boolean;
}

/**
 * State -> URL decision. Opening the reader pushes exactly one entry (marked
 * via history.state). Closing never pushes: a reader we opened pops its own
 * entry (Back never reopens it), a deep-linked reader is replaced by the
 * underlying view URL. Other changes push only when the view path changes.
 */
export function decideHistoryOp(i: HistoryInput): HistoryOp {
  const next = buildAppUrl(i.view, i.selectedTaskId, i.fullscreenTaskId);
  if (next === i.currentUrl) return "none";
  if (i.current === null) return "replace";
  const wasReader = i.current.fullscreenTaskId !== null;
  const isReader = i.fullscreenTaskId !== null;
  if (wasReader && !isReader) {
    // Popping is only right for a plain close (task selection kept). Anything
    // else that clears the reader (view switch, selection cleared) navigates
    // somewhere the entry underneath is not, so it replaces.
    const plainClose = i.selectedTaskId === i.current.taskId;
    return plainClose && isReaderEntry(i.currentState) ? "back" : "replace";
  }
  if (wasReader && isReader) return isReaderEntry(i.currentState) ? "replace-reader" : "replace";
  if (i.replaceNext) return "replace";
  if (isReader) return "push";
  const pathChanged = buildAppUrl(i.current.view, null, null) !== buildAppUrl(i.view, null, null);
  return pathChanged ? "push" : "replace";
}
