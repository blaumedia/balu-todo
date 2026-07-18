import { selectList, todayLocalISO, type SmartList } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import type { TranslationKey } from "../i18n/index.js";
import { TaskListSurface } from "./TaskListSurface.js";

export function SimpleListView({ snapshot, list }: { snapshot: Snapshot; list: SmartList }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const today = todayLocalISO();
  const tasks = selectList(snapshot.tasks, list, today);

  return (
    <TaskListSurface
      groups={[{ key: list, tasks }]}
      emptyLabel={t(`empty.${list}` as TranslationKey)}
      showProject={list !== "inbox"}
      projects={maps.projects}
      labels={maps.labels}
      today={today}
      locale={locale}
      t={t}
    />
  );
}
