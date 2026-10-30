import { describe, expect, it } from "vitest";
import { projectViewAction, type ProjectViewInput } from "../src/lib/projectView.js";

const base: ProjectViewInput = {
  projectId: "P1",
  projects: [{ id: "P1", is_deleted: false }],
  aliases: {},
  synced: true,
  quickAddOpen: false,
};
const act = (over: Partial<ProjectViewInput>) => projectViewAction({ ...base, ...over });

describe("projectViewAction", () => {
  it("follows an aliased temp id, regardless of sync status or open quick-add", () => {
    const o = { projectId: "tmp-a", aliases: { "tmp-a": "P1" } };
    expect(act(o)).toEqual({ kind: "follow", projectId: "P1" });
    expect(act({ ...o, synced: false })).toEqual({ kind: "follow", projectId: "P1" });
    expect(act({ ...o, quickAddOpen: true })).toEqual({ kind: "follow", projectId: "P1" });
  });

  it("keeps an existing project", () => {
    expect(act({})).toEqual({ kind: "keep" });
  });

  it("heals a missing project to Today once synced", () => {
    expect(act({ projectId: "gone" })).toEqual({ kind: "today" });
  });

  it("heals a deleted project to Today once synced", () => {
    expect(act({ projects: [{ id: "P1", is_deleted: true }] })).toEqual({ kind: "today" });
  });

  it("keeps a missing project while not synced", () => {
    expect(act({ projectId: "gone", synced: false })).toEqual({ kind: "keep" });
  });

  it("keeps a missing project while quick-add is open", () => {
    expect(act({ projectId: "gone", quickAddOpen: true })).toEqual({ kind: "keep" });
  });

  it("heals a tmp id without alias (reload case)", () => {
    expect(act({ projectId: "tmp-x" })).toEqual({ kind: "today" });
  });

  it("does not resolve through Object.prototype", () => {
    expect(act({ projectId: "constructor", projects: [{ id: "constructor", is_deleted: false }] })).toEqual({
      kind: "keep",
    });
  });
});
