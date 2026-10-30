// Viewers must not reach write affordances on mobile (§2). The replica is the
// live source for the role; /me covers the moment before it has loaded.
import type { Role } from '@balu/domain';
import { describe, expect, it } from 'vitest';
import { resolveMyRole } from '../src/lib/role';

const ws = { id: 'ws-1' };
const rec = (id: string, role: Role) => ({ id, role });

describe('resolveMyRole', () => {
  it('prefers the replica record over /me, so a synced demotion applies', () => {
    expect(
      resolveMyRole({ userId: 'u1', workspaceId: 'ws-1', members: [rec('u1', 'viewer')], memberships: [{ role: 'owner', workspace: ws }] }),
    ).toBe('viewer');
  });

  it('falls back to /me when the replica has no record', () => {
    expect(
      resolveMyRole({ userId: 'u1', workspaceId: 'ws-1', members: [], memberships: [{ role: 'member', workspace: ws }] }),
    ).toBe('member');
  });

  it('uses the membership of the active workspace for the fallback', () => {
    expect(
      resolveMyRole({
        userId: 'u1',
        workspaceId: 'ws-1',
        members: [],
        memberships: [
          { role: 'owner', workspace: { id: 'ws-2' } },
          { role: 'viewer', workspace: ws },
        ],
      }),
    ).toBe('viewer');
  });

  it('returns null when the replica is loaded but has no own record, ignoring /me', () => {
    expect(
      resolveMyRole({ userId: 'u1', workspaceId: 'ws-1', members: [rec('u2', 'owner')], memberships: [{ role: 'owner', workspace: ws }] }),
    ).toBeNull();
  });

  it('ignores other users records', () => {
    expect(resolveMyRole({ userId: 'u1', workspaceId: 'ws-1', members: [rec('u2', 'owner')], memberships: [] })).toBeNull();
  });

  it('returns null without a user', () => {
    expect(
      resolveMyRole({ userId: null, workspaceId: 'ws-1', members: [rec('u1', 'owner')], memberships: [{ role: 'owner', workspace: ws }] }),
    ).toBeNull();
  });

  it('returns null when nothing is known (offline cold start before the replica loads)', () => {
    expect(resolveMyRole({ userId: 'u1', workspaceId: 'ws-1', members: [], memberships: [] })).toBeNull();
  });
});
