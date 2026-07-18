import { selectList, todayLocalISO, type Project, type SmartList, type Task } from "@balu/domain";
import type { Snapshot } from "@balu/sync-client";
import { getSync } from "../lib/clients.js";
import { spacedOrders } from "../lib/reorder.js";
import { useMaps } from "../lib/maps.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import type { TranslationKey } from "../i18n/index.js";
import { TaskListSurface, type DndConfig, type TaskGroup } from "./TaskListSurface.js";

function reorderContainer(orderedIds: string[]) {
  getSync()?.mutate({ type: "task_reorder", args: { items: spacedOrders(orderedIds) } });
}

const REORDERABLE: Partial<Record<SmartList, boolean>> = { inbox: true, someday: true, anytime: true };

export function SimpleListView({ snapshot, list }: { snapshot: Snapshot; list: SmartList }) {
  const { t, locale } = useT();
  const maps = useMaps(snapshot);
  const userId = useApp((s) => s.user?.id);
  const today = todayLocalISO();
  const tasks = selectList(snapshot.tasks, list, today, userId);

  // Anytime is grouped by project (each project is its own reorder container,
  // contract §4 "project order, then sort_order").
  let groups: TaskGroup[];
  if (list === "anytime") {
    const projects = snapshot.projects
      .filter((p: Project) => !p.is_deleted && p.archived_at == null)
      .sort((a, b) => a.sort_order - b.sort_order);
    const byProject = new Map<string, Task[]>();
    for (const tk of tasks) {
      const pid = tk.project_id ?? "";
      (byProject.get(pid) ?? byProject.set(pid, []).get(pid)!).push(tk);
    }
    groups = projects
      .filter((p) => byProject.has(p.id))
      .map((p) => ({ key: p.id, header: p.name, tasks: byProject.get(p.id)! }));
  } else {
    groups = [{ key: list, tasks }];
  }

  const dnd: DndConfig | undefined = REORDERABLE[list]
    ? { mode: "reorder", onReorder: (_key, ids) => reorderContainer(ids) }
    : undefined;

  return (
    <TaskListSurface
      groups={groups}
      emptyLabel={t(`empty.${list}` as TranslationKey)}
      showProject={list !== "inbox"}
      projects={maps.projects}
      labels={maps.labels}
      today={today}
      locale={locale}
      t={t}
      dnd={dnd}
    />
  );
}
