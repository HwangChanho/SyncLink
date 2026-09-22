/**
 * ESLint config — restored after the auto-reviewer caught that
 * `npm run lint` was silently failing for lack of any config file
 * (Sprint 19, daily-review 2026-04-26).
 *
 * `expo` is the canonical preset for Expo / React Native projects;
 * `package.json` already pins `eslint-config-expo@~8.0.0` so this just
 * wires it in.
 */
module.exports = {
  root: true,
  extends: ['expo'],
  ignorePatterns: [
    'node_modules/',
    'ios/',
    'android/',
    'build/',
    '.expo/',
    'public/',
    'scripts/auto-review/prompts/',
  ],
  rules: {
    // Sprint-19 baseline rules — keep low so the gate isn't aspirational.
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  },
  overrides: [
    {
      // 1.5.0 브랜드 글꼴: 텍스트는 공용 AppText 를 거쳐야 글꼴이 입혀진다.
      // RN Text/TextInput 을 직접 쓰면 그 텍스트만 시스템 글꼴로 남는다.
      // 타입 import(useRef<TextInput> 등)는 허용한다.
      files: ['src/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'react-native',
                importNames: ['Text', 'TextInput'],
                message: '@/components/common/AppText 의 Text/TextInput 을 쓰세요(브랜드 글꼴 자동 적용).',
                allowTypeImports: true,
              },
            ],
          },
        ],
      },
    },
  ],
};
