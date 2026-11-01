import { useEffect } from "react";
import { useApp } from "../store/app.js";
import { buildAppUrl, parseAppUrl } from "./url.js";
import { decideHistoryOp, readerState, readerUnder } from "./historyOp.js";

/**
 * One-shot escape hatch: the next state->URL write uses replaceState even if
 * the path changed. Used by self-healing fallbacks (unknown project id) so
 * they never add a history entry the user did not ask for. It does not apply
 * to reader transitions, which follow their own push/pop/replace rules.
 */
let replaceNext = false;
/**
 * Set just before our own history.back() to the URL that pop must land on, so
 * its popstate is not treated as user navigation. A popstate landing anywhere
 * else is a real user navigation; the flag is cleared by every popstate and
 * when the hook unmounts, so it cannot swallow a later Back.
 */
let expectReaderPop: string | null = null;
/** How long our own back() may take before it is considered lost. */
const LOST_POP_MS = 500;
let lostPopTimer: ReturnType<typeof setTimeout> | null = null;
function cancelLostPopTimer(): void {
  if (lostPopTimer !== null) clearTimeout(lostPopTimer);
  lostPopTimer = null;
}
/**
 * A back() that never pops (a host ignoring it) would leave the reader URL in
 * the address bar and the expectation armed, so the user's next Back would be
 * swallowed. If no popstate came, drop the expectation and replace the stale
 * reader URL with the one the state wants. A reader reopened meanwhile owns
 * the URL again, so that case is left alone.
 */
function armLostPopTimer(): void {
  cancelLostPopTimer();
  lostPopTimer = setTimeout(() => {
    lostPopTimer = null;
    const loc = globalThis.location;
    if (expectReaderPop === null || !loc) return;
    const cur = useApp.getState();
    if (cur.fullscreenTaskId || !parseAppUrl(loc.pathname, loc.search)?.fullscreenTaskId) return;
    expectReaderPop = null;
    globalThis.history.replaceState(null, "", buildAppUrl(cur.view, cur.selectedTaskId, null));
  }, LOST_POP_MS);
}
/** True while a history traversal (e.g. the user's own Back) is already in flight, where the Navigation API exists. */
function traversalInFlight(): boolean {
  return (globalThis as { navigation?: { transition?: unknown } }).navigation?.transition != null;
}
export function markReplaceNext(): void {
  replaceNext = true;
}

/**
 * Two-way binding between the browser URL and view/selectedTaskId. Mount
 * exactly once, in Shell - so the URL is never rewritten before authentication
 * completes and a deep link survives the login round-trip.
 */
export function useUrlSync(): void {
  const view = useApp((s) => s.view);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const fullscreenTaskId = useApp((s) => s.fullscreenTaskId);

  // State -> URL. Opening the reader pushes one marked entry; closing it pops
  // that entry (only when it leads back to the URL now wanted) or replaces.
  // Otherwise push only when the view path changes; task select/deselect and
  // canonicalisation ("/" -> "/today", garbage -> "/today") replace, so Back
  // walks views, not row clicks.
  useEffect(() => {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist) {
      replaceNext = false;
      return;
    }
    const next = buildAppUrl(view, selectedTaskId, fullscreenTaskId);
    const op = decideHistoryOp({
      current: parseAppUrl(loc.pathname, loc.search),
      currentUrl: loc.pathname + loc.search,
      currentState: hist.state,
      view,
      selectedTaskId,
      fullscreenTaskId,
      replaceNext,
    });
    // "back" pops the reader entry we pushed; the popstate handler below
    // recognises it via expectReaderPop and leaves the state alone.
    // A back() on top of a traversal the user already started would go one
    // entry too far, so replace instead.
    if (op === "back" && traversalInFlight()) hist.replaceState(null, "", next);
    else if (op === "back") {
      expectReaderPop = readerUnder(hist.state);
      hist.back();
      armLostPopTimer();
    } else if (op === "push") hist.pushState(fullscreenTaskId ? readerState(loc.pathname + loc.search) : null, "", next);
    else if (op === "replace-reader") hist.replaceState(readerState(readerUnder(hist.state) ?? ""), "", next);
    else if (op === "replace") hist.replaceState(null, "", next);
    replaceNext = false;
  }, [view, selectedTaskId, fullscreenTaskId]);

  // URL -> state on back/forward. After popstate the location already equals
  // what the effect above would build, so it writes nothing: no echo loop.
  useEffect(() => {
    function onPop(): void {
      cancelLostPopTimer();
      const expected = expectReaderPop;
      expectReaderPop = null;
      const here = globalThis.location ? globalThis.location.pathname + globalThis.location.search : null;
      if (expected !== null && here === expected) {
        // Our own back() from a reader close: state already holds the intended
        // target (and focusedIndex/focusDeadline), so never overwrite it with
        // the older entry's route. If newer state landed meanwhile, realign
        // the address bar to it. A reader reopened before this popstate gets
        // its own entry on top of the one we landed on (like opening it from
        // there), so `under` names an entry that really is below it; replacing
        // would destroy that entry and make the next close pop one too far.
        const cur = useApp.getState();
        const want = buildAppUrl(cur.view, cur.selectedTaskId, cur.fullscreenTaskId);
        if (here !== want) {
          // Push when the view path differs (decideHistoryOp's rule), so the
          // landed entry is kept; replace only within the same path.
          const here0 = parseAppUrl(globalThis.location.pathname, globalThis.location.search);
          const pathChanged = here0 !== null && buildAppUrl(here0.view, null, null) !== buildAppUrl(cur.view, null, null);
          if (cur.fullscreenTaskId) globalThis.history.pushState(readerState(here), "", want);
          else if (pathChanged) globalThis.history.pushState(null, "", want);
          else globalThis.history.replaceState(null, "", want);
        }
        return;
      }
      const st = useApp.getState();
      // An open overlay owns its input (the same rule Shell's keyboard map
      // follows): Back must not silently retarget QuickAdd's project context or
      // close the palette mid-selection. The address bar keeps the popped URL
      // until the next view/task change reconciles it - a bounded, deliberate
      // inconsistency.
      if (st.quickAddOpen || st.paletteOpen) return;
      // A focused title/notes field commits on blur, and removing a focused node
      // does not fire blur - commit the pending edit before the state change
      // below unmounts or refills the panel.
      (globalThis.document?.activeElement as HTMLElement | null)?.blur?.();
      const loc = globalThis.location;
      if (!loc) return;
      const route = parseAppUrl(loc.pathname, loc.search);
      if (!route) return;
      useApp.setState({ view: route.view, selectedTaskId: route.taskId, fullscreenTaskId: route.fullscreenTaskId, focusDeadline: false, focusedIndex: -1 });
    }
    globalThis.addEventListener("popstate", onPop);
    return () => {
      globalThis.removeEventListener("popstate", onPop);
      cancelLostPopTimer();
      expectReaderPop = null;
    };
  }, []);
}
