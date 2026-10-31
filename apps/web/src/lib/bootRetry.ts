/** Delay before boot retry `attempt` (0-based): 1 s, doubling, capped at 30 s. */
export function bootRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}

/**
 * Wait `ms`, or less if the browser reports it is back online or another tab
 * changed the stored login (so the boot loop notices a logout there).
 */
export function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const onStorage = (e: Event): void => {
      const key = (e as { key?: string | null }).key;
      if (key === null || key === "balu:auth:refresh") done();
    };
    const done = (): void => {
      clearTimeout(timer);
      globalThis.removeEventListener?.("online", done);
      globalThis.removeEventListener?.("storage", onStorage);
      resolve();
    };
    const timer = setTimeout(done, ms);
    globalThis.addEventListener?.("online", done);
    globalThis.addEventListener?.("storage", onStorage);
  });
}
