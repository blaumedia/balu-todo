/** A `Retry-After` beyond this is clamped: a client must keep trying. */
export const RETRY_AFTER_CAP_MS = 300_000;

/**
 * A `Retry-After` header value as ms: delta-seconds or an HTTP date, clamped to
 * {@link RETRY_AFTER_CAP_MS}; null when absent or unusable.
 */
export function parseRetryAfter(raw: string | null | undefined, now: number = Date.now()): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const secs = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
}
