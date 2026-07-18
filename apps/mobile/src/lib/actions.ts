// Thin typed helpers over sync.mutate() for the mutations the UI performs.
// Every call applies optimistically to the local replica and queues a durable
// command (contract §6) — the UI never awaits the network.
import type { CommandType, IsoDate, Priority } from '@balu/domain';
import { getSync } from './clients';

function mutate(type: CommandType, args: Record<string, unknown>) {
  const sync = getSync();
  if (!sync) return;
  return sync.mutate({ type, args });
}

export function addTask(args: Record<string, unknown>) {
  return mutate('task_add', args);
}

export function updateTask(id: string, args: Record<string, unknown>) {
  return mutate('task_update', { id, ...args });
}

export function completeTask(id: string) {
  return mutate('task_complete', { id });
}

export function uncompleteTask(id: string) {
  return mutate('task_uncomplete', { id });
}

export function deleteTask(id: string) {
  return mutate('task_delete', { id });
}

export function moveTask(id: string, args: { project_id?: string | null; section_id?: string | null; sort_order?: number }) {
  return mutate('task_move', { id, ...args });
}

/** Schedule presets — set start_date/evening/someday coherently. */
export function scheduleTask(
  id: string,
  opts: { start_date?: IsoDate | null; evening?: boolean; someday?: boolean },
) {
  const args: Record<string, unknown> = {};
  if (opts.someday) {
    args['someday'] = true;
    args['start_date'] = null; // server enforces mutual exclusion too
    args['evening'] = false;
  } else {
    args['someday'] = false;
    if ('start_date' in opts) args['start_date'] = opts.start_date ?? null;
    args['evening'] = opts.evening ?? false;
  }
  return updateTask(id, args);
}

export function setPriority(id: string, priority: Priority) {
  return updateTask(id, { priority });
}

export function addProject(args: { name: string; color?: string; sort_order?: number }) {
  return mutate('project_add', args);
}
