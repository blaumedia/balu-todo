import { describe, expect, it } from "vitest";
import {
  activeProjects,
  archivedProjectIds,
  archivedProjects,
  effectiveProjectId,
  excludeArchivedProjectTasks,
  nextProjectSortOrder,
  PROJECT_COLORS,
} from "../src/index.js";
import type { Project, Task } from "../src/index.js";

let seq = 0;
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

describe("activeProjects", () => {
  it("returns only live projects, ordered by sort_order", () => {
    const deleted = project({ is_deleted: true });
    const archived = project({ archived_at: "2026-07-02T00:00:00Z" });
    const liveLater = project({ sort_order: 3000 });
    const liveFirst = project({ sort_order: 1000 });
    const result = activeProjects([deleted, archived, liveLater, liveFirst]);
    expect(result.map((p) => p.sort_order)).toEqual([1000, 3000]);
    expect(result.map((p) => p.id)).toEqual([liveFirst.id, liveLater.id]);
  });
});

describe("archivedProjects", () => {
  it("returns archived non-deleted projects ordered by sort_order", () => {
    const live = project({});
    const archivedDeleted = project({ archived_at: "2026-07-02T00:00:00Z", is_deleted: true });
    const archivedLater = project({ archived_at: "2026-07-02T00:00:00Z", sort_order: 3000 });
    const archivedFirst = project({ archived_at: "2026-07-02T00:00:00Z", sort_order: 1000 });
    const result = archivedProjects([live, archivedDeleted, archivedLater, archivedFirst]);
    expect(result.map((p) => p.sort_order)).toEqual([1000, 3000]);
    expect(result.map((p) => p.id)).toEqual([archivedFirst.id, archivedLater.id]);
  });
});

describe("PROJECT_COLORS", () => {
  it("is the full 12-color contract palette without duplicates", () => {
    expect(PROJECT_COLORS).toHaveLength(12);
    expect(PROJECT_COLORS[0]).toBe("slate");
    expect(PROJECT_COLORS[PROJECT_COLORS.length - 1]).toBe("rose");
    expect(new Set(PROJECT_COLORS).size).toBe(PROJECT_COLORS.length);
  });
});

describe("archivedProjectIds", () => {
  it("collects archived non-deleted project ids only", () => {
    const live = project({});
    const archived = project({ archived_at: "2026-07-02T00:00:00Z" });
    const archivedAndDeleted = project({ archived_at: "2026-07-02T00:00:00Z", is_deleted: true });
    expect(archivedProjectIds([live, archived, archivedAndDeleted])).toEqual(new Set([archived.id]));
  });
});

describe("effectiveProjectId", () => {
  it("uses the task's own project", () => {
    const t = task({ project_id: "p1" });
    expect(effectiveProjectId(t, new Map([[t.id, t]]))).toBe("p1");
  });
  it("follows the parent for a subtask without one", () => {
    const parent = task({ project_id: "p1" });
    const child = task({ project_id: null, parent_task_id: parent.id });
    expect(effectiveProjectId(child, new Map([[parent.id, parent]]))).toBe("p1");
  });
  it("is null when the parent is not in the map", () => {
    const child = task({ project_id: null, parent_task_id: "missing" });
    expect(effectiveProjectId(child, new Map([[child.id, child]]))).toBeNull();
  });
  it("is null for a top-level inbox task", () => {
    const t = task({});
    expect(effectiveProjectId(t, new Map([[t.id, t]]))).toBeNull();
  });
});

describe("excludeArchivedProjectTasks", () => {
  it("returns the same array when nothing is archived", () => {
    const tasks = [task({ project_id: "p1" })];
    expect(excludeArchivedProjectTasks(tasks, [project({ id: "p1" })])).toBe(tasks);
  });
  it("drops the archived project's tasks and subtasks following it, keeps the rest", () => {
    const archived = project({ archived_at: "2026-07-02T00:00:00Z" });
    const live = project({});
    const inArchived = task({ project_id: archived.id });
    const parentInArchived = task({ project_id: archived.id });
    const subtaskOrphan = task({ project_id: null, parent_task_id: parentInArchived.id });
    const inLive = task({ project_id: live.id });
    const inInbox = task({});
    const tasks = [inArchived, parentInArchived, subtaskOrphan, inLive, inInbox];
    const out = excludeArchivedProjectTasks(tasks, [archived, live]);
    expect(out.map((t) => t.id)).toEqual([inLive.id, inInbox.id]);
  });
});

describe("nextProjectSortOrder", () => {
  it("appends after archived projects too, ignoring deleted ones", () => {
    const live = project({ sort_order: 1000 });
    const archived = project({ archived_at: "2026-07-02T00:00:00Z", sort_order: 5000 });
    const deleted = project({ is_deleted: true, sort_order: 9000 });
    expect(nextProjectSortOrder([live, archived, deleted])).toBe(6000);
  });
  it("is 1000 for an empty list", () => {
    expect(nextProjectSortOrder([])).toBe(1000);
  });
});
