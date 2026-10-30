import { describe, expect, it } from 'vitest';
import { canQuickAddInto } from '../src/lib/quickadd';

// The project screen's add button (user request: add tasks directly inside a
// project). It must not offer adding where the task could not sensibly land.

const open = { is_deleted: false, archived_at: null };

describe('canQuickAddInto', () => {
  it('offers quick-add in an open project for a writer', () => {
    expect(canQuickAddInto(open, true)).toBe(true);
  });

  it('hides it for read-only members', () => {
    expect(canQuickAddInto(open, false)).toBe(false);
  });

  it('hides it while the project has not loaded', () => {
    expect(canQuickAddInto(undefined, true)).toBe(false);
  });

  it('hides it in an archived project', () => {
    expect(canQuickAddInto({ is_deleted: false, archived_at: '2026-10-30T12:00:00Z' }, true)).toBe(false);
  });

  it('hides it in a deleted project before the screen pops', () => {
    expect(canQuickAddInto({ is_deleted: true, archived_at: null }, true)).toBe(false);
  });
});
