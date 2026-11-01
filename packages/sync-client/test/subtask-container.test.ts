// A subtask's project_id and section_id follow its parent (contract §3.3),
// mirrored optimistically exactly as the server's h_task_move / h_task_add do.
import { describe, expect, it } from "vitest";
import { applyCommand, type ApplyContext } from "../src/apply.js";
import { emptyReplica } from "../src/replica.js";
import type { SyncCommand } from "@balu/domain";

const ctx: ApplyContext = {
  workspaceId: "w1",
  userId: "u1",
  now: () => "2026-01-01T00:00:00.000Z",
  today: () => "2026-01-01",
};

function run(replica: ReturnType<typeof emptyReplica>, type: string, args: Record<string, unknown>, temp_id?: string) {
  applyCommand(replica, { uuid: `c-${Math.random()}`, type, args, temp_id } as unknown as SyncCommand, ctx);
}

function setup() {
  const r = emptyReplica();
  run(r, "project_add", { name: "A" }, "pa");
  run(r, "project_add", { name: "B" }, "pb");
  run(r, "section_add", { project_id: "pa", name: "sa" }, "sa");
  run(r, "section_add", { project_id: "pb", name: "sb" }, "sb");
  run(r, "task_add", { title: "P", project_id: "pa", section_id: "sa" }, "par");
  run(r, "task_add", { title: "P2", project_id: "pb", section_id: "sb" }, "par2");
  run(r, "task_add", { title: "S", parent_task_id: "par", project_id: "pb" }, "s1");
  return r;
}

describe("subtask container follows its parent", () => {
  it("task_add under a parent takes the parent's project and section", () => {
    const s = setup().tasks.get("s1")!;
    expect([s.project_id, s.section_id]).toEqual(["pa", "sa"]);
  });

  it("task_move of the parent cascades to live subtasks only", () => {
    const r = setup();
    run(r, "task_add", { title: "Dead", parent_task_id: "par" }, "s2");
    r.tasks.get("s2")!.is_deleted = true;
    run(r, "task_move", { id: "par", project_id: "pb", section_id: "sb" });
    const s = r.tasks.get("s1")!;
    expect([s.project_id, s.section_id]).toEqual(["pb", "sb"]);
    expect(r.tasks.get("s2")!.project_id).toBe("pa");
  });

  it("moving the parent to another project without a section clears the subtasks' section", () => {
    const r = setup();
    run(r, "task_move", { id: "par", project_id: "pb" });
    const s = r.tasks.get("s1")!;
    expect([s.project_id, s.section_id]).toEqual(["pb", null]);
  });

  it("leaves the updated_at of subtasks whose container did not change alone", () => {
    const r = setup();
    r.tasks.get("s1")!.updated_at = "old";
    run(r, "task_move", { id: "par", sort_order: 5000 });
    expect(r.tasks.get("s1")!.updated_at).toBe("old");
  });

  it("re-parenting a subtask takes the new parent's project and section", () => {
    const r = setup();
    run(r, "task_move", { id: "s1", parent_task_id: "par2" });
    const s = r.tasks.get("s1")!;
    expect([s.project_id, s.section_id]).toEqual(["pb", "sb"]);
  });

  it("ignores a task_move that would make a task its own parent", () => {
    const r = setup();
    run(r, "task_move", { id: "par", parent_task_id: "par", project_id: "pb" });
    const p = r.tasks.get("par")!;
    expect([p.parent_task_id, p.project_id]).toEqual([null, "pa"]);
  });
});

describe("task_reorder", () => {
  it("skips deleted and unknown ids and still applies the rest", () => {
    const r = setup();
    r.tasks.get("par2")!.is_deleted = true;
    run(r, "task_reorder", {
      items: [
        { id: "par", sort_order: 7000 },
        { id: "par2", sort_order: 8000 },
        { id: "nope", sort_order: 9000 },
      ],
    });
    expect(r.tasks.get("par")!.sort_order).toBe(7000);
    expect(r.tasks.get("par2")!.sort_order).not.toBe(8000);
  });
});
