/**
 * Metro bundler configuration for SyncDay
 *
 * Extends Expo's default Metro config.
 * Additional customization can be added here as needed.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
