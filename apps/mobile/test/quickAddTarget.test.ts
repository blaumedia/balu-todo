import type { Project } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import { describe, expect, it } from 'vitest';
import { composeTaskArgs, resolveProjectId, resolveQuickAddContext } from '../src/lib/quickadd';

// A project created offline is opened under a tmp id; the server's ack swaps in
// the real id. Quick-add must follow that swap, and must never file a task into
// a project that is missing, deleted or archived (it goes to the Inbox instead).

function project(over: Partial<Project>): Project {
  return {
    id: 'P1',
    workspace_id: 'w1',
    name: 'Project',
    color: 'blue',
    sort_order: 1000,
    archived_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_deleted: false,
    ...over,
  };
}

const inbox = { kind: 'list', list: 'inbox' } as const;

describe('resolveProjectId', () => {
  it('maps a temp id to the real one', () => {
    expect(resolveProjectId({ 'tmp-a': 'P1' }, 'tmp-a')).toBe('P1');
  });

  it('returns an unknown id unchanged', () => {
    expect(resolveProjectId({ 'tmp-a': 'P1' }, 'P9')).toBe('P9');
  });

  it('never resolves through Object.prototype', () => {
    expect(resolveProjectId({}, 'constructor')).toBe('constructor');
  });
});

describe('resolveQuickAddContext', () => {
  it('passes a list context through', () => {
    expect(resolveQuickAddContext({ kind: 'list', list: 'today' }, [], {})).toEqual({
      context: { kind: 'list', list: 'today' },
      redirected: false,
    });
  });

  it('keeps an open project', () => {
    expect(resolveQuickAddContext({ kind: 'project', projectId: 'P1' }, [project({})], {})).toEqual({
      context: { kind: 'project', projectId: 'P1' },
      redirected: false,
    });
  });

  it('follows a remapped temp id instead of treating it as gone', () => {
    expect(resolveQuickAddContext({ kind: 'project', projectId: 'tmp-a' }, [project({})], { 'tmp-a': 'P1' })).toEqual({
      context: { kind: 'project', projectId: 'P1' },
      redirected: false,
    });
  });

  it('redirects a missing project to the Inbox', () => {
    expect(resolveQuickAddContext({ kind: 'project', projectId: 'gone' }, [project({})], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it('redirects a deleted project to the Inbox', () => {
    const p = project({ is_deleted: true });
    expect(resolveQuickAddContext({ kind: 'project', projectId: 'P1' }, [p], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it('redirects an archived project to the Inbox', () => {
    const p = project({ archived_at: '2026-07-02T00:00:00Z' });
    expect(resolveQuickAddContext({ kind: 'project', projectId: 'P1' }, [p], {})).toEqual({
      context: inbox,
      redirected: true,
    });
  });

  it('lets an explicit #project token win over the redirect', () => {
    const projects = [project({ id: 'W1', name: 'Work' })];
    const target = resolveQuickAddContext({ kind: 'project', projectId: 'gone' }, projects, {});
    const text = 'Buy milk #Work';
    const args = composeTaskArgs(text, parseQuickAdd(text, { locale: 'en', referenceDate: '2026-10-30' }), {
      context: target.context,
      projects,
      labels: [],
      today: '2026-10-30',
    });
    expect(args['project_id']).toBe('W1');
    expect(target.redirected).toBe(true);
  });
});
