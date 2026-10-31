import type { Locale, Membership, Theme, User, Workspace } from "@balu/domain";
import { create } from "zustand";
import { parseAppUrl, type ViewSel } from "../lib/url.js";

export type { ViewSel };

type Boot = "loading" | "login" | "ready";

const THEME_KEY = "balu:theme";
const WORKSPACE_KEY = "balu:workspace";

function initialTheme(): Theme {
  const v = globalThis.localStorage?.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** Deep-link seed: parsed once at module init so a reload or a link opened
 * before login restores the same view after boot. `/invite/:token` and
 * garbage parse to null and fall back to today. */
const initialRoute = parseAppUrl(globalThis.location?.pathname ?? "/", globalThis.location?.search ?? "");

/** Last-used workspace id (contract §7 multi-workspace), persisted locally. */
export function lastWorkspaceId(): string | null {
  return globalThis.localStorage?.getItem(WORKSPACE_KEY) ?? null;
}
export function rememberWorkspaceId(id: string): void {
  globalThis.localStorage?.setItem(WORKSPACE_KEY, id);
}

/** One button on a toast, e.g. "Unarchive". The toast dismisses itself after `run`. */
export interface ToastAction {
  label: string;
  run(): void;
  /**
   * Whether the button still does something. The store owns staleness: it asks
   * before a waiting toast is shown and on every app-store change or
   * revalidateToast() (sync changes) while the toast is shown or waiting, and
   * drops the toast once this returns false.
   */
  isValid?: () => boolean;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
  tone?: "success" | "error" | "info";
}
export type ToastTone = NonNullable<ToastOptions["tone"]>;

const TOAST_MS = 2600;
const ACTION_TOAST_MS = 10000;
// One timer for the one toast slot: a new toast restarts it, so showing the
// same message twice no longer lets the first timer clear the second.
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastDurationMs = TOAST_MS;
// Pointer and keyboard holds are tracked apart: leaving with the mouse must
// not release a hold that keyboard focus on the toast button still wants.
const toastHolds = { hover: false, focus: false };
// While an error toast is on screen, a later success/info/action toast waits
// here instead of erasing it (e.g. "access lost" must outlive "Added to Inbox").
// One slot, latest wins; it is shown when the error expires, and dropped when
// the error is dismissed (clearToast, defensive: any later non-deferred show
// resets it too) or the workspace is switched; an action toast is also dropped
// when the view it belongs to is left or its action.isValid() turns false.
let pendingToast: { message: string; opts?: ToastOptions } | null = null;

// A throwing isValid() counts as invalid: the toast is dropped and nothing
// escapes into the timer or the store subscriber.
function stillValid(a?: ToastAction | null): boolean {
  try {
    return a?.isValid?.() !== false;
  } catch {
    return false;
  }
}

function startToastTimer(set: (p: Partial<AppState>) => void): void {
  if (toastTimer) globalThis.clearTimeout(toastTimer);
  toastTimer = null;
  // Nothing on screen (e.g. an already-invalid action was just dropped): no timer.
  if (!useApp.getState().toast) return;
  if (toastHolds.hover || toastHolds.focus) return;
  toastTimer = globalThis.setTimeout(() => {
    const next = pendingToast;
    if (next && stillValid(next.opts?.action)) {
      // Straight from the error to the waiting toast in one set(): no empty
      // state in between that a subscriber could mistake for "toast gone".
      toastHolds.hover = false;
      toastHolds.focus = false;
      applyToast(set, next.message, next.opts);
    } else {
      clearToast(set);
    }
  }, toastDurationMs);
}

function applyToast(set: (p: Partial<AppState>) => void, message: string, opts?: ToastOptions): void {
  pendingToast = null;
  // Without an action button the focused one is gone, and an unmounted node
  // fires no blur, so its focus hold would otherwise stick for good.
  if (!opts?.action) toastHolds.focus = false;
  toastDurationMs = opts?.durationMs ?? (opts?.action ? ACTION_TOAST_MS : TOAST_MS);
  set({ toast: message, toastAction: opts?.action ?? null, toastTone: opts?.tone ?? "success", toastSeq: useApp.getState().toastSeq + 1 });
  startToastTimer(set);
}

function clearToast(set: (p: Partial<AppState>) => void): void {
  if (toastTimer) globalThis.clearTimeout(toastTimer);
  toastTimer = null;
  toastHolds.hover = false;
  toastHolds.focus = false;
  pendingToast = null;
  set({ toast: null, toastAction: null, toastTone: "success" });
}

export interface AppState {
  boot: Boot;
  user: User | null;
  workspace: Workspace | null;
  memberships: Membership[];
  view: ViewSel;
  selectedTaskId: string | null;
  fullscreenTaskId: string | null;
  focusDeadline: boolean;
  quickAddOpen: boolean;
  paletteOpen: boolean;
  theme: Theme;
  locale: Locale;

  // keyboard selection
  visibleTaskIds: string[];
  focusedIndex: number;

  // ambient toast (contract §7 accept flow, copy confirmations); at most one
  // action button (archived-project notice)
  toast: string | null;
  toastAction: ToastAction | null;
  toastTone: ToastTone;
  /** Bumps on every showToast, so a repeated message is announced again by the live regions. */
  toastSeq: number;
  /** While an error is shown, non-error toasts wait (latest wins) until it expires. */
  showToast(message: string, opts?: ToastOptions): void;
  dismissToast(): void;
  /** Re-check the action's isValid() for a shown or waiting toast; call after changes the app store cannot see (sync). */
  revalidateToast(): void;
  /** Pause the dismiss timer while the toast is hovered or focused; it runs again once both holds are released. */
  holdToast(source: "hover" | "focus", hold: boolean): void;

  setBoot(b: Boot): void;
  setSession(user: User, memberships: Membership[], workspace: Workspace): void;
  setUser(user: User): void;
  setMemberships(memberships: Membership[]): void;
  setWorkspace(workspace: Workspace): void;
  setView(view: ViewSel): void;
  selectTask(id: string | null, focusDeadline?: boolean): void;
  setFullscreen(id: string | null): void;
  setQuickAdd(open: boolean): void;
  setPalette(open: boolean): void;
  setTheme(theme: Theme): void;
  setLocale(locale: Locale): void;
  setVisibleTaskIds(ids: string[]): void;
  setFocusedIndex(i: number): void;
  moveFocus(delta: number): void;
  reset(): void;
}

export const useApp = create<AppState>((set, get) => ({
  boot: "loading",
  user: null,
  workspace: null,
  memberships: [],
  view: initialRoute?.view ?? { kind: "list", list: "today" },
  selectedTaskId: initialRoute?.taskId ?? null,
  fullscreenTaskId: initialRoute?.fullscreenTaskId ?? null,
  focusDeadline: false,
  quickAddOpen: false,
  paletteOpen: false,
  theme: initialTheme(),
  locale: "en",

  visibleTaskIds: [],
  focusedIndex: -1,

  toast: null,
  toastAction: null,
  toastTone: "success",
  toastSeq: 0,
  showToast: (message, opts) => {
    // An error is only replaced by another error; anything else (action
    // toasts included) is deferred until the error has expired.
    if (get().toast && get().toastTone === "error" && opts?.tone !== "error") {
      pendingToast = { message, opts };
      return;
    }
    applyToast(set, message, opts);
  },
  dismissToast: () => clearToast(set),
  revalidateToast: () => {
    if (!stillValid(pendingToast?.opts?.action)) pendingToast = null;
    if (get().toast && !stillValid(get().toastAction)) clearToast(set);
  },
  holdToast: (source, hold) => {
    if (!get().toast) return;
    toastHolds[source] = hold;
    startToastTimer(set);
  },

  setBoot: (boot) => set({ boot }),
  setSession: (user, memberships, workspace) => {
    rememberWorkspaceId(workspace.id);
    set({ user, memberships, workspace, locale: user.locale, boot: "ready" });
  },
  setUser: (user) => set({ user, locale: user.locale }),
  setMemberships: (memberships) => set({ memberships }),
  setWorkspace: (workspace) => {
    rememberWorkspaceId(workspace.id);
    // Only an action belongs to one workspace (e.g. Unarchive); a plain notice
    // such as "you lost access" must survive the switch that it causes. A
    // waiting toast would surface later in the wrong workspace: always drop it.
    if (get().toastAction) clearToast(set);
    else pendingToast = null;
    set({ workspace, view: { kind: "list", list: "today" }, selectedTaskId: null, fullscreenTaskId: null, focusedIndex: -1 });
  },
  setView: (view) => {
    // An action toast is about the view it was shown on (Unarchive for that
    // project); leaving the view drops it, re-selecting the same view keeps it.
    const left = JSON.stringify(get().view) !== JSON.stringify(view);
    if (left && get().toastAction) clearToast(set);
    else if (left && pendingToast?.opts?.action) pendingToast = null;
    set({ view, selectedTaskId: null, fullscreenTaskId: null, focusedIndex: -1 });
  },
  selectTask: (selectedTaskId, focusDeadline = false) => set({ selectedTaskId, focusDeadline }),
  setFullscreen: (fullscreenTaskId) => set({ fullscreenTaskId }),
  setQuickAdd: (quickAddOpen) => set({ quickAddOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setTheme: (theme) => {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
    set({ theme });
  },
  setLocale: (locale) => set({ locale }),
  setVisibleTaskIds: (visibleTaskIds) => {
    const { focusedIndex } = get();
    set({ visibleTaskIds, focusedIndex: Math.min(focusedIndex, visibleTaskIds.length - 1) });
  },
  setFocusedIndex: (focusedIndex) => set({ focusedIndex }),
  moveFocus: (delta) => {
    const { visibleTaskIds, focusedIndex } = get();
    if (visibleTaskIds.length === 0) return;
    const next = Math.max(0, Math.min(visibleTaskIds.length - 1, (focusedIndex < 0 ? 0 : focusedIndex) + (focusedIndex < 0 ? 0 : delta)));
    set({ focusedIndex: next });
  },
  reset: () => {
    clearToast(set);
    set({
      boot: "login",
      user: null,
      workspace: null,
      memberships: [],
      view: { kind: "list", list: "today" },
      selectedTaskId: null,
      fullscreenTaskId: null,
      quickAddOpen: false,
      paletteOpen: false,
    });
  },
}));

// Staleness is the store's concern, checked once here for every toast: any
// app-store change (view moved by Back/Forward, workspace, role) re-validates
// the shown or waiting action. Sync changes arrive via revalidateToast().
useApp.subscribe(() => useApp.getState().revalidateToast());
