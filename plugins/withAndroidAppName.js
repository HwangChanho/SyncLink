/**
 * withAndroidAppName — set the Android launcher label independently of `expo.name`.
 *
 * Why this exists (2026-08 rebrand):
 *   Expo derives the **iOS Xcode project name** from `expo.name`. Setting it to the
 *   Korean brand "투투리스트" made prebuild sanitize it down to `app`, renaming
 *   `ios/SyncLink.xcodeproj` → `ios/app.xcodeproj`. That silently broke:
 *     - fastlane/Fastfile (workspace path, `-scheme SyncLink`, Info.plist path)
 *     - plugins/withAppGroupBridge.js, which copied the native bridge into the now
 *       orphaned `ios/SyncLink/` — the widget's App Group bridge would have been
 *       missing from the build entirely.
 *
 *   So `expo.name` stays the ASCII "SyncLink" (matching the bundle id, package,
 *   scheme and domain, which we deliberately kept), and the user-visible name is
 *   set per platform instead:
 *     - iOS     : ios.infoPlist.CFBundleDisplayName in app.json
 *     - Android : this plugin (Expo has no `android.appName` field)
 *
 * Reads `expo.extra.androidAppName`, falling back to `expo.name` so removing the
 * extra restores stock behaviour rather than blanking the label.
 */

const { withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const withAndroidAppName = (config) => {
  return withStringsXml(config, (cfg) => {
    const label = cfg.extra?.androidAppName ?? cfg.name;
    if (!label) return cfg;

    cfg.modResults = AndroidConfig.Strings.setStringItem(
      // `translatable: false` — this is a brand name, not copy to be localized.
      [{ _: label, $: { name: 'app_name', translatable: 'false' } }],
      cfg.modResults,
    );
    return cfg;
  });
};

module.exports = withAndroidAppName;
