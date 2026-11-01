import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../src/lib/clipboard.js";

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true when writeText resolves", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await copyText("x")).toBe(true);
  });
  it("returns false when writeText rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    expect(await copyText("x")).toBe(false);
  });
  it("returns false without a clipboard", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toBe(false);
  });
});
