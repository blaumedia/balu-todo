import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  addMonthsISO,
  addYearsISO,
  compareISO,
  diffDaysISO,
  dowISO,
  todayLocalISO,
} from "../src/index.js";

describe("date utils", () => {
  it("addDaysISO crosses month boundaries", () => {
    expect(addDaysISO("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("addMonthsISO clamps the day", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("addYearsISO handles leap days", () => {
    expect(addYearsISO("2024-02-29", 1)).toBe("2025-02-28");
  });
  it("diffDaysISO", () => {
    expect(diffDaysISO("2026-07-23", "2026-07-31")).toBe(8);
  });
  it("compareISO", () => {
    expect(compareISO("2026-07-23", "2026-07-24")).toBe(-1);
    expect(compareISO("2026-07-24", "2026-07-23")).toBe(1);
    expect(compareISO("2026-07-23", "2026-07-23")).toBe(0);
  });
  it("dowISO: 2026-07-23 is a Thursday", () => {
    expect(dowISO("2026-07-23")).toBe(4);
  });
  it("todayLocalISO matches the local date", () => {
    const d = new Date(2026, 6, 23, 15, 30);
    expect(todayLocalISO(d)).toBe("2026-07-23");
  });
});
