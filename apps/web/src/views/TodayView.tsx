import { selectList, todayLocalISO } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import { TaskListSurface } from "./TaskListSurface.js";

export function TodayView({ snapshot }: { snapshot: Snapshot }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const today = todayLocalISO();
  const list = selectList(snapshot.tasks, "today", today);
  const day = list.filter((tk) => !tk.evening);
  const evening = list.filter((tk) => tk.evening);

  return (
    <TaskListSurface
      groups={[
        { key: "today", tasks: day },
        { key: "evening", header: t("section.thisEvening"), tasks: evening },
      ]}
      emptyLabel={t("empty.today")}
      showProject
      projects={maps.projects}
      labels={maps.labels}
      today={today}
      locale={locale}
      t={t}
    />
  );
}
