// Local reminder notifications (expo-notifications, local scheduling only —
// remote push is out of scope and does not work in Expo Go, contract §8).
// This is the impure side: permissions, the foreground handler, and a
// debounced reconcile that mirrors the replica's future `reminder_at`s onto the
// OS scheduler. The selection logic itself lives in `reminderPlan.ts` (pure,
// unit-tested).
import type { Locale, Project, Task } from '@balu/domain';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { makeT, type TranslationKey } from '../i18n';
import { useApp } from '../store/app';
import { getSync } from './clients';
import { dayMonth } from './format';
import { reconcileReminders } from './reminderPlan';

const RECONCILE_DEBOUNCE_MS = 800;

let started = false;
let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Show reminders as a banner even while the app is foregrounded. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function getReminderPermissionGranted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** Ask the OS for notification permission; returns whether it was granted. */
export async function requestReminderPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Body line for a reminder: "Project · 31 Jul" (either part optional). */
function buildBody(
  task: Task,
  projects: Map<string, Project>,
  locale: Locale,
  t: (k: TranslationKey) => string,
): string {
  const parts: string[] = [];
  const project = task.project_id ? projects.get(task.project_id) : undefined;
  parts.push(project && !project.is_deleted ? project.name : t('detail.noProject'));
  if (task.deadline) parts.push(dayMonth(task.deadline, locale));
  return parts.join(' · ');
}

/** Cancel every notification this app scheduled and re-arm the desired set. */
async function reconcile(): Promise<void> {
  const sync = getSync();
  if (!started || !sync) return;

  const snap = sync.getSnapshot();
  const projects = new Map(snap.projects.map((p) => [p.id, p]));
  const locale = useApp.getState().locale;
  const t = makeT(locale);

  const desired = reconcileReminders({
    tasks: snap.tasks,
    nowMs: Date.now(),
    renderBody: (task) => buildBody(task, projects, locale, t),
  });

  // This app schedules only reminders, so cancel-all is exactly "our" set.
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const d of desired) {
    await Notifications.scheduleNotificationAsync({
      content: { title: d.title, body: d.body, data: { taskId: d.taskId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(d.fireAtMs) },
    });
  }
}

function scheduleReconcile(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void reconcile(), RECONCILE_DEBOUNCE_MS);
}

/**
 * Begin mirroring the replica onto the OS scheduler: reconcile now, then after
 * every (debounced) replica change. Idempotent — safe to call on enable, on
 * boot, and after the sync client is (re)created on login.
 */
export function startReminderScheduler(): void {
  started = true;
  // Re-attach if the sync client was replaced (login / server change).
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  const sync = getSync();
  if (sync) unsubscribe = sync.subscribe(scheduleReconcile);
  void reconcile();
}

/** Stop mirroring and clear every reminder this app scheduled. */
export function stopReminderScheduler(): void {
  started = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  void Notifications.cancelAllScheduledNotificationsAsync();
}

/** True once the scheduler has been started (reminders enabled + permitted). */
export function isReminderSchedulerActive(): boolean {
  return started;
}

/** Read the `taskId` a notification carries, if any. */
export function taskIdFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data;
  const taskId = data && (data as Record<string, unknown>).taskId;
  return typeof taskId === 'string' ? taskId : null;
}

/**
 * Deep-link into a task's detail from a tapped reminder: land on a tab screen
 * (expo-router) and open the store-driven detail sheet — the same surface used
 * for task detail everywhere in the app.
 */
export function openTaskFromNotification(taskId: string): void {
  try {
    router.navigate('/today');
  } catch {
    /* router may not be ready on the very first frame; the sheet still opens */
  }
  useApp.getState().openDetail(taskId);
}
