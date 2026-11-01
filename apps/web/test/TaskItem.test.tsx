// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@balu/domain";
import { TaskItem } from "../src/views/TaskItem.js";

vi.mock("../src/lib/clients.js", () => ({ getSync: () => null }));

const TODAY = "2026-07-10";
const NAMES: Record<string, string> = { "date.today": "Today", "date.tomorrow": "Tomorrow", "date.yesterday": "Yesterday" };

function row(task: Partial<Task>, hideTodayDate?: boolean) {
  const full = { id: "t1", title: "Task", priority: 0, label_ids: [], completed_at: null, start_date: null, deadline: null, notes: null, recurrence: null, ...task } as unknown as Task;
  return render(
    <TaskItem
      task={full}
      projects={new Map()}
      labels={new Map()}
      today={TODAY as never}
      locale="en"
      t={(k) => NAMES[k] ?? k}
      hideTodayDate={hideTodayDate}
      onOpen={() => {}}
    />,
  );
}

describe("<TaskItem /> due-today chip", () => {
  afterEach(cleanup);

  it("shows the today chip by default (every view but Today)", () => {
    expect(row({ start_date: TODAY as never }).container.textContent).toContain("Today");
  });

  it("hides the start-date today chip in the Today view", () => {
    expect(row({ start_date: TODAY as never }, true).container.textContent).not.toContain("Today");
  });

  it("never hides the deadline today chip, even in the Today view", () => {
    const c = row({ deadline: TODAY as never }, true).container;
    expect(c.textContent).toContain("Today");
    expect(c.querySelector("svg")).not.toBeNull();
  });

  it("keeps the deadline chip when the start date is yesterday, tomorrow or today", () => {
    expect(row({ start_date: "2026-07-09" as never, deadline: TODAY as never }, true).container.textContent).toMatch(/Yesterday.*Today/);
    cleanup();
    expect(row({ start_date: "2026-07-11" as never, deadline: TODAY as never }, true).container.textContent).toMatch(/Tomorrow.*Today/);
    cleanup();
    // Both today: the start chip is hidden, the deadline chip stays.
    expect((row({ start_date: TODAY as never, deadline: TODAY as never }, true).container.textContent ?? "").match(/Today/g)).toHaveLength(1);
  });

  it("keeps overdue and future dates in the Today view", () => {
    expect(row({ start_date: "2026-07-09" as never }, true).container.textContent).toContain("Yesterday");
    cleanup();
    expect(row({ deadline: "2026-07-11" as never }, true).container.textContent).toContain("Tomorrow");
  });
});
