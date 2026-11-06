// Makes sure MainActivity handles the window/size configuration changes itself (keyboard, orientation, screenSize, ...),
// so a fold, rotation or multi-window resize switches the layout live instead of recreating the activity and
// resetting drafts and open sheets. Appends whatever is missing, so a template that has them all is left alone.
// `density` is deliberately NOT handled (and removed if a template ever adds it): a live `wm size` + `wm density`
// pair on an emulator (and likely any change where size and density change together) left the React surface laid
// out with the intermediate density (tab bar, FAB and header actions off screen) until a cold start; letting Android
// recreate the activity on a density change avoids that.
const { withAndroidManifest } = require('expo/config-plugins');
const { applyToManifest } = require('./configChanges');

module.exports = function withConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    applyToManifest(cfg.modResults.manifest);
    return cfg;
  });
};
