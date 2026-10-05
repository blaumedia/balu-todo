import { describe, expect, it } from "vitest";
import { activeProjects, archivedProjects, PROJECT_COLORS } from "../src/index.js";
import type { Project } from "../src/index.js";

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
