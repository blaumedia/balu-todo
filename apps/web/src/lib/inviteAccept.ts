/**
 * What the invite screen shows once the invite was accepted but booting into the
 * workspace ended on the login screen (`bootSession` resolved false).
 *
 * Only a login that is gone leads to the login form. With the login intact the
 * accept call already succeeded: a missing membership in /me or a local failure
 * is an error of its own, not an invalid invite and not a reason to ask for a
 * password.
 */
export function phaseAfterFailedBoot(isAuthenticated: boolean): "needsAuth" | "bootFailed" {
  return isAuthenticated ? "bootFailed" : "needsAuth";
}
