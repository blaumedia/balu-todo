import type { Task } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import { REMINDER_CAP, reconcileReminders } from '../src/lib/reminderPlan';

const NOW = Date.parse('2026-07-23T12:00:00Z');

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

const plain = { nowMs: NOW, renderBody: () => '' };

describe('reconcileReminders', () => {
  it('schedules only open tasks with a future reminder_at', () => {
    const future = task({ reminder_at: '2026-07-23T18:00:00Z' });
    const past = task({ reminder_at: '2026-07-23T06:00:00Z' });
    const none = task({ reminder_at: null });
    const completed = task({ reminder_at: '2026-07-24T09:00:00Z', completed_at: '2026-07-22T00:00:00Z' });
    const deleted = task({ reminder_at: '2026-07-24T09:00:00Z', is_deleted: true });

    const out = reconcileReminders({ ...plain, tasks: [future, past, none, completed, deleted] });

    expect(out.map((r) => r.taskId)).toEqual([future.id]);
    expect(out[0].fireAtMs).toBe(Date.parse('2026-07-23T18:00:00Z'));
    expect(out[0].title).toBe(future.title);
  });

  it('treats a reminder exactly at now as past (strictly future only)', () => {
    const atNow = task({ reminder_at: new Date(NOW).toISOString() });
    expect(reconcileReminders({ ...plain, tasks: [atNow] })).toHaveLength(0);
  });

  it('orders soonest-first regardless of input order', () => {
    const late = task({ reminder_at: '2026-07-25T09:00:00Z' });
    const soon = task({ reminder_at: '2026-07-23T13:00:00Z' });
    const mid = task({ reminder_at: '2026-07-24T09:00:00Z' });

    const out = reconcileReminders({ ...plain, tasks: [late, soon, mid] });
    expect(out.map((r) => r.taskId)).toEqual([soon.id, mid.id, late.id]);
  });

  it('caps at the soonest N (default REMINDER_CAP)', () => {
    const many = Array.from({ length: REMINDER_CAP + 10 }, (_, i) =>
      task({ reminder_at: new Date(NOW + (i + 1) * 60_000).toISOString() }),
    );
    const out = reconcileReminders({ ...plain, tasks: many });
    expect(out).toHaveLength(REMINDER_CAP);
    // The kept ones are the soonest — first CAP by fire time.
    expect(out[0].fireAtMs).toBe(NOW + 60_000);
    expect(out[REMINDER_CAP - 1].fireAtMs).toBe(NOW + REMINDER_CAP * 60_000);
  });

  it('honors an explicit cap', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      task({ reminder_at: new Date(NOW + (i + 1) * 60_000).toISOString() }),
    );
    expect(reconcileReminders({ ...plain, tasks: many, cap: 2 })).toHaveLength(2);
  });

  it('ignores an unparseable reminder_at', () => {
    const bad = task({ reminder_at: 'not-a-date' });
    expect(reconcileReminders({ ...plain, tasks: [bad] })).toHaveLength(0);
  });

  it('builds the body via the injected renderBody', () => {
    const t = task({ reminder_at: '2026-07-24T09:00:00Z', deadline: '2026-07-31' });
    const out = reconcileReminders({
      nowMs: NOW,
      tasks: [t],
      renderBody: (task) => `Body:${task.deadline}`,
    });
    expect(out[0].body).toBe('Body:2026-07-31');
  });
});
