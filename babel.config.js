/**
 * Babel configuration for SyncDay (Expo SDK 52)
 *
 * Key configs:
 * - expo preset: handles React Native transformation
 * - module-resolver: enables @/* path alias (mirrors tsconfig.json paths)
 * - react-native-reanimated: must be listed LAST per library requirements
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json', '.svg'],
          alias: {
            // @/components/Foo → src/components/Foo
            '@': './src',
          },
        },
      ],
      // Must be listed last
      'react-native-reanimated/plugin',
    ],
  };
};
