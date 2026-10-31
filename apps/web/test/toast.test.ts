// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../src/store/app.js";

describe("toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useApp.getState().dismissToast();
  });
  afterEach(() => vi.useRealTimers());

  it("clears a plain toast after 2600 ms", () => {
    useApp.getState().showToast("A");
    vi.advanceTimersByTime(2599);
    expect(useApp.getState().toast).toBe("A");
    vi.advanceTimersByTime(1);
    expect(useApp.getState().toast).toBeNull();
  });

  it("restarts the timer when the same message is shown again", () => {
    useApp.getState().showToast("A");
    vi.advanceTimersByTime(2000);
    useApp.getState().showToast("A");
    vi.advanceTimersByTime(1000);
    expect(useApp.getState().toast).toBe("A");
    vi.advanceTimersByTime(1600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("keeps an action toast for 10000 ms", () => {
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    vi.advanceTimersByTime(9999);
    expect(useApp.getState().toast).toBe("A");
    expect(useApp.getState().toastAction?.label).toBe("Go");
    vi.advanceTimersByTime(1);
    expect(useApp.getState().toast).toBeNull();
    expect(useApp.getState().toastAction).toBeNull();
  });

  it("dismissToast clears immediately and the old timer does not resurrect anything", () => {
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().dismissToast();
    expect(useApp.getState().toast).toBeNull();
    expect(useApp.getState().toastAction).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("honours durationMs and tone", () => {
    useApp.getState().showToast("A", { durationMs: 9000, tone: "error" });
    expect(useApp.getState().toastTone).toBe("error");
    vi.advanceTimersByTime(8999);
    expect(useApp.getState().toast).toBe("A");
    vi.advanceTimersByTime(1);
    expect(useApp.getState().toast).toBeNull();
    expect(useApp.getState().toastTone).toBe("success");
  });

  it("holdToast pauses the timer and release restarts it", () => {
    useApp.getState().showToast("A");
    useApp.getState().holdToast("hover", true);
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBe("A");
    useApp.getState().holdToast("hover", false);
    vi.advanceTimersByTime(2600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a focus hold survives the mouse leaving", () => {
    useApp.getState().showToast("A");
    useApp.getState().holdToast("focus", true);
    useApp.getState().holdToast("hover", true);
    useApp.getState().holdToast("hover", false);
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBe("A");
    useApp.getState().holdToast("focus", false);
    vi.advanceTimersByTime(2600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a new toast under a held pointer waits for release", () => {
    useApp.getState().showToast("A");
    useApp.getState().holdToast("hover", true);
    useApp.getState().showToast("B");
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBe("B");
    useApp.getState().holdToast("hover", false);
    vi.advanceTimersByTime(2600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a plain toast replacing a focused action toast drops the stale focus hold", () => {
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().holdToast("focus", true);
    useApp.getState().showToast("B");
    vi.advanceTimersByTime(2599);
    expect(useApp.getState().toast).toBe("B");
    vi.advanceTimersByTime(1);
    expect(useApp.getState().toast).toBeNull();
  });

  it("an action toast replacing a focused action toast keeps the focus hold", () => {
    const act = { label: "Go", run: () => {} };
    useApp.getState().showToast("A", { action: act });
    useApp.getState().holdToast("focus", true);
    useApp.getState().showToast("B", { action: act });
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBe("B");
    useApp.getState().holdToast("focus", false);
    vi.advanceTimersByTime(10000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("bumps toastSeq on every show, also for an identical message", () => {
    const before = useApp.getState().toastSeq;
    useApp.getState().showToast("A");
    useApp.getState().showToast("A");
    expect(useApp.getState().toastSeq).toBe(before + 2);
  });

  it("a success toast does not erase a live error toast and shows after it expires", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    vi.advanceTimersByTime(100);
    useApp.getState().showToast("added");
    vi.advanceTimersByTime(900);
    expect(useApp.getState().toast).toBe("lost");
    expect(useApp.getState().toastTone).toBe("error");
    vi.advanceTimersByTime(6999);
    expect(useApp.getState().toast).toBe("lost");
    vi.advanceTimersByTime(1);
    expect(useApp.getState().toast).toBe("added");
    expect(useApp.getState().toastTone).toBe("success");
    vi.advanceTimersByTime(2600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("only the latest deferred toast is shown, an action toast keeps its action", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("one");
    useApp.getState().showToast("two", { action: { label: "Go", run: () => {} } });
    expect(useApp.getState().toast).toBe("lost");
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBe("two");
    expect(useApp.getState().toastAction?.label).toBe("Go");
  });

  it("an error toast still replaces an error toast and drops the deferred one", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("one");
    useApp.getState().showToast("again", { tone: "error" });
    expect(useApp.getState().toast).toBe("again");
    vi.advanceTimersByTime(2600);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a deferred plain toast is dropped when the workspace changes", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("added");
    useApp.getState().setWorkspace({ id: "w2", name: "W2" } as never);
    expect(useApp.getState().toast).toBe("lost");
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("setView drops a waiting action toast on another view, keeps it on the same one", () => {
    useApp.getState().setView({ kind: "project", projectId: "P1" });
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().setView({ kind: "project", projectId: "P1" });
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBe("A");
    useApp.getState().dismissToast();
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("B", { action: { label: "Go", run: () => {} } });
    useApp.getState().setView({ kind: "list", list: "today" });
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a hover or focus hold on the error delays the waiting toast until released and the full duration passed", () => {
    for (const source of ["hover", "focus"] as const) {
      useApp.getState().dismissToast();
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      useApp.getState().showToast("added");
      useApp.getState().holdToast(source, true);
      vi.advanceTimersByTime(20000);
      expect(useApp.getState().toast).toBe("lost");
      useApp.getState().holdToast(source, false);
      vi.advanceTimersByTime(7999);
      expect(useApp.getState().toast).toBe("lost");
      vi.advanceTimersByTime(1);
      expect(useApp.getState().toast).toBe("added");
    }
  });

  it("drops a shown action toast once action.isValid() is false, on revalidateToast", () => {
    let ok = true;
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {}, isValid: () => ok } });
    useApp.getState().revalidateToast();
    expect(useApp.getState().toast).toBe("A");
    ok = false;
    useApp.getState().revalidateToast();
    expect(useApp.getState().toast).toBeNull();
  });

  it("drops a shown action toast on any app-store change once it is invalid", () => {
    let ok = true;
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {}, isValid: () => ok } });
    ok = false;
    useApp.setState({ selectedTaskId: "x" });
    expect(useApp.getState().toast).toBeNull();
  });

  it("promotes a waiting toast in one step (never an empty state) and drops a stale one", () => {
    let ok = true;
    const seen: (string | null)[] = [];
    const un = useApp.subscribe((s) => seen.push(s.toast));
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("B", { action: { label: "Go", run: () => {}, isValid: () => ok } });
    seen.length = 0;
    vi.advanceTimersByTime(8000);
    un();
    expect(seen).toEqual(["B"]);
    expect(useApp.getState().toastAction).not.toBeNull();
    useApp.getState().dismissToast();
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("B", { action: { label: "Go", run: () => {}, isValid: () => ok } });
    ok = false;
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("a deferred action toast is dropped when the workspace changes", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().setWorkspace({ id: "w2", name: "W2" } as never);
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("setWorkspace clears an action toast and its timer", () => {
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().setWorkspace({ id: "w2", name: "W2" } as never);
    expect(useApp.getState().toast).toBeNull();
    expect(useApp.getState().toastAction).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("setWorkspace keeps a plain error toast, e.g. the access-lost notice", () => {
    useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
    useApp.getState().setWorkspace({ id: "w2", name: "W2" } as never);
    expect(useApp.getState().toast).toBe("lost");
    expect(useApp.getState().toastTone).toBe("error");
    vi.advanceTimersByTime(8000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("setView clears an action toast on a different view, keeps it on the same one", () => {
    useApp.getState().setView({ kind: "project", projectId: "P1" });
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {} } });
    useApp.getState().setView({ kind: "project", projectId: "P1" });
    expect(useApp.getState().toast).toBe("A");
    useApp.getState().setView({ kind: "list", list: "today" });
    expect(useApp.getState().toast).toBeNull();
  });

  it("setView keeps a plain toast", () => {
    useApp.getState().showToast("A", { tone: "error" });
    useApp.getState().setView({ kind: "list", list: "today" });
    expect(useApp.getState().toast).toBe("A");
  });

  it("reset clears the toast", () => {
    useApp.getState().showToast("A");
    useApp.getState().reset();
    expect(useApp.getState().toast).toBeNull();
  });
  it("treats a throwing isValid as invalid: store change drops the toast, nothing escapes", () => {
    useApp.getState().showToast("A", {
      action: {
        label: "Go",
        run: () => {},
        isValid: () => {
          throw new Error("boom");
        },
      },
    });
    // The throw at show time already counts as invalid and drops the toast.
    expect(useApp.getState().toast).toBeNull();
    useApp.getState().showToast("B", { action: { label: "Go", run: () => {} } });
    expect(useApp.getState().toast).toBe("B");
    const bad = () => {
      throw new Error("boom");
    };
    expect(() => useApp.setState({ toastAction: { label: "Go", run: () => {}, isValid: bad } })).not.toThrow();
    expect(useApp.getState().toast).toBeNull();
  });

  it("a throwing isValid on a waiting toast drops it when the error expires", () => {
    useApp.getState().showToast("err", { tone: "error", durationMs: 1000 });
    useApp.getState().showToast("wait", {
      action: {
        label: "Go",
        run: () => {},
        isValid: () => {
          throw new Error("boom");
        },
      },
    });
    vi.advanceTimersByTime(1000);
    expect(useApp.getState().toast).toBeNull();
    vi.advanceTimersByTime(20000);
    expect(useApp.getState().toast).toBeNull();
  });

  it("an already-invalid action toast is dropped without leaving a timer behind", () => {
    useApp.getState().showToast("A", { action: { label: "Go", run: () => {}, isValid: () => false } });
    expect(useApp.getState().toast).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
