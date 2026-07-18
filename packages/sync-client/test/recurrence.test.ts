import { describe, expect, it } from "vitest";
import { nextOccurrence, parseRrule } from "../src/index.js";

describe("nextOccurrence", () => {
  it("daily", () => {
    expect(nextOccurrence("FREQ=DAILY", "2026-07-23", "2026-07-23")).toBe("2026-07-24");
  });
  it("daily interval 3", () => {
    expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", "2026-07-23", "2026-07-23")).toBe("2026-07-26");
  });
  it("weekly", () => {
    expect(nextOccurrence("FREQ=WEEKLY", "2026-07-23", "2026-07-23")).toBe("2026-07-30");
  });
  it("weekly interval 2", () => {
    expect(nextOccurrence("FREQ=WEEKLY;INTERVAL=2", "2026-07-23", "2026-07-23")).toBe("2026-08-06");
  });
  it("weekly by day (Monday), anchored on a Thursday", () => {
    // Next Monday strictly after the Thursday anchor.
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-07-23", "2026-07-23")).toBe("2026-07-27");
  });
  it("weekly by day every other Tuesday", () => {
    // Anchor Tue 2026-07-21; interval 2 → skip 07-28, land 08-04.
    expect(nextOccurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-07-21", "2026-07-25")).toBe("2026-08-04");
  });
  it("monthly clamps", () => {
    expect(nextOccurrence("FREQ=MONTHLY", "2026-01-31", "2026-01-31")).toBe("2026-02-28");
  });
  it("yearly", () => {
    expect(nextOccurrence("FREQ=YEARLY", "2026-07-23", "2026-07-23")).toBe("2027-07-23");
  });
  it("jumps past a far-future 'after'", () => {
    expect(nextOccurrence("FREQ=DAILY", "2026-07-01", "2026-07-23")).toBe("2026-07-24");
  });
  it("rejects unknown freq", () => {
    expect(parseRrule("FREQ=HOURLY")).toBeNull();
  });
});
