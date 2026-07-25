import { describe, expect, it } from "vitest";
import { commentCountsByTask, commentsForTask } from "../src/index.js";
import type { Comment } from "../src/index.js";

let seq = 0;
function comment(over: Partial<Comment> & { id: string }): Comment {
  seq += 1;
  return {
    workspace_id: "w1",
    task_id: "t1",
    author_id: "u1",
    body: `Comment ${seq}`,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

describe("commentsForTask", () => {
  it("returns only the given task's comments", () => {
    const a = comment({ id: "c1", task_id: "t1" });
    const b = comment({ id: "c2", task_id: "t2" });
    expect(commentsForTask([a, b], "t1").map((c) => c.id)).toEqual(["c1"]);
  });

  it("orders by created_at ascending", () => {
    const later = comment({ id: "c1", created_at: "2026-07-03T10:00:00Z" });
    const earlier = comment({ id: "c2", created_at: "2026-07-02T10:00:00Z" });
    const middle = comment({ id: "c3", created_at: "2026-07-02T18:00:00Z" });
    expect(commentsForTask([later, earlier, middle], "t1").map((c) => c.id)).toEqual([
      "c2",
      "c3",
      "c1",
    ]);
  });

  it("excludes soft-deleted comments", () => {
    const live = comment({ id: "c1" });
    const gone = comment({ id: "c2", is_deleted: true });
    expect(commentsForTask([live, gone], "t1").map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("stable ordering (I9)", () => {
  it("tie-breaks same-timestamp comments by id", () => {
    const b = comment({ id: "c2", created_at: "2026-07-02T10:00:00Z" });
    const a = comment({ id: "c1", created_at: "2026-07-02T10:00:00Z" });
    expect(commentsForTask([b, a], "t1").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(commentsForTask([a, b], "t1").map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("commentCountsByTask", () => {
  it("counts live comments per task", () => {
    const counts = commentCountsByTask([
      comment({ id: "c1", task_id: "t1" }),
      comment({ id: "c2", task_id: "t1" }),
      comment({ id: "c3", task_id: "t2" }),
      comment({ id: "c4", task_id: "t1", is_deleted: true }),
    ]);
    expect(counts.get("t1")).toBe(2);
    expect(counts.get("t2")).toBe(1);
    expect(counts.get("t3")).toBeUndefined();
  });
});
