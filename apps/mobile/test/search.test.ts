import type { Label, Project, Task } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import { searchReplica } from '../src/lib/search';

let seq = 0;
function task(over: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    workspace_id: 'w1',
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title: `Task ${seq}`,
    notes: '',
    start_date: null,
    evening: false,
    someday: false,
    deadline: null,
    reminder_at: null,
    recurrence: null,
    priority: 0,
    label_ids: [],
    assigned_to: null,
    sort_order: seq * 1000,
    completed_at: null,
    completed_by: null,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_deleted: false,
    ...over,
  };
}
function project(over: Partial<Project>): Project {
  seq += 1;
  return {
    id: `p${seq}`,
    workspace_id: 'w1',
    name: `Project ${seq}`,
    color: 'blue',
    sort_order: seq * 1000,
    archived_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_deleted: false,
    ...over,
  };
}
function label(over: Partial<Label>): Label {
  seq += 1;
  return {
    id: `l${seq}`,
    workspace_id: 'w1',
    name: `Label ${seq}`,
    color: 'amber',
    sort_order: seq * 1000,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_deleted: false,
    ...over,
  };
}

const EMPTY = { tasks: [], projects: [], labels: [] };

describe('searchReplica', () => {
  it('returns nothing for a blank query', () => {
    const out = searchReplica({ ...EMPTY, tasks: [task({ title: 'Milk' })], query: '   ' });
    expect(out).toEqual({ tasks: [], projects: [], labels: [] });
  });

  it('matches tasks on title and notes, case-insensitively', () => {
    const byTitle = task({ title: 'Buy MILK' });
    const byNotes = task({ title: 'Errand', notes: 'get milk on the way' });
    const miss = task({ title: 'Walk dog' });
    const out = searchReplica({ ...EMPTY, tasks: [byTitle, byNotes, miss], query: 'milk' });
    expect(out.tasks.map((t) => t.id).sort()).toEqual([byTitle.id, byNotes.id].sort());
  });

  it('excludes completed tasks by default and includes them when asked', () => {
    const open = task({ title: 'report open' });
    const done = task({ title: 'report done', completed_at: '2026-07-20T00:00:00Z' });

    const def = searchReplica({ ...EMPTY, tasks: [open, done], query: 'report' });
    expect(def.tasks.map((t) => t.id)).toEqual([open.id]);

    const incl = searchReplica({ ...EMPTY, tasks: [open, done], query: 'report', includeCompleted: true });
    // Open sorts before completed.
    expect(incl.tasks.map((t) => t.id)).toEqual([open.id, done.id]);
  });

  it('never returns deleted tasks even with includeCompleted', () => {
    const del = task({ title: 'ghost', is_deleted: true, completed_at: '2026-07-20T00:00:00Z' });
    const out = searchReplica({ ...EMPTY, tasks: [del], query: 'ghost', includeCompleted: true });
    expect(out.tasks).toHaveLength(0);
  });

  it('matches projects by name, excluding archived and deleted', () => {
    const live = project({ name: 'Finance' });
    const archived = project({ name: 'Finance old', archived_at: '2026-01-01T00:00:00Z' });
    const deleted = project({ name: 'Finance gone', is_deleted: true });
    const out = searchReplica({ ...EMPTY, projects: [live, archived, deleted], query: 'finance' });
    expect(out.projects.map((p) => p.id)).toEqual([live.id]);
  });

  it('matches labels by name, excluding deleted', () => {
    const live = label({ name: 'privat' });
    const deleted = label({ name: 'private-old', is_deleted: true });
    const out = searchReplica({ ...EMPTY, labels: [live, deleted], query: 'priv' });
    expect(out.labels.map((l) => l.id)).toEqual([live.id]);
  });

  it('caps task results', () => {
    const many = Array.from({ length: 10 }, (_, i) => task({ title: `find me ${i}` }));
    const out = searchReplica({ ...EMPTY, tasks: many, query: 'find me', cap: 3 });
    expect(out.tasks).toHaveLength(3);
  });
});
