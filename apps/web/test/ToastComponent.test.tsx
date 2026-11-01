// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "../src/components/Toast.js";
import { useApp } from "../src/store/app.js";

const show = (...a: Parameters<ReturnType<typeof useApp.getState>["showToast"]>) => act(() => useApp.getState().showToast(...a));

describe("<Toast />", () => {
  let windowKeys: string[];
  const onWindowKey = (e: KeyboardEvent) => windowKeys.push(e.key);
  beforeEach(() => {
    windowKeys = [];
    window.addEventListener("keydown", onWindowKey);
    act(() => useApp.getState().dismissToast());
  });
  afterEach(() => {
    window.removeEventListener("keydown", onWindowKey);
    cleanup();
    act(() => useApp.getState().dismissToast());
  });

  const live = (c: HTMLElement) => ({
    status: c.querySelector('[role="status"]')!,
    alert: c.querySelector('[role="alert"]')!,
  });

  it("keeps showing a live error in the alert region when a success toast arrives", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<Toast />);
      show("lost", { tone: "error", durationMs: 8000 });
      show("added");
      expect(live(container).alert.textContent).toBe("lost");
      act(() => void vi.advanceTimersByTime(8000));
      expect(live(container).status.textContent).toBe("added");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders an icon for success and error tones, none for info", () => {
    const { container } = render(<Toast />);
    show("Saved");
    expect(container.querySelectorAll("svg").length).toBe(1);
    show("Failed", { tone: "error" });
    expect(container.querySelectorAll("svg").length).toBe(1);
    // A live error is not replaced by an info toast, so dismiss it first.
    act(() => useApp.getState().dismissToast());
    show("FYI", { tone: "info" });
    expect(container.querySelectorAll("svg").length).toBe(0);
  });

  it("keeps the icon and the message in one inner row, apart from the button", () => {
    const { container, getByRole } = render(<Toast />);
    show("Copied", { action: { label: "Undo", run: () => {} } });
    const svg = container.querySelector("svg")!;
    const message = container.querySelector('span[aria-hidden="true"]')!;
    const button = getByRole("button", { name: "Undo" });
    expect(svg.parentElement).toBe(message.parentElement);
    expect(message.parentElement).not.toBe(button.parentElement);
  });

  it("announces only the message, errors in the alert region", () => {
    const { container } = render(<Toast />);
    const { status, alert } = live(container);
    show("Moved", { action: { label: "Undo", run: () => {} } });
    expect(status.textContent).toBe("Moved");
    expect(alert.textContent).toBe("");
    show("Broke", { tone: "error" });
    expect(alert.textContent).toBe("Broke");
    expect(status.textContent).toBe("");
  });

  it("re-announces a repeated message with a fresh node", () => {
    const { container } = render(<Toast />);
    const { status } = live(container);
    show("Same");
    const first = status.firstElementChild;
    show("Same");
    expect(status.firstElementChild).not.toBe(first);
    expect(status.textContent).toBe("Same");
  });

  it("action click runs and dismisses, even if run throws", () => {
    const run = vi.fn(() => {
      throw new Error("boom");
    });
    const { getByRole } = render(<Toast />);
    show("Msg", { action: { label: "Go", run } });
    const btn = getByRole("button", { name: "Go" });
    expect(btn.getAttribute("aria-describedby")).toBeTruthy();
    // React logs the rethrown error from the handler; it surfaces on window.
    const swallow = (ev: ErrorEvent) => ev.preventDefault();
    window.addEventListener("error", swallow);
    fireEvent.click(btn);
    window.removeEventListener("error", swallow);
    expect(run).toHaveBeenCalledTimes(1);
    expect(useApp.getState().toast).toBeNull();
  });

  it("Enter, Space and Escape on the toast do not reach window listeners", () => {
    const { getByRole } = render(<Toast />);
    show("Msg", { action: { label: "Go", run: () => {} } });
    const btn = getByRole("button", { name: "Go" });
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: " " });
    expect(windowKeys).toEqual([]);
    expect(useApp.getState().toast).toBe("Msg");
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(windowKeys).toEqual([]);
    expect(useApp.getState().toast).toBeNull();
  });

  it("other keys still bubble to window", () => {
    const { getByRole } = render(<Toast />);
    show("Msg", { action: { label: "Go", run: () => {} } });
    fireEvent.keyDown(getByRole("button", { name: "Go" }), { key: "j" });
    expect(windowKeys).toEqual(["j"]);
  });

  it("gives focus back after the action button is activated", () => {
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    origin.focus();
    const { getByRole } = render(<Toast />);
    show("Msg", { action: { label: "Go", run: () => {} } });
    const btn = getByRole("button", { name: "Go" });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });

  it("holds the timer on hover and on focus, releases on leave and blur", () => {
    vi.useFakeTimers();
    try {
      const { getByRole } = render(<Toast />);
      show("Msg", { action: { label: "Go", run: () => {} } });
      const btn = getByRole("button", { name: "Go" });
      const box = btn.parentElement!;
      fireEvent.mouseEnter(box);
      act(() => void vi.advanceTimersByTime(20000));
      expect(useApp.getState().toast).toBe("Msg");
      fireEvent.focus(btn);
      fireEvent.mouseLeave(box);
      act(() => void vi.advanceTimersByTime(20000));
      expect(useApp.getState().toast).toBe("Msg");
      fireEvent.blur(btn);
      act(() => void vi.advanceTimersByTime(10000));
      expect(useApp.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
