// Pure copy selection for sync notices (relocated task_adds, lost workspace
// access). Kept free of React Native and the sqlite store so it is unit-testable.
// Imports TranslationKey from the dictionary, never from '../i18n' (which pulls
// in the store).
import { relocationNotice, type RelocationNotice } from '@balu/domain';
import type { AccessLost, RelocatedCommand } from '@balu/sync-client';
import type { TranslationKey } from '../i18n/en';

type T = (key: TranslationKey) => string;

export interface Notice {
  title: string;
  body: string;
}

const RELOCATED_KEY: Record<RelocationNotice, TranslationKey> = {
  inbox: 'sync.relocatedInbox',
  project: 'sync.relocatedProject',
  topLevel: 'sync.relocatedTopLevel',
  mixed: 'sync.relocatedMixed',
};

/** The alert for a flush's relocated task_adds, or null when there were none. */
export function relocatedNotice(t: T, relocated: ReadonlyArray<RelocatedCommand>): Notice | null {
  const kind = relocationNotice(relocated.map((r) => r.reasons));
  if (!kind) return null;
  return {
    title: t('sync.relocatedTitle'),
    body: t(RELOCATED_KEY[kind]).replace('{n}', String(relocated.length)),
  };
}

/** "You no longer have access to X. N unsynced change(s) could not be saved." */
export function accessLostNotice(
  t: T,
  reason: AccessLost['reason'],
  discarded: number,
  workspaceName: string | null,
): Notice {
  // A function replacement: a name containing "$&" must not be read as a pattern.
  const head =
    reason === 'removed'
      ? workspaceName
        ? t('sync.accessRemoved').replace('{workspace}', () => workspaceName)
        : t('sync.accessRemovedUnnamed')
      : workspaceName
        ? t('sync.workspaceGone').replace('{workspace}', () => workspaceName)
        : t('sync.workspaceGoneUnnamed');
  return {
    title: t('sync.accessLostTitle'),
    body: discarded > 0 ? `${head} ${t('sync.changesDiscarded').replace('{n}', String(discarded))}` : head,
  };
}
