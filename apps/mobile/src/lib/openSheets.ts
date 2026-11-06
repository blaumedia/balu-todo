// How many BottomSheets are really on screen, so the screen behind them is hidden from TalkBack only
// while one is (a store id can be set while its sheet is not visible). Pure - no React Native imports.

let count = 0;
const listeners = new Set<() => void>();

/** Register one visible sheet; the returned function unregisters it (calling it twice is harmless). */
export function registerOpenSheet(): () => void {
  let active = true;
  count += 1;
  listeners.forEach((l) => l());
  return () => {
    if (!active) return;
    active = false;
    count -= 1;
    listeners.forEach((l) => l());
  };
}

export function anySheetOpen(): boolean {
  return count > 0;
}

export function subscribeOpenSheets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
