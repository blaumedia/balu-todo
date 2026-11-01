import { describe, expect, it } from "vitest";
import { decideHistoryOp, READER_STATE, type HistoryInput } from "../src/lib/historyOp.js";
import { parseAppUrl, type ViewSel } from "../src/lib/url.js";

const today: ViewSel = { kind: "list", list: "today" };
const upcoming: ViewSel = { kind: "list", list: "upcoming" };

function at(url: string, state: unknown, over: Partial<HistoryInput>): HistoryInput {
  const [path = "", q = ""] = url.split("?");
  return {
    current: parseAppUrl(path, q ? `?${q}` : ""),
    currentUrl: url,
    currentState: state,
    view: today,
    selectedTaskId: null,
    fullscreenTaskId: null,
    replaceNext: false,
    ...over,
  };
}

describe("decideHistoryOp - full-screen reader", () => {
  it("opening pushes one entry", () => {
    expect(decideHistoryOp(at("/today?task=t1", null, { selectedTaskId: "t1", fullscreenTaskId: "t1" }))).toBe("push");
  });

  it("closing a reader we opened pops its entry (no push)", () => {
    expect(decideHistoryOp(at("/task/t1", READER_STATE, { selectedTaskId: "t1" }))).toBe("back");
  });

  it("closing a deep-linked reader replaces with the underlying view", () => {
    expect(decideHistoryOp(at("/task/t1", null, { selectedTaskId: "t1" }))).toBe("replace");
  });

  it("a close that also changes the selection or view never pops", () => {
    expect(decideHistoryOp(at("/task/t1", READER_STATE, { view: upcoming, selectedTaskId: null }))).toBe("replace");
  });

  it("after Back/Forward the URL already matches: nothing is written", () => {
    expect(decideHistoryOp(at("/today?task=t1", null, { selectedTaskId: "t1" }))).toBe("none");
    expect(decideHistoryOp(at("/task/t1", READER_STATE, { selectedTaskId: "t1", fullscreenTaskId: "t1" }))).toBe("none");
  });

  it("switching reader task keeps the marker on our entry", () => {
    expect(decideHistoryOp(at("/task/t1", READER_STATE, { selectedTaskId: "t2", fullscreenTaskId: "t2" }))).toBe("replace-reader");
    expect(decideHistoryOp(at("/task/t1", null, { selectedTaskId: "t2", fullscreenTaskId: "t2" }))).toBe("replace");
  });
});

describe("decideHistoryOp - views", () => {
  it("pushes on a view change, replaces on selection change", () => {
    expect(decideHistoryOp(at("/today", null, { view: upcoming }))).toBe("push");
    expect(decideHistoryOp(at("/today", null, { selectedTaskId: "t1" }))).toBe("replace");
  });

  it("replaceNext and foreign URLs replace", () => {
    expect(decideHistoryOp(at("/today", null, { view: upcoming, replaceNext: true }))).toBe("replace");
    expect(decideHistoryOp(at("/garbage", null, {}))).toBe("replace");
  });
});
