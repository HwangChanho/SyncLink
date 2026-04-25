/**
 * App entry point. Wraps the Expo Router entry so we can also register the
 * Android widget headless task before the JS runtime hands control to the
 * router.
 *
 * react-native-android-widget calls `registerWidgetTaskHandler(handler)`
 * once at module load; the OS then invokes `handler` whenever a widget on
 * the home screen needs a render. This must be registered eagerly (i.e.
 * before any Router code) because the headless task can fire even when the
 * full app isn't running.
 *
 * Web bundle: the package's NativeModules access throws on unsupported
 * platforms, so we skip the registration entirely on web. The router still
 * loads as the fallthrough import below.
 *
 * Sprint 19 TASK-1900.
 */

import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  // Lazy require so the package isn't even pulled into the iOS / web bundle
  // graphs; metro tree-shakes the unused branch out at build time.
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/widgetTaskHandler');
  // Idempotent — package guards against double-registration internally.
  registerWidgetTaskHandler(widgetTaskHandler);
}

// Hand off to expo-router so the rest of the app boots normally. Must come
// after the widget handler registration so headless task firings during
// boot still resolve to a valid handler.
import 'expo-router/entry';
