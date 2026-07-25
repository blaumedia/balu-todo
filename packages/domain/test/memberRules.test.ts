import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canChangeMemberRole,
  canRemoveMember,
  ROLE_RANK,
  type Role,
} from "../src/index.js";

// The client lattice has to mirror `server/balu/routers/members.py` exactly: too
// strict and the UI hides a control the server would have honoured, too loose
// and it renders one that always comes back 403. `server/tests/test_members.py`
// asserts the same table from the other side.
const ROLES: Role[] = ["viewer", "member", "admin", "owner"];

/** PATCH: `update_member_role` checks admin rank *before* the self-allowance. */
function serverAllowsRoleChange(actor: Role, target: Role, isSelf: boolean): boolean {
  if (ROLE_RANK[actor] < ROLE_RANK.admin) return false; // "admin role required"
  if (isSelf) return true; // stepping down / handing over
  return ROLE_RANK[actor] >= ROLE_RANK[target]; // may not act on a higher rank
}

/** DELETE: `remove_member` allows self unconditionally ("admin role or self"). */
function serverAllowsRemoval(actor: Role, target: Role, isSelf: boolean): boolean {
  if (isSelf) return true;
  if (ROLE_RANK[actor] < ROLE_RANK.admin) return false;
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}

describe("member permission lattice", () => {
  it("matches the server for every actor/target/self combination", () => {
    for (const actor of ROLES) {
      for (const target of ROLES) {
        for (const isSelf of [true, false]) {
          const where = `actor=${actor} target=${target} isSelf=${isSelf}`;
          expect(canChangeMemberRole(actor, target, isSelf), `PATCH ${where}`).toBe(
            serverAllowsRoleChange(actor, target, isSelf),
          );
          expect(canRemoveMember(actor, target, isSelf), `DELETE ${where}`).toBe(
            serverAllowsRemoval(actor, target, isSelf),
          );
        }
      }
    }
  });

  it("separates leaving from self-promotion", () => {
    // A member may leave, but must not be offered a role dropdown for themselves
    // — the server refuses PATCH below admin rank, self or not.
    expect(canRemoveMember("member", "member", true)).toBe(true);
    expect(canChangeMemberRole("member", "member", true)).toBe(false);
    expect(canChangeMemberRole("viewer", "viewer", true)).toBe(false);
  });

  it("lets peers act on each other", () => {
    // The reason the rule is `>=` and not `>`: with `>`, a co-owner could never
    // be removed through the API — only they could step down.
    expect(canRemoveMember("owner", "owner", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(true);
  });

  it("never lets anyone act on a higher rank", () => {
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
    expect(canRemoveMember("member", "admin", false)).toBe(false);
    expect(canRemoveMember("viewer", "viewer", false)).toBe(false); // not a manager
  });

  it("treats a missing role as no permission", () => {
    expect(canRemoveMember(null, "member", false)).toBe(false);
    expect(canRemoveMember(undefined, "member", false)).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("only an owner may hand out owner", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
  });

  it("gives non-managers nothing to assign", () => {
    expect(assignableRoles("member")).toEqual([]);
    expect(assignableRoles("viewer")).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it("never offers a role the actor could not then act on", () => {
    // Rendering an option the server rejects is the bug this guards against.
    for (const actor of ROLES) {
      for (const role of assignableRoles(actor)) {
        expect(
          serverAllowsRoleChange(actor, role, false),
          `${actor} was offered ${role} but the server would refuse it`,
        ).toBe(true);
      }
    }
  });
});
