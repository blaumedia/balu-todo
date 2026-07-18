import { describe, expect, it } from "vitest";
import {
  isAnytime,
  isAssignedToMe,
  isInbox,
  isLogbook,
  isSomeday,
  isToday,
  isUpcoming,
  nextSortOrder,
  selectList,
  upcomingGroupDate,
} from "../src/index.js";
import type { Task } from "../src/index.js";

const TODAY = "2026-07-23";

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

describe("isInbox", () => {
  it("open, no project, not someday, top-level", () => {
    expect(isInbox(task({}), TODAY)).toBe(true);
  });
  it("excludes tasks in a project", () => {
    expect(isInbox(task({ project_id: "p1" }), TODAY)).toBe(false);
  });
  it("excludes someday", () => {
    expect(isInbox(task({ someday: true, start_date: null }), TODAY)).toBe(false);
  });
  it("excludes subtasks", () => {
    expect(isInbox(task({ parent_task_id: "t0" }), TODAY)).toBe(false);
  });
  it("excludes completed", () => {
    expect(isInbox(task({ completed_at: "2026-07-22T00:00:00Z" }), TODAY)).toBe(false);
  });
  it("excludes soft-deleted", () => {
    expect(isInbox(task({ is_deleted: true }), TODAY)).toBe(false);
  });
});

describe("isToday", () => {
  it("start_date == today qualifies", () => {
    expect(isToday(task({ start_date: TODAY }), TODAY)).toBe(true);
  });
  it("start_date in the past qualifies", () => {
    expect(isToday(task({ start_date: "2026-07-01" }), TODAY)).toBe(true);
  });
  it("deadline == today qualifies (boundary)", () => {
    expect(isToday(task({ deadline: TODAY }), TODAY)).toBe(true);
  });
  it("overdue deadline qualifies", () => {
    expect(isToday(task({ deadline: "2026-07-20" }), TODAY)).toBe(true);
  });
  it("future start does not qualify", () => {
    expect(isToday(task({ start_date: "2026-07-30" }), TODAY)).toBe(false);
  });
  it("someday never qualifies", () => {
    expect(isToday(task({ someday: true, deadline: TODAY }), TODAY)).toBe(false);
  });
  it("subtask excluded", () => {
    expect(isToday(task({ start_date: TODAY, parent_task_id: "p" }), TODAY)).toBe(false);
  });
});

describe("isUpcoming", () => {
  it("future start qualifies", () => {
    expect(isUpcoming(task({ start_date: "2026-07-24" }), TODAY)).toBe(true);
  });
  it("future deadline qualifies", () => {
    expect(isUpcoming(task({ deadline: "2026-08-01" }), TODAY)).toBe(true);
  });
  it("today start does not (boundary — belongs to Today)", () => {
    expect(isUpcoming(task({ start_date: TODAY }), TODAY)).toBe(false);
  });
});

describe("isAnytime", () => {
  it("open, in project, no start date, not someday", () => {
    expect(isAnytime(task({ project_id: "p1" }), TODAY)).toBe(true);
  });
  it("excludes when it has a start date", () => {
    expect(isAnytime(task({ project_id: "p1", start_date: TODAY }), TODAY)).toBe(false);
  });
  it("excludes inbox tasks (no project)", () => {
    expect(isAnytime(task({ project_id: null }), TODAY)).toBe(false);
  });
});

describe("isSomeday", () => {
  it("someday qualifies", () => {
    expect(isSomeday(task({ someday: true }), TODAY)).toBe(true);
  });
  it("non-someday excluded", () => {
    expect(isSomeday(task({ someday: false }), TODAY)).toBe(false);
  });
});

describe("isLogbook", () => {
  it("completed qualifies", () => {
    expect(isLogbook(task({ completed_at: "2026-07-22T10:00:00Z" }), TODAY)).toBe(true);
  });
  it("open task excluded", () => {
    expect(isLogbook(task({}), TODAY)).toBe(false);
  });
  it("deleted completed excluded", () => {
    expect(
      isLogbook(task({ completed_at: "2026-07-22T10:00:00Z", is_deleted: true }), TODAY),
    ).toBe(false);
  });
});

