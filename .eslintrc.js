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
};
