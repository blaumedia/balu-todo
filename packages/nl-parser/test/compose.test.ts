import { describe, expect, it } from "vitest";
import { composeTaskArgs, localTimeToUtc, parseQuickAdd, type ComposeContext, type NamedEntity } from "../src/index.js";

const TODAY = "2026-07-23";

const projects: NamedEntity[] = [
  { id: "p-fin", name: "Finanzen", is_deleted: false },
  { id: "p-gone", name: "Alt", is_deleted: true },
];
const labels: NamedEntity[] = [
  { id: "l-home", name: "home", is_deleted: false },
  { id: "l-gone", name: "old", is_deleted: true },
];

function compose(text: string, context: ComposeContext = { kind: "none" }) {
  const result = parseQuickAdd(text, { locale: "en", referenceDate: TODAY });
  return composeTaskArgs(text, result, { projects, labels, today: TODAY, context });
}

describe("composeTaskArgs (shared by web and mobile — D1)", () => {
  it("keeps a plain title", () => {
    expect(compose("Buy milk")).toEqual({ title: "Buy milk" });
  });

  it("resolves an existing project and strips its token", () => {
    const args = compose("Steuer #Finanzen");
    expect(args["project_id"]).toBe("p-fin");
    expect(args["title"]).toBe("Steuer");
  });

  it("resolves labels and strips their tokens", () => {
    const args = compose("Vacuum @home");
    expect(args["label_ids"]).toEqual(["l-home"]);
    expect(args["title"]).toBe("Vacuum");
  });

  it("leaves unmatched #/@ tokens as literal title text", () => {
    const args = compose("Ping #nosuch @nolabel");
    expect(args["project_id"]).toBeUndefined();
    expect(args["label_ids"]).toBeUndefined();
    expect(args["title"]).toBe("Ping #nosuch @nolabel");
  });

  it("never matches a soft-deleted project or label", () => {
    const args = compose("Thing #Alt @old");
    expect(args["project_id"]).toBeUndefined();
    expect(args["label_ids"]).toBeUndefined();
  });

  it("defaults the project from a project context", () => {
    expect(compose("Task", { kind: "project", projectId: "p-ctx" })["project_id"]).toBe("p-ctx");
  });

  it("lets an explicit project token win over the context", () => {
    const args = compose("Task #Finanzen", { kind: "project", projectId: "p-ctx" });
    expect(args["project_id"]).toBe("p-fin");
  });

  it("defaults start_date to today in the Today list", () => {
    expect(compose("Task", { kind: "list", list: "today" })["start_date"]).toBe(TODAY);
  });

  it("does not override a parsed date with the Today default", () => {
    const args = compose("Task tomorrow", { kind: "list", list: "today" });
    expect(args["start_date"]).toBe("2026-07-24");
  });

  it("sets someday and drops start_date in the Someday list", () => {
    const args = compose("Task tomorrow", { kind: "list", list: "someday" });
    expect(args["someday"]).toBe(true);
    expect(args["start_date"]).toBeUndefined();
  });

  it("adds no context defaults for other lists", () => {
    expect(compose("Task", { kind: "list", list: "anytime" })).toEqual({ title: "Task" });
    expect(compose("Task", { kind: "none" })).toEqual({ title: "Task" });
  });

  it("falls back to the raw text when stripping empties the title", () => {
    expect(compose("#Finanzen")["title"]).toBe("#Finanzen");
  });
});

