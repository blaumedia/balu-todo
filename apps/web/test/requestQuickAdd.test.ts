// @vitest-environment node
import type { Project } from "@balu/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder: { sync: unknown } = { sync: null };
vi.mock("../src/lib/clients.js", () => ({ getSync: () => holder.sync }));

import { requestQuickAdd } from "../src/lib/requestQuickAdd.js";
import { useApp } from "../src/store/app.js";

function project(over: Partial<Project>): Project {
  return {
    id: "P1",
    workspace_id: "w1",
    name: "Project",
    color: "blue",
    sort_order: 1000,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

function fakeSync(projects: Project[], idAliases: Record<string, string> = {}) {
  const mutate = vi.fn();
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const emit = () => [...listeners].forEach((l) => l());
  // Same wiring as clients.initSync: the app wires revalidateToast once per sync client.
  subscribe(() => useApp.getState().revalidateToast());
  return { mutate, subscribe, emit, listeners, getSnapshot: () => ({ projects, idAliases }) };
}

function setRole(role: "owner" | "viewer") {
  const workspace = { id: "w1", name: "W" };
  useApp.setState({ workspace: workspace as never, memberships: [{ workspace, role }] as never });
}

const archivedAt = "2026-07-02T00:00:00Z";

describe("requestQuickAdd", () => {
  beforeEach(() => {
    useApp.getState().dismissToast();
    setRole("owner");
    useApp.getState().setQuickAdd(false);
    useApp.getState().setView({ kind: "project", projectId: "P1" });
  });

  it("opens quick-add on a live project view", () => {
    holder.sync = fakeSync([project({})]);
    requestQuickAdd();
    expect(useApp.getState().quickAddOpen).toBe(true);
    expect(useApp.getState().toast).toBeNull();
  });

  it("shows an Unarchive toast on an archived project view and stays closed", () => {
    holder.sync = fakeSync([project({ archived_at: archivedAt })]);
    requestQuickAdd();
    expect(useApp.getState().quickAddOpen).toBe(false);
    expect(useApp.getState().toast).not.toBeNull();
    expect(useApp.getState().toastAction).not.toBeNull();
  });

  it("run() unarchives with the next sort order", () => {
    const sync = fakeSync([project({ archived_at: archivedAt }), project({ id: "P2", sort_order: 5000 })]);
    holder.sync = sync;
    requestQuickAdd();
    useApp.getState().toastAction?.run();
    expect(sync.mutate).toHaveBeenCalledTimes(1);
    const arg = sync.mutate.mock.calls[0]![0];
    expect(arg.type).toBe("project_update");
    expect(arg.args.id).toBe("P1");
    expect(arg.args.archived_at).toBeNull();
    expect(arg.args.sort_order).toBeGreaterThan(5000);
  });

  it("run() is a no-op when the sync client changed", () => {
    const sync = fakeSync([project({ archived_at: archivedAt })]);
    holder.sync = sync;
    requestQuickAdd();
    holder.sync = fakeSync([project({ archived_at: archivedAt })]);
    useApp.getState().toastAction?.run();
    expect(sync.mutate).not.toHaveBeenCalled();
    expect((holder.sync as ReturnType<typeof fakeSync>).mutate).not.toHaveBeenCalled();
  });

  it("run() is a no-op when the project was already unarchived or is gone", () => {
    const projects = [project({ archived_at: archivedAt })];
    const sync = fakeSync(projects);
    holder.sync = sync;
    requestQuickAdd();
    projects[0] = project({ archived_at: null });
    useApp.getState().toastAction?.run();
    projects.length = 0;
    useApp.getState().toastAction?.run();
    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it("run() is a no-op when the project was deleted meanwhile", () => {
    const projects = [project({ archived_at: archivedAt })];
    const sync = fakeSync(projects);
    holder.sync = sync;
    requestQuickAdd();
    projects[0] = project({ archived_at: archivedAt, is_deleted: true });
    useApp.getState().toastAction?.run();
    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it("run() follows a temp id that the server replaced while the toast was up", () => {
    const aliases: Record<string, string> = {};
    const projects = [project({ id: "TMP", archived_at: archivedAt })];
    const sync = fakeSync(projects, aliases);
    holder.sync = sync;
    useApp.getState().setView({ kind: "project", projectId: "TMP" });
    requestQuickAdd();
    projects[0] = project({ id: "REAL", archived_at: archivedAt });
    aliases["TMP"] = "REAL";
    useApp.getState().toastAction?.run();
    expect(sync.mutate).toHaveBeenCalledTimes(1);
    expect(sync.mutate.mock.calls[0]![0].args.id).toBe("REAL");
  });

  it("run() is a no-op when the user was demoted to viewer meanwhile", () => {
    const sync = fakeSync([project({ archived_at: archivedAt })]);
    holder.sync = sync;
    requestQuickAdd();
    const action = useApp.getState().toastAction;
    setRole("viewer");
    // The store drops the now-useless button; a stale handle is still a no-op.
    expect(useApp.getState().toast).toBeNull();
    action?.run();
    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it("dismisses the toast when the project is unarchived elsewhere", () => {
    const projects = [project({ archived_at: archivedAt })];
    const sync = fakeSync(projects);
    holder.sync = sync;
    requestQuickAdd();
    sync.emit();
    expect(useApp.getState().toast).not.toBeNull();
    projects[0] = project({ archived_at: null });
    sync.emit();
    expect(useApp.getState().toast).toBeNull();
  });

  it("dismisses the toast when the project is deleted elsewhere", () => {
    const projects = [project({ archived_at: archivedAt })];
    const sync = fakeSync(projects);
    holder.sync = sync;
    requestQuickAdd();
    projects[0] = project({ archived_at: archivedAt, is_deleted: true });
    sync.emit();
    expect(useApp.getState().toast).toBeNull();
  });

  it("drops the toast when the sync client was replaced", () => {
    const sync = fakeSync([project({ archived_at: archivedAt })]);
    holder.sync = sync;
    requestQuickAdd();
    holder.sync = fakeSync([project({ archived_at: archivedAt })]);
    sync.emit();
    expect(useApp.getState().toast).toBeNull();
  });

  it("run() is a no-op after navigating away (Back/Forward bypasses setView)", () => {
    const sync = fakeSync([project({ archived_at: archivedAt })]);
    holder.sync = sync;
    requestQuickAdd();
    const run = useApp.getState().toastAction!.run;
    useApp.setState({ view: { kind: "list", list: "today" } });
    run();
    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it("dismisses the toast when the view moves away (Back/Forward)", () => {
    holder.sync = fakeSync([project({ archived_at: archivedAt })]);
    requestQuickAdd();
    useApp.setState({ view: { kind: "list", list: "today" } });
    expect(useApp.getState().toast).toBeNull();
  });

  it("run() still works when the view holds a temp id that resolves to the project", () => {
    const aliases: Record<string, string> = {};
    const sync = fakeSync([project({ id: "REAL", archived_at: archivedAt })], aliases);
    holder.sync = sync;
    aliases["TMP"] = "REAL";
    useApp.getState().setView({ kind: "project", projectId: "TMP" });
    requestQuickAdd();
    useApp.setState({ view: { kind: "project", projectId: "REAL" } });
    useApp.getState().toastAction?.run();
    expect(sync.mutate).toHaveBeenCalledTimes(1);
  });

  it("marks the archived notice with the info tone", () => {
    holder.sync = fakeSync([project({ archived_at: archivedAt })]);
    requestQuickAdd();
    expect(useApp.getState().toastTone).toBe("info");
  });

  describe("while an error toast is up", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("drops the waiting Unarchive toast when the view moves away via setState (Back/Forward)", () => {
      holder.sync = fakeSync([project({ archived_at: archivedAt })]);
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      requestQuickAdd();
      expect(useApp.getState().toast).toBe("lost");
      useApp.setState({ view: { kind: "list", list: "today" } });
      vi.advanceTimersByTime(8000);
      expect(useApp.getState().toast).toBeNull();
    });

    it("drops the waiting Unarchive toast when the project is unarchived elsewhere", () => {
      const projects = [project({ archived_at: archivedAt })];
      const sync = fakeSync(projects);
      holder.sync = sync;
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      requestQuickAdd();
      projects[0] = project({ archived_at: null });
      sync.emit();
      vi.advanceTimersByTime(8000);
      expect(useApp.getState().toast).toBeNull();
    });

    it("shows the waiting Unarchive toast when still valid, and keeps watching it after promotion (view moves)", () => {
      holder.sync = fakeSync([project({ archived_at: archivedAt })]);
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      requestQuickAdd();
      vi.advanceTimersByTime(8000);
      expect(useApp.getState().toastAction).not.toBeNull();
      useApp.setState({ view: { kind: "list", list: "today" } });
      expect(useApp.getState().toast).toBeNull();
    });

    it("keeps watching the promoted Unarchive toast: unarchived elsewhere after promotion", () => {
      const projects = [project({ archived_at: archivedAt })];
      const sync = fakeSync(projects);
      holder.sync = sync;
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      requestQuickAdd();
      vi.advanceTimersByTime(8000);
      expect(useApp.getState().toastAction).not.toBeNull();
      projects[0] = project({ archived_at: null });
      sync.emit();
      expect(useApp.getState().toast).toBeNull();
    });

    it("does not promote a waiting toast that went stale during the same tick", () => {
      const projects = [project({ archived_at: archivedAt })];
      holder.sync = fakeSync(projects);
      useApp.getState().showToast("lost", { tone: "error", durationMs: 8000 });
      requestQuickAdd();
      projects[0] = project({ archived_at: null }); // no emit: only the promotion check can catch it
      vi.advanceTimersByTime(8000);
      expect(useApp.getState().toast).toBeNull();
    });
  });
});
