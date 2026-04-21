/**
 * Paywall screen — SyncDay Pro subscription UI.
 *
 * Displays the Pro plan features, pricing (월간/연간), and CTA button.
 * Actual payment integration (RevenueCat / react-native-purchases) is deferred
 * to v1.1. Current implementation shows "준비 중" alert on purchase attempt.
 *
 * Accessible via: router.push('/subscription/paywall')
 * Opened automatically when AI limit is exceeded (NLInputBar gate).
 *
 * TASK-505 (Sprint 5)
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Plan data ─────────────────────────────────────────────────────────────────

const PRO_FEATURES = [
  'AI 자연어 일정 무제한',
  '주간 리뷰 매주',
  'Space 무제한',
  '날짜 추천 AI',
  '광고 없음',
] as const;

interface PricingOption {
  id: 'monthly' | 'annual';
  label: string;
  price: string;
  period: string;
  isPopular: boolean;
  savingsLabel?: string;
}

const PRICING_OPTIONS: PricingOption[] = [
  {
    id:         'monthly',
    label:      '월간',
    price:      '3,900원',
    period:     '/월',
    isPopular:  false,
  },
  {
    id:           'annual',
    label:        '연간',
    price:        '29,900원',
    period:       '/년',
    isPopular:    true,
    savingsLabel: '월 2,492원 — 36% 절약',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Currently selected pricing plan. Annual is the default (highlighted). */
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');

  const handleSubscribe = () => {
    // v1.1: RevenueCat integration will replace this Alert
    Alert.alert(
      '준비 중',
      '결제 기능은 곧 출시됩니다! 조금만 기다려 주세요.',
      [{ text: '확인', style: 'default' }],
    );
  };

  const handleDismiss = () => {
    // Navigate back; if no back stack, go to home
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.appName}>SyncDay Pro</Text>
          <Text style={styles.headline}>모든 기능을 제한 없이 사용하세요</Text>
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

        {/* ── Pricing options ────────────────────────────────────────── */}
        <View style={styles.pricingSection}>
          {PRICING_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.pricingCard,
                selectedPlan === option.id && styles.pricingCardSelected,
                option.isPopular && styles.pricingCardPopular,
              ]}
              onPress={() => setSelectedPlan(option.id)}
              activeOpacity={0.8}
            >
              {/* Popular badge */}
              {option.isPopular && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularBadgeText}>인기</Text>
                </View>
              )}

              <View style={styles.pricingInfo}>
                <Text style={[
                  styles.pricingLabel,
                  selectedPlan === option.id && styles.pricingLabelSelected,
                ]}>
                  {option.label}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={[
                    styles.priceAmount,
                    selectedPlan === option.id && styles.priceAmountSelected,
                  ]}>
                    {option.price}
                  </Text>
                  <Text style={[
                    styles.pricePeriod,
                    selectedPlan === option.id && styles.pricePeriodSelected,
                  ]}>
                    {option.period}
                  </Text>
                </View>
                {option.savingsLabel && (
                  <Text style={[
                    styles.savingsText,
                    selectedPlan === option.id && styles.savingsTextSelected,
                  ]}>
                    {option.savingsLabel}
                  </Text>
                )}
              </View>

              {/* Selection indicator */}
              <View style={[
                styles.radioOuter,
                selectedPlan === option.id && styles.radioOuterSelected,
              ]}>
                {selectedPlan === option.id && (
                  <View style={styles.radioInner} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── CTA button ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={handleSubscribe}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>지금 시작하기</Text>
        </TouchableOpacity>

        {/* ── Dismiss link ───────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          activeOpacity={0.7}
        >
          <Text style={styles.dismissText}>무료로 계속 사용</Text>
        </TouchableOpacity>

        {/* ── Legal footnote ─────────────────────────────────────────── */}
        <Text style={styles.legalText}>
          결제는 App Store / Google Play를 통해 처리됩니다.
          구독은 언제든지 해지할 수 있습니다.
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

    // ── Pricing cards ────────────────────────────────────────────────────────
    pricingSection: {
      gap: spacing[3],
    },
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
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    pricingCardPopular: {
      // Slightly taller implicit via padding — badge handles the visual
    },
    popularBadge: {
      position:        'absolute',
      top:             -12,
      right:           spacing[4],
      backgroundColor: colors.primary,
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1],
      borderRadius:    radius.full,
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
      width:        22,
      height:       22,
      borderRadius: radius.full,
      borderWidth:  2,
      borderColor:  colors.border,
      alignItems:   'center',
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
    ctaText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },

    // ── Dismiss & legal ──────────────────────────────────────────────────────
    dismissButton: {
      alignItems: 'center',
      paddingVertical: spacing[2],
    },
    dismissText: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    legalText: {
      ...textStyles.caption,
      color:     colors.textTertiary,
      textAlign: 'center',
      paddingBottom: spacing[4],
    },
  });
}
