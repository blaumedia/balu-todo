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

  it("hides it in the Today view, start date and deadline alike", () => {
    expect(row({ start_date: TODAY as never }, true).container.textContent).not.toContain("Today");
    cleanup();
    expect(row({ deadline: TODAY as never }, true).container.textContent).not.toContain("Today");
  });

  it("keeps overdue and future dates in the Today view", () => {
    expect(row({ start_date: "2026-07-09" as never }, true).container.textContent).toContain("Yesterday");
    cleanup();
    expect(row({ deadline: "2026-07-11" as never }, true).container.textContent).toContain("Tomorrow");
  });
});
