import { describe, expect, it } from "vitest";
import { nextOccurrence, parseRrule } from "../src/index.js";

/**
 * Mirrored verbatim from `server/tests/test_recurrence.py::PARITY_VECTORS` —
 * the two engines must agree for every rule, or a completed recurring task
 * visibly jumps to a different date once the sync response lands (I1). Keep the
 * two lists in sync.
 */
const PARITY_VECTORS: Array<[rrule: string, anchor: string, after: string, expected: string]> = [
  // ── DAILY ────────────────────────────────────────────────────────────────
  ["FREQ=DAILY", "2026-07-23", "2026-07-23", "2026-07-24"],
  ["FREQ=DAILY;INTERVAL=3", "2026-07-23", "2026-07-23", "2026-07-26"],
  ["FREQ=DAILY;INTERVAL=3", "2026-07-01", "2026-07-08", "2026-07-10"],
  ["FREQ=DAILY;INTERVAL=5", "2026-07-01", "2026-07-23", "2026-07-26"],
  ["FREQ=DAILY", "2026-07-01", "2026-07-23", "2026-07-24"],
  ["FREQ=DAILY;INTERVAL=2", "2026-07-23", "2026-07-01", "2026-07-23"],

  // ── WEEKLY without BYDAY ─────────────────────────────────────────────────
  ["FREQ=WEEKLY", "2026-07-23", "2026-07-23", "2026-07-30"],
  ["FREQ=WEEKLY;INTERVAL=2", "2026-07-23", "2026-07-23", "2026-08-06"],
  ["FREQ=WEEKLY;INTERVAL=2", "2026-07-02", "2026-07-25", "2026-07-30"],
  ["FREQ=WEEKLY;INTERVAL=3", "2026-01-05", "2026-07-23", "2026-08-03"],

  // ── WEEKLY with BYDAY ────────────────────────────────────────────────────
  ["FREQ=WEEKLY;BYDAY=TU", "2026-07-22", "2026-07-22", "2026-07-28"],
  ["FREQ=WEEKLY;BYDAY=MO", "2026-07-23", "2026-07-23", "2026-07-27"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-07-21", "2026-07-21", "2026-07-24"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-07-24", "2026-07-24", "2026-08-04"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-07-21", "2026-07-25", "2026-08-04"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-07-06", "2026-08-05", "2026-08-17"],
  ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-07-06", "2026-07-25", "2026-08-03"],
  ["FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,SA", "2026-07-01", "2026-07-01", "2026-07-04"],
  ["FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,SA", "2026-07-04", "2026-07-04", "2026-07-22"],
  ["FREQ=WEEKLY;BYDAY=FR,MO", "2026-07-21", "2026-07-21", "2026-07-24"],

  // ── MONTHLY ──────────────────────────────────────────────────────────────
  ["FREQ=MONTHLY", "2026-07-15", "2026-07-15", "2026-08-15"],
  ["FREQ=MONTHLY", "2026-01-31", "2026-01-31", "2026-02-28"],
  ["FREQ=MONTHLY", "2024-01-31", "2024-01-31", "2024-02-29"],
  ["FREQ=MONTHLY", "2026-01-31", "2026-02-28", "2026-03-31"],
  ["FREQ=MONTHLY;INTERVAL=3", "2026-07-15", "2026-07-15", "2026-10-15"],
  ["FREQ=MONTHLY;INTERVAL=3", "2026-01-15", "2026-08-20", "2026-10-15"],
  ["FREQ=MONTHLY;INTERVAL=2", "2026-01-31", "2026-04-10", "2026-05-31"],

  // ── YEARLY ───────────────────────────────────────────────────────────────
  ["FREQ=YEARLY", "2026-03-10", "2026-03-10", "2027-03-10"],
  ["FREQ=YEARLY", "2024-02-29", "2024-02-29", "2025-02-28"],
  ["FREQ=YEARLY", "2024-02-29", "2027-01-01", "2027-02-28"],
  ["FREQ=YEARLY", "2024-02-29", "2027-03-01", "2028-02-29"],
  ["FREQ=YEARLY;INTERVAL=2", "2026-03-10", "2026-03-10", "2028-03-10"],
  ["FREQ=YEARLY;INTERVAL=5", "2020-06-01", "2026-07-23", "2030-06-01"],
];

describe("nextOccurrence — server parity vectors", () => {
  for (const [rrule, anchor, after, expected] of PARITY_VECTORS) {
    it(`${rrule} | anchor ${anchor} | after ${after} -> ${expected}`, () => {
      expect(nextOccurrence(rrule, anchor, after)).toBe(expected);
    });
  }

  it("always returns a date strictly after `after`", () => {
    for (const [, , after, expected] of PARITY_VECTORS) {
      expect(expected > after).toBe(true);
    }
  });
});

describe("parseRrule", () => {
  it("rejects unknown freq", () => {
    expect(parseRrule("FREQ=HOURLY")).toBeNull();
  });
  it("normalizes BYDAY to ascending Monday-based offsets", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=FR,MO,MO")?.byday).toEqual([0, 4]);
  });
  it("ignores BYDAY outside FREQ=WEEKLY (contract §3.3)", () => {
    expect(parseRrule("FREQ=DAILY;BYDAY=MO")?.byday).toEqual([]);
  });
  it("defaults interval to 1", () => {
    expect(parseRrule("FREQ=DAILY")?.interval).toBe(1);
  });
});
