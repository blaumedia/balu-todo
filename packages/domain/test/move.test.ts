import { describe, expect, it } from "vitest";
import { containerTasks, moveTaskArgs } from "../src/index.js";
import type { Task } from "../src/index.js";

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

describe("moveTaskArgs", () => {
  it("returns null for a no-op move", () => {
    const inSection = task({ project_id: "p1", section_id: "s1" });
    expect(moveTaskArgs(inSection, { project_id: "p1", section_id: "s1" }, [inSection])).toBeNull();
    const inInbox = task({});
    expect(moveTaskArgs(inInbox, { project_id: null, section_id: null }, [inInbox])).toBeNull();
  });

  it("names both container fields so server and replica agree", () => {
    const t = task({ project_id: "p1", section_id: "s1" });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [t]);
    expect(args).not.toBeNull();
    expect(args!.project_id).toBe("p2");
    expect("section_id" in args!).toBe(true);
    expect(args!.section_id).toBeNull();
  });

  it("appends with max + 1000 of the destination container", () => {
    const a = task({ project_id: "p2", sort_order: 1000 });
    const b = task({ project_id: "p2", sort_order: 3000 });
    const t = task({ project_id: "p1", section_id: "s1" });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [a, b, t]);
    expect(args).not.toBeNull();
    expect(args!.sort_order).toBe(4000);

    const lonely = task({ project_id: "p1", section_id: "s1" });
    const intoEmpty = moveTaskArgs(lonely, { project_id: "p3", section_id: null }, [lonely]);
    expect(intoEmpty).not.toBeNull();
    expect(intoEmpty!.sort_order).toBe(1000);
  });

  it("the moved task's own order does not feed its append position", () => {
    const dest = task({ project_id: "p2", sort_order: 2000 });
    const t = task({ project_id: "p1", section_id: "s1", sort_order: 9000 });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [dest, t]);
    expect(args).not.toBeNull();
    expect(args!.sort_order).toBe(3000);
  });

  it("other sections of the same project are not siblings", () => {
    const body = task({ project_id: "p2", sort_order: 2000 });
    const otherSection = task({ project_id: "p2", section_id: "s9", sort_order: 50000 });
    const t = task({ project_id: "p1", section_id: "s1" });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [body, otherSection, t]);
    expect(args).not.toBeNull();
    expect(args!.sort_order).toBe(3000);
  });

  it("deleted tasks and subtasks are not siblings", () => {
    const body = task({ project_id: "p2", sort_order: 1000 });
    const deleted = task({ project_id: "p2", sort_order: 50000, is_deleted: true });
    const subtask = task({ project_id: "p2", sort_order: 60000, parent_task_id: "parent" });
    const t = task({ project_id: "p1", section_id: "s1" });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [body, deleted, subtask, t]);
    expect(args).not.toBeNull();
    expect(args!.sort_order).toBe(2000);
    expect(containerTasks([body, deleted, subtask, t], { project_id: "p2", section_id: null }).map((x) => x.id)).toEqual([body.id]);
  });

  it("completed siblings still raise the append position", () => {
    // "Live" means "not soft-deleted", not "open": a completed task still
    // occupies the server's container ordering, so its sort_order counts.
    const body = task({ project_id: "p2", sort_order: 1000 });
    const done = task({ project_id: "p2", sort_order: 50000, completed_at: "2026-07-02T00:00:00Z", completed_by: "u1" });
    const t = task({ project_id: "p1", section_id: "s1" });
    const args = moveTaskArgs(t, { project_id: "p2", section_id: null }, [body, done, t]);
    expect(args).not.toBeNull();
    expect(args!.sort_order).toBe(51000);
    expect(containerTasks([body, done, t], { project_id: "p2", section_id: null }).map((x) => x.id)).toEqual([body.id, done.id]);
  });
});
