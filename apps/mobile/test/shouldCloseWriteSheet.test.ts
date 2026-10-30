// An open write sheet closes when the role drops to read-only, but never on an
// unknown role (fail-open, same as the tabs add button).
import { describe, expect, it } from 'vitest';
import { shouldCloseWriteSheet } from '../src/lib/role';

describe('shouldCloseWriteSheet', () => {
  it('closes for a viewer', () => {
    expect(shouldCloseWriteSheet('viewer')).toBe(true);
  });

  it('stays open for writers', () => {
    for (const role of ['member', 'admin', 'owner'] as const) {
      expect(shouldCloseWriteSheet(role)).toBe(false);
    }
  });

  it('stays open while the role is unknown', () => {
    expect(shouldCloseWriteSheet(null)).toBe(false);
  });
});
