// AndroidManifest merger 충돌 해결.
// androidx.core 1.13.1 vs com.android.support:support-compat 28.0.0 가 동시 들어와
// appComponentFactory 속성을 동시 정의함. <application>에 tools:replace 명시해 충돌 회피.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidManifestMergerFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return config;

    if (!manifest.$) manifest.$ = {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    if (!app.$) app.$ = {};

    const existing = app.$['tools:replace'];
    const replaceList = existing ? existing.split(',').map((s) => s.trim()) : [];
    if (!replaceList.includes('android:appComponentFactory')) {
      replaceList.push('android:appComponentFactory');
      app.$['tools:replace'] = replaceList.join(',');
    }
    app.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';
    return config;
  });
};
