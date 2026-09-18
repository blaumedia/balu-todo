import { describe, expect, it } from "vitest";
import { buildAppUrl, parseAppUrl, type ViewSel } from "../src/lib/url.js";

const LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "assigned"] as const;

describe("parseAppUrl", () => {
  it("maps / to today with no selection", () => {
    expect(parseAppUrl("/", "")).toEqual({ view: { kind: "list", list: "today" }, taskId: null });
  });

  it("parses every smart list path", () => {
    for (const l of LISTS) {
      expect(parseAppUrl(`/${l}`, "")).toEqual({ view: { kind: "list", list: l }, taskId: null });
    }
  });

  it("parses /settings and ignores a task param there", () => {
    expect(parseAppUrl("/settings", "?task=t1")).toEqual({ view: { kind: "settings" }, taskId: null });
  });

  it("parses /project/:id and decodes the id", () => {
    expect(parseAppUrl("/project/p1", "")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: null });
    expect(parseAppUrl("/project/a%2Fb", "")).toEqual({ view: { kind: "project", projectId: "a/b" }, taskId: null });
  });

  it("extracts ?task= on lists and projects", () => {
    expect(parseAppUrl("/today", "?task=t9")).toEqual({ view: { kind: "list", list: "today" }, taskId: "t9" });
    expect(parseAppUrl("/project/p1", "?task=t9")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: "t9" });
  });

  it("treats an empty task param as no selection", () => {
    expect(parseAppUrl("/today", "?task=")).toEqual({ view: { kind: "list", list: "today" }, taskId: null });
  });

  it("tolerates trailing slashes", () => {
    expect(parseAppUrl("/inbox/", "")).toEqual({ view: { kind: "list", list: "inbox" }, taskId: null });
    expect(parseAppUrl("/project/p1/", "")).toEqual({ view: { kind: "project", projectId: "p1" }, taskId: null });
  });

  it("returns null for paths it does not own", () => {
    for (const p of ["/nope", "/project", "/project/a/b", "/invite/tok123", "/list/today", "/settings/x"]) {
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
});

describe("roundtrip", () => {
  it("parse(build(view, task)) restores view and task for every route", () => {
    const views: ViewSel[] = [...LISTS.map((list) => ({ kind: "list", list }) as ViewSel), { kind: "project", projectId: "p1" }, { kind: "settings" }];
    for (const view of views) {
      for (const taskId of [null, "t1"]) {
        const url = buildAppUrl(view, taskId);
        const q = url.indexOf("?");
        const [pathname, search] = q === -1 ? [url, ""] : [url.slice(0, q), url.slice(q)];
        expect(parseAppUrl(pathname, search)).toEqual({ view, taskId: view.kind === "settings" ? null : taskId });
      }
    }
  });

  it("canonicalises the / alias", () => {
    const r = parseAppUrl("/", "");
    expect(r && buildAppUrl(r.view, r.taskId)).toBe("/today");
  });
});
