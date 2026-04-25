/**
 * Metro bundler configuration for SyncLink.
 *
 * Extends Expo's default Metro config and adds web-only stubs for native-
 * only modules that would otherwise pull `codegenNativeCommands` (or
 * similar TurboModule glue) into the web bundle and break it at compile
 * time. Stubbed modules resolve to an empty module on web, leaving them
 * fully functional on iOS/Android.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Modules that crash the web bundler because they import native specs.
 * Each entry is matched against the requested module name verbatim. When
 * the platform is `web` Metro is told to resolve the request to an
 * empty module (no code, no exports — safe to require because callers
 * already platform-guard their usage).
 */
const WEB_BLOCKED_MODULES = new Set([
  'react-native-google-mobile-ads',
  'expo-apple-authentication',
  'expo-tracking-transparency',
  '@react-native-community/datetimepicker',
  'expo-notifications',
]);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_BLOCKED_MODULES.has(moduleName)) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
