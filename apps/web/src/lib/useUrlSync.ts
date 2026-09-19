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
  const fullscreenTaskId = useApp((s) => s.fullscreenTaskId);

  // State -> URL. Push only when the view path changes; task select/deselect
  // and canonicalisation ("/" -> "/today", garbage -> "/today") replace, so
  // Back walks views, not row clicks.
  useEffect(() => {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist) {
      replaceNext = false;
      return;
    }
    const next = buildAppUrl(view, selectedTaskId, fullscreenTaskId);
    if (next === loc.pathname + loc.search) {
      replaceNext = false;
      return;
    }
    const current = parseAppUrl(loc.pathname, loc.search);
    const pathChanged =
      current === null ||
      buildAppUrl(current.view, null, current.fullscreenTaskId) !== buildAppUrl(view, null, fullscreenTaskId);
    if (pathChanged && current !== null && !replaceNext) hist.pushState(null, "", next);
    else hist.replaceState(null, "", next);
    replaceNext = false;
  }, [view, selectedTaskId, fullscreenTaskId]);

  // URL -> state on back/forward. After popstate the location already equals
  // what the effect above would build, so it writes nothing: no echo loop.
  useEffect(() => {
    function onPop(): void {
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
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);
}
