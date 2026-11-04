import { describe, expect, it } from "vitest";
import { buildTitle, parseQuickAdd, type Locale } from "../src/index.js";

const REF = "2026-07-23"; // Thursday

function en(text: string) {
  return parseQuickAdd(text, { locale: "en", referenceDate: REF });
}
function de(text: string) {
  return parseQuickAdd(text, { locale: "de", referenceDate: REF });
}

// ── Table: date parsing ───────────────────────────────────────────────

interface Row {
  locale: Locale;
  text: string;
  title: string;
  startDate?: string;
  deadline?: string;
  evening?: boolean;
  priority?: number;
  recurrence?: string;
  time?: string;
  projectQuery?: string;
  labels?: string[];
}

const ROWS: Row[] = [
  // English relative
  { locale: "en", text: "Buy milk today", title: "Buy milk", startDate: "2026-07-23" },
  { locale: "en", text: "Buy milk tomorrow", title: "Buy milk", startDate: "2026-07-24" },
  { locale: "en", text: "Call mom tonight", title: "Call mom", startDate: "2026-07-23", evening: true },
  { locale: "en", text: "Plan trip next week", title: "Plan trip", startDate: "2026-07-27" },
  { locale: "en", text: "Ping Ana in 3 days", title: "Ping Ana", startDate: "2026-07-26" },
  { locale: "en", text: "Vacation in 2 weeks", title: "Vacation", startDate: "2026-08-06" },
  { locale: "en", text: "Gym friday", title: "Gym", startDate: "2026-07-24" },
  { locale: "en", text: "Gym monday", title: "Gym", startDate: "2026-07-27" },
  { locale: "en", text: "Standup next friday", title: "Standup", startDate: "2026-07-31" },
  { locale: "en", text: "Taxes 2026-07-31", title: "Taxes", startDate: "2026-07-31" },
  { locale: "en", text: "Taxes jul 31", title: "Taxes", startDate: "2026-07-31" },
  { locale: "en", text: "Taxes 31 jul", title: "Taxes", startDate: "2026-07-31" },
  // English deadline vs start
  { locale: "en", text: "Report by friday", title: "Report", deadline: "2026-07-24" },
  { locale: "en", text: "Report due 2026-07-31", title: "Report", deadline: "2026-07-31" },
  // German relative
  { locale: "de", text: "Milch kaufen heute", title: "Milch kaufen", startDate: "2026-07-23" },
  { locale: "de", text: "Milch kaufen morgen", title: "Milch kaufen", startDate: "2026-07-24" },
  { locale: "de", text: "Müll rausbringen übermorgen", title: "Müll rausbringen", startDate: "2026-07-25" },
  { locale: "de", text: "Blumen gießen heute abend", title: "Blumen gießen", startDate: "2026-07-23", evening: true },
  { locale: "de", text: "Urlaub planen nächste Woche", title: "Urlaub planen", startDate: "2026-07-27" },
  { locale: "de", text: "Anruf in 3 Tagen", title: "Anruf", startDate: "2026-07-26" },
  { locale: "de", text: "Projekt in 2 Wochen", title: "Projekt", startDate: "2026-08-06" },
  { locale: "de", text: "Sport Freitag", title: "Sport", startDate: "2026-07-24" },
  { locale: "de", text: "Sport Montag", title: "Sport", startDate: "2026-07-27" },
  { locale: "de", text: "Meeting nächsten Freitag", title: "Meeting", startDate: "2026-07-31" },
  { locale: "de", text: "Steuer 31.7.", title: "Steuer", startDate: "2026-07-31" },
  { locale: "de", text: "Steuer 31.07.2026", title: "Steuer", startDate: "2026-07-31" },
  // German deadline
  { locale: "de", text: "Abgabe bis Freitag", title: "Abgabe", deadline: "2026-07-24" },
  { locale: "de", text: "Abgabe bis 31.7.", title: "Abgabe", deadline: "2026-07-31" },
  // Recurrence — English
  { locale: "en", text: "Water plants every day", title: "Water plants", recurrence: "FREQ=DAILY" },
  { locale: "en", text: "Water plants daily", title: "Water plants", recurrence: "FREQ=DAILY" },
  { locale: "en", text: "Standup every week", title: "Standup", recurrence: "FREQ=WEEKLY" },
  { locale: "en", text: "Standup weekly", title: "Standup", recurrence: "FREQ=WEEKLY" },
  { locale: "en", text: "Meds every 3 days", title: "Meds", recurrence: "FREQ=DAILY;INTERVAL=3" },
  { locale: "en", text: "Review every 2 weeks", title: "Review", recurrence: "FREQ=WEEKLY;INTERVAL=2" },
  { locale: "en", text: "Sync every monday", title: "Sync", recurrence: "FREQ=WEEKLY;BYDAY=MO" },
  { locale: "en", text: "Retro every other tuesday", title: "Retro", recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" },
  { locale: "en", text: "Rent monthly", title: "Rent", recurrence: "FREQ=MONTHLY" },
  { locale: "en", text: "Taxes yearly", title: "Taxes", recurrence: "FREQ=YEARLY" },
  // Recurrence — German
  { locale: "de", text: "Blumen jeden Tag", title: "Blumen", recurrence: "FREQ=DAILY" },
  { locale: "de", text: "Blumen täglich", title: "Blumen", recurrence: "FREQ=DAILY" },
  { locale: "de", text: "Standup jede Woche", title: "Standup", recurrence: "FREQ=WEEKLY" },
  { locale: "de", text: "Standup wöchentlich", title: "Standup", recurrence: "FREQ=WEEKLY" },
  { locale: "de", text: "Tabletten alle 3 Tage", title: "Tabletten", recurrence: "FREQ=DAILY;INTERVAL=3" },
  { locale: "de", text: "Review alle 2 Wochen", title: "Review", recurrence: "FREQ=WEEKLY;INTERVAL=2" },
  { locale: "de", text: "Sync jeden Montag", title: "Sync", recurrence: "FREQ=WEEKLY;BYDAY=MO" },
  { locale: "de", text: "Retro jeden zweiten Dienstag", title: "Retro", recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" },
  { locale: "de", text: "Miete monatlich", title: "Miete", recurrence: "FREQ=MONTHLY" },
  { locale: "de", text: "Steuer jährlich", title: "Steuer", recurrence: "FREQ=YEARLY" },
  // Time of day - English
  { locale: "en", text: "Task every day at 9am", title: "Task", recurrence: "FREQ=DAILY", time: "09:00" },
  { locale: "en", text: "Task every day 9:00", title: "Task", recurrence: "FREQ=DAILY", time: "09:00" },
  { locale: "en", text: "Task tomorrow at 9", title: "Task", startDate: "2026-07-24", time: "09:00" },
  { locale: "en", text: "Call at 9", title: "Call", time: "09:00" },
  { locale: "en", text: "Call 9am", title: "Call", time: "09:00" },
  { locale: "en", text: "Call 9 am", title: "Call", time: "09:00" },
  { locale: "en", text: "Call 9:30", title: "Call", time: "09:30" },
  { locale: "en", text: "Call 9.30pm", title: "Call", time: "21:30" },
  { locale: "en", text: "Call at 9:30 pm", title: "Call", time: "21:30" },
  { locale: "en", text: "Call 21:00", title: "Call", time: "21:00" },
  { locale: "en", text: "Call 12am", title: "Call", time: "00:00" },
  { locale: "en", text: "Call 12pm", title: "Call", time: "12:00" },
  { locale: "en", text: "Lunch at noon", title: "Lunch", time: "12:00" },
  { locale: "en", text: "Backup at midnight", title: "Backup", time: "00:00" },
  { locale: "en", text: "Report by friday at 5pm", title: "Report", deadline: "2026-07-24", time: "17:00" },
  { locale: "en", text: "Meds every 3 days at 8am", title: "Meds", recurrence: "FREQ=DAILY;INTERVAL=3", time: "08:00" },
  { locale: "en", text: "Ping Ana in 3 days at 9", title: "Ping Ana", startDate: "2026-07-26", time: "09:00" },
  { locale: "en", text: "Taxes 2026-07-31 at 10:00", title: "Taxes", startDate: "2026-07-31", time: "10:00" },
  // Time of day - German
  { locale: "de", text: "Aufgabe jeden Tag um 9 Uhr", title: "Aufgabe", recurrence: "FREQ=DAILY", time: "09:00" },
  { locale: "de", text: "Anruf um 9", title: "Anruf", time: "09:00" },
  { locale: "de", text: "Anruf 9 Uhr", title: "Anruf", time: "09:00" },
  { locale: "de", text: "Anruf 9Uhr", title: "Anruf", time: "09:00" },
  { locale: "de", text: "Anruf 9:30 Uhr", title: "Anruf", time: "09:30" },
  { locale: "de", text: "Anruf 21:00", title: "Anruf", time: "21:00" },
  { locale: "de", text: "Anruf 21.30 Uhr", title: "Anruf", time: "21:30" },
  { locale: "de", text: "Anruf morgen um 14:30", title: "Anruf", startDate: "2026-07-24", time: "14:30" },
  { locale: "de", text: "Abgabe bis Freitag 12 Uhr", title: "Abgabe", deadline: "2026-07-24", time: "12:00" },
  { locale: "de", text: "Termin 1.12. um 9 Uhr", title: "Termin", startDate: "2026-12-01", time: "09:00" },
  { locale: "de", text: "Bericht bis 31.7. 9:00", title: "Bericht", deadline: "2026-07-31", time: "09:00" },
  { locale: "en", text: "Submit report by 5pm", title: "Submit report", time: "17:00" },
  { locale: "en", text: "Submit report due 17:00", title: "Submit report", time: "17:00" },
  { locale: "de", text: "Abgabe bis 12 Uhr", title: "Abgabe", time: "12:00" },
  // Time of day - not a time
  { locale: "en", text: "Ship at 9 jul", title: "Ship at", startDate: "2027-07-09" },
  { locale: "en", text: "Party at 1 may", title: "Party at", startDate: "2027-05-01" },
  { locale: "en", text: "Buy 9 apples", title: "Buy 9 apples" },
  { locale: "en", text: "Call 9", title: "Call 9" },
  { locale: "en", text: "Call 25:00", title: "Call 25:00" },
  { locale: "en", text: "Call 9:75", title: "Call 9:75" },
  { locale: "en", text: "Call 13pm", title: "Call 13pm" },
  { locale: "en", text: "Call at 24", title: "Call at 24" },
  { locale: "en", text: "Pay 9.30", title: "Pay 9.30" },
  { locale: "de", text: "Kaufe 9 Äpfel", title: "Kaufe 9 Äpfel" },
  { locale: "de", text: "Anruf 25 Uhr", title: "Anruf 25 Uhr" },
  { locale: "de", text: "Anruf um 9.30", title: "Anruf um 9.30" },
  { locale: "de", text: "Steuer 9.30.", title: "Steuer 9.30." },
  { locale: "de", text: "Anruf 9 am", title: "Anruf 9 am" },
  // Time vs date collisions
  { locale: "en", text: "Gym at 1.12.", title: "Gym at", startDate: "2026-12-01" },
  { locale: "de", text: "Termin um 1.12.", title: "Termin um", startDate: "2026-12-01" },
];

describe("parseQuickAdd table", () => {
  for (const row of ROWS) {
    it(`[${row.locale}] ${row.text}`, () => {
      const r = parseQuickAdd(row.text, { locale: row.locale, referenceDate: REF });
      expect(r.title).toBe(row.title);
      expect(r.startDate).toBe(row.startDate);
      expect(r.deadline).toBe(row.deadline);
      expect(r.evening ?? undefined).toBe(row.evening);
      expect(r.priority).toBe(row.priority);
      expect(r.recurrence).toBe(row.recurrence);
      expect(r.time).toBe(row.time);
      if (row.projectQuery) expect(r.projectQuery).toBe(row.projectQuery);
      if (row.labels) expect(r.labelQueries).toEqual(row.labels);
    });
  }
});

// ── Symbols ───────────────────────────────────────────────────────────

describe("symbol tokens", () => {
  it("parses #project, @label and !priority together", () => {
    const r = de("Milch kaufen morgen #Haushalt @einkauf !p2");
    expect(r.title).toBe("Milch kaufen");
    expect(r.startDate).toBe("2026-07-24");
    expect(r.projectQuery).toBe("Haushalt");
    expect(r.labelQueries).toEqual(["einkauf"]);
    expect(r.priority).toBe(2);
  });
  it("supports quoted multi-word projects", () => {
    const r = en('Draft doc #"Q3 Planning"');
    expect(r.projectQuery).toBe("Q3 Planning");
    expect(r.title).toBe("Draft doc");
  });
  it("!! means P1", () => {
    expect(en("Urgent thing !!").priority).toBe(1);
  });
  it("collects multiple labels", () => {
    expect(en("Task @home @errands").labelQueries).toEqual(["home", "errands"]);
  });
  it("priority levels", () => {
    expect(en("a !p1").priority).toBe(1);
    expect(en("a !p2").priority).toBe(2);
    expect(en("a !p3").priority).toBe(3);
  });
});

// ── Deadline vs start distinction ─────────────────────────────────────

describe("deadline vs start", () => {
  it("bare weekday is a start date, bis/by makes it a deadline", () => {
    expect(de("X Freitag").startDate).toBe("2026-07-24");
    expect(de("X Freitag").deadline).toBeUndefined();
    expect(de("X bis Freitag").deadline).toBe("2026-07-24");
    expect(de("X bis Freitag").startDate).toBeUndefined();
    expect(en("X friday").startDate).toBe("2026-07-24");
    expect(en("X by friday").deadline).toBe("2026-07-24");
  });
});

// ── Tokens & title reconstruction ─────────────────────────────────────

describe("tokens", () => {
  it("a time token spans the prefix and the time", () => {
    expect(en("Task every day at 9am").tokens).toEqual([
      { type: "recurrence", start: 5, end: 14, value: "FREQ=DAILY" },
      { type: "time", start: 15, end: 21, value: "09:00" },
    ]);
  });
  it("emits non-empty spans for highlighting", () => {
    const r = en("Ship it tomorrow #Balu !p1");
    expect(r.tokens.length).toBe(3);
    for (const t of r.tokens) expect(t.end).toBeGreaterThan(t.start);
    expect(r.tokens.map((t) => t.type).sort()).toEqual(["priority", "project", "start"]);
  });
  it("buildTitle keeps spans that the app chooses not to strip (unmatched project stays in title)", () => {
    const text = "Milch kaufen morgen #Haushalt @einkauf !p2";
    const r = de(text);
    // App resolved everything except the project token → keep #Haushalt literal.
    const keep = r.tokens.filter((t) => t.type !== "project");
    expect(buildTitle(text, keep)).toBe("Milch kaufen #Haushalt");
  });
});

// ── Longest-match wins ────────────────────────────────────────────────

describe("longest match wins", () => {
  it("'every monday' is recurrence, not a bare weekday", () => {
    const r = en("Sync every monday");
    expect(r.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(r.startDate).toBeUndefined();
  });
});
