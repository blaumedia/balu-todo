// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../src/store/app.js";
import { useUrlSync } from "../src/lib/useUrlSync.js";

const today = { kind: "list", list: "today" } as const;
const upcoming = { kind: "list", list: "upcoming" } as const;
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("useUrlSync - reader history wiring", () => {
  let push: ReturnType<typeof vi.spyOn>;
  let replace: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;

  function mount(url: string, state: unknown = null, reader: string | null = null): void {
    globalThis.history.replaceState(state, "", url);
    useApp.setState({ view: today, selectedTaskId: reader, fullscreenTaskId: reader, focusedIndex: -1, focusDeadline: false, paletteOpen: false, quickAddOpen: false });
    renderHook(() => useUrlSync());
    push = vi.spyOn(globalThis.history, "pushState");
    replace = vi.spyOn(globalThis.history, "replaceState");
    back = vi.spyOn(globalThis.history, "back");
  }
  const calls = () => ({ push: push.mock.calls.length, replace: replace.mock.calls.length, back: back.mock.calls.length });

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("open pushes one marked entry; close pops it and keeps focusedIndex", async () => {
    mount("/today");
    act(() => useApp.setState({ selectedTaskId: "t1", focusedIndex: 3 }));
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
    push.mockClear();
    replace.mockClear();
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    expect(calls()).toMatchObject({ push: 1 });
    expect(push.mock.calls[0]?.[0]).toEqual({ baluReader: true, under: "/today?task=t1" });
    expect(globalThis.location.pathname).toBe("/task/t1");

    act(() => useApp.setState({ fullscreenTaskId: null }));
    expect(back).toHaveBeenCalledTimes(1);
    await act(tick);
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
    expect(useApp.getState().focusedIndex).toBe(3);
    expect(useApp.getState().selectedTaskId).toBe("t1");
  });

  it("the pop from our own back() never overwrites newer state", async () => {
    mount("/today");
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    act(() => useApp.setState({ focusedIndex: 5, focusDeadline: true }));
    await act(tick);
    expect(useApp.getState().focusedIndex).toBe(5);
    expect(useApp.getState().focusDeadline).toBe(true);
  });

  it("closing a deep-linked reader replaces, never back()", () => {
    mount("/task/t1", null, "t1");
    replace.mockClear();
    act(() => useApp.setState({ fullscreenTaskId: null }));
    expect(calls()).toEqual({ push: 0, replace: 1, back: 0 });
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
  });

  it("palette jump to the same task while open replaces and keeps the new view", async () => {
    mount("/today");
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    replace.mockClear();
    act(() => useApp.setState({ view: upcoming, selectedTaskId: "t1", fullscreenTaskId: null }));
    await act(tick);
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(useApp.getState().view).toEqual(upcoming);
    expect(globalThis.location.pathname).toBe("/upcoming");
  });

  it("a view change with no reader open still pushes; selection change replaces", () => {
    mount("/today");
    act(() => useApp.setState({ view: upcoming }));
    expect(calls()).toMatchObject({ push: 1, back: 0 });
    replace.mockClear();
    act(() => useApp.setState({ selectedTaskId: "t2" }));
    expect(calls()).toMatchObject({ push: 1, replace: 1 });
  });
});
