// 옛 com.android.support 라이브러리 group 전체 차단.
// androidx와 충돌. Jetifier가 자동 변환 못하는 transitive 케이스 대응.
const { withAppBuildGradle } = require('@expo/config-plugins');

const EXCLUDE_BLOCK = `
configurations.all {
    exclude group: 'com.android.support'
}
`;

module.exports = function withExcludeSupportLibs(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes("exclude group: 'com.android.support'")) {
      config.modResults.contents += '\n' + EXCLUDE_BLOCK + '\n';
    } else if (config.modResults.contents.includes("exclude group: 'com.android.support', module:")) {
      // 이전 module별 exclude를 group 전체로 교체
      config.modResults.contents = config.modResults.contents.replace(
        /configurations\.all\s*\{[\s\S]*?exclude group: 'com\.android\.support'[\s\S]*?\}/,
        EXCLUDE_BLOCK.trim()
      );
    }
    return config;
  });
};
