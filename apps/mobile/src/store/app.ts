import type { Locale, Membership, SmartList, Theme, User, Workspace } from '@balu/domain';
import { create } from 'zustand';
import { sqliteKV, SETTINGS } from '../lib/kv';

type Boot = 'loading' | 'onboarding' | 'ready';

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

  reset(): void;
}

export const useApp = create<AppState>((set) => ({
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

  setBoot: (boot) => set({ boot }),
  setServerUrl: (serverUrl) => {
    if (serverUrl) void sqliteKV.setItem(SETTINGS.serverUrl, serverUrl);
    else void sqliteKV.removeItem(SETTINGS.serverUrl);
    set({ serverUrl });
  },
  setSession: (user, memberships, workspace) => {
    void sqliteKV.setItem(SETTINGS.session, JSON.stringify({ user, workspace }));
    // Remember the workspace so the next launch reopens it (§7, I8).
    void sqliteKV.setItem(SETTINGS.lastWorkspaceId, workspace.id);
    set({ user, memberships, workspace, locale: user.locale, boot: 'ready' });
  },
  setUser: (user) => set({ user, locale: user.locale }),
  setTheme: (theme) => {
    void sqliteKV.setItem(SETTINGS.theme, theme);
    set({ theme });
  },
  setLocale: (locale) => {
    void sqliteKV.setItem(SETTINGS.locale, locale);
    set({ locale });
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
    }),
}));
