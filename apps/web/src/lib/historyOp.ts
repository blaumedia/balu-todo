import { buildAppUrl, type AppRoute, type ViewSel } from "./url.js";

/**
 * history.state marker on the entry we pushed when the full-screen reader
 * opened. `under` is the URL that was showing before the push, i.e. what
 * popping the entry returns to.
 */
export interface ReaderState {
  baluReader: true;
  under: string;
}

export function readerState(under: string): ReaderState {
  return { baluReader: true, under };
}

function readerEntry(state: unknown): ReaderState | null {
  if (typeof state !== "object" || state === null) return null;
  const s = state as { baluReader?: unknown; under?: unknown };
  return s.baluReader === true && typeof s.under === "string" ? { baluReader: true, under: s.under } : null;
}

/** The `under` URL of the current entry when it is a reader entry we pushed. */
export function readerUnder(state: unknown): string | null {
  return readerEntry(state)?.under ?? null;
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
 * entry (Back never reopens it) only when the target URL is exactly the one
 * underneath (recorded in the marker, so it also holds after a reload); every
 * other close, including a deep-linked reader, replaces the URL. Other changes push only when the view path changes.
 */
export function decideHistoryOp(i: HistoryInput): HistoryOp {
  const next = buildAppUrl(i.view, i.selectedTaskId, i.fullscreenTaskId);
  if (next === i.currentUrl) return "none";
  if (i.current === null) return "replace";
  const wasReader = i.current.fullscreenTaskId !== null;
  const isReader = i.fullscreenTaskId !== null;
  if (wasReader && !isReader) {
    // Popping lands on the entry underneath, so it is only right when that
    // entry is exactly where the state now points. A close that also changes
    // the view or selection (palette jump, view switch) must replace instead.
    return readerUnder(i.currentState) === next ? "back" : "replace";
  }
  if (wasReader && isReader) return readerEntry(i.currentState) ? "replace-reader" : "replace";
  if (i.replaceNext) return "replace";
  if (isReader) return "push";
  const pathChanged = buildAppUrl(i.current.view, null, null) !== buildAppUrl(i.view, null, null);
  return pathChanged ? "push" : "replace";
}
