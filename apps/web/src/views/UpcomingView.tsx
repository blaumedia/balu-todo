import { addDaysISO, selectList, todayLocalISO, upcomingGroupDate, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import { dayMonth, weekdayLong } from "../lib/format.js";
import { TaskListSurface, type TaskGroup } from "./TaskListSurface.js";

export function UpcomingView({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const today = todayLocalISO();
  const list = selectList(snapshot.tasks, "upcoming", today);

  // Bucket by group-date: the next 7 days individually, then weekly buckets.
  const byDate = new Map<string, Task[]>();
  for (const task of list) {
    const gd = upcomingGroupDate(task, today);
    if (!gd) continue;
    (byDate.get(gd) ?? byDate.set(gd, []).get(gd)!).push(task);
  }

  const groups: TaskGroup[] = [];
  const weekEnd = addDaysISO(today, 7);

  const dates = [...byDate.keys()].sort();
  const weekBuckets = new Map<string, { header: string; tasks: Task[] }>();

  for (const date of dates) {
    const tasks = byDate.get(date)!;
    if (date <= weekEnd) {
      groups.push({ key: date, header: `${weekdayLong(date, locale)} · ${dayMonth(date, locale)}`, tasks });
    } else {
      // Group remaining by ISO week (Monday).
      const [y, m, dd] = date.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1, dd));
      const dow = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
      const bucket = weekBuckets.get(monday) ?? { header: `${dayMonth(monday, locale)}`, tasks: [] };
      bucket.tasks.push(...tasks);
      weekBuckets.set(monday, bucket);
    }
  }

  for (const monday of [...weekBuckets.keys()].sort()) {
    const b = weekBuckets.get(monday)!;
    groups.push({ key: `w-${monday}`, header: b.header, tasks: b.tasks });
  }

  return (
    <TaskListSurface
      groups={groups}
      emptyLabel={t("empty.upcoming")}
      showProject
      projects={maps.projects}
      labels={maps.labels}
      today={today}
      locale={locale}
      t={t}
    />
  );
}
