import { describe, expect, it } from "vitest";
import { phaseAfterFailedBoot } from "../src/lib/inviteAccept.js";

describe("phaseAfterFailedBoot", () => {
  it("asks for a login when the session is gone", () => {
    expect(phaseAfterFailedBoot(false)).toBe("needsAuth");
  });

  it("shows a boot error, not the login form or 'invalid invite', when the login is intact", () => {
    expect(phaseAfterFailedBoot(true)).toBe("bootFailed");
  });
});
