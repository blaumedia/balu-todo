import type { Label } from '@balu/domain';

/** Labels shown as chips on a row; the rest collapse into a "+N" chip. */
const MAX_ROW_LABELS = 2;

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
