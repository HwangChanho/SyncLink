/**
 * BootConnectionNotice — 부팅 로딩 화면(AppSplash) 안에 띄우는 «서버 연결 안내» 카드. (2026-11-27)
 *
 * 언제 보이나: RootLayout 이 useBootConnectionNotice 로 판정한다.
 *   - 부팅(인증 초기화 + 프로필 조회)이 10초를 넘기거나
 *   - 프로필 조회가 «서버에 닿지 않음»(연결 실패·시간 초과·5xx)으로 끝났을 때
 * 부팅이 끝나면 로딩 화면과 함께 사라진다.
 *
 * LEAD 결정(11-27 문답): «안내 + 다시 시도» — 게스트로 떨어뜨리지 않고 다시 시도 버튼을 준다.
 *
 * @param onRetry - [다시 시도] 를 눌렀을 때 부른다(RootLayout 은 앱 전체 리로드를 넘긴다)
 *
 * ⚠️ 이 카드는 그림만 그린다 — 네트워크·스토어를 직접 읽지 않는다(판정은 훅, 동작은 서비스).
 */

import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { Text } from '@/components/common/AppText';

export function BootConnectionNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View
      style={styles.card}
      // 화면 읽기 프로그램이 로딩 화면 대신 이 안내를 바로 읽게 한다
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
      <Text style={styles.title}>{t('offline.serverTitle')}</Text>
      <Text style={styles.body}>{t('offline.serverBody')}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        // 버튼 높이 40 + 위아래 4 = 누르는 범위 48
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{t('offline.serverRetry')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 색 토큰을 받아 스타일을 만든다(다크 모드에서도 토큰만 바뀌면 그대로 맞는다).
 *
 * @param colors - useColors() 결과
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      alignItems: 'center',
      gap: spacing[2],
      paddingVertical: spacing[5],
      paddingHorizontal: spacing[4],
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    title: {
      ...textStyles.h4,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    body: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    button: {
      marginTop: spacing[2],
      minHeight: componentHeight.buttonSm,
      justifyContent: 'center',
      paddingHorizontal: spacing[6],
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonText: {
      ...textStyles.label,
      color: colors.textInverse,
    },
  });
}
