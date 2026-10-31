import { describe, expect, it } from "vitest";
import { withTimeout } from "../src/index.js";

describe("withTimeout", () => {
  it("resolves with the value of a fast run", async () => {
    const v = await withTimeout(1000, async () => 42, () => new Error("timeout"));
    expect(v).toBe(42);
  });

  it("rejects a never-settling run with onTimeout() and aborts the signal", async () => {
    let seen: AbortSignal | undefined;
    const p = withTimeout(
      10,
      (signal) => {
        seen = signal;
        return new Promise<never>(() => {});
      },
      () => new Error("too slow"),
    );
    await expect(p).rejects.toThrow("too slow");
    expect(seen?.aborted).toBe(true);
  });

  it("passes a rejection from run through unchanged", async () => {
    const boom = new Error("boom");
    await expect(
      withTimeout(1000, () => Promise.reject(boom), () => new Error("timeout")),
    ).rejects.toBe(boom);
  });
});
