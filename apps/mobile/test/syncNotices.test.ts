// Copy selection for relocated task_adds and lost workspace access.
import { describe, expect, it } from 'vitest';
import type { RelocatedCommand } from '@balu/sync-client';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { accessLostNotice, relocatedNotice } from '../src/lib/syncNotices';

const tEn = (k: keyof typeof en) => en[k];
const tDe = (k: keyof typeof en) => de[k];

function reloc(...reasons: string[][]): RelocatedCommand[] {
  return reasons.map(
    (r, i) =>
      ({ command: { type: 'task_add', uuid: `u${i}`, args: {} }, reasons: r }) as unknown as RelocatedCommand,
  );
}

describe('relocatedNotice', () => {
  it('is null when nothing was relocated', () => {
    expect(relocatedNotice(tEn, [])).toBeNull();
  });

  it('titles and words the Inbox case', () => {
    expect(relocatedNotice(tEn, reloc(['project_deleted']))).toEqual({
      title: 'Tasks filed elsewhere',
      body: '1 task(s) added to the Inbox - their project was deleted.',
    });
  });

  it('has a German title', () => {
    expect(relocatedNotice(tDe, reloc(['project_deleted']))?.title).toBe('Aufgaben woanders abgelegt');
  });
});

describe('accessLostNotice', () => {
  it('names the workspace and the lost changes', () => {
    expect(accessLostNotice(tEn, 'removed', 2, 'Team')).toEqual({
      title: 'Workspace unavailable',
      body: 'You no longer have access to Team. 2 unsynced change(s) could not be saved.',
    });
  });

  it('speaks German', () => {
    expect(accessLostNotice(tDe, 'removed', 2, 'Team')).toEqual({
      title: 'Arbeitsbereich nicht verfügbar',
      body: 'Du hast keinen Zugriff mehr auf Team. 2 nicht synchronisierte Änderung(en) konnten nicht gespeichert werden.',
    });
  });

  it('uses Arbeitsbereich for an unnamed deleted workspace in German', () => {
    expect(accessLostNotice(tDe, 'deleted', 0, null).body).toBe('Dieser Arbeitsbereich wurde gelöscht.');
  });
});
