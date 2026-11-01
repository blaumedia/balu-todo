import { describe, expect, it } from 'vitest';

import { syncLabelKey } from '../src/lib/syncLabel';

describe('syncLabelKey', () => {
  it('maps every status to its own key', () => {
    expect(syncLabelKey('synced')).toBe('sync.synced');
    expect(syncLabelKey('syncing')).toBe('sync.syncing');
    expect(syncLabelKey('error')).toBe('sync.error');
    expect(syncLabelKey('offline')).toBe('sync.offline');
  });
});
