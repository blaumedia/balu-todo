// Expo's template lists most configChanges on MainActivity but not `density`. Without it a display
// size change (fold, multi-window resize, `wm density`) recreates the activity and resets drafts and
// open sheets. Appends whatever is missing, so a future template that has them all is left alone.
const { withAndroidManifest } = require('expo/config-plugins');

const REQUIRED = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'density', 'uiMode'];

module.exports = function withConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const activity = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (!activity) throw new Error('withConfigChanges: MainActivity not found in AndroidManifest.xml');
    const current = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean);
    const missing = REQUIRED.filter((f) => !current.includes(f));
    if (missing.length > 0) activity.$['android:configChanges'] = [...current, ...missing].join('|');
    return cfg;
  });
};
