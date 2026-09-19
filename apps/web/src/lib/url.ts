import type { SmartList } from "@balu/domain";

/**
 * Which main surface is on screen. Lives here (not in the store) so the pure
 * URL mapping has no import cycle with store/app.ts; the store re-exports it.
 */
export type ViewSel =
  | { kind: "list"; list: SmartList }
  | { kind: "project"; projectId: string }
  | { kind: "settings" };

export interface AppRoute {
  view: ViewSel;
  taskId: string | null;
  fullscreenTaskId: string | null;
}

const SMART_LISTS: readonly SmartList[] = [
  "inbox",
  "today",
  "upcoming",
  "anytime",
  "someday",
  "logbook",
  "assigned",
];

/**
 * URL -> route. Returns null for anything this app does not own (garbage,
 * `/invite/:token`, ...) so callers fall back to the default view. `/` is an
 * entry alias for today; buildAppUrl canonicalises it to `/today`.
 */
export function parseAppUrl(pathname: string, search: string): AppRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const raw = new URLSearchParams(search).get("task");
  const taskId = raw ? raw : null;
  if (path === "/") return { view: { kind: "list", list: "today" }, taskId, fullscreenTaskId: null };
  if (path === "/settings") return { view: { kind: "settings" }, taskId: null, fullscreenTaskId: null };
  const seg = path.split("/").slice(1);
  if (seg.length === 1) {
    const list = SMART_LISTS.find((l) => l === seg[0]);
    return list ? { view: { kind: "list", list }, taskId, fullscreenTaskId: null } : null;
  }
  if (seg.length === 2 && seg[0] === "project" && seg[1]) {
    try {
      return { view: { kind: "project", projectId: decodeURIComponent(seg[1]) }, taskId, fullscreenTaskId: null };
    } catch {
      return null;
    }
  }
  if (seg.length === 2 && seg[0] === "task" && seg[1]) {
    try {
      // Full-screen task view. The underlying view is not encoded in the URL -
      // a reload falls back to Today behind the modal - and the task is also
      // the panel selection, so closing the modal keeps the task on screen.
      // Any ?task= query is ignored: the path id wins.
      const id = decodeURIComponent(seg[1]);
      return { view: { kind: "list", list: "today" }, taskId: id, fullscreenTaskId: id };
    } catch {
      return null;
    }
  }
  return null;
}

/** Route -> canonical URL (pathname + search). Settings never carries a task. */
export function buildAppUrl(view: ViewSel, taskId: string | null, fullscreenTaskId: string | null = null): string {
  if (fullscreenTaskId) return `/task/${encodeURIComponent(fullscreenTaskId)}`;
  let path: string;
  if (view.kind === "settings") path = "/settings";
  else if (view.kind === "project") path = `/project/${encodeURIComponent(view.projectId)}`;
  else path = `/${view.list}`;
  return taskId && view.kind !== "settings" ? `${path}?task=${encodeURIComponent(taskId)}` : path;
}
