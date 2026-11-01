// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../src/store/app.js";
import { markReplaceNext, useUrlSync } from "../src/lib/useUrlSync.js";

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

  it("a user-initiated Back after a close still updates the store", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    await act(tick);
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
    act(() => globalThis.history.back());
    await act(tick);
    expect(globalThis.location.pathname).toBe("/upcoming");
    expect(useApp.getState().view).toEqual(upcoming);
    expect(useApp.getState().selectedTaskId).toBeNull();
  });

  it("a back() that never pops does not swallow the user's next Back", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    // Our own back() is lost (no prior entry, unmount in between, browser ignores it),
    // so no popstate consumes the expectation.
    back.mockImplementation(() => {});
    act(() => useApp.setState({ fullscreenTaskId: null }));
    await act(tick);
    // A later real user Back lands somewhere else than the expected landing URL.
    act(() => {
      globalThis.history.replaceState(null, "", "/upcoming");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    // It is user navigation: the store follows it instead of rewriting the URL back.
    expect(useApp.getState().view).toEqual(upcoming);
    expect(globalThis.location.pathname).toBe("/upcoming");
  });

  it("a heal's replace intent between our back() and its pop replaces instead of pushing", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    act(() => {
      markReplaceNext();
      useApp.setState({ view: upcoming, selectedTaskId: null }); // self-heal before the popstate
    });
    push.mockClear();
    replace.mockClear();
    await act(tick);
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(globalThis.location.pathname).toBe("/upcoming");
  });

  it("a view change between our back() and its pop pushes instead of overwriting the landed entry", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    act(() => useApp.setState({ view: upcoming, selectedTaskId: null })); // before the popstate
    push.mockClear();
    replace.mockClear();
    await act(tick);
    expect(push).toHaveBeenCalledTimes(1);
    expect(globalThis.location.pathname).toBe("/upcoming");
    act(() => globalThis.history.back());
    await act(tick);
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
  });

  it("a reader reopened before our pop lands keeps the entry below it", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" })); // reopened before the popstate
    await act(tick);
    // the reopened reader has its own marked entry on top of the landed one
    expect(globalThis.history.state).toEqual({ baluReader: true, under: "/today?task=t1" });
    act(() => useApp.setState({ fullscreenTaskId: null }));
    await act(tick);
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
    expect(useApp.getState().view).toEqual(today);
  });

  it("browser Back from a reader reopened before our pop closes it", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: null }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    await act(tick);
    act(() => globalThis.history.back());
    await act(tick);
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/today?task=t1");
    expect(useApp.getState().fullscreenTaskId).toBeNull();
  });

  it("unmount drops a pending pop expectation", async () => {
    mount("/upcoming");
    act(() => useApp.setState({ view: today }));
    act(() => useApp.setState({ selectedTaskId: "t1" }));
    act(() => useApp.setState({ fullscreenTaskId: "t1" }));
    back.mockImplementation(() => {});
    act(() => useApp.setState({ fullscreenTaskId: null })); // back() lost, expectation pending
    cleanup();
    back.mockRestore();
    // Remount on a plain, already aligned URL (no reader marker), so the mount
    // effect writes nothing and no back() of our own is in flight.
    globalThis.history.replaceState(null, "", "/upcoming");
    useApp.setState({ view: upcoming, selectedTaskId: null, fullscreenTaskId: null });
    renderHook(() => useUrlSync());
    // A user navigation that happens to land on the old expected URL is still user navigation.
    act(() => {
      globalThis.history.replaceState(null, "", "/today?task=t1");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(useApp.getState().view).toEqual(today);
    expect(useApp.getState().selectedTaskId).toBe("t1");
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