describe("selectList Today ordering", () => {
  it("overdue-deadline first, evening last, then priority, then sort_order", () => {
    const overdue = task({ deadline: "2026-07-20", sort_order: 5000 });
    const eveningTask = task({ start_date: TODAY, evening: true, priority: 1, sort_order: 100 });
    const p1 = task({ start_date: TODAY, priority: 1, sort_order: 4000 });
    const p3 = task({ start_date: TODAY, priority: 3, sort_order: 300 });
    const none = task({ start_date: TODAY, priority: 0, sort_order: 200 });
    const ordered = selectList([none, eveningTask, p3, p1, overdue], "today", TODAY);
    expect(ordered.map((t) => t.id)).toEqual([
      overdue.id, // overdue deadline first
      p1.id, // then day tasks by priority
      p3.id,
      none.id,
      eveningTask.id, // evening always last despite P1
    ]);
  });
});

describe("selectList Upcoming ordering", () => {
  it("orders by earliest future date", () => {
    const far = task({ start_date: "2026-08-10" });
    const near = task({ start_date: "2026-07-25" });
    const mid = task({ deadline: "2026-07-28" });
    const out = selectList([far, mid, near], "upcoming", TODAY);
    expect(out.map((t) => t.id)).toEqual([near.id, mid.id, far.id]);
  });
  it("upcomingGroupDate picks earlier future date", () => {
    const t = task({ start_date: "2026-07-30", deadline: "2026-07-26" });
    expect(upcomingGroupDate(t, TODAY)).toBe("2026-07-26");
  });
});

describe("selectList Logbook ordering", () => {
  it("newest completion first", () => {
    const a = task({ completed_at: "2026-07-22T09:00:00Z" });
    const b = task({ completed_at: "2026-07-23T09:00:00Z" });
    const c = task({ completed_at: "2026-07-21T09:00:00Z" });
    const out = selectList([a, b, c], "logbook", TODAY);
    expect(out.map((t) => t.id)).toEqual([b.id, a.id, c.id]);
  });
});

describe("isAssignedToMe", () => {
  it("matches an open task assigned to the current user", () => {
    expect(isAssignedToMe(task({ assigned_to: "u1" }), "u1")).toBe(true);
  });
  it("excludes tasks assigned to someone else", () => {
    expect(isAssignedToMe(task({ assigned_to: "u2" }), "u1")).toBe(false);
  });
  it("excludes unassigned tasks", () => {
    expect(isAssignedToMe(task({ assigned_to: null }), "u1")).toBe(false);
  });
  it("excludes completed tasks", () => {
    expect(isAssignedToMe(task({ assigned_to: "u1", completed_at: "2026-07-22T00:00:00Z" }), "u1")).toBe(false);
  });
  it("excludes subtasks", () => {
    expect(isAssignedToMe(task({ assigned_to: "u1", parent_task_id: "p" }), "u1")).toBe(false);
  });
  it("false when no user id is known", () => {
    expect(isAssignedToMe(task({ assigned_to: "u1" }), null)).toBe(false);
  });
});

describe("selectList Assigned ordering", () => {
  it("deadline ascending with nulls last, then priority, then sort_order", () => {
    const noDeadlineP1 = task({ assigned_to: "u1", deadline: null, priority: 1, sort_order: 100 });
    const noDeadlineP3 = task({ assigned_to: "u1", deadline: null, priority: 3, sort_order: 50 });
    const early = task({ assigned_to: "u1", deadline: "2026-07-25", sort_order: 9000 });
    const late = task({ assigned_to: "u1", deadline: "2026-08-10", sort_order: 10 });
    const other = task({ assigned_to: "u2", deadline: "2026-07-24" });
    const out = selectList([noDeadlineP1, other, late, noDeadlineP3, early], "assigned", TODAY, "u1");
    expect(out.map((t) => t.id)).toEqual([
      early.id, // earliest deadline
      late.id, // later deadline
      noDeadlineP1.id, // nulls last, then priority P1 before P3
      noDeadlineP3.id,
    ]);
  });
});

describe("nextSortOrder", () => {
  it("returns 1000 for an empty container", () => {
    expect(nextSortOrder([])).toBe(1000);
  });
  it("returns max + 1000", () => {
    expect(nextSortOrder([{ sort_order: 1000 }, { sort_order: 3000 }])).toBe(4000);
  });
});
