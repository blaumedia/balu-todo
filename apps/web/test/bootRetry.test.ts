import { describe, expect, it, vi } from "vitest";
import { bootRetryDelayMs, waitForRetry } from "../src/lib/bootRetry.js";

describe("bootRetryDelayMs", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(bootRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(bootRetryDelayMs(-1)).toBe(1000);
    expect(bootRetryDelayMs(100)).toBe(30000);
  });
});

describe("waitForRetry", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = waitForRetry(50).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
