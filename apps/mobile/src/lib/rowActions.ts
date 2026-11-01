export type RowActionName = 'complete' | 'schedule';

/**
 * Accessibility actions of a task row. Swipes are unreachable with
 * TalkBack/VoiceOver, so rows with swipe actions (writer, swipeable) expose the
 * same two actions; all other rows expose none.
 */
export function rowAccessibilityActions(
  swipeable: boolean,
  writable: boolean,
  labels: { complete: string; schedule: string },
): { name: RowActionName; label: string }[] | undefined {
  if (!swipeable || !writable) return undefined;
  return [
    { name: 'complete', label: labels.complete },
    { name: 'schedule', label: labels.schedule },
  ];
}

/** Route an accessibility action name to its handler; unknown names are ignored. */
export function dispatchRowAction(name: string, handlers: { complete: () => void; schedule: () => void }): void {
  if (name === 'complete') handlers.complete();
  else if (name === 'schedule') handlers.schedule();
}
