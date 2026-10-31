/** Delay before boot retry `attempt` (0-based): 1 s, doubling, capped at 30 s. */
export function bootRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}

/** Wait `ms`, or less if the browser reports it is back online. */
export function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      globalThis.removeEventListener?.("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    globalThis.addEventListener?.("online", done);
  });
}
