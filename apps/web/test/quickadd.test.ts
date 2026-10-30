import type { Project } from "@balu/domain";
import { parseQuickAdd } from "@balu/nl-parser";
import { describe, expect, it } from "vitest";
import { composeTaskArgs, contextOf, quickAddTarget, shouldNotifyInbox } from "../src/lib/quickadd.js";

function project(over: Partial<Project>): Project {
  return {
    id: "P1",
    workspace_id: "w1",
    name: "Project",
    color: "blue",
    sort_order: 1000,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

const inbox = { kind: "list", list: "inbox" } as const;
const view = (projectId: string) => ({ kind: "project", projectId }) as const;

describe("shouldNotifyInbox", () => {
  const redirected = { context: inbox, redirected: true } as const;
  it("notifies when redirected and no project token was given", () => {
    expect(shouldNotifyInbox(redirected, {})).toBe(true);
  });
  it("stays quiet when an explicit project was named", () => {
    expect(shouldNotifyInbox(redirected, { project_id: "P2" })).toBe(false);
  });
  it("stays quiet when not redirected", () => {
    expect(shouldNotifyInbox({ context: inbox, redirected: false }, {})).toBe(false);
  });
});

describe("contextOf", () => {
  it("maps project, list and other views", () => {
    expect(contextOf(view("P1"))).toEqual({ kind: "project", projectId: "P1" });
    expect(contextOf({ kind: "list", list: "today" })).toEqual({ kind: "list", list: "today" });
    expect(contextOf({ kind: "settings" })).toEqual({ kind: "none" });
  });
});

describe("quickAddTarget", () => {
  it("follows a temp id the server replaced", () => {
    expect(quickAddTarget(view("tmp-a"), [project({})], { "tmp-a": "P1" })).toEqual({
      context: { kind: "project", projectId: "P1" },
      redirected: false,
    });
  });

  it("redirects an archived project to the Inbox", () => {
    const archived = project({ archived_at: "2026-07-02T00:00:00Z" });
    expect(quickAddTarget(view("P1"), [archived], {})).toEqual({ context: inbox, redirected: true });
  });

  it("redirects a deleted project to the Inbox", () => {
    expect(quickAddTarget(view("P1"), [project({ is_deleted: true })], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it("redirects a missing project to the Inbox", () => {
    expect(quickAddTarget(view("gone"), [project({})], {})).toEqual({ context: inbox, redirected: true });
  });

  it("leaves a list view unchanged", () => {
    expect(quickAddTarget({ kind: "list", list: "today" }, [], {})).toEqual({
      context: { kind: "list", list: "today" },
      redirected: false,
    });
  });
});

describe("quickAddTarget + composeTaskArgs", () => {
  const work = project({ id: "W1", name: "Work" });
  const archived = project({ archived_at: "2026-07-02T00:00:00Z" });
  const run = (text: string) => {
    const target = quickAddTarget(view("P1"), [archived, work], {});
    return composeTaskArgs(text, parseQuickAdd(text, { locale: "en", referenceDate: "2026-10-30" }), {
      context: target.context,
      projects: [work],
      labels: [],
      today: "2026-10-30",
    });
  };

  it("files no project for an archived view without a token", () => {
    expect(run("Buy milk")["project_id"]).toBeUndefined();
  });

  it("lets a #project token win", () => {
    expect(run("Buy milk #Work")["project_id"]).toBe("W1");
  });
});
