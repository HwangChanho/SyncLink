/**
 * Notification settings screen.
 *
 * Displays toggles for user-facing notification preferences:
 *  - 일정 리마인더 (event_reminder): receive reminder 30 min before events
 *  - Space 활동 알림 (space_activity): push when a Space member changes an event
 *  - 공유 일정 알림 (event_share): push when an event is shared to your Space
 *
 * Settings are persisted to users.notification_preferences JSONB
 * via authService.updateNotificationPreferences().
 *
 * Route: /settings/notifications
 * Entry: My 탭 → 설정 → 알림 설정
 *
 * TASK-501 (Sprint 5)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { light as colors } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  updateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';

// ─── Toggle row config ────────────────────────────────────────────────────────

interface ToggleConfig {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}

const TOGGLES: ToggleConfig[] = [
  {
    key:         'event_reminder',
    label:       '일정 리마인더',
    description: '일정 30분 전에 알림을 받습니다.',
  },
  {
    key:         'space_activity',
    label:       'Space 활동 알림',
    description: 'Space 멤버가 공유 일정을 추가하거나 수정할 때 알림을 받습니다.',
  },
  {
    key:         'event_share',
    label:       '공유 일정 알림',
    description: '내 Space에 새 일정이 공유될 때 알림을 받습니다.',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsSettingsScreen() {
  const { user, setUser } = useAuthStore();

  // Read initial preferences from user profile (fall back to defaults)
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => ({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(user as (typeof user & { notification_preferences?: NotificationPreferences }) | null)
      ?.notification_preferences,
  }));

  /** True while saving a preference change to the server. */
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);

  // Keep local state in sync if user profile is updated externally
  useEffect(() => {
    const userWithPrefs = user as (typeof user & {
      notification_preferences?: NotificationPreferences;
    }) | null;
    if (userWithPrefs?.notification_preferences) {
      setPrefs(prev => ({
        ...prev,
        ...userWithPrefs.notification_preferences,
      }));
    }
  }, [user]);

  // ── Toggle handler ────────────────────────────────────────────────────────

  /**
   * Toggle a single notification preference.
   * Optimistically updates local state, then persists to DB.
   * Reverts on failure with an error alert.
   *
   * @param key   - Which preference to toggle
   * @param value - New value (true = enabled)
   */
  const handleToggle = useCallback(async (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => {
    // Optimistic update
    const prev = prefs[key];
    setPrefs(p => ({ ...p, [key]: value }));
    setSavingKey(key);

    try {
      const updated = await updateNotificationPreferences({ [key]: value });
      setUser(updated);
    } catch (err) {
      // Revert optimistic change
      setPrefs(p => ({ ...p, [key]: prev }));
      Alert.alert('오류', err instanceof Error ? err.message : '설정 저장에 실패했습니다.');
    } finally {
      setSavingKey(null);
    }
  }, [prefs, setUser]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Section header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>알림 설정</Text>
          <Text style={styles.sectionSubtitle}>
            받고 싶은 알림 유형을 선택하세요.
          </Text>
        </View>

        {/* Toggle card */}
        <View style={styles.card}>
          {TOGGLES.map((toggle, index) => (
            <View key={toggle.key}>
              {/* Separator between items */}
              {index > 0 && <View style={styles.separator} />}

              <View style={styles.toggleRow}>
                {/* Label + description */}
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>{toggle.label}</Text>
                  <Text style={styles.toggleDescription}>{toggle.description}</Text>
                </View>

                {/* Switch / loading indicator */}
                {savingKey === toggle.key ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Switch
                    value={prefs[toggle.key]}
                    onValueChange={v => { void handleToggle(toggle.key, v); }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.surface}
                    ios_backgroundColor={colors.border}
                    disabled={savingKey !== null}
                  />
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Info note */}
        <Text style={styles.note}>
          알림을 받으려면 기기의 알림 권한이 허용되어 있어야 합니다.
          설정 앱에서 SyncDay의 알림을 허용해 주세요.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex:            1,
    backgroundColor: colors.backgroundAlt,
  },
  content: {
    padding: spacing[4],
    gap:     spacing[4],
  },

  // ── Section header ───────────────────────────────────────────────────────
  sectionHeader: {
    gap: spacing[1],
    paddingBottom: spacing[2],
  },
  sectionTitle: {
    ...textStyles.h3,
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
  },

  // ── Toggle card ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.xl,
    borderWidth:     1,
    borderColor:     colors.border,
    overflow:        'hidden',
  },
  separator: {
    height:          1,
    backgroundColor: colors.border,
    marginHorizontal: spacing[4],
  },
  toggleRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[4],
    gap:            spacing[3],
  },
  toggleInfo: {
    flex: 1,
    gap:  spacing[0.5],
  },
  toggleLabel: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  toggleDescription: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },

  // ── Note ─────────────────────────────────────────────────────────────────
  note: {
    ...textStyles.caption,
    color:     colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing[2],
  },
});
