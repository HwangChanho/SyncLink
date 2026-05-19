/**
 * DevDashboard.tsx
 *
 * Developer-only AI cost dashboard component.
 * Rendered exclusively when EXPO_PUBLIC_APP_ENV === 'development'.
 * This component must NEVER be shown in production or TestFlight builds.
 *
 * Displays:
 *  - Today's AI call count and estimated cost
 *  - This week's AI call count and estimated cost
 *  - This month's AI call count and estimated cost
 *
 * Data source: usage_metrics table (via usageMetricsService).
 * Each card auto-refreshes on mount; a manual refresh button is provided.
 *
 * Architecture:
 *  - Service layer only — never calls Supabase directly
 *  - useColors() for theme awareness (light/dark)
 *  - StyleSheet-based styling (no inline style objects)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';

import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { getUsageDashboard, getCostByFeatureArea } from '@/services/usageMetricsService';
import type { UsageDashboard, UsagePeriodStats, FeatureAreaCost } from '@/services/usageMetricsService';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Props for a single usage period card. */
interface PeriodCardProps {
  /** Human-readable label, e.g. "Today", "This Week". */
  label: string;
  /** Aggregated stats for this period. */
  stats: UsagePeriodStats;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * PeriodCard — displays call count and estimated cost for one time window.
 *
 * @param label - Period label displayed at the top of the card
 * @param stats - { calls, estimatedCostUsd } for the period
 */
function PeriodCard({ label, stats }: PeriodCardProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  // Format cost to 4 decimal places; suppress trailing zeros below $0.0001
  const formattedCost =
    stats.estimatedCostUsd < 0.0001 && stats.estimatedCostUsd > 0
      ? '< $0.0001'
      : `$${stats.estimatedCostUsd.toFixed(4)}`;

  return (
    <View style={styles.card}>
      {/* Period label */}
      <Text style={styles.cardLabel}>{label}</Text>

      {/* Call count */}
      <View style={styles.cardRow}>
        <Text style={styles.cardMetaLabel}>AI calls</Text>
        <Text style={styles.cardMetaValue}>{stats.calls}</Text>
      </View>

      {/* Estimated cost */}
      <View style={styles.cardRow}>
        <Text style={styles.cardMetaLabel}>Est. cost</Text>
        <Text style={[styles.cardMetaValue, stats.estimatedCostUsd > 0.01 && styles.cardCostWarning]}>
          {formattedCost}
        </Text>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DevDashboard
 *
 * Shows a three-card grid (Today / This Week / This Month) with AI usage
 * and estimated cost pulled from the usage_metrics Supabase table.
 *
 * Guard: the parent (my.tsx) renders this only when
 * `process.env.EXPO_PUBLIC_APP_ENV === 'development'`.
 */
export function DevDashboard() {
  const colors = useColors();
  const styles = makeStyles(colors);

  // ── State ────────────────────────────────────────────────────────────────

  /** Loaded dashboard data; null until the first successful fetch. */
  const [dashboard, setDashboard] = useState<UsageDashboard | null>(null);
  /** v1.2 Phase 5 — feature_area 별 월간 cost breakdown. */
  const [areaCosts, setAreaCosts] = useState<FeatureAreaCost[]>([]);
  /** True while the network request is in flight. */
  const [isLoading, setIsLoading] = useState(false);
  /** Error message when fetch fails; null on success or before first fetch. */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  /**
   * Load (or reload) usage stats from the service layer.
   * Wrapped in useCallback so it can safely be listed as a useEffect dep.
   */
  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [data, areas] = await Promise.all([
        getUsageDashboard(),
        getCostByFeatureArea(),
      ]);
      setDashboard(data);
      setAreaCosts(areas);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load usage data.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🛠 Dev — AI Cost Dashboard</Text>
        <TouchableOpacity
          onPress={loadDashboard}
          disabled={isLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Refresh AI usage data"
          accessibilityRole="button"
        >
          <Text style={[styles.refreshButton, isLoading && styles.refreshButtonDisabled]}>
            ↻
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {isLoading && !dashboard && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading usage data…</Text>
        </View>
      )}

      {/* Error state */}
      {!isLoading && errorMessage !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity onPress={loadDashboard} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Data cards */}
      {dashboard !== null && (
        <View style={styles.cardsRow}>
          <PeriodCard label="Today"      stats={dashboard.today} />
          <PeriodCard label="This Week"  stats={dashboard.week}  />
          <PeriodCard label="This Month" stats={dashboard.month} />
        </View>
      )}

      {/* v1.2 Phase 5 — feature_area 별 월간 breakdown */}
      {areaCosts.length > 0 && (
        <View style={styles.areaBlock}>
          <Text style={styles.areaTitle}>By Feature Area (30d)</Text>
          {areaCosts.map((a) => (
            <View key={a.feature_area} style={styles.areaRow}>
              <Text style={styles.areaName}>{a.feature_area}</Text>
              <Text style={styles.areaCalls}>{a.calls} calls</Text>
              <Text style={styles.areaCost}>${a.estimatedCostUsd.toFixed(3)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Subtle loading overlay when re-fetching with existing data */}
      {isLoading && dashboard !== null && (
        <View style={styles.refreshingRow}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
          <Text style={styles.refreshingText}>Refreshing…</Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * makeStyles: returns a theme-aware StyleSheet.
 * Called inside the component after useColors() resolves the active theme.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    // ── Outer wrapper ────────────────────────────────────────────────────────
    container: {
      marginHorizontal: spacing[4],
      borderRadius:     radius.xl,
      borderWidth:      1,
      borderColor:      colors.border,
      backgroundColor:  colors.surface,
      padding:          spacing[4],
      gap:              spacing[3],
      // Dev-only visual cue: subtle amber tint border in addition to section border
      borderTopColor:   '#F59E0B',   // amber-400 — universally distinct from theme borders
      borderTopWidth:   2,
    },

    // ── Header row ───────────────────────────────────────────────────────────
    header: {
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    refreshButton: {
      fontSize: 18,
      color:    colors.primary,
      fontWeight: '600',
    },
    refreshButtonDisabled: {
      opacity: 0.4,
    },

    // ── Cards row ────────────────────────────────────────────────────────────
    cardsRow: {
      flexDirection: 'row',
      gap:           spacing[2],
    },

    // ── Individual card ──────────────────────────────────────────────────────
    card: {
      flex:            1,
      backgroundColor: colors.backgroundAlt,
      borderRadius:    radius.lg,
      borderWidth:     1,
      borderColor:     colors.border,
      padding:         spacing[3],
      gap:             spacing[1],
    },
    cardLabel: {
      ...textStyles.labelSm,
      color:        colors.textSecondary,
      marginBottom: spacing[1],
    },
    cardRow: {
      flexDirection:  'row',
      justifyContent: 'space-between',
      alignItems:     'center',
    },
    cardMetaLabel: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    cardMetaValue: {
      ...textStyles.caption,
      fontWeight: '600',
      color:      colors.textPrimary,
    },
    /** Highlight high-cost periods in amber to draw developer attention. */
    cardCostWarning: {
      color: '#D97706',   // amber-600 — visible in both light and dark themes
    },

    // ── Utility states ────────────────────────────────────────────────────────
    centerBox: {
      alignItems:     'center',
      justifyContent: 'center',
      paddingVertical: spacing[4],
      gap:             spacing[2],
    },
    loadingText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    errorBox: {
      backgroundColor: '#FEF2F2',   // red-50 — static, intentional dev alert color
      borderRadius:    radius.md,
      borderWidth:     1,
      borderColor:     '#FCA5A5',   // red-300
      padding:         spacing[3],
      gap:             spacing[2],
      alignItems:      'flex-start',
    },
    errorText: {
      ...textStyles.caption,
      color: '#DC2626',             // red-600
    },
    retryButton: {
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1],
      borderRadius:      radius.sm,
      backgroundColor:   '#DC2626',
    },
    retryButtonText: {
      ...textStyles.labelSm,
      color: '#FFFFFF',
    },
    refreshingRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[2],
      alignSelf:     'center',
    },
    refreshingText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    areaBlock: {
      marginTop: spacing[3],
      padding: spacing[3],
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      gap: spacing[1],
    },
    areaTitle: {
      ...textStyles.labelSm,
      color: colors.textSecondary,
      marginBottom: spacing[1],
    },
    areaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing[2],
    },
    areaName: {
      ...textStyles.bodySm,
      color: colors.textPrimary,
      flex: 1,
    },
    areaCalls: {
      ...textStyles.caption,
      color: colors.textTertiary,
      minWidth: 60,
      textAlign: 'right',
    },
    areaCost: {
      ...textStyles.labelSm,
      color: colors.textPrimary,
      minWidth: 60,
      textAlign: 'right',
    },
  });
}
