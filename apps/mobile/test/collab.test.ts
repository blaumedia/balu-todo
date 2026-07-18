import type { Comment } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import {
  canComment,
  canDeleteComment,
  canEditComment,
  commentCountsByTask,
  commentsForTask,
  compareCommentAsc,
  initials,
} from '../src/lib/collab';

let cseq = 0;
function comment(over: Partial<Comment>): Comment {
  cseq += 1;
  return {
    id: `c${cseq}`,
    workspace_id: 'w1',
    task_id: 't1',
    author_id: 'u1',
    body: `Body ${cseq}`,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    is_deleted: false,
    ...over,
  };
}

// A minimal Snapshot-shaped object carrying comments (the plan-08 field).
function snap(comments: Comment[]) {
  return { comments } as unknown as Parameters<typeof commentsForTask>[0];
}

describe('compareCommentAsc', () => {
  it('orders by created_at ascending, tie-broken by id', () => {
    const a = comment({ id: 'c-b', created_at: '2026-07-02T00:00:00Z' });
    const b = comment({ id: 'c-a', created_at: '2026-07-01T00:00:00Z' });
    const c = comment({ id: 'c-c', created_at: '2026-07-01T00:00:00Z' });
    const sorted = [a, b, c].sort(compareCommentAsc).map((x) => x.id);
    expect(sorted).toEqual(['c-a', 'c-c', 'c-b']);
  });
});

describe('commentsForTask', () => {
  it('filters by task, drops deleted, sorts ascending', () => {
    const s = snap([
      comment({ id: 'c1', task_id: 't1', created_at: '2026-07-03T00:00:00Z' }),
      comment({ id: 'c2', task_id: 't1', created_at: '2026-07-01T00:00:00Z' }),
      comment({ id: 'c3', task_id: 't2', created_at: '2026-07-02T00:00:00Z' }),
      comment({ id: 'c4', task_id: 't1', is_deleted: true }),
    ]);
    expect(commentsForTask(s, 't1').map((c) => c.id)).toEqual(['c2', 'c1']);
  });
});

describe('commentCountsByTask', () => {
  it('counts non-deleted comments per task', () => {
    const s = snap([
      comment({ task_id: 't1' }),
      comment({ task_id: 't1' }),
      comment({ task_id: 't2' }),
      comment({ task_id: 't1', is_deleted: true }),
    ]);
    const counts = commentCountsByTask(s);
    expect(counts.get('t1')).toBe(2);
    expect(counts.get('t2')).toBe(1);
  });
});

describe('role rules (contract §3.4)', () => {
  const own = comment({ author_id: 'me' });
  const other = comment({ author_id: 'someone' });

  it('canComment: viewer cannot, member+ can', () => {
    expect(canComment('viewer')).toBe(false);
    expect(canComment('member')).toBe(true);
    expect(canComment('admin')).toBe(true);
    expect(canComment(undefined)).toBe(false);
  });

  it('canEditComment: author only', () => {
    expect(canEditComment(own, 'me')).toBe(true);
    expect(canEditComment(other, 'me')).toBe(false);
    expect(canEditComment(own, null)).toBe(false);
  });

  it('canDeleteComment: author or admin+', () => {
    expect(canDeleteComment(own, 'me', 'member')).toBe(true);
    expect(canDeleteComment(other, 'me', 'member')).toBe(false);
    expect(canDeleteComment(other, 'me', 'admin')).toBe(true);
    expect(canDeleteComment(other, 'me', 'owner')).toBe(true);
    expect(canDeleteComment(other, 'me', 'viewer')).toBe(false);
  });
});

describe('initials', () => {
  it('builds up to two letters', () => {
    expect(initials('Dennis Paul')).toBe('DP');
    expect(initials('Dennis')).toBe('DE');
    expect(initials('  ')).toBe('?');
  });
});
