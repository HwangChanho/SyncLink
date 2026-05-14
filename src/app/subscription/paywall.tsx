/**
 * Paywall screen — SyncLink Pro subscription UI.
 *
 * Displays the Pro plan features and available RevenueCat offerings.
 * Loads packages dynamically from RevenueCat; falls back to static
 * display data while loading or if the SDK is not yet initialized.
 *
 * Flows handled:
 *  - Purchase:  purchaseService.purchasePackage() → setPlan('pro') → back
 *  - Restore:   purchaseService.restorePurchases() → setPlan('pro') if active
 *  - Dismiss:   router.back() or /(tabs) if no back stack
 *
 * Accessible via: router.push('/subscription/paywall')
 * Opened automatically when AI limit is exceeded (NLInputBar gate).
 *
 * TASK-505 (Sprint 5) — updated TASK-800 (Sprint 8)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import type { PurchasesPackage } from 'react-native-purchases';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '@/services/purchaseService';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

// ─── Static plan display data — replaced by i18n inside the component ─────────

/**
 * Fallback pricing shown while RevenueCat offerings are loading.
 * Replaced by actual package data once getOfferings() resolves.
 */
interface FallbackPricing {
  id: 'monthly' | 'annual';
  label: string;
  price: string;
  period: string;
  isPopular: boolean;
  savingsLabel?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine if a PurchasesPackage is an annual subscription.
 * RevenueCat PackageType enum: 'ANNUAL', 'MONTHLY', 'WEEKLY', etc.
 * Package identifier also often contains 'annual'/'yearly' by convention.
 */
function isAnnualPackage(pkg: PurchasesPackage): boolean {
  const type = pkg.packageType?.toLowerCase() ?? '';
  const id   = pkg.identifier?.toLowerCase() ?? '';
  return type.includes('annual') || type.includes('yearly') || id.includes('annual') || id.includes('yearly');
}

/**
 * Format a RevenueCat product price string for display.
 * product.priceString is already locale-formatted (e.g. '₩3,900').
 */
function formatPackagePrice(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

/**
 * Map a PurchasesPackage to its display period label.
 */
function formatPackagePeriod(pkg: PurchasesPackage): string {
  if (isAnnualPackage(pkg)) return '/년';
  return '/월';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const { t } = useTranslation();
  const colors  = useColors();
  const styles  = makeStyles(colors);
  const setPlan = useSubscriptionStore((s) => s.setPlan);

  /** Pro features loaded from i18n. */
  const PRO_FEATURES = t('paywall.features', { returnObjects: true }) as string[];

  /** Fallback pricing loaded from i18n. */
  const FALLBACK_PRICING: FallbackPricing[] = [
    {
      id:        'monthly',
      label:     t('paywall.monthly_label'),
      price:     t('paywall.monthly_price'),
      period:    t('paywall.monthly_period'),
      isPopular: false,
    },
    {
      id:           'annual',
      label:        t('paywall.annual_label'),
      price:        t('paywall.annual_price'),
      period:       t('paywall.annual_period'),
      isPopular:    true,
      savingsLabel: t('paywall.annual_savings'),
    },
  ];

  /** RevenueCat packages loaded from the current offering. */
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);

  /** Index of the currently selected package. Defaults to the annual option (index 1). */
  const [selectedIndex, setSelectedIndex] = useState<number>(1);

  /** Whether a purchase or restore network call is in progress. */
  const [purchasing, setPurchasing] = useState(false);

  /** Whether offerings are still being fetched from RevenueCat. */
  const [offeringsLoading, setOfferingsLoading] = useState(true);

  // ── Load offerings on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    getOfferings()
      .then((pkgs) => {
        if (cancelled) return;
        // Build-102 — v1.0 출시 시점에는 monthly 1개만 노출. RevenueCat
        // default Offering 의 $rc_annual / $rc_lifetime 슬롯에 Pro Monthly
        // product 가 잘못 attached 되어 있어 paywall 에 3개 카드가
        // 표시됨. transaction 이력 때문에 dashboard 에서 detach 불가 →
        // 클라이언트 필터로 monthly 만 노출. annual/lifetime 제품을 정식
        // 등록한 뒤 이 필터를 제거하면 다시 노출.
        const monthlyOnly = pkgs.filter((p) => p.identifier === '$rc_monthly');
        setPackages(monthlyOnly);
        setSelectedIndex(0);
      })
      .catch(() => {
        // Offerings unavailable (no network, SDK not initialized, etc.)
        // Fall back to static pricing display; purchase buttons still disabled.
        if (!cancelled) setPackages([]);
      })
      .finally(() => {
        if (!cancelled) setOfferingsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Purchase handler ────────────────────────────────────────────────────────
  const handleSubscribe = useCallback(async () => {
    if (purchasing) return;

    // If RevenueCat packages are loaded, use them; otherwise show unavailable alert
    if (!packages || packages.length === 0) {
      Alert.alert(
        t('paywall.purchase_unavailable_title'),
        t('paywall.purchase_unavailable_desc'),
        [{ text: t('common.ok'), style: 'default' }],
      );
      return;
    }

    const selectedPackage = packages[selectedIndex] ?? packages[0];
    if (!selectedPackage) return;

    setPurchasing(true);
    try {
      const isPro = await purchasePackage(selectedPackage);
      if (isPro) {
        // Sync local subscription store with the confirmed entitlement
        setPlan('pro');
        Alert.alert(
          t('paywall.purchase_complete_title'),
          t('paywall.purchase_complete_desc'),
          [{
            text: t('common.ok'),
            onPress: () => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)');
              }
            },
          }],
        );
      }
    } catch (err: unknown) {
      // User cancellation is normal — do not show an error alert
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isCancelled =
        msg.includes('cancel') || msg.includes('usercancel') || msg.includes('0');
      if (!isCancelled) {
        Alert.alert(
          t('paywall.purchase_failed_title'),
          err instanceof Error ? err.message : t('paywall.purchase_failed_desc'),
          [{ text: t('common.ok'), style: 'default' }],
        );
      }
    } finally {
      setPurchasing(false);
    }
  }, [packages, selectedIndex, purchasing, setPlan, t]);

