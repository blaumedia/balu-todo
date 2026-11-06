import { describe, expect, it } from 'vitest';
import { mayCommitDraft, pendingDraftPatch } from '../src/lib/taskDraft';

// The detail sheet unmounts before the native blur arrives (scrim tap, VoiceOver escape,
// drag-down, opening another task), so the unmount cleanup must commit what blur would have.

const saved = { title: 'Buy milk', notes: '' };

describe('pendingDraftPatch', () => {
  it('returns null for an untouched draft', () => {
    expect(pendingDraftPatch(saved, saved, true)).toBeNull();
  });

  it('patches edited notes', () => {
    expect(pendingDraftPatch({ title: 'Buy milk', notes: 'oat' }, saved, true)).toEqual({ notes: 'oat' });
  });

  it('patches an edited title, trimmed', () => {
    expect(pendingDraftPatch({ title: '  Buy oat milk ', notes: '' }, saved, true)).toEqual({ title: 'Buy oat milk' });
  });

  it('patches both at once', () => {
    expect(pendingDraftPatch({ title: 'Milk', notes: 'x' }, saved, true)).toEqual({ title: 'Milk', notes: 'x' });
  });

  it('ignores a blank title', () => {
    expect(pendingDraftPatch({ title: '   ', notes: '' }, saved, true)).toBeNull();
  });

  it('never writes for a viewer', () => {
    expect(pendingDraftPatch({ title: 'Milk', notes: 'x' }, saved, false)).toBeNull();
  });

  it('is idempotent once the written value is the saved one', () => {
    const draft = { title: 'Milk', notes: 'x' };
    expect(pendingDraftPatch(draft, { ...saved, ...pendingDraftPatch(draft, saved, true) }, true)).toBeNull();
  });

  it('can clear notes', () => {
    expect(pendingDraftPatch({ title: 'Buy milk', notes: '' }, { title: 'Buy milk', notes: 'old' }, true)).toEqual({ notes: '' });
  });
});

describe('mayCommitDraft', () => {
  it('allows a live task on the same client', () => {
    expect(mayCommitDraft({ is_deleted: false }, true, false)).toBe(true);
  });

  it('refuses a task that is missing or deleted (here or on another client)', () => {
    expect(mayCommitDraft(undefined, true, false)).toBe(false);
    expect(mayCommitDraft(null, true, false)).toBe(false);
    expect(mayCommitDraft({ is_deleted: true }, true, false)).toBe(false);
  });

  it('refuses after a workspace switch (another sync client)', () => {
    expect(mayCommitDraft({ is_deleted: false }, false, false)).toBe(false);
  });

  it('refuses a draft discarded by Delete', () => {
    expect(mayCommitDraft({ is_deleted: false }, true, true)).toBe(false);
  });
});
