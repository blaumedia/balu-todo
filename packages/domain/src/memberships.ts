// Which workspace to open at boot (contract §7 multi-workspace).

import type { Membership } from "./types.js";

/**
 * Resolve the membership to boot into: an explicitly requested workspace, else
 * the last one the user had open, else the first they belong to.
 *
 * Shared by web and mobile — mobile used to take `memberships[0]` unconditionally,
 * so a multi-workspace user was thrown back to the same workspace on every launch.
 */
export function pickMembership(
  memberships: ReadonlyArray<Membership>,
  preferredId?: string | null,
  lastUsedId?: string | null,
): Membership | undefined {
  for (const id of [preferredId, lastUsedId]) {
    if (!id) continue;
    const match = memberships.find((m) => m.workspace.id === id);
    if (match) return match;
  }
  return memberships[0];
}
