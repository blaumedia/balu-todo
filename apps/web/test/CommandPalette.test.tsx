// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder: { snap: unknown } = { snap: null };
const mutate = vi.fn();
vi.mock("../src/lib/clients.js", () => ({ api: { patchMe: vi.fn() }, getSync: () => ({ mutate }) }));
const logout = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/logout.js", () => ({ logout }));
vi.mock("../src/store/useSync.js", () => ({ useSnapshot: () => holder.snap }));

import { CommandPalette } from "../src/palette/CommandPalette.js";
import { useApp } from "../src/store/app.js";

function snapshot(archived: boolean) {
  return {
    projects: [
      {
        id: "P1",
        workspace_id: "w1",
        name: "Project",
        color: "blue",
        sort_order: 1000,
        archived_at: archived ? "2026-07-02T00:00:00Z" : null,
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        is_deleted: false,
      },
    ],
    sections: [],
    tasks: [],
    labels: [],
    members: [],
    idAliases: {},
  };
}

describe("<CommandPalette />", () => {
  let prompt: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    prompt = vi.fn(() => null);
    vi.stubGlobal("prompt", prompt);
    // jsdom has no layout, hence no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    const workspace = { id: "w1", name: "W" };
    act(() => {
      useApp.setState({ workspace: workspace as never, memberships: [{ workspace, role: "owner" }] as never });
      useApp.getState().setView({ kind: "project", projectId: "P1" });
      useApp.getState().setQuickAdd(false);
      useApp.getState().setPalette(false);
    });
    holder.snap = snapshot(false);
    mutate.mockClear();
    logout.mockClear();
  });
  afterEach(() => {
    cleanup();
    act(() => useApp.getState().setPalette(false));
    vi.unstubAllGlobals();
  });

  function openPalette() {
    const utils = render(<CommandPalette />);
    act(() => useApp.getState().setPalette(true));
    return { ...utils, input: utils.container.querySelector("input")! };
  }

  it("highlights the first row by default and Enter runs it", () => {
    const { input } = openPalette();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().quickAddOpen).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("does not run another command when the highlighted row vanishes (archived elsewhere)", () => {
    const { input, rerender } = openPalette();
    holder.snap = snapshot(true);
    rerender(<CommandPalette />);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(prompt).not.toHaveBeenCalled();
    expect(useApp.getState().quickAddOpen).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps the highlighted row when a row is added above it (unarchived elsewhere)", () => {
    holder.snap = snapshot(true);
    const { input, rerender } = openPalette();
    holder.snap = snapshot(false);
    rerender(<CommandPalette />);
    fireEvent.keyDown(input, { key: "Enter" });
    // First row was New project: it must stay the target, not become New task.
    expect(useApp.getState().quickAddOpen).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("arrow keys work again after the highlight vanished", () => {
    const { input, rerender } = openPalette();
    holder.snap = snapshot(true);
    rerender(<CommandPalette />);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("re-seeds the highlight on a query change so Enter runs the first result", () => {
    const { input } = openPalette();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "log" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // First match is "Go to Logbook", not "Log out".
    expect(useApp.getState().view).toEqual({ kind: "list", list: "logbook" });
    expect(logout).not.toHaveBeenCalled();
  });

  it("ArrowUp with nothing highlighted goes to the last row", () => {
    const { input, rerender } = openPalette();
    holder.snap = snapshot(true);
    rerender(<CommandPalette />);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("ArrowUp from the first row wraps to the last row", () => {
    const { input } = openPalette();
    expect(() => fireEvent.keyDown(input, { key: "ArrowUp" })).not.toThrow();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
