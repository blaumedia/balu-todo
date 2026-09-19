import { describe, expect, it } from "vitest";
import { buildAppUrl, parseAppUrl, type ViewSel } from "../src/lib/url.js";

const LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "assigned"] as const;

describe("parseAppUrl", () => {
  it("maps / to today with no selection", () => {
    expect(parseAppUrl("/", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: null, fullscreenTaskId: null });
  });

  it("parses every smart list path", () => {
    for (const l of LISTS) {
      expect(parseAppUrl(`/${l}`, "")).toEqual({ view: { kind: "list", list: l }, taskId: null, fullscreenTaskId: null });
    }
  });

  it("parses /settings and ignores a task param there", () => {
    expect(parseAppUrl("/settings", "?task=t1")).toEqual({ view: { kind: "settings" }, taskId: null, fullscreenTaskId: null });
  });

  it("parses /project/:id and decodes the id", () => {
    expect(parseAppUrl("/project/p1", "")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: null, fullscreenTaskId: null });
    expect(parseAppUrl("/project/a%2Fb", "")).toEqual({ view: { kind: "project", projectId: "a/b" }, taskId: null, fullscreenTaskId: null });
  });

  it("parses /task/:id as fullscreen with the task also selected", () => {
    expect(parseAppUrl("/task/t1", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: "t1" });
    expect(parseAppUrl("/task/a%2Fb", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: "a/b", fullscreenTaskId: "a/b" });
  });

  it("tolerates a trailing slash on /task/:id", () => {
    expect(parseAppUrl("/task/t1/", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: "t1" });
  });

  it("ignores a ?task= param on /task/:id - the path id wins", () => {
    expect(parseAppUrl("/task/t1", "?task=t2")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: "t1" });
  });

  it("returns null instead of throwing on malformed /task/:id encoding", () => {
    expect(parseAppUrl("/task/100%", "")).toBeNull();
    expect(parseAppUrl("/task/%zz", "")).toBeNull();
  });

  it("returns null instead of throwing on malformed percent-encoding", () => {
    expect(parseAppUrl("/project/100%", "")).toBeNull();
    expect(parseAppUrl("/project/%zz", "")).toBeNull();
  });

  it("extracts ?task= on lists and projects", () => {
    expect(parseAppUrl("/today", "?task=t9")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t9", fullscreenTaskId: null });
    expect(parseAppUrl("/project/p1", "?task=t9")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: "t9", fullscreenTaskId: null });
  });

  it("treats an empty task param as no selection", () => {
    expect(parseAppUrl("/today", "?task=")).toEqual({ view: { kind: "list", list: "today" }, taskId: null, fullscreenTaskId: null });
  });

  it("treats an empty pathname as today", () => {
    expect(parseAppUrl("", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: null, fullscreenTaskId: null });
  });

  it("accepts a search string without the leading ?", () => {
    expect(parseAppUrl("/today", "task=t1")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: null });
  });

  it("takes the first task param when it is repeated", () => {
    expect(parseAppUrl("/today", "?task=a&task=b")).toEqual({ view: { kind: "list", list: "today" }, taskId: "a", fullscreenTaskId: null });
  });

  it("tolerates trailing slashes", () => {
    expect(parseAppUrl("/inbox/", "")).toEqual({ view: { kind: "list", list: "inbox" }, taskId: null, fullscreenTaskId: null });
    expect(parseAppUrl("/project/p1/", "")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: null, fullscreenTaskId: null });
  });

  it("keeps the task param with a trailing slash", () => {
    expect(parseAppUrl("/today/", "?task=t1")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: null });
  });

  it("returns null for paths it does not own", () => {
    for (const p of ["/nope", "/project", "/project/a/b", "/task", "/task/a/b", "/invite/tok123", "/list/today", "/settings/x"]) {
      expect(parseAppUrl(p, "")).toBeNull();
    }
  });
});

describe("buildAppUrl", () => {
  it("builds every smart list path, canonicalising today to /today", () => {
    for (const l of LISTS) {
      expect(buildAppUrl({ kind: "list", list: l }, null)).toBe(`/${l}`);
    }
  });

  it("builds project and settings paths, encoding the id", () => {
    expect(buildAppUrl({ kind: "project", projectId: "a/b" }, null)).toBe("/project/a%2Fb");
    expect(buildAppUrl({ kind: "settings" }, null)).toBe("/settings");
  });

  it("appends the task query param except on settings", () => {
    expect(buildAppUrl({ kind: "list", list: "today" }, "t1")).toBe("/today?task=t1");
    expect(buildAppUrl({ kind: "project", projectId: "p1" }, "t1")).toBe("/project/p1?task=t1");
    expect(buildAppUrl({ kind: "settings" }, "t1")).toBe("/settings");
  });

  it("builds /task/:id when fullscreen is set, overriding view and task param", () => {
    expect(buildAppUrl({ kind: "list", list: "today" }, null, "t1")).toBe("/task/t1");
    expect(buildAppUrl({ kind: "list", list: "inbox" }, "t2", "t1")).toBe("/task/t1");
    expect(buildAppUrl({ kind: "settings" }, null, "t1")).toBe("/task/t1");
    expect(buildAppUrl({ kind: "project", projectId: "p1" }, null, "a/b")).toBe("/task/a%2Fb");
  });
});

describe("roundtrip", () => {
  it("parse(build(view, task)) restores view and task for every route", () => {
    const views: ViewSel[] = [...LISTS.map((list) => ({ kind: "list", list }) as ViewSel), { kind: "project", projectId: "p1" }, { kind: "settings" }];
    for (const view of views) {
      for (const taskId of [null, "t1"]) {
        const url = buildAppUrl(view, taskId);
        const q = url.indexOf("?");
        const [pathname, search] = q === -1 ? [url, ""] : [url.slice(0, q), url.slice(q)];
        expect(parseAppUrl(pathname, search)).toEqual({ view, taskId: view.kind === "settings" ? null : taskId, fullscreenTaskId: null });
      }
    }
  });

  it("canonicalises the / alias", () => {
    const r = parseAppUrl("/", "");
    expect(r && buildAppUrl(r.view, r.taskId)).toBe("/today");
  });

  it("round-trips a task id that needs encoding", () => {
    const url = buildAppUrl({ kind: "list", list: "today" }, "a b&c=d");
    const q = url.indexOf("?");
    const [pathname, search] = [url.slice(0, q), url.slice(q)];
    expect(parseAppUrl(pathname, search)?.taskId).toBe("a b&c=d");
  });

  it("round-trips a project id containing a literal %", () => {
    const url = buildAppUrl({ kind: "project", projectId: "100%" }, null);
    expect(url).toBe("/project/100%25");
    expect(parseAppUrl(url, "")).toEqual({ view: { kind: "project", projectId: "100%" }, taskId: null, fullscreenTaskId: null });
  });

  it("round-trips fullscreen, losing the underlying view to today by design", () => {
    const url = buildAppUrl({ kind: "project", projectId: "p1" }, "t1", "t1");
    expect(url).toBe("/task/t1");
    expect(parseAppUrl(url, "")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t1", fullscreenTaskId: "t1" });
  });

  it("round-trips a fullscreen task id containing a literal %", () => {
    const url = buildAppUrl({ kind: "list", list: "today" }, null, "100%");
    expect(url).toBe("/task/100%25");
    expect(parseAppUrl(url, "")).toEqual({ view: { kind: "list", list: "today" }, taskId: "100%", fullscreenTaskId: "100%" });
  });
});
