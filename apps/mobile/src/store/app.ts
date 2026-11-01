import type { Locale, Membership, SmartList, Theme, User, Workspace } from '@balu/domain';
import { create } from 'zustand';
import { sqliteKV, SETTINGS } from '../lib/kv';

/**
 * `reconnecting`: signed in, but /me cannot be reached after the open workspace was
 * lost. `noWorkspace`: /me answered with an account that has no workspace. Both
 * show a full-screen notice (components/BootNotice) while lib/boot.ts keeps asking.
 */
export type Boot = 'loading' | 'onboarding' | 'reconnecting' | 'noWorkspace' | 'ready';

export type LoginNotice = 'sessionExpired';

/** The context the floating add button / quick-add creates into. */
export type ComposeContext =
  | { kind: 'list'; list: SmartList }
  | { kind: 'project'; projectId: string };

export interface AppState {
  boot: Boot;
  serverUrl: string | null;
  user: User | null;
  workspace: Workspace | null;
  memberships: Membership[];
  theme: Theme;
  locale: Locale;
  /** Local reminder notifications on (permission granted + user opted in). */
  remindersEnabled: boolean;

  /** Where a new task lands when created from the FAB. */
  context: ComposeContext;

  // Sheet controllers (cross-screen)
  quickAddOpen: boolean;
  detailTaskId: string | null;
  scheduleTaskId: string | null;
  projectActionsId: string | null;

  /** Shown above the login form (lib/boot.ts expireSession). */
  loginNotice: LoginNotice | null;
  setLoginNotice(notice: LoginNotice | null): void;
  setBoot(b: Boot): void;
  setServerUrl(url: string | null): void;
  setSession(user: User, memberships: Membership[], workspace: Workspace): void;
  setUser(user: User): void;
  setTheme(theme: Theme): void;
  setLocale(locale: Locale): void;
  setRemindersEnabled(enabled: boolean): void;
  setContext(context: ComposeContext): void;

  openQuickAdd(): void;
  closeQuickAdd(): void;
  openDetail(taskId: string): void;
  closeDetail(): void;
  openSchedule(taskId: string): void;
  closeSchedule(): void;
  openProjectActions(projectId: string): void;
  closeProjectActions(): void;

  reset(): void;
}

export const useApp = create<AppState>((set, get) => ({
  boot: 'loading',
  serverUrl: null,
  user: null,
  workspace: null,
  memberships: [],
  theme: 'system',
  locale: 'en',
  remindersEnabled: false,
  context: { kind: 'list', list: 'today' },

  quickAddOpen: false,
  detailTaskId: null,
  scheduleTaskId: null,
  projectActionsId: null,
  loginNotice: null,

  setBoot: (boot) => set({ boot }),
  setLoginNotice: (loginNotice) => set({ loginNotice }),
  setServerUrl: (serverUrl) => {
    if (serverUrl) void sqliteKV.setItem(SETTINGS.serverUrl, serverUrl);
    else void sqliteKV.removeItem(SETTINGS.serverUrl);
    set({ serverUrl });
  },
  setSession: (user, memberships, workspace) => {
    void sqliteKV.setItem(SETTINGS.session, JSON.stringify({ user, workspace }));
    // Remember the workspace so the next launch reopens it (§7, I8).
    void sqliteKV.setItem(SETTINGS.lastWorkspaceId, workspace.id);
    set({ user, memberships, workspace, locale: user.locale, boot: 'ready', loginNotice: null });
  },
  setUser: (user) => set({ user, locale: user.locale }),
  setTheme: (theme) => {
    void sqliteKV.setItem(SETTINGS.theme, theme);
    set({ theme });
  },
  setLocale: (locale) => {
    void sqliteKV.setItem(SETTINGS.locale, locale);
    // Keep user.locale in step: setUser({ ...user, name }) would otherwise carry
    // the old value and switch the language back. The cached session (offline boot)
    // is rewritten from the new state for the same reason.
    set((s) => ({ locale, user: s.user ? { ...s.user, locale } : s.user }));
    const { user, workspace } = get();
    if (user && workspace) void sqliteKV.setItem(SETTINGS.session, JSON.stringify({ user, workspace }));
  },
  setRemindersEnabled: (remindersEnabled) => {
    void sqliteKV.setItem(SETTINGS.remindersEnabled, remindersEnabled ? '1' : '0');
    set({ remindersEnabled });
  },
  setContext: (context) => set({ context }),

  openQuickAdd: () => set({ quickAddOpen: true }),
  closeQuickAdd: () => set({ quickAddOpen: false }),
  openDetail: (detailTaskId) => set({ detailTaskId }),
  closeDetail: () => set({ detailTaskId: null }),
  openSchedule: (scheduleTaskId) => set({ scheduleTaskId }),
  closeSchedule: () => set({ scheduleTaskId: null }),
  openProjectActions: (projectActionsId) => set({ projectActionsId }),
  closeProjectActions: () => set({ projectActionsId: null }),

  reset: () =>
    set({
      boot: 'onboarding',
      user: null,
      workspace: null,
      memberships: [],
      context: { kind: 'list', list: 'today' },
      quickAddOpen: false,
      detailTaskId: null,
      scheduleTaskId: null,
      projectActionsId: null,
      loginNotice: null,
    }),
}));
