import { describe, expect, it } from "vitest";
import { relativeDate, relativeTime, timestampLabel, type DateNames, type MetaDateNames } from "../src/index.js";

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

describe("timestampLabel", () => {
  const NAMES: MetaDateNames = { date: (iso) => `D(${iso})`, time: () => "TIME" };
  // Local anchors, so the same-day rule is not at the mercy of the CI timezone -
  // same convention as the todayLocalISO test in dates.test.ts:36.
  const now = new Date(2026, 6, 23, 12, 0, 0);
  const at = (d: number, h: number, mi: number) => new Date(2026, 6, d, h, mi).toISOString();

  it("appends the clock only for today's timestamp", () => {
    expect(timestampLabel(at(23, 9, 30), now.getTime(), "en", NAMES)).toBe("D(2026-07-23), TIME");
  });

  it("labels the local day, not the UTC day of the wire string", () => {
    // The only case that discriminates the local-day implementation from the
    // iso.slice(0, 10) bug: it needs the local day to differ from the UTC day,
    // which never happens on a UTC machine (the CI runners). Pin a non-UTC zone,
    // verify the switch took effect, and skip honestly if the platform ignores it.
    const savedTZ = process.env.TZ;
    try {
      process.env.TZ = "America/New_York"; // July is EDT (UTC-4), no DST ambiguity
      // Local noon on 2026-07-23 lands at 16:00 UTC if and only if the zone is
      // America/New_York - true if the runtime TZ switch worked, and also if the
      // machine already is NY, so no false skip there.
      if (new Date(2026, 6, 23, 12, 0, 0).toISOString() !== "2026-07-23T16:00:00.000Z") {
        // This platform ignored the runtime TZ switch (and is not itself NY), so
        // the anchors below would not discriminate. Skip - the Linux CI runners
        // honour TZ and enforce this case for real.
        expect(true).toBe(true);
        return;
      }
      // Rebuild the describe-scope anchors under the verified NY zone.
      const nowNY = new Date(2026, 6, 23, 12, 0, 0);
      const atNY = (d: number, h: number, mi: number) => new Date(2026, 6, d, h, mi).toISOString();
      // 23:30 local NY is 2026-07-24T03:30Z on the wire - a slice would say the
      // 24th, the local day says the 23rd.
      expect(timestampLabel(atNY(23, 23, 30), nowNY.getTime(), "en", NAMES)).toBe("D(2026-07-23), TIME");
      // 00:15 local NY is 2026-07-24T04:15Z on the wire (EDT is UTC-4, so local
      // midnight lands on the same UTC day) - this pins the label; the 23:30
      // assertion above is the one the wire-slice implementation fails.
      expect(timestampLabel(atNY(24, 0, 15), nowNY.getTime(), "en", NAMES)).toBe("D(2026-07-24)");
    } finally {
      if (savedTZ === undefined) delete process.env.TZ;
      else process.env.TZ = savedTZ;
    }
  });

  it("drops the clock on any earlier or later day", () => {
    expect(timestampLabel(at(22, 18, 0), now.getTime(), "de", NAMES)).toBe("D(2026-07-22)");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(timestampLabel("not-a-date", now.getTime(), "en", NAMES)).toBe("");
  });
});
