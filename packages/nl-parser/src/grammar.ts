// Locale grammars for the quick-add parser. Each matcher yields a global RegExp
// (with named groups) plus a `build` that turns a match into a token payload.
// Longest-match / earliest wins is resolved by the caller.

import {
  addDays,
  makeDate,
  nextWeekday,
  nextWeekWeekday,
  weekMonday,
} from "./dateMath.js";
import type { Locale, TokenType } from "./types.js";

export interface Payload {
  type: TokenType;
  value: string | number;
}

export interface Matcher {
  re: RegExp;
  build: (m: RegExpExecArray, ref: string) => Payload | null;
}

type Groups = Record<string, string | undefined>;

// ── Weekday tables ────────────────────────────────────────────────────

interface Weekday {
  dow: number;
  byday: string;
}

const EN_WD: Array<[string[], number, string]> = [
  [["sunday", "sun"], 0, "SU"],
  [["monday", "mon"], 1, "MO"],
  [["tuesday", "tues", "tue"], 2, "TU"],
  [["wednesday", "weds", "wed"], 3, "WE"],
  [["thursday", "thurs", "thur", "thu"], 4, "TH"],
  [["friday", "fri"], 5, "FR"],
  [["saturday", "sat"], 6, "SA"],
];

const DE_WD: Array<[string[], number, string]> = [
  [["sonntag", "so"], 0, "SU"],
  [["montag", "mo"], 1, "MO"],
  [["dienstag", "di"], 2, "TU"],
  [["mittwoch", "mi"], 3, "WE"],
  [["donnerstag", "do"], 4, "TH"],
  [["freitag", "fr"], 5, "FR"],
  [["samstag", "sonnabend", "sa"], 6, "SA"],
];

