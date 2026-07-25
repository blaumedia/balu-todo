import { describe, expect, it } from "vitest";
import { scoreText, searchItems, searchReplica } from "../src/index.js";
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

describe("searchReplica (grouped; shared with mobile — D2/I6)", () => {
  const EMPTY = { tasks: [], projects: [], labels: [] };

  it("ranks tasks with the same scoring as searchItems", () => {
    const exact = task({ title: "milk" });
    const prefix = task({ title: "milk run" });
    const substring = task({ title: "buy the milk" });
    const input = { ...EMPTY, tasks: [substring, prefix, exact], query: "milk" };
    expect(searchReplica(input).tasks.map((t) => t.id)).toEqual([exact.id, prefix.id, substring.id]);
    // Same order the ⌘K palette would show.
    const flat = searchItems("milk", { tasks: [substring, prefix, exact], projects: [], labels: [] });
    expect(flat.map((r) => r.id)).toEqual([exact.id, prefix.id, substring.id]);
  });

  it("hides completed tasks by default and sorts them last when included", () => {
    const open = task({ title: "report open" });
    const done = task({ title: "report", completed_at: "2026-07-20T00:00:00Z" });
    expect(searchReplica({ ...EMPTY, tasks: [open, done], query: "report" }).tasks.map((t) => t.id))
      .toEqual([open.id]);
    // `done` scores higher (exact match) but completed still sorts last.
    expect(
      searchReplica({ ...EMPTY, tasks: [open, done], query: "report", includeCompleted: true })
        .tasks.map((t) => t.id),
    ).toEqual([open.id, done.id]);
  });

  it("hides archived projects unless asked", () => {
    const live = project({ name: "Finance" });
    const archived = project({ name: "Finance old", archived_at: "2026-01-01T00:00:00Z" });
    expect(searchReplica({ ...EMPTY, projects: [live, archived], query: "finance" }).projects.map((p) => p.id))
      .toEqual([live.id]);
    expect(
      searchReplica({
        ...EMPTY, projects: [live, archived], query: "finance", includeArchivedProjects: true,
      }).projects.map((p) => p.id),
    ).toEqual([live.id, archived.id]);
  });

  it("caps tasks and returns nothing for a blank query", () => {
    const many = Array.from({ length: 10 }, (_, i) => task({ title: `find me ${i}` }));
    expect(searchReplica({ ...EMPTY, tasks: many, query: "find me", cap: 3 }).tasks).toHaveLength(3);
    expect(searchReplica({ ...EMPTY, tasks: many, query: "  " })).toEqual({ tasks: [], projects: [], labels: [] });
  });

  it("never returns soft-deleted objects", () => {
    const t = task({ title: "ghost", is_deleted: true, completed_at: "2026-07-20T00:00:00Z" });
    const p = project({ name: "ghost", is_deleted: true });
    const l = label({ name: "ghost", is_deleted: true });
    const out = searchReplica({ tasks: [t], projects: [p], labels: [l], query: "ghost", includeCompleted: true });
    expect(out).toEqual({ tasks: [], projects: [], labels: [] });
  });
});
