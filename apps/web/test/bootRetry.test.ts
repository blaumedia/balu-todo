import { describe, expect, it, vi } from "vitest";
import { bootRetryDelayMs, bootRetryWaitMs, waitForRetry, wakeBootRetry } from "../src/lib/bootRetry.js";

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

describe("bootRetryWaitMs", () => {
  it("jitters the backoff by +-20%", () => {
    const r = vi.spyOn(Math, "random");
    r.mockReturnValue(0);
    expect(bootRetryWaitMs(1)).toBeCloseTo(1600);
    r.mockReturnValue(1);
    expect(bootRetryWaitMs(1)).toBeCloseTo(2400);
    r.mockRestore();
  });
  it("never waits less than Retry-After", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(bootRetryWaitMs(0, 10_000)).toBe(10_000);
    expect(bootRetryWaitMs(0, 100)).toBe(1000);
    vi.restoreAllMocks();
  });
});

describe("wakeBootRetry", () => {
  it("ends a running wait at once", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = waitForRetry(30_000).then(() => {
        done = true;
      });
      wakeBootRetry();
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
