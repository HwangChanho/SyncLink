/**
 * Babel configuration for SyncDay (Expo SDK 54)
 *
 * Key configs:
 * - expo preset: handles React Native transformation
 * - module-resolver: enables @/* path alias (mirrors tsconfig.json paths)
 * - react-native-worklets/plugin: reanimated 4 moved its worklets Babel
 *   plugin into the standalone react-native-worklets package. Must be LAST.
 *   (reanimated/plugin still exists as a shim re-exporting this, but we
 *   reference the canonical path directly to survive shim removal.)
 */

// Stub only the service-specific EXPO_PUBLIC_* vars that babel-preset-expo's
// inline-env-vars plugin would inline as undefined during Jest transforms.
// We intentionally avoid loading the full .env (which would break tests that
// assert on *missing* vars, e.g. supabase.test.ts "missing env vars" suite).
if (process.env.NODE_ENV === 'test') {
  if (!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-google-maps-key-jest';
  }
  if (!process.env.EXPO_PUBLIC_WEATHER_API_KEY) {
    process.env.EXPO_PUBLIC_WEATHER_API_KEY = 'test-weather-key-jest';
  }
  // Kakao custom OAuth (kakao-auth Edge Function). authService.signInWithKakao
  // builds the Kakao authorize URL using this key, so it must be present at
  // transform time (babel-preset-expo's inline-env-vars plugin bakes the
  // value in). Setting it in jest.setup.js is too late — the transform has
  // already run by then.
  if (!process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY) {
    process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY = 'test-kakao-rest-api-key';
  }
  // Kakao 네이티브 SDK 초기화 키. authService 는 모듈 로드 시 이 값으로
  // initializeKakaoSDK 를 부르고, 값이 없으면 네이티브 로그인 호출 자체를 막는
  // 가드가 걸린다(초기화 안 된 SDK 를 부르면 네이티브에서 앱이 죽기 때문).
  // 테스트가 실제 로그인 경로를 타려면 transform 시점에 값이 있어야 한다.
  if (!process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY) {
    process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = 'test-kakao-native-app-key';
  }
  // Note: EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are intentionally NOT stubbed
  // here. `__tests__/lib/supabase.test.ts` asserts the "missing env vars"
  // warning path by deleting process.env.EXPO_PUBLIC_SUPABASE_URL; stubbing
  // would cause babel to bake a real value in and defeat that delete.
  // authService instead consumes SUPABASE_URL / SUPABASE_ANON_KEY re-exports
  // from lib/supabase, which callers can mock per-test-file.
}

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
      // Must be listed last (reanimated 4 worklets plugin)
      'react-native-worklets/plugin',
    ],
  };
};
