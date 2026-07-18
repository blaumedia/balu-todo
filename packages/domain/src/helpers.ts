// Small ordering / container helpers shared by clients.

/** Next append `sort_order` for a container: `max + 1000`, or 1000 when empty. */
export function nextSortOrder(siblings: ReadonlyArray<{ sort_order: number }>): number {
  if (siblings.length === 0) return 1000;
  let max = -Infinity;
  for (const s of siblings) if (s.sort_order > max) max = s.sort_order;
  return max + 1000;
}
