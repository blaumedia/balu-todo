import type { SyncStatus } from '@balu/domain';

export type SyncLabelKey = 'sync.synced' | 'sync.syncing' | 'sync.error' | 'sync.offline';

/** The i18n key that names a sync status; anything but synced/syncing/error reads as offline. */
export function syncLabelKey(status: SyncStatus): SyncLabelKey {
  return status === 'synced'
    ? 'sync.synced'
    : status === 'syncing'
      ? 'sync.syncing'
      : status === 'error'
        ? 'sync.error'
        : 'sync.offline';
}