  // ── Restore handler ─────────────────────────────────────────────────────────
  const handleRestore = useCallback(async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const isPro = await restorePurchases();
      if (isPro) {
        setPlan('pro');
        Alert.alert(t('paywall.restore_complete_title'), t('paywall.restore_complete_desc'), [{
          text: t('common.ok'),
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)');
          },
        }]);
      } else {
        Alert.alert(t('paywall.restore_none_title'), t('paywall.restore_none_desc'), [{ text: t('common.ok') }]);
      }
    } catch (err: unknown) {
      Alert.alert(
        t('paywall.restore_failed_title'),
        err instanceof Error ? err.message : t('paywall.restore_failed_desc'),
        [{ text: t('common.ok') }],
      );
    } finally {
      setPurchasing(false);
    }
  }, [purchasing, setPlan, t]);

  // ── Dismiss handler ─────────────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, []);

  // ─── Render helpers ─────────────────────────────────────────────────────────

  /**
   * Render a pricing card — either from a live RevenueCat package or
   * from the static fallback data shown during loading.
   */
  function renderPricingCard(
    key: string,
    index: number,
    label: string,
    price: string,
    period: string,
    isPopular: boolean,
    savingsLabel?: string,
  ) {
    const isSelected = selectedIndex === index;
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.pricingCard,
          isSelected     && styles.pricingCardSelected,
          isPopular      && styles.pricingCardPopular,
        ]}
        onPress={() => setSelectedIndex(index)}
        activeOpacity={0.8}
        disabled={purchasing}
      >
        {/* Popular badge */}
        {isPopular && (
          <View style={styles.popularBadge}>
            <Text style={styles.popularBadgeText}>{t('paywall.popular')}</Text>
          </View>
        )}

        <View style={styles.pricingInfo}>
          <Text style={[styles.pricingLabel, isSelected && styles.pricingLabelSelected]}>
            {label}
          </Text>
          <View style={styles.priceRow}>
            <Text style={[styles.priceAmount, isSelected && styles.priceAmountSelected]}>
              {price}
            </Text>
            <Text style={[styles.pricePeriod, isSelected && styles.pricePeriodSelected]}>
              {period}
            </Text>
          </View>
          {savingsLabel && (
            <Text style={[styles.savingsText, isSelected && styles.savingsTextSelected]}>
              {savingsLabel}
            </Text>
          )}
        </View>

        {/* Selection indicator */}
        <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.appName}>SyncLink Pro</Text>
          <Text style={styles.headline}>{t('paywall.headline')}</Text>
        </View>

        {/* ── Feature list ──────────────────────────────────────────── */}
        <View style={styles.featureList}>
          {PRO_FEATURES.map(feature => (
            <View key={feature} style={styles.featureRow}>
              <View style={styles.checkIcon}>
                <Text style={styles.checkMark}>✓</Text>
              </View>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* ── Pricing options ─────────────────────────────────────────── */}
        <View style={styles.pricingSection}>
          {offeringsLoading ? (
            // Loading skeleton — show spinner while fetching offerings
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>{t('paywall.loading')}</Text>
            </View>
          ) : packages && packages.length > 0 ? (
            // Live RevenueCat packages
            packages.map((pkg, index) => {
              const annual       = isAnnualPackage(pkg);
              const label        = annual ? t('paywall.annual_label') : t('paywall.monthly_label');
              const price        = formatPackagePrice(pkg);
              const period       = formatPackagePeriod(pkg);
              const isPopular    = annual;
              // savingsLabel only available from server-side config; omitted for live pkgs
              return renderPricingCard(pkg.identifier, index, label, price, period, isPopular);
            })
          ) : (
            // Fallback static pricing (SDK not initialized or no offerings configured)
            FALLBACK_PRICING.map((option, index) =>
              renderPricingCard(
                option.id,
                index,
                option.label,
                option.price,
                option.period,
                option.isPopular,
                option.savingsLabel,
              ),
            )
          )}
        </View>

        {/* ── CTA button ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.ctaButton, purchasing && styles.ctaButtonDisabled]}
          onPress={handleSubscribe}
          activeOpacity={0.85}
          disabled={purchasing || offeringsLoading}
        >
          {purchasing ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.ctaText}>{t('paywall.cta')}</Text>
          )}
        </TouchableOpacity>

        {/* ── Restore button ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestore}
          activeOpacity={0.7}
          disabled={purchasing}
        >
          <Text style={styles.restoreText}>{t('paywall.restore')}</Text>
        </TouchableOpacity>

        {/* ── Dismiss link ───────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          activeOpacity={0.7}
          disabled={purchasing}
        >
          <Text style={styles.dismissText}>{t('paywall.dismiss')}</Text>
        </TouchableOpacity>

        {/* ── Legal footnote ─────────────────────────────────────────── */}
        <Text style={styles.legalText}>
          {t('paywall.legal')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: {
      flex:            1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: spacing[6],
      paddingBottom:     spacing[10],
      gap:               spacing[6],
    },

    // ── Header ──────────────────────────────────────────────────────────────
    header: {
      alignItems: 'center',
      paddingTop: spacing[8],
      gap:        spacing[2],
    },
    appName: {
      ...textStyles.h1,
      color: colors.primary,
    },
    headline: {
      ...textStyles.body,
      color:     colors.textSecondary,
      textAlign: 'center',
    },

    // ── Feature list ─────────────────────────────────────────────────────────
    featureList: {
      backgroundColor: colors.backgroundAlt,
      borderRadius:    radius.xl,
      padding:         spacing[5],
      gap:             spacing[3],
    },
    featureRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[3],
    },
    checkIcon: {
      width:           24,
      height:          24,
      borderRadius:    radius.full,
      backgroundColor: colors.primaryLight,
      alignItems:      'center',
      justifyContent:  'center',
    },
    checkMark: {
      color:      colors.primary,
      fontSize:   13,
      fontWeight: '700',
    },
    featureText: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },

    // ── Pricing section ─────────────────────────────────────────────────────
    pricingSection: {
      gap: spacing[3],
    },
    loadingContainer: {
      alignItems:      'center',
      justifyContent:  'center',
      paddingVertical: spacing[6],
      gap:             spacing[3],
    },
    loadingText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },

    // ── Pricing cards ────────────────────────────────────────────────────────
    pricingCard: {
      flexDirection:   'row',
      alignItems:      'center',
      backgroundColor: colors.surface,
      borderRadius:    radius.xl,
      borderWidth:     2,
      borderColor:     colors.border,
      padding:         spacing[4],
      position:        'relative',
    },
    pricingCardSelected: {
      borderColor:     colors.primary,
      backgroundColor: colors.primaryLight,
    },
    pricingCardPopular: {
      // Slightly taller implicit via padding — badge handles the visual
    },
    popularBadge: {
      position:          'absolute',
      top:               -12,
      right:             spacing[4],
      backgroundColor:   colors.primary,
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1],
      borderRadius:      radius.full,
    },
    popularBadgeText: {
      ...textStyles.caption,
      color:      colors.textInverse,
      fontWeight: '700',
    },
    pricingInfo: {
      flex: 1,
      gap:  spacing[0.5],
    },
    pricingLabel: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    pricingLabelSelected: {
      color: colors.primary,
    },
    priceRow: {
      flexDirection: 'row',
      alignItems:    'baseline',
      gap:           spacing[1],
    },
    priceAmount: {
      ...textStyles.h3,
      color: colors.textPrimary,
    },
    priceAmountSelected: {
      color: colors.primary,
    },
    pricePeriod: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    pricePeriodSelected: {
      color: colors.primary,
    },
    savingsText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    savingsTextSelected: {
      color: colors.primary,
    },
    radioOuter: {
      width:          22,
      height:         22,
      borderRadius:   radius.full,
      borderWidth:    2,
      borderColor:    colors.border,
      alignItems:     'center',
      justifyContent: 'center',
    },
    radioOuterSelected: {
      borderColor: colors.primary,
    },
    radioInner: {
      width:           12,
      height:          12,
      borderRadius:    radius.full,
      backgroundColor: colors.primary,
    },

    // ── CTA ──────────────────────────────────────────────────────────────────
    ctaButton: {
      height:          componentHeight.buttonLg,
      backgroundColor: colors.primary,
      borderRadius:    radius.full,
      alignItems:      'center',
      justifyContent:  'center',
    },
    ctaButtonDisabled: {
      opacity: 0.7,
    },
    ctaText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },

    // ── Restore ───────────────────────────────────────────────────────────────
    restoreButton: {
      alignItems:      'center',
      paddingVertical: spacing[2],
    },
    restoreText: {
      ...textStyles.label,
      color: colors.primary,
    },

    // ── Dismiss & legal ──────────────────────────────────────────────────────
    dismissButton: {
      alignItems:      'center',
      paddingVertical: spacing[2],
    },
    dismissText: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    legalText: {
      ...textStyles.caption,
      color:         colors.textTertiary,
      textAlign:     'center',
      paddingBottom: spacing[4],
    },
  });
}
