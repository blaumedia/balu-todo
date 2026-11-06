// Expo's template lists most configChanges on MainActivity but not `density`. Without it a display
// size change (fold, multi-window resize, `wm density`) recreates the activity and resets drafts and
// open sheets. Appends whatever is missing, so a future template that has them all is left alone.
const { withAndroidManifest } = require('expo/config-plugins');
const { applyToManifest } = require('./configChanges');

module.exports = function withConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    applyToManifest(cfg.modResults.manifest);
    return cfg;
  });
};
