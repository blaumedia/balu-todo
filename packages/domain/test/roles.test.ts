import { describe, expect, it } from "vitest";
import {
  canComment,
  canDeleteComment,
  canEditComment,
  canManageMembers,
  canWrite,
  rankOf,
  ROLE_RANK,
  type Comment,
  type Role,
} from "../src/index.js";

const comment = (author: string): Comment => ({
  id: "c1",
  workspace_id: "w1",
  task_id: "t1",
  author_id: author,
  body: "hi",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  is_deleted: false,
});

const ROLES: Role[] = ["viewer", "member", "admin", "owner"];

describe("role capabilities (contract §2, §3.4, §7)", () => {
  it("ranks roles like the server's ROLE_RANK", () => {
    expect(ROLE_RANK).toEqual({ viewer: 0, member: 1, admin: 2, owner: 3 });
    expect(rankOf(null)).toBe(-1);
    expect(rankOf(undefined)).toBe(-1);
  });

  it("viewers are read-only", () => {
    expect(ROLES.filter(canWrite)).toEqual(["member", "admin", "owner"]);
    expect(canWrite(null)).toBe(false);
  });

  it("member management needs admin or owner", () => {
    expect(ROLES.filter(canManageMembers)).toEqual(["admin", "owner"]);
    expect(canManageMembers(null)).toBe(false);
  });

  it("commenting is a write", () => {
    for (const role of [...ROLES, null]) expect(canComment(role)).toBe(canWrite(role));
  });

  it("only the author may edit a comment", () => {
    expect(canEditComment(comment("u1"), "u1")).toBe(true);
    expect(canEditComment(comment("u1"), "u2")).toBe(false);
    expect(canEditComment(comment("u1"), null)).toBe(false);
  });

  it("the author or an admin+ may delete a comment", () => {
    expect(canDeleteComment(comment("u1"), "u1", "viewer")).toBe(true);
    expect(canDeleteComment(comment("u1"), "u2", "member")).toBe(false);
    expect(canDeleteComment(comment("u1"), "u2", "admin")).toBe(true);
    expect(canDeleteComment(comment("u1"), "u2", "owner")).toBe(true);
    expect(canDeleteComment(comment("u1"), null, null)).toBe(false);
  });
});
