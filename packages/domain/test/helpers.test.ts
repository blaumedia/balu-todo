import { describe, expect, it } from "vitest";
import { reorderUpdates, spacedOrders } from "../src/index.js";

describe("spacedOrders", () => {
  it("spaces ids evenly from STEP", () => {
    expect(spacedOrders(["a", "b", "c"])).toEqual([
      { id: "a", sort_order: 1000 },
      { id: "b", sort_order: 2000 },
      { id: "c", sort_order: 3000 },
    ]);
  });

  it("returns nothing for an empty order", () => {
    expect(spacedOrders([])).toEqual([]);
  });
});

describe("reorderUpdates", () => {
  it("emits nothing for a no-op drag", () => {
    const items = [
      { id: "a", sort_order: 1000 },
      { id: "b", sort_order: 2000 },
      { id: "c", sort_order: 3000 },
    ];
    expect(reorderUpdates(items, ["a", "b", "c"])).toEqual([]);
  });

  it("rewrites every position when the order changes", () => {
    const items = [
      { id: "a", sort_order: 1000 },
      { id: "b", sort_order: 2000 },
      { id: "c", sort_order: 3000 },
    ];
    expect(reorderUpdates(items, ["c", "a", "b"])).toEqual([
      { id: "c", sort_order: 1000 },
      { id: "a", sort_order: 2000 },
      { id: "b", sort_order: 3000 },
    ]);
  });

  it("heals uneven spacing without re-sending an untouched id", () => {
    const items = [
      { id: "a", sort_order: 1000 },
      { id: "b", sort_order: 5000 },
    ];
    expect(reorderUpdates(items, ["a", "b"])).toEqual([{ id: "b", sort_order: 2000 }]);
  });

  it("keeps ids absent from items (a freshly added row still gets placed)", () => {
    const items = [{ id: "a", sort_order: 1000 }];
    expect(reorderUpdates(items, ["a", "x"])).toEqual([{ id: "x", sort_order: 2000 }]);
  });
});
