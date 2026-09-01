import { selectList, todayLocalISO, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import { relativeDate, weekdayLong, dayMonth } from "../lib/format.js";
import { TaskListSurface, type TaskGroup } from "./TaskListSurface.js";

export function LogbookView({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const today = todayLocalISO();
  const list = selectList(snapshot.tasks, "logbook", today);

  // Grouped by completion day, newest first (selectList already sorted desc).
  const byDay = new Map<string, Task[]>();
  for (const task of list) {
    const day = (task.completed_at ?? "").slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(task);
  }

  const groups: TaskGroup[] = [...byDay.entries()].map(([day, tasks]) => {
    const rel = relativeDate(day, today, locale, t);
    const header = rel.tone === "today" || day === today ? t("date.today") : `${weekdayLong(day, locale)} · ${dayMonth(day, locale)}`;
    return { key: day, header, tasks };
  });

  return (
    <TaskListSurface
      groups={groups}
      emptyLabel={t("empty.logbook")}
      showProject
      draggable={false}
      projects={maps.projects}
      labels={maps.labels}
      today={today}
      locale={locale}
      t={t}
    />
  );
}
