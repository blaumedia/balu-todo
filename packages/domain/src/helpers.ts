// Small ordering / container helpers shared by clients.

/** Next append `sort_order` for a container: `max + 1000`, or 1000 when empty. */
export function nextSortOrder(siblings: ReadonlyArray<{ sort_order: number }>): number {
  if (siblings.length === 0) return 1000;
  let max = -Infinity;
  for (const s of siblings) if (s.sort_order > max) max = s.sort_order;
  return max + 1000;
}

// Reorders rewrite the affected container with even 1000-spacing (contract
// §3.3 / §5.4) so a later reorder always heals any interleaving.
const STEP = 1000;
/** New `sort_order` for each id in visual order, evenly spaced from STEP. */
export function spacedOrders(orderedIds: ReadonlyArray<string>): Array<{ id: string; sort_order: number }> {
  return orderedIds.map((id, i) => ({ id, sort_order: (i + 1) * STEP }));
}
/**
 * The `sort_order` patches a drag result actually needs: `spacedOrders` over
 * `orderedIds`, minus every entry whose item already carries that value.
 * Ids not present in `items` are kept (a freshly added row still gets placed).
 */
export function reorderUpdates(
  items: ReadonlyArray<{ id: string; sort_order: number }>,
  orderedIds: ReadonlyArray<string>,
): Array<{ id: string; sort_order: number }> {
  const current = new Map(items.map((it) => [it.id, it.sort_order]));
  return spacedOrders(orderedIds).filter((u) => current.get(u.id) !== u.sort_order);
}
