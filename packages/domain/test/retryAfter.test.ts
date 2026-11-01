import { describe, expect, it } from "vitest";
import { parseRetryAfter, RETRY_AFTER_CAP_MS } from "../src/index.js";

describe("parseRetryAfter", () => {
  it("reads delta-seconds as ms", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(" 0 ")).toBe(0);
  });
  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(parseRetryAfter("Tue, 01 Jan 2030 00:00:10 GMT", now)).toBe(10_000);
  });
  it("is null for absent, past or unusable values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("Tue, 01 Jan 2000 00:00:00 GMT")).toBeNull();
  });
  it("clamps to the cap", () => {
    expect(parseRetryAfter("99999")).toBe(RETRY_AFTER_CAP_MS);
  });
});
