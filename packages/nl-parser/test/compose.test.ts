import { describe, expect, it } from "vitest";
import { composeTaskArgs, parseQuickAdd, type ComposeContext, type NamedEntity } from "../src/index.js";

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
