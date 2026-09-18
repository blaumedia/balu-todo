import { useEffect } from "react";
import { useApp } from "../store/app.js";
import { buildAppUrl, parseAppUrl } from "./url.js";

/**
 * One-shot escape hatch: the next state->URL write uses replaceState even if
 * the path changed. Used by self-healing fallbacks (unknown project id) so
 * they never add a history entry the user did not ask for.
 */
let replaceNext = false;
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

  // State -> URL. Push only when the view path changes; task select/deselect
  // and canonicalisation ("/" -> "/today", garbage -> "/today") replace, so
  // Back walks views, not row clicks.
  useEffect(() => {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist) return;
    const next = buildAppUrl(view, selectedTaskId);
    if (next === loc.pathname + loc.search) {
      replaceNext = false;
      return;
    }
    const current = parseAppUrl(loc.pathname, loc.search);
    const pathChanged = current === null || buildAppUrl(current.view, null) !== buildAppUrl(view, null);
    if (pathChanged && current !== null && !replaceNext) hist.pushState(null, "", next);
    else hist.replaceState(null, "", next);
    replaceNext = false;
  }, [view, selectedTaskId]);

  // URL -> state on back/forward. After popstate the location already equals
  // what the effect above would build, so it writes nothing: no echo loop.
  useEffect(() => {
    function onPop(): void {
      const loc = globalThis.location;
      if (!loc) return;
      const route = parseAppUrl(loc.pathname, loc.search);
      if (!route) return;
      useApp.setState({ view: route.view, selectedTaskId: route.taskId, focusDeadline: false, focusedIndex: -1 });
    }
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);
}
