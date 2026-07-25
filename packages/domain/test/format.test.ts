import { describe, expect, it } from "vitest";
import { relativeDate, relativeTime, type DateNames } from "../src/index.js";

// A deterministic stand-in for the platform name tables.
const NAMES: DateNames = {
  weekdayShort: (iso) => `WD(${iso})`,
  dayMonth: (iso) => `DM(${iso})`,
};
const LABELS = { today: "today", tomorrow: "tomorrow", yesterday: "yesterday" };
const TODAY = "2026-07-23";

describe("relativeDate", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(relativeDate(TODAY, TODAY, "en", NAMES, LABELS)).toEqual({ text: "today", tone: "today" });
    expect(relativeDate("2026-07-24", TODAY, "en", NAMES, LABELS)).toEqual({ text: "tomorrow", tone: "future" });
    expect(relativeDate("2026-07-22", TODAY, "en", NAMES, LABELS)).toEqual({ text: "yesterday", tone: "overdue" });
  });

  it("uses a weekday inside the coming week and a date beyond it", () => {
    expect(relativeDate("2026-07-27", TODAY, "en", NAMES, LABELS)).toEqual({
      text: "WD(2026-07-27)", tone: "future",
    });
    expect(relativeDate("2026-08-10", TODAY, "en", NAMES, LABELS)).toEqual({
      text: "DM(2026-08-10)", tone: "future",
    });
  });

  it("marks older dates overdue with a date label", () => {
    expect(relativeDate("2026-07-01", TODAY, "en", NAMES, LABELS)).toEqual({
      text: "DM(2026-07-01)", tone: "overdue",
    });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-23T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is compact and identical on every platform (I7)", () => {
    expect(relativeTime(ago(30_000), now, "en", NAMES, "just now")).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), now, "en", NAMES, "just now")).toBe("5m");
    expect(relativeTime(ago(2 * 3_600_000), now, "en", NAMES, "just now")).toBe("2h");
    expect(relativeTime(ago(3 * 86_400_000), now, "en", NAMES, "just now")).toBe("3d");
  });

  it("falls back to the date beyond a week", () => {
    expect(relativeTime("2026-07-01T09:00:00Z", now, "en", NAMES, "just now")).toBe("DM(2026-07-01)");
  });

  it("clamps a future timestamp instead of going negative", () => {
    expect(relativeTime("2026-07-24T12:00:00Z", now, "en", NAMES, "just now")).toBe("just now");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", now, "en", NAMES, "just now")).toBe("");
  });
});
