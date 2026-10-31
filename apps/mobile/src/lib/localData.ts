/**
 * Whether the data on this device belongs to another account than `userId`.
 * The cached session (`SETTINGS.session`, written by setSession) names its owner.
 * An expired session keeps it, while logout deletes it together with the data.
 * Missing or unreadable: nothing to protect, or no way to tell - adopt it.
 */
export function isForeignLocalData(cachedSessionRaw: string | null, userId: string): boolean {
  if (!cachedSessionRaw) return false;
  try {
    const owner = (JSON.parse(cachedSessionRaw) as { user?: { id?: unknown } } | null)?.user?.id;
    return typeof owner === 'string' && owner !== userId;
  } catch {
    return false;
  }
}
