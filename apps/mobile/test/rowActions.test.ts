import { describe, expect, it, vi } from 'vitest';
import { dispatchRowAction, rowAccessibilityActions } from '../src/lib/rowActions';

const labels = { complete: 'Complete', schedule: 'Schedule' };

describe('rowAccessibilityActions', () => {
  it('exposes complete and schedule on writer swipeable rows', () => {
    expect(rowAccessibilityActions(true, true, labels)).toEqual([
      { name: 'complete', label: 'Complete' },
      { name: 'schedule', label: 'Schedule' },
    ]);
  });
  it('exposes nothing on viewer rows or rows without swipe actions', () => {
    expect(rowAccessibilityActions(true, false, labels)).toBeUndefined();
    expect(rowAccessibilityActions(false, true, labels)).toBeUndefined();
  });
});

describe('dispatchRowAction', () => {
  it('routes each action to its handler only', () => {
    const h = { complete: vi.fn(), schedule: vi.fn() };
    dispatchRowAction('complete', h);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.schedule).not.toHaveBeenCalled();
    dispatchRowAction('schedule', h);
    expect(h.schedule).toHaveBeenCalledTimes(1);
  });
  it('ignores unknown action names', () => {
    const h = { complete: vi.fn(), schedule: vi.fn() };
    dispatchRowAction('activate', h);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.schedule).not.toHaveBeenCalled();
  });
});
