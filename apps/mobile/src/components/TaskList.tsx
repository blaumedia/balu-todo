import type { IsoDate, Task } from '@balu/domain';
import { TaskRow } from './TaskRow';
import type { ReplicaMaps } from '../store/useSnapshot';

/** Map a list of tasks to swipeable rows sharing the replica maps. */
export function TaskItems({
  tasks,
  maps,
  today,
  hideProject,
  swipeable = true,
}: {
  tasks: Task[];
  maps: ReplicaMaps;
  today: IsoDate;
  hideProject?: boolean;
  swipeable?: boolean;
}) {
  return (
    <>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          projects={maps.projects}
          labels={maps.labels}
          members={maps.members}
          commentCount={maps.commentCounts.get(task.id) ?? 0}
          hideProject={hideProject}
          swipeable={swipeable}
        />
      ))}
    </>
  );
}
