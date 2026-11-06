// Pure merge logic of withConfigChanges (no Expo imports, so it can be unit-tested in plain node).
const REQUIRED = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'uiMode'];

/** `configChanges` value with every required flag present, existing ones kept in order; unchanged when complete. */
function mergeConfigChanges(value) {
  const current = (value ?? '').split('|').filter(Boolean);
  const missing = REQUIRED.filter((f) => !current.includes(f));
  return missing.length > 0 ? [...current, ...missing].join('|') : value;
}

/** Apply it to the parsed manifest; throws when MainActivity is missing. */
function applyToManifest(manifest) {
  const activity = manifest.application?.[0]?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
  if (!activity) throw new Error('withConfigChanges: MainActivity not found in AndroidManifest.xml');
  activity.$['android:configChanges'] = mergeConfigChanges(activity.$['android:configChanges']);
}

module.exports = { REQUIRED, mergeConfigChanges, applyToManifest };
