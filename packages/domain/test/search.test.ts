import { describe, expect, it } from "vitest";
import { scoreText, searchItems } from "../src/index.js";
import type { Label, Project, Task } from "../src/index.js";

let seq = 0;
function task(over: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    workspace_id: "w1",
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title: `Task ${seq}`,
    notes: "",
    start_date: null,
    evening: false,
    someday: false,
    deadline: null,
    reminder_at: null,
    recurrence: null,
    priority: 0,
    label_ids: [],
    assigned_to: null,
    sort_order: seq * 1000,
    completed_at: null,
    completed_by: null,
    created_by: "u1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

function project(over: Partial<Project>): Project {
  seq += 1;
  return {
    id: `p${seq}`,
    workspace_id: "w1",
    name: `Project ${seq}`,
    color: "blue",
    sort_order: seq * 1000,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

function label(over: Partial<Label>): Label {
  seq += 1;
  return {
    id: `l${seq}`,
    workspace_id: "w1",
    name: `label${seq}`,
    color: "amber",
    sort_order: seq * 1000,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

const empty = { tasks: [], projects: [], labels: [] };

describe("scoreText", () => {
  it("exact beats prefix beats word-prefix beats subsequence", () => {
    const exact = scoreText("milk", "milk")!;
    const prefix = scoreText("mil", "milk")!;
    const word = scoreText("bar", "foo bar")!;
    const substr = scoreText("oob", "foobar")!;
    const sub = scoreText("mlk", "milk")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(sub);
  });

  it("is case-insensitive on the text side", () => {
    expect(scoreText("milk", "Buy Milk")).not.toBeNull();
  });

  it("returns null when characters are out of order", () => {
    expect(scoreText("klim", "milk")).toBeNull();
  });

  it("empty query scores 0 (neutral)", () => {
    expect(scoreText("", "anything")).toBe(0);
  });
});

describe("searchItems", () => {
  it("returns nothing for a blank query", () => {
    expect(searchItems("   ", empty)).toEqual([]);
  });

  it("matches task titles and ranks a title prefix above a subsequence", () => {
    const buyMilk = task({ title: "Buy milk" });
    const misc = task({ title: "Mail landlord kindly" }); // subsequence m-i-l-k
    const res = searchItems("milk", { tasks: [misc, buyMilk], projects: [], labels: [] });
    expect(res[0]!.id).toBe(buyMilk.id);
    expect(res.map((r) => r.id)).toContain(misc.id);
  });

  it("matches notes but ranks below a title hit", () => {
    const titleHit = task({ title: "Groceries milk" });
    const notesHit = task({ title: "Errands", notes: "remember the milk" });
    const res = searchItems("milk", { tasks: [notesHit, titleHit], projects: [], labels: [] });
    expect(res[0]!.id).toBe(titleHit.id);
    expect(res.map((r) => r.id)).toContain(notesHit.id);
  });

  it("mixes projects and labels with a kind discriminator", () => {
    const t = task({ title: "finance report" });
    const p = project({ name: "Finanzen" });
    const l = label({ name: "finish" });
    const res = searchItems("fin", { tasks: [t], projects: [p], labels: [l] });
    const kinds = new Set(res.map((r) => r.kind));
    expect(kinds.has("task")).toBe(true);
    expect(kinds.has("project")).toBe(true);
    expect(kinds.has("label")).toBe(true);
  });

  it("skips soft-deleted objects", () => {
    const gone = task({ title: "deleted milk", is_deleted: true });
    expect(searchItems("milk", { tasks: [gone], projects: [], labels: [] })).toEqual([]);
  });

  it("honors the limit", () => {
    const tasks = Array.from({ length: 30 }, (_, i) => task({ title: `alpha ${i}` }));
    expect(searchItems("alpha", { tasks, projects: [], labels: [] }, 5)).toHaveLength(5);
  });
});
