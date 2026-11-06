// Pure merge logic of withConfigChanges (no Expo imports, so it can be unit-tested in plain node).
const REQUIRED = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'uiMode'];

// Never handled in-process: a handled size + density change left the React surface laid out with stale constraints.
const FORBIDDEN = ['density'];

/**
 * `configChanges` value with every required flag present and every forbidden one removed, existing ones kept in
 * order; unchanged when already right.
 */
function mergeConfigChanges(value) {
  const all = (value ?? '').split('|').filter(Boolean);
  const current = all.filter((f) => !FORBIDDEN.includes(f));
  const missing = REQUIRED.filter((f) => !current.includes(f));
  return missing.length > 0 || current.length !== all.length ? [...current, ...missing].join('|') : value;
}

/** Apply it to the parsed manifest; throws when MainActivity is missing. */
function applyToManifest(manifest) {
  const activity = manifest.application?.[0]?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
  if (!activity) throw new Error('withConfigChanges: MainActivity not found in AndroidManifest.xml');
  activity.$['android:configChanges'] = mergeConfigChanges(activity.$['android:configChanges']);
}

module.exports = { REQUIRED, FORBIDDEN, mergeConfigChanges, applyToManifest };
