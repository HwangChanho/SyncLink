/**
 * UpdateBanner — "앱 업데이트가 있습니다" 안내 띠(1.5.0, LEAD 지시 2026-09-23).
 *
 * OTA 새 업데이트를 내려받아 두면 화면 위쪽에 뜬다. [지금 적용] 을 누르면 바로 리로드해
 * 새 버전으로 바뀌고, [나중에] 를 누르면 이번 실행에서는 숨긴다(다음 실행 때 자동 적용).
 *
 * 🔑 자동으로 리로드하지 않고 **사용자가 누르게** 한 이유: 리로드는 화면을 처음부터 다시
 *    그리므로, 작성 중인 일정·할 일 입력이 사라질 수 있다.
 *
 * 루트 레이아웃에서 OfflineBanner 바로 아래에 그린다(같은 zIndex 계층).
 */
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { useOtaUpdatePrompt } from '@/hooks/useOtaUpdatePrompt';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { Text } from '@/components/common/AppText';

export function UpdateBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const { ready, apply, dismiss } = useOtaUpdatePrompt();

  if (!ready) return null;
  const styles = makeStyles(colors);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea} pointerEvents="box-none">
      {/* 위에서 톡 내려온다(동작 줄이기 설정은 reanimated 가 따른다) */}
      <Animated.View
        entering={FadeInUp.duration(260)}
        exiting={FadeOutUp.duration(180)}
        style={styles.card}
        accessibilityRole="alert"
        testID="ota-update-banner"
      >
        <Ionicons name="sparkles" size={18} color={colors.primary} />
        <Text style={styles.text}>{t('common.update_available')}</Text>
        <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button" testID="ota-update-later">
          <Text style={styles.later}>{t('common.update_later')}</Text>
        </Pressable>
        <Pressable
          onPress={apply}
          style={({ pressed }) => [styles.apply, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          testID="ota-update-apply"
        >
          <Text style={styles.applyText}>{t('common.update_apply')}</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: {
      // 내비게이션 위, 잠금 화면(9999) 아래 — OfflineBanner 와 같은 계층
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      paddingHorizontal: spacing[3],
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginTop: spacing[2],
      paddingVertical: spacing[2],
      paddingLeft: spacing[3],
      paddingRight: spacing[2],
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.primaryLight,
      // 떠 있는 알약 — 아래 화면과 구분되게 부드러운 그림자
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 6,
    },
    text: {
      ...textStyles.label,
      flex: 1,
      color: colors.textPrimary,
    },
    later: {
      ...textStyles.labelSm,
      color: colors.textSecondary,
      paddingHorizontal: spacing[1],
    },
    apply: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingVertical: spacing[1] + 2,
      paddingHorizontal: spacing[3],
    },
    applyText: {
      ...textStyles.labelSm,
      // 흰색 하드코딩 금지 — 다크 primary 는 흰 글자와 3.0:1 뿐이다(작은 글자 기준 4.5 미달).
      // textInverse 는 라이트=흰색(4.5+) · 다크=어두운 글자(5.3) 로 양쪽 다 기준을 넘는다.
      color: colors.textInverse,
      fontWeight: '700',
    },
  });
}
