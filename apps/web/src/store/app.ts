import type { Locale, Membership, SmartList, Theme, User, Workspace } from "@balu/domain";
import { create } from "zustand";

export type ViewSel =
  | { kind: "list"; list: SmartList }
  | { kind: "project"; projectId: string }
  | { kind: "settings" };

type Boot = "loading" | "login" | "ready";

const THEME_KEY = "balu:theme";
const WORKSPACE_KEY = "balu:workspace";

function initialTheme(): Theme {
  const v = globalThis.localStorage?.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** Last-used workspace id (contract §7 multi-workspace), persisted locally. */
export function lastWorkspaceId(): string | null {
  return globalThis.localStorage?.getItem(WORKSPACE_KEY) ?? null;
}
export function rememberWorkspaceId(id: string): void {
  globalThis.localStorage?.setItem(WORKSPACE_KEY, id);
}

export interface AppState {
  boot: Boot;
  user: User | null;
  workspace: Workspace | null;
  memberships: Membership[];
  view: ViewSel;
  selectedTaskId: string | null;
  focusDeadline: boolean;
  quickAddOpen: boolean;
  paletteOpen: boolean;
  theme: Theme;
  locale: Locale;

  // keyboard selection
  visibleTaskIds: string[];
  focusedIndex: number;

  // ambient toast (contract §7 accept flow, copy confirmations)
  toast: string | null;
  showToast(message: string): void;

  setBoot(b: Boot): void;
  setSession(user: User, memberships: Membership[], workspace: Workspace): void;
  setUser(user: User): void;
  setMemberships(memberships: Membership[]): void;
  setWorkspace(workspace: Workspace): void;
  setView(view: ViewSel): void;
  selectTask(id: string | null, focusDeadline?: boolean): void;
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
  view: { kind: "list", list: "today" },
  selectedTaskId: null,
  focusDeadline: false,
  quickAddOpen: false,
  paletteOpen: false,
  theme: initialTheme(),
  locale: "en",

  visibleTaskIds: [],
  focusedIndex: -1,

  toast: null,
  showToast: (message) => {
    set({ toast: message });
    globalThis.setTimeout(() => {
      if (get().toast === message) set({ toast: null });
    }, 2600);
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
    set({ workspace, view: { kind: "list", list: "today" }, selectedTaskId: null, focusedIndex: -1 });
  },
  setView: (view) => set({ view, selectedTaskId: null, focusedIndex: -1 }),
  selectTask: (selectedTaskId, focusDeadline = false) => set({ selectedTaskId, focusDeadline }),
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
  reset: () =>
    set({
      boot: "login",
      user: null,
      workspace: null,
      memberships: [],
      view: { kind: "list", list: "today" },
      selectedTaskId: null,
      quickAddOpen: false,
      paletteOpen: false,
    }),
}));
