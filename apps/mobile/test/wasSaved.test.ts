import { describe, expect, it } from 'vitest';
import { wasSaved } from '../src/lib/quickadd';

describe('wasSaved', () => {
  it('is false for a dropped edit or no client, true otherwise', () => {
    expect(wasSaved({ dropped: true })).toBe(false);
    expect(wasSaved(undefined)).toBe(false);
    expect(wasSaved({})).toBe(true);
  });
});
