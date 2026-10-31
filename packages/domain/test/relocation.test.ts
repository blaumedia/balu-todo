import { describe, expect, it } from "vitest";
import { relocationNotice } from "../src/index.js";

describe("relocationNotice", () => {
  const cases: Array<[string[][], string | null]> = [
    [[], null],
    [[["project_deleted"]], "inbox"],
    [[["section_deleted"]], "project"],
    [[["parent_deleted"]], "topLevel"],
    [[["project_deleted", "parent_deleted"]], "inbox"],
    [[["section_deleted", "parent_deleted"]], "project"],
    [[["project_deleted"], ["project_deleted"]], "inbox"],
    [[["project_deleted"], ["section_deleted"]], "mixed"],
    [[["something_new"]], "mixed"],
    [[[]], "mixed"],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(relocationNotice(input)).toBe(expected);
    });
  }
});
