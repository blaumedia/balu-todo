// Turn a drag result into sort_order mutations. Reorders rewrite the affected
// container with even 1000-spacing (contract §3.3 / §5.4) so a later reorder
// always heals any interleaving.

const STEP = 1000;

/** New `sort_order` for each id in visual order, evenly spaced from STEP. */
export function spacedOrders(orderedIds: string[]): Array<{ id: string; sort_order: number }> {
  return orderedIds.map((id, i) => ({ id, sort_order: (i + 1) * STEP }));
}

/** Move the item at `from` to `to`, returning a new id array. */
export function moveId(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return ids;
  next.splice(to, 0, item);
  return next;
}
