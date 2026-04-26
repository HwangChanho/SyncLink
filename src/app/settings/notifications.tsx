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
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import {
  requestWebPushPermission,
  getWebPushPermission,
  type WebPushRegistrationResult,
} from '@/hooks/useWebPush';
import { showAlert } from '@/lib/webAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsSettingsScreen() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();

  /** Toggles built from i18n to respond to locale changes. */
  const TOGGLES: ToggleConfig[] = [
    {
      key:         'event_reminder',
      label:       t('notification.event_reminder'),
      description: t('notification.event_reminder_desc'),
    },
    {
      key:         'space_activity',
      label:       t('notification.space_activity'),
      description: t('notification.space_activity_desc'),
    },
    {
      key:         'event_share',
      label:       t('notification.event_share'),
      description: t('notification.event_share_desc'),
    },
  ];

  const { user, setUser } = useAuthStore();

  // Read initial preferences from user profile (fall back to defaults)
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => ({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(user as (typeof user & { notification_preferences?: NotificationPreferences }) | null)
      ?.notification_preferences,
  }));

  /** True while saving a preference change to the server. */
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);

  // ── Web push permission state ────────────────────────────────────────────
  // On web only: track whether the browser has granted notification access.
  // Drives the "알림 활성화" CTA visibility below the toggles.
  const [webPushPerm, setWebPushPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [webPushBusy, setWebPushBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') setWebPushPerm(getWebPushPermission());
  }, []);

  /**
   * Click-to-enable handler. Browsers reject Notification.requestPermission
   * unless invoked from a real user gesture, so this MUST run on press —
   * not on mount or in an effect.
   */
  const handleEnableWebPush = useCallback(async () => {
    setWebPushBusy(true);
    try {
      const result: WebPushRegistrationResult = await requestWebPushPermission();
      setWebPushPerm(getWebPushPermission());
      // showAlert maps to window.alert on web; native Alert.alert sometimes
      // doesn't render under React Native Web.
      if (result === 'granted') {
        showAlert('알림 활성화 완료', '이제 이 브라우저로 알림을 받습니다.');
      } else if (result === 'denied') {
        showAlert(
          '알림 권한 필요',
          '브라우저에서 이 사이트의 알림이 차단되어 있어 다시 요청할 수 없습니다.\n\n' +
          '• Chrome: 주소창 왼쪽 자물쇠/정보 아이콘 → 알림 → 허용\n' +
          '• Safari: 환경설정 → 웹사이트 → 알림 → SyncLink → 허용\n' +
          '• Firefox: 주소창 왼쪽 방패 아이콘 → 사이트 권한 → 알림 → 허용',
        );
      } else if (result === 'no-user') {
        showAlert('로그인 필요', '먼저 로그인 후 다시 시도해 주세요.');
      } else if (result === 'not-configured') {
        showAlert('설정 누락', 'VAPID 공개키가 설정되지 않았습니다 (관리자 문의).');
      } else if (result === 'unsupported') {
        showAlert('미지원 브라우저', '이 브라우저는 웹 푸시를 지원하지 않습니다.');
      } else {
        showAlert('등록 실패', '알림 등록 중 오류가 발생했습니다. 브라우저 콘솔의 [webpush] 로그를 확인해 주세요.');
      }
    } finally {
      setWebPushBusy(false);
    }
  }, []);

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
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('notification.save_failed'));
    } finally {
      setSavingKey(null);
    }
  }, [prefs, setUser, t]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ── Navigation header with back button ── */}
      <View style={styles.navHeader}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>알림 설정</Text>
        {/* Spacer to keep title centered */}
        <View style={styles.backButton} />
      </View>

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

        {/*
          Web-only: explicit "알림 활성화" CTA. Browsers (especially Safari)
          reject Notification.requestPermission() unless triggered from a
          user gesture, so we can't auto-prompt on mount — the user has to
          tap this button.
        */}
        {Platform.OS === 'web' && webPushPerm !== 'unsupported' && webPushPerm !== 'granted' && (
          <TouchableOpacity
            style={styles.webPushCta}
            onPress={() => { void handleEnableWebPush(); }}
            disabled={webPushBusy}
            activeOpacity={0.85}
          >
            {webPushBusy
              ? <ActivityIndicator color={colors.textInverse} />
              : (
                <Text style={styles.webPushCtaText}>
                  {webPushPerm === 'denied' ? '브라우저에서 알림 차단됨' : '이 브라우저에 알림 활성화'}
                </Text>
              )}
          </TouchableOpacity>
        )}
        {Platform.OS === 'web' && webPushPerm === 'granted' && (
          <Text style={[styles.note, { color: colors.success ?? colors.primary }]}>
            ✓ 이 브라우저는 알림이 활성화되어 있습니다.
          </Text>
        )}

        {/* Info note */}
        <Text style={styles.note}>
          알림을 받으려면 기기의 알림 권한이 허용되어 있어야 합니다.
          설정 앱에서 SyncLink의 알림을 허용해 주세요.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  safeArea: {
    flex:            1,
    backgroundColor: colors.backgroundAlt,
  },

  // ── Navigation header ────────────────────────────────────────────────────
  navHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing[2],
    paddingVertical:   spacing[3],
    backgroundColor:   colors.backgroundAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex:  1,
    textAlign: 'center',
  },
  backButton: {
    width:  40,
    height: 40,
    alignItems:      'center',
    justifyContent:  'center',
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

  // ── Web push CTA ─────────────────────────────────────────────────────────
  webPushCta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webPushCtaText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
    fontWeight: '600',
  },
  });
}
