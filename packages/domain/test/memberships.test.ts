import { describe, expect, it } from "vitest";
import { pickMembership, type Membership } from "../src/index.js";

function m(id: string): Membership {
  return {
    workspace: { id, name: id, created_at: "2026-07-01T00:00:00Z" },
    role: "owner",
  };
}

const all = [m("a"), m("b"), m("c")];

describe("pickMembership", () => {
  it("prefers the explicitly requested workspace", () => {
    expect(pickMembership(all, "c", "b")?.workspace.id).toBe("c");
  });

  it("falls back to the last-used workspace", () => {
    expect(pickMembership(all, null, "b")?.workspace.id).toBe("b");
  });

  it("falls back to the first membership", () => {
    expect(pickMembership(all, null, null)?.workspace.id).toBe("a");
  });

  it("ignores ids the user is no longer a member of", () => {
    expect(pickMembership(all, "gone", "also-gone")?.workspace.id).toBe("a");
    expect(pickMembership(all, "gone", "b")?.workspace.id).toBe("b");
  });

  it("returns undefined when there are no memberships", () => {
    expect(pickMembership([], "a", "b")).toBeUndefined();
  });
});
