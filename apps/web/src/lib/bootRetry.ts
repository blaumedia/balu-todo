import { REFRESH_KEY } from "@balu/api-client";

/** Delay before boot retry `attempt` (0-based): 1 s, doubling, capped at 30 s. */
export function bootRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}

/**
 * How long to wait before boot retry `attempt`: the backoff with +-20% jitter, so
 * clients that failed together do not return together, and never less than the
 * server's Retry-After.
 */
export function bootRetryWaitMs(attempt: number, retryAfterMs: number | null = null): number {
  return Math.max(bootRetryDelayMs(attempt) * (0.8 + Math.random() * 0.4), retryAfterMs ?? 0);
}

let wakeCurrent: (() => void) | null = null;
/** End a running `waitForRetry` now (the user logged out while the screen was waiting). */
export function wakeBootRetry(): void {
  wakeCurrent?.();
}

let epoch = 0;
/** Counts logouts: a boot loop started under an older value belongs to a login that is gone. */
export function bootEpoch(): number {
  return epoch;
}
/**
 * The user logged out: every boot loop in flight is over (it must stop at its next
 * check, whatever its pending request answers) and one waiting on a retry wakes now.
 */
export function endBootAttempts(): void {
  epoch += 1;
  wakeBootRetry();
}

/**
 * Wait `ms`, or less if the browser reports it is back online or another tab
 * changed the stored login (so the boot loop notices a logout there).
 */
export function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const onStorage = (e: Event): void => {
      const key = (e as { key?: string | null }).key;
      if (key === null || key === REFRESH_KEY) done();
    };
    const done = (): void => {
      if (wakeCurrent === done) wakeCurrent = null;
      clearTimeout(timer);
      globalThis.removeEventListener?.("online", done);
      globalThis.removeEventListener?.("storage", onStorage);
      resolve();
    };
    const timer = setTimeout(done, ms);
    wakeCurrent = done;
    globalThis.addEventListener?.("online", done);
    globalThis.addEventListener?.("storage", onStorage);
  });
}
