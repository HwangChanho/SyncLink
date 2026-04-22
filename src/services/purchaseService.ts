/**
 * Purchase service — RevenueCat in-app purchase adapter.
 *
 * All RevenueCat SDK calls flow through here. Components never call
 * react-native-purchases directly; only this service does.
 * If the payment backend changes (e.g. StoreKit direct), only this file needs updating.
 *
 * Supported flows:
 *  1. initializePurchases — configure SDK once at app startup after login
 *  2. getOfferings        — fetch available packages from RevenueCat dashboard
 *  3. purchasePackage     — execute an in-app purchase for a given package
 *  4. restorePurchases    — restore previously purchased entitlements
 *  5. checkProStatus      — query current entitlement state from RevenueCat
 *
 * Environment variables required (set in .env.local, never commit real keys):
 *  - EXPO_PUBLIC_RC_API_KEY_IOS     — RevenueCat iOS project API key
 *  - EXPO_PUBLIC_RC_API_KEY_ANDROID — RevenueCat Android project API key
 *
 * TASK-800 (Sprint 8)
 */

import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

// ─── Environment variables ────────────────────────────────────────────────────

/**
 * RevenueCat iOS API key.
 * Must start with "appl_" — configured in RevenueCat dashboard.
 * Leave blank in development; StoreKit sandbox will still work with a real key.
 */
const RC_API_KEY_IOS     = process.env.EXPO_PUBLIC_RC_API_KEY_IOS     ?? '';

/**
 * RevenueCat Android API key.
 * Must start with "goog_" — configured in RevenueCat dashboard.
 */
const RC_API_KEY_ANDROID = process.env.EXPO_PUBLIC_RC_API_KEY_ANDROID ?? '';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the RevenueCat SDK with the appropriate platform API key.
 * Must be called once after the user has authenticated (user ID required
 * so RevenueCat can attribute purchases to the correct subscriber).
 *
 * Typically called in _layout.tsx when session becomes available:
 *  ```ts
 *  initializePurchases(session.user.id).then(...);
 *  ```
 *
 * @param userId - Supabase user UUID; used as RevenueCat appUserID
 */
export async function initializePurchases(userId: string): Promise<void> {
  // Set verbose logging in development to help debug StoreKit sandbox issues.
  // In production builds, LOG_LEVEL.ERROR is recommended to reduce noise.
  Purchases.setLogLevel(LOG_LEVEL.DEBUG);

  // Select API key based on platform — iOS and Android use separate RC projects
  const apiKey = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;

  await Purchases.configure({
    apiKey,
    appUserID: userId,
  });
}

/**
 * Fetch the currently active offerings from RevenueCat.
 * Offerings and their packages are configured in the RevenueCat dashboard
 * and can be updated without a new App Store / Play Store release.
 *
 * Returns the packages from the "current" offering (the default offering
 * selected in the RevenueCat dashboard). Returns an empty array if no
 * current offering exists (e.g. misconfigured dashboard).
 *
 * @returns Array of PurchasesPackage objects (monthly, annual, etc.)
 */
export async function getOfferings(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  // current may be null if no offering is set as default in RC dashboard
  return offerings.current?.availablePackages ?? [];
}

/**
 * Purchase a specific package (e.g. monthly or annual subscription).
 * Triggers the native App Store / Play Store purchase sheet.
 *
 * @param pkg - A PurchasesPackage from getOfferings()
 * @returns true if the 'pro' entitlement is now active after purchase;
 *          false if purchase succeeded but entitlement is still absent
 *          (shouldn't happen with correct RC configuration)
 * @throws Error if purchase fails, is cancelled by the user, or the
 *         StoreKit / Billing Client returns an error
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  // Check whether the 'pro' entitlement is active in the returned CustomerInfo
  return customerInfo.entitlements.active['pro'] !== undefined;
}

/**
 * Restore previously purchased subscriptions.
 * Should be triggered by the "구매 복원" button on the paywall screen.
 * Useful when a user reinstalls the app or switches devices.
 *
 * @returns true if the 'pro' entitlement is active after restore;
 *          false if no active entitlements were found
 */
export async function restorePurchases(): Promise<boolean> {
  const customerInfo = await Purchases.restorePurchases();
  return customerInfo.entitlements.active['pro'] !== undefined;
}

/**
 * Check the current Pro entitlement status without triggering a purchase.
 * Used at app startup to sync the local subscription plan with RevenueCat's
 * server-side entitlement state.
 *
 * @returns true if the user has an active 'pro' entitlement
 */
export async function checkProStatus(): Promise<boolean> {
  const customerInfo = await Purchases.getCustomerInfo();
  return customerInfo.entitlements.active['pro'] !== undefined;
}
