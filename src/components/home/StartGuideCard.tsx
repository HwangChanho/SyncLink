/**
 * StartGuideCard — post-login "시작 가이드" checklist shown at the top of Home
 * until the new user has actually tried each core feature once.
 *
 * Steps and how completion is decided (real data over stored flags wherever
 * the data can speak for itself — see startGuideStore doc):
 *  1. Create your first event  — eventStore has ≥1 event (authenticated, so
 *                                guest demo data is never in play here).
 *                                Tap → focuses the bottom NLInputBar via
 *                                nlFocusStore so the user types for real.
 *  2. See it on the calendar   — tap navigates to /(tabs)/calendar and sets a
 *                                persisted visited flag (navigation isn't
 *                                derivable from data).
 *  3. Join or create a Space   — spaceStore has ≥1 space. Tap → /(tabs)/spaces.
 *                                (Copy leads with "join": creating is Pro-gated.)
 *  4. Allow notifications      — notification permission granted. Hidden on
 *                                web (Expo push unsupported there).
 *
 * Visibility: authenticated && hydrated && !dismissed && !all-complete.
 * All steps complete → celebratory row + auto-dismiss (persisted) shortly
 * after, so the card retires itself. X dismisses permanently at any time.
 *
 * 2026-08-05 interactive-onboarding plan.
 */

import { useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { getMySpaces } from '@/services/spaceService';
import { useStartGuideStore } from '@/stores/startGuideStore';
import { useNLFocusStore } from '@/stores/nlFocusStore';
import { requestPermission } from '@/services/notificationService';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Delay before the fully-completed card dismisses itself (ms) — long enough
 *  to register the "all done" state, short enough not to linger. */
const AUTO_DISMISS_MS = 4000;

// ─── Component ────────────────────────────────────────────────────────────────

export function StartGuideCard() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const eventsByDate = useEventStore((s) => s.eventsByDate);
  const spaces = useSpaceStore((s) => s.spaces);
  const { hydrated, dismissed, calendarVisited, notifGranted } = useStartGuideStore();

  // Hydrate persisted flags once on mount (card renders nothing until then,
  // so users who already dismissed it never see a flash).
  useEffect(() => {
    if (!hydrated) void useStartGuideStore.getState().hydrate();
  }, [hydrated]);

  // spaceStore is normally populated by the Spaces tab — before the user ever
  // visits it, `spaces` is just "not loaded yet", which would show the Space
  // step as incomplete for members (실측 2026-08-05: e2e Space member saw 0/3).
  // One fetch on mount resolves the ambiguity; failure keeps [] (step simply
  // stays actionable, tapping it leads to the tab which retries anyway).
  useEffect(() => {
    if (!isAuthenticated || dismissed) return;
    if (useSpaceStore.getState().spaces.length > 0) return;
    let cancelled = false;
    getMySpaces()
      .then((list) => {
        if (!cancelled && list.length > 0) useSpaceStore.getState().setSpaces(list);
      })
      .catch(() => { /* leave [] — see note above */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, dismissed]);

  // ── Step completion (derived from real data where possible) ─────────────
  const hasEvent = useMemo(
    () => Object.values(eventsByDate).some((list) => list.length > 0),
    [eventsByDate],
  );
  const hasSpace = spaces.length > 0;
  const showNotifStep = Platform.OS !== 'web';

  interface Step {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    done: boolean;
    onPress: () => void;
  }

  const steps: Step[] = useMemo(() => {
    const list: Step[] = [
      {
        key: 'event',
        icon: 'chatbubble-ellipses',
        done: hasEvent,
        // Focus the real NL input bar — the user creates an actual event.
        onPress: () => useNLFocusStore.getState().requestFocus(),
      },
      {
        key: 'calendar',
        icon: 'calendar',
        done: calendarVisited,
        onPress: () => {
          useStartGuideStore.getState().markCalendarVisited();
          router.push('/(tabs)/calendar');
        },
      },
      {
        key: 'space',
        icon: 'people',
        done: hasSpace,
        onPress: () => router.push('/(tabs)/spaces'),
      },
    ];
    if (showNotifStep) {
      list.push({
        key: 'notif',
        icon: 'notifications',
        done: notifGranted,
        onPress: () => {
          void requestPermission().then((granted) => {
            if (granted) useStartGuideStore.getState().markNotifGranted();
          });
        },
      });
    }
    return list;
  }, [hasEvent, calendarVisited, hasSpace, notifGranted, showNotifStep]);

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // ── Auto-dismiss after full completion ──────────────────────────────────
  // Timer ref so an unmount (tab switch) cancels the pending dismiss cleanly.
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (allDone && !dismissed) {
      dismissTimer.current = setTimeout(() => {
        useStartGuideStore.getState().dismiss();
      }, AUTO_DISMISS_MS);
    }
    return () => {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
    };
  }, [allDone, dismissed]);

  // ── Visibility gate ──────────────────────────────────────────────────────
  if (!isAuthenticated || !hydrated || dismissed) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.card} testID="start-guide-card">

      {/* Header: title + progress + close */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {allDone ? t('startGuide.title_done') : t('startGuide.title')}
        </Text>
        <View style={styles.headerRight}>
          <Text style={styles.progress}>{doneCount}/{steps.length}</Text>
          <TouchableOpacity
            onPress={() => useStartGuideStore.getState().dismiss()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('startGuide.a11y_dismiss')}
            testID="start-guide-dismiss"
          >
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Steps */}
      {steps.map((step) => (
        <TouchableOpacity
          key={step.key}
          style={styles.stepRow}
          onPress={step.onPress}
          disabled={step.done}
          accessibilityRole="button"
          accessibilityState={{ checked: step.done }}
          accessibilityLabel={t(`startGuide.step_${step.key}`)}
          testID={`start-guide-step-${step.key}`}
        >
          {/* Check state */}
          <Ionicons
            name={step.done ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={step.done ? colors.primary : colors.border}
          />
          {/* Step icon + label */}
          <Ionicons
            name={step.icon}
            size={16}
            color={step.done ? colors.textTertiary : colors.textSecondary}
            style={styles.stepIcon}
          />
          <Text style={[styles.stepText, step.done && styles.stepTextDone]} numberOfLines={1}>
            {t(`startGuide.step_${step.key}`)}
          </Text>
          {!step.done && (
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      marginHorizontal: spacing[4],
      marginBottom: spacing[3],
      gap: spacing[1],
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing[2],
    },
    title: {
      ...textStyles.body,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    progress: {
      ...textStyles.bodySm,
      color: colors.primary,
      fontWeight: '600',
    },

    // Step rows
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing[2],
      gap: spacing[2],
    },
    stepIcon: {
      marginLeft: spacing[1],
    },
    stepText: {
      ...textStyles.bodySm,
      color: colors.textPrimary,
      flex: 1,
    },
    stepTextDone: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
  });
}
