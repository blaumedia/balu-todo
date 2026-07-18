// Self-contained calendar-date math (kept independent so the parser has no
// package dependencies — mobile reuses it directly). Dates are `YYYY-MM-DD`.

const DAY_MS = 86_400_000;

function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dow(iso: string): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/** Monday of the ISO week containing `iso`. */
export function weekMonday(iso: string): string {
  const d = dow(iso);
  const offset = d === 0 ? -6 : 1 - d;
  return addDays(iso, offset);
}

/** Nearest strictly-future occurrence of `targetDow` (never today). */
export function nextWeekday(ref: string, targetDow: number): string {
  const cur = dow(ref);
  let diff = (targetDow - cur + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(ref, diff);
}

/** "next <weekday>": the occurrence in next week or later. */
export function nextWeekWeekday(ref: string, targetDow: number): string {
  const base = nextWeekday(ref, targetDow);
  const nextMonday = addDays(weekMonday(ref), 7);
  return base < nextMonday ? addDays(base, 7) : base;
}

/** Build a `YYYY-MM-DD` from parts, validating the calendar. Returns null if invalid. */
export function makeDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Reject overflow (e.g. 31.02.).
  const back = fromUTC(Date.UTC(y, m - 1, d));
  return back === iso ? iso : null;
}