// UTC+2 (Berlin summer), injected so the result does not depend on the machine's timezone.
const plus2 = (date: string, time: string) =>
  new Date(Date.parse(`${date}T${time}:00Z`) - 120 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const BEFORE_NINE = new Date("2026-07-23T05:00:00Z"); // 07:00 local
const AFTER_NINE = new Date("2026-07-23T08:00:00Z"); // 10:00 local
const AT_NINE = new Date("2026-07-23T07:00:00Z"); // 09:00 local exactly
function composeAt(text: string, now: Date, context: ComposeContext = { kind: "none" }, locale: "en" | "de" = "en") {
  const result = parseQuickAdd(text, { locale, referenceDate: TODAY });
  return composeTaskArgs(text, result, { projects, labels, today: TODAY, context, now, localToUtc: plus2 });
}
const LOCAL_NINE = new Date(2026, 6, 24, 9, 0).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("composeTaskArgs reminder_at from a time of day", () => {
  it("keeps today when the time is still ahead", () => {
    expect(composeAt("Task every day at 9am", BEFORE_NINE)).toEqual({
      title: "Task",
      recurrence: "FREQ=DAILY",
      reminder_at: "2026-07-23T07:00:00Z",
    });
  });
  it("rolls a passed time to tomorrow without creating a start_date", () => {
    expect(composeAt("Task every day at 9am", AFTER_NINE)).toEqual({
      title: "Task",
      recurrence: "FREQ=DAILY",
      reminder_at: "2026-07-24T07:00:00Z",
    });
  });
  it("accepts a bare HH:MM", () => {
    expect(composeAt("Task every day 9:00", BEFORE_NINE)).toEqual({
      title: "Task",
      recurrence: "FREQ=DAILY",
      reminder_at: "2026-07-23T07:00:00Z",
    });
  });
  it("uses the start date of an explicit date", () => {
    expect(composeAt("Task tomorrow at 9", AFTER_NINE)).toEqual({
      title: "Task",
      start_date: "2026-07-24",
      reminder_at: "2026-07-24T07:00:00Z",
    });
  });
  it("works in German", () => {
    expect(composeAt("Aufgabe jeden Tag um 9 Uhr", BEFORE_NINE, { kind: "none" }, "de")).toEqual({
      title: "Aufgabe",
      recurrence: "FREQ=DAILY",
      reminder_at: "2026-07-23T07:00:00Z",
    });
  });
  it("uses the deadline as the base day", () => {
    expect(composeAt("Report by friday at 5pm", AFTER_NINE)).toEqual({
      title: "Report",
      deadline: "2026-07-24",
      reminder_at: "2026-07-24T15:00:00Z",
    });
  });
  it("keeps the typed deadline as the reminder day in the Today list", () => {
    const args = composeAt("Report by friday at 5pm", AFTER_NINE, { kind: "list", list: "today" });
    expect(args["reminder_at"]).toBe("2026-07-24T15:00:00Z");
    expect(args["deadline"]).toBe("2026-07-24");
  });
  it("keeps the typed start day as the reminder day in the Someday list", () => {
    const args = composeAt("Task tomorrow at 9", AFTER_NINE, { kind: "list", list: "someday" });
    expect(args["reminder_at"]).toBe("2026-07-24T07:00:00Z");
    expect(args["someday"]).toBe(true);
    expect(args["start_date"]).toBeUndefined();
  });
  it("turns 'by 5pm' into a deadline today with a reminder at 17:00", () => {
    expect(composeAt("Submit report by 5pm", BEFORE_NINE)).toEqual({
      title: "Submit report",
      deadline: "2026-07-23",
      reminder_at: "2026-07-23T15:00:00Z",
    });
  });
  it("moves a passed 'by 9am' deadline to tomorrow together with the reminder", () => {
    expect(composeAt("Submit report by 9am", AFTER_NINE)).toEqual({
      title: "Submit report",
      deadline: "2026-07-24",
      reminder_at: "2026-07-24T07:00:00Z",
    });
  });
  it("turns 'bis 12 Uhr' into a deadline with a reminder in German", () => {
    expect(composeAt("Abgabe bis 12 Uhr", BEFORE_NINE, { kind: "none" }, "de")).toEqual({
      title: "Abgabe",
      deadline: "2026-07-23",
      reminder_at: "2026-07-23T10:00:00Z",
    });
  });
  it("treats a time equal to now as passed", () => {
    expect(composeAt("Task at 9am", AT_NINE)["reminder_at"]).toBe("2026-07-24T07:00:00Z");
  });
  it("never rolls an explicit date", () => {
    expect(composeAt("Task today at 9am", AFTER_NINE)).toEqual({
      title: "Task",
      start_date: "2026-07-23",
      reminder_at: "2026-07-23T07:00:00Z",
    });
  });
  it("keeps the evening start for tonight", () => {
    const args = composeAt("Call mom tonight at 9pm", AFTER_NINE);
    expect(args["start_date"]).toBe("2026-07-23");
    expect(args["evening"]).toBe(true);
    expect(args["reminder_at"]).toBe("2026-07-23T19:00:00Z");
  });
  it("Today list: keeps the default start when the time is ahead", () => {
    expect(composeAt("Task at 9am", BEFORE_NINE, { kind: "list", list: "today" })).toEqual({
      title: "Task",
      start_date: "2026-07-23",
      reminder_at: "2026-07-23T07:00:00Z",
    });
  });
  it("Today list: the default start moves to tomorrow with a rolled time", () => {
    expect(composeAt("Task at 9am", AFTER_NINE, { kind: "list", list: "today" })).toEqual({
      title: "Task",
      start_date: "2026-07-24",
      reminder_at: "2026-07-24T07:00:00Z",
    });
  });
  it("Someday list: rolls the reminder, no start_date", () => {
    expect(composeAt("Task at 9am", AFTER_NINE, { kind: "list", list: "someday" })).toEqual({
      title: "Task",
      someday: true,
      reminder_at: "2026-07-24T07:00:00Z",
    });
  });
  it("project context adds no start_date", () => {
    const args = composeAt("Task at 9am", BEFORE_NINE, { kind: "project", projectId: "p-ctx" });
    expect(args["project_id"]).toBe("p-ctx");
    expect(args["start_date"]).toBeUndefined();
    expect(args["reminder_at"]).toBe("2026-07-23T07:00:00Z");
  });
  it("default conversion uses the runtime timezone", () => {
    const text = "Task tomorrow at 9";
    const result = parseQuickAdd(text, { locale: "en", referenceDate: TODAY });
    const args = composeTaskArgs(text, result, { projects, labels, today: TODAY, context: { kind: "none" } });
    expect(args["reminder_at"]).toBe(LOCAL_NINE);
  });
  it("localTimeToUtc converts local wall time", () => {
    expect(localTimeToUtc("2026-07-24", "09:00")).toBe(LOCAL_NINE);
  });
});
