// Pure reminder-reconcile logic — no React Native / expo imports so it runs in
// a plain node (vitest) environment. Maps a replica task snapshot to the set of
// local notifications that *should* be scheduled; `notifications.ts` performs
// the impure scheduling against expo-notifications.
import { isOpen, type Task } from '@balu/domain';

/** iOS caps pending local notifications at 64; we stay well under (contract §8). */
export const REMINDER_CAP = 50;

export interface DesiredReminder {
  /** The task the reminder belongs to (carried as notification `data.taskId`). */
  taskId: string;
  /** When the notification should fire, epoch milliseconds (from `reminder_at`). */
  fireAtMs: number;
  /** Notification title — the task title. */
  title: string;
  /** Notification body — project · deadline (built by the caller). */
  body: string;
}

export interface ReconcileInput {
  tasks: readonly Task[];
  /** "now" in epoch ms; injected so the selection is deterministic in tests. */
  nowMs: number;
  /** Renders the notification body for a task (project · deadline, localized). */
  renderBody: (task: Task) => string;
  /** Max notifications to schedule; defaults to {@link REMINDER_CAP}. */
  cap?: number;
}

/**
 * The desired local-notification set for a replica snapshot: open, non-deleted
 * tasks whose `reminder_at` is strictly in the future, soonest first, capped.
 * Pure and total — same input always yields the same output.
 */
export function reconcileReminders(input: ReconcileInput): DesiredReminder[] {
  const cap = input.cap ?? REMINDER_CAP;
  const desired: DesiredReminder[] = [];

  for (const task of input.tasks) {
    if (!isOpen(task) || task.reminder_at == null) continue;
    const fireAtMs = Date.parse(task.reminder_at);
    if (Number.isNaN(fireAtMs) || fireAtMs <= input.nowMs) continue;
    desired.push({
      taskId: task.id,
      fireAtMs,
      title: task.title,
      body: input.renderBody(task),
    });
  }

  desired.sort((a, b) => a.fireAtMs - b.fireAtMs);
  return desired.slice(0, cap);
}
