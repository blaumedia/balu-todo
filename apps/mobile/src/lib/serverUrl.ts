// Server-URL normalization for onboarding (S8). Pure — no React Native / expo
// imports — so it runs in a plain node (vitest) environment, like reminderPlan.
//
// The scheme default matters: a bare hostname used to become `http://`, which
// sent the user's password and bearer tokens over the wire in the clear.

/**
 * Normalize what the user typed into an origin (`scheme://host[:port]`), or
 * null if it can't be one. A missing scheme defaults to **https**; `http://`
 * is preserved only when the user wrote it explicitly, and the caller is
 * expected to make them confirm it (see {@link isInsecureUrl}).
 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Did the user actually type a scheme, or did {@link normalizeUrl} assume one?
 *
 * Worth distinguishing: when an assumed `https://` fails to connect, the honest
 * error names the URL we tried and offers `http://`, rather than leaving the
 * user to guess that we changed what they typed.
 */
export function hasExplicitScheme(raw: string): boolean {
  return SCHEME_RE.test(raw.trim());
}

/** The cleartext twin of an https origin, for the "try http instead" path. */
export function toInsecureUrl(url: string): string {
  return url.replace(/^https:\/\//i, 'http://');
}

export function normalizeUrl(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!SCHEME_RE.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** True when the origin would carry credentials in cleartext. */
export function isInsecureUrl(url: string): boolean {
  return url.toLowerCase().startsWith('http://');
}
