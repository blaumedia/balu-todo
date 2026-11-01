/**
 * Copy text. Resolves false instead of rejecting when the Clipboard API is
 * missing (non-secure context) or refuses (permission, unfocused document) -
 * a bare writeText().then() turned that into an "Uncaught (in promise)".
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