function weekdayData(locale: Locale): { map: Record<string, Weekday>; alt: string } {
  const table = locale === "de" ? DE_WD : EN_WD;
  const map: Record<string, Weekday> = {};
  const syns: string[] = [];
  for (const [names, dow, byday] of table) {
    for (const n of names) {
      map[n] = { dow, byday };
      syns.push(n);
    }
  }
  syns.sort((a, b) => b.length - a.length);
  return { map, alt: syns.join("|") };
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DL: Record<Locale, string> = { en: "by|due", de: "bis" };

// ── Recurrence helpers ────────────────────────────────────────────────

function rruleDaily(interval: number): string {
  return interval > 1 ? `FREQ=DAILY;INTERVAL=${interval}` : "FREQ=DAILY";
}
function rruleWeekly(interval: number, byday?: string): string {
  let s = "FREQ=WEEKLY";
  if (interval > 1) s += `;INTERVAL=${interval}`;
  if (byday) s += `;BYDAY=${byday}`;
  return s;
}

// ── Date value builders ───────────────────────────────────────────────

function resolveDMY(g: Groups, ref: string): string | null {
  const d = Number(g["d"]);
  const mo = Number(g["mo"]);
  const yStr = g["y"];
  const refYear = Number(ref.slice(0, 4));
  if (yStr) return makeDate(Number(yStr), mo, d);
  // No year: use ref year, roll to next year if already past.
  const cand = makeDate(refYear, mo, d);
  if (!cand) return null;
  return cand < ref ? makeDate(refYear + 1, mo, d) : cand;
}

function resolveMonthName(g: Groups, ref: string): string | null {
  const raw = (g["mon"] ?? "").toLowerCase().slice(0, 3);
  const mo = EN_MONTHS[raw];
  const d = Number(g["md"]);
  if (!mo) return null;
  const refYear = Number(ref.slice(0, 4));
  const cand = makeDate(refYear, mo, d);
  if (!cand) return null;
  return cand < ref ? makeDate(refYear + 1, mo, d) : cand;
}

// ── Matcher assembly ──────────────────────────────────────────────────

const BOUND_PRE = "(?<=^|\\s)";
const BOUND_POST = "(?=$|[\\s.,;])";

/** Wrap a date core so it optionally absorbs a leading deadline keyword. */
function dateMatcher(
  locale: Locale,
  core: string,
  toDate: (g: Groups, ref: string) => string | null,
): Matcher {
  const re = new RegExp(
    `${BOUND_PRE}(?:(?<dl>${DL[locale]})\\s+)?(?:${core})${BOUND_POST}`,
    "giu",
  );
  return {
    re,
    build: (m, ref) => {
      const g = m.groups ?? {};
      const value = toDate(g, ref);
      if (!value) return null;
      return { type: g["dl"] ? "deadline" : "start", value };
    },
  };
}

function eveningMatcher(locale: Locale, core: string): Matcher {
  const re = new RegExp(
    `${BOUND_PRE}(?:(?<dl>${DL[locale]})\\s+)?(?:${core})${BOUND_POST}`,
    "giu",
  );
  return {
    re,
    build: (m, ref) => {
      const g = m.groups ?? {};
      if (g["dl"]) return { type: "deadline", value: ref };
      return { type: "evening", value: ref };
    },
  };
}

function recMatcher(core: string, toRrule: (g: Groups) => string | null): Matcher {
  const re = new RegExp(`${BOUND_PRE}(?:${core})${BOUND_POST}`, "giu");
  return {
    re,
    build: (m) => {
      const v = toRrule(m.groups ?? {});
      return v ? { type: "recurrence", value: v } : null;
    },
  };
}

export function buildMatchers(locale: Locale): Matcher[] {
  const { map: wd, alt } = weekdayData(locale);
  const out: Matcher[] = [];

  // Recurrence first (more specific / longer than bare dates).
  if (locale === "en") {
    out.push(recMatcher(`every\\s+other\\s+(?<wd>${alt})`, (g) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? rruleWeekly(2, w.byday) : null;
    }));
    out.push(recMatcher(`every\\s+(?<n>\\d+)\\s+days?`, (g) => rruleDaily(Number(g["n"]))));
    out.push(recMatcher(`every\\s+(?<n>\\d+)\\s+weeks?`, (g) => rruleWeekly(Number(g["n"]))));
    out.push(recMatcher(`every\\s+(?<wd>${alt})`, (g) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? rruleWeekly(1, w.byday) : null;
    }));
    out.push(recMatcher(`every\\s+day`, () => rruleDaily(1)));
    out.push(recMatcher(`daily`, () => rruleDaily(1)));
    out.push(recMatcher(`every\\s+week`, () => rruleWeekly(1)));
    out.push(recMatcher(`weekly`, () => rruleWeekly(1)));
    out.push(recMatcher(`monthly`, () => "FREQ=MONTHLY"));
    out.push(recMatcher(`yearly|annually`, () => "FREQ=YEARLY"));
  } else {
    out.push(recMatcher(`jede[nrs]?\\s+zweite[nrs]?\\s+(?<wd>${alt})`, (g) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? rruleWeekly(2, w.byday) : null;
    }));
    out.push(recMatcher(`alle\\s+(?<n>\\d+)\\s+tage?n?`, (g) => rruleDaily(Number(g["n"]))));
    out.push(recMatcher(`alle\\s+(?<n>\\d+)\\s+wochen?`, (g) => rruleWeekly(Number(g["n"]))));
    out.push(recMatcher(`jede[nrs]?\\s+tag`, () => rruleDaily(1)));
    out.push(recMatcher(`jede[nrs]?\\s+(?<wd>${alt})`, (g) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? rruleWeekly(1, w.byday) : null;
    }));
    out.push(recMatcher(`t(?:ä|ae)glich`, () => rruleDaily(1)));
    out.push(recMatcher(`jede\\s+woche`, () => rruleWeekly(1)));
    out.push(recMatcher(`w(?:ö|oe)chentlich`, () => rruleWeekly(1)));
    out.push(recMatcher(`monatlich`, () => "FREQ=MONTHLY"));
    out.push(recMatcher(`j(?:ä|ae)hrlich`, () => "FREQ=YEARLY"));
  }

  // Absolute dates (both locales).
  out.push(dateMatcher(locale, `(?<iy>\\d{4})-(?<im>\\d{2})-(?<id>\\d{2})`, (g) =>
    makeDate(Number(g["iy"]), Number(g["im"]), Number(g["id"])),
  ));
  out.push(dateMatcher(locale, `(?<d>\\d{1,2})\\.(?<mo>\\d{1,2})\\.(?<y>\\d{4})?`, resolveDMY));

  if (locale === "en") {
    const monthAlt =
      "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
    out.push(dateMatcher(locale, `(?<mon>${monthAlt})\\s+(?<md>\\d{1,2})(?:st|nd|rd|th)?`, resolveMonthName));
    out.push(dateMatcher(locale, `(?<md>\\d{1,2})(?:st|nd|rd|th)?\\s+(?<mon>${monthAlt})`, resolveMonthName));
  }

  // Relative words.
  if (locale === "en") {
    out.push(eveningMatcher(locale, `tonight`));
    out.push(dateMatcher(locale, `today`, (_g, ref) => ref));
    out.push(dateMatcher(locale, `tomorrow|tmrw`, (_g, ref) => addDays(ref, 1)));
    out.push(dateMatcher(locale, `next\\s+week`, (_g, ref) => addDays(weekMonday(ref), 7)));
    out.push(dateMatcher(locale, `in\\s+(?<n>\\d+)\\s+days?`, (g, ref) => addDays(ref, Number(g["n"]))));
    out.push(dateMatcher(locale, `in\\s+(?<n>\\d+)\\s+weeks?`, (g, ref) => addDays(ref, Number(g["n"]) * 7)));
    out.push(dateMatcher(locale, `next\\s+(?<wd>${alt})`, (g, ref) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? nextWeekWeekday(ref, w.dow) : null;
    }));
    out.push(dateMatcher(locale, `(?<wd>${alt})`, (g, ref) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? nextWeekday(ref, w.dow) : null;
    }));
  } else {
    out.push(eveningMatcher(locale, `heute\\s+abend`));
    out.push(dateMatcher(locale, `(?:ü|ue)bermorgen`, (_g, ref) => addDays(ref, 2)));
    out.push(dateMatcher(locale, `heute`, (_g, ref) => ref));
    out.push(dateMatcher(locale, `morgen`, (_g, ref) => addDays(ref, 1)));
    out.push(dateMatcher(locale, `n(?:ä|ae)chste\\s+woche`, (_g, ref) => addDays(weekMonday(ref), 7)));
    out.push(dateMatcher(locale, `in\\s+(?<n>\\d+)\\s+tage?n?`, (g, ref) => addDays(ref, Number(g["n"]))));
    out.push(dateMatcher(locale, `in\\s+(?<n>\\d+)\\s+wochen?`, (g, ref) => addDays(ref, Number(g["n"]) * 7)));
    out.push(dateMatcher(locale, `n(?:ä|ae)chste[nrs]?\\s+(?<wd>${alt})`, (g, ref) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? nextWeekWeekday(ref, w.dow) : null;
    }));
    out.push(dateMatcher(locale, `(?<wd>${alt})`, (g, ref) => {
      const w = wd[(g["wd"] ?? "").toLowerCase()];
      return w ? nextWeekday(ref, w.dow) : null;
    }));
  }

  return out;
}

// ── Symbol matchers (locale-independent) ──────────────────────────────

export const SYMBOL_MATCHERS: Matcher[] = [
  {
    re: /(?<=^|\s)#"(?<pq>[^"]+)"/gu,
    build: (m) => ({ type: "project", value: (m.groups?.["pq"] ?? "").trim() }),
  },
  {
    re: /(?<=^|\s)#(?<pw>[^\s#@!"]+)/gu,
    build: (m) => ({ type: "project", value: m.groups?.["pw"] ?? "" }),
  },
  {
    re: /(?<=^|\s)@(?<lb>[^\s#@!"]+)/gu,
    build: (m) => ({ type: "label", value: m.groups?.["lb"] ?? "" }),
  },
  {
    re: /(?<=^|\s)(?<pri>!!|![pP][1-3])(?=$|[\s.,;])/gu,
    build: (m) => {
      const raw = m.groups?.["pri"] ?? "";
      const value = raw === "!!" ? 1 : Number(raw[2]);
      return { type: "priority", value };
    },
  },
];
