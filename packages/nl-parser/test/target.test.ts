import { describe, expect, it } from "vitest";
import {
  canQuickAddInto,
  composeTaskArgs,
  parseQuickAdd,
  resolveProjectId,
  resolveQuickAddContext,
  type TargetProject,
} from "../src/index.js";

const p = (over: Partial<TargetProject> = {}): TargetProject => ({
  id: "P1",
  is_deleted: false,
  archived_at: null,
  ...over,
});

const inbox = { kind: "list", list: "inbox" } as const;

describe("resolveProjectId", () => {
  it("maps a temp id to the real one", () => {
    expect(resolveProjectId({ "tmp-a": "P1" }, "tmp-a")).toBe("P1");
  });

  it("returns an unknown id unchanged", () => {
    expect(resolveProjectId({ "tmp-a": "P1" }, "P9")).toBe("P9");
  });

  it("never resolves through Object.prototype", () => {
    expect(resolveProjectId({}, "constructor")).toBe("constructor");
  });
});

describe("canQuickAddInto", () => {
  it("accepts an open project for a writer", () => {
    expect(canQuickAddInto(p(), true)).toBe(true);
  });

  it("rejects read-only members", () => {
    expect(canQuickAddInto(p(), false)).toBe(false);
  });

  it("rejects a project that has not loaded", () => {
    expect(canQuickAddInto(undefined, true)).toBe(false);
  });

  it("rejects an archived project", () => {
    expect(canQuickAddInto(p({ archived_at: "2026-10-30T12:00:00Z" }), true)).toBe(false);
  });

  it("rejects a deleted project", () => {
    expect(canQuickAddInto(p({ is_deleted: true }), true)).toBe(false);
  });
});

describe("resolveQuickAddContext", () => {
  it("passes a list context through", () => {
    expect(resolveQuickAddContext({ kind: "list", list: "today" }, [], {})).toEqual({
      context: { kind: "list", list: "today" },
      redirected: false,
    });
  });

  it("passes a none context through", () => {
    expect(resolveQuickAddContext({ kind: "none" }, [], {})).toEqual({
      context: { kind: "none" },
      redirected: false,
    });
  });

  it("keeps an open project", () => {
    expect(resolveQuickAddContext({ kind: "project", projectId: "P1" }, [p()], {})).toEqual({
      context: { kind: "project", projectId: "P1" },
      redirected: false,
    });
  });

  it("follows a remapped temp id", () => {
    expect(resolveQuickAddContext({ kind: "project", projectId: "tmp-a" }, [p()], { "tmp-a": "P1" })).toEqual({
      context: { kind: "project", projectId: "P1" },
      redirected: false,
    });
  });

  it("redirects a missing project to the Inbox", () => {
    expect(resolveQuickAddContext({ kind: "project", projectId: "gone" }, [p()], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it("redirects a deleted project to the Inbox", () => {
    expect(resolveQuickAddContext({ kind: "project", projectId: "P1" }, [p({ is_deleted: true })], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it("redirects an archived project to the Inbox", () => {
    const archived = p({ archived_at: "2026-07-02T00:00:00Z" });
    expect(resolveQuickAddContext({ kind: "project", projectId: "P1" }, [archived], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it("lets an explicit #project token win over the redirect", () => {
    const projects = [{ id: "W1", name: "Work", is_deleted: false, archived_at: null }];
    const target = resolveQuickAddContext({ kind: "project", projectId: "gone" }, projects, {});
    const text = "Buy milk #Work";
    const args = composeTaskArgs(text, parseQuickAdd(text, { locale: "en", referenceDate: "2026-10-30" }), {
      context: target.context,
      projects,
      labels: [],
      today: "2026-10-30",
    });
    expect(args["project_id"]).toBe("W1");
    expect(target.redirected).toBe(true);
  });
});
