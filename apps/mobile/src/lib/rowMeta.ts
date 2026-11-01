import type { IsoDate, Label, Locale, Task } from '@balu/domain';
import type { TranslationKey } from '../i18n';
import { relativeDate } from './format';

/** Labels shown as chips on a row; the rest collapse into a "+N" chip. */
const MAX_ROW_LABELS = 2;

/** Below this width in font-scale-independent dp the row meta stacks on two lines. */
const STACK_BELOW_DP = 360;

/**
 * Meta layout of a row: 'inline' keeps everything on one nowrap line, 'stacked'
 * puts the project/labels on their own line above the fixed items. Decided from
 * the window width divided by the font scale (the room text really has), so it
 * is deterministic and needs no measuring.
 */
export function metaLayout(windowWidthDp: number, fontScale: number): 'inline' | 'stacked' {
  return windowWidthDp / (fontScale > 0 ? fontScale : 1) < STACK_BELOW_DP ? 'stacked' : 'inline';
}

/**
 * Resolves a task's label ids to live labels (a deleted or unknown id is
 * skipped, like the web row) and splits them into the chips to render and the
 * count hidden behind the "+N" chip.
 */
export function rowLabels(
  labelIds: readonly string[],
  labels: ReadonlyMap<string, Label>,
  max: number = MAX_ROW_LABELS,
): { visible: Label[]; overflow: number } {
  const live = labelIds.map((id) => labels.get(id)).filter((l): l is Label => l != null && !l.is_deleted);
  return { visible: live.slice(0, max), overflow: Math.max(0, live.length - max) };
}

/** Screen-reader text for the "+N" chip, with the singular/plural form of the locale. */
export function moreLabelsText(n: number, t: (k: TranslationKey) => string): string {
  return t(n === 1 ? 'row.moreLabelsOne' : 'row.moreLabelsOther').replace('{n}', String(n));
}

/**
 * The date chip of a row: start date, else deadline. The accent "today" chip of
 * a start date is dropped only when hideToday is set (the Today list, where it
 * is redundant); a deadline due today always shows, since Today also lists rows
 * that merely start earlier, and overdue and future dates always show.
 * isDeadlineOnly marks a task with a deadline but no start date, so the chip
 * can carry the deadline icon.
 */
export function rowDate(
  task: Pick<Task, 'start_date' | 'deadline'>,
  today: IsoDate,
  locale: Locale,
  t: (k: TranslationKey) => string,
  hideToday: boolean,
): { info: ReturnType<typeof relativeDate>; isDeadlineOnly: boolean } | null {
  const primary = task.start_date ?? task.deadline;
  if (!primary) return null;
  const info = relativeDate(primary, today, locale, t);
  if (hideToday && info.tone === 'today' && task.start_date != null) return null;
  return { info, isDeadlineOnly: task.start_date == null };
}
