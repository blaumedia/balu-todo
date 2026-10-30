// The tabs add button must not show for read-only members: the server rejects
// their task_add as forbidden (§2).
import { describe, expect, it } from 'vitest';
import { canQuickAddFromTabs } from '../src/lib/quickadd';

describe('canQuickAddFromTabs', () => {
  it('is hidden for a viewer', () => {
    expect(canQuickAddFromTabs('viewer')).toBe(false);
  });

  it('is shown for writers', () => {
    for (const role of ['member', 'admin', 'owner'] as const) {
      expect(canQuickAddFromTabs(role)).toBe(true);
    }
  });

  it('is shown while the role is unknown', () => {
    // Offline cold start before the replica loads: a writer must not lose the
    // button, and the server rejects a viewer anyway.
    expect(canQuickAddFromTabs(null)).toBe(true);
  });
});
