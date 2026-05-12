/**
 * BlockingOverlay — 전역 fullscreen 인디케이터 + 입력 차단.
 *
 * Build-98 — 중요 비동기 작업 (Space 탈퇴, 회원 탈퇴, 일정 삭제 등) 동안
 * 노출. 사용자가 다른 버튼 누르거나 탭 전환 못 하게 모든 영역 덮음.
 *
 * blockingStore 의 visible/message 를 구독 — runBlocking() helper 가 자동
 * 으로 show/hide 처리. _layout root 에 한 번만 마운트.
 */

import { View, Text, ActivityIndicator, StyleSheet, Pressable, Platform } from 'react-native';
import { useBlockingStore } from '@/stores/blockingStore';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export function BlockingOverlay() {
  const visible = useBlockingStore(s => s.visible);
  const message = useBlockingStore(s => s.message);
  const colors  = useColors();

  if (!visible) return null;

  return (
    // Pressable 로 모든 터치 흡수 — 뒤 영역의 버튼/탭이 발화 안 됨.
    <Pressable
      style={[styles.backdrop, Platform.OS === 'web' ? styles.webBackdrop : null]}
      // Tap 이 backdrop 자신을 흡수. 반응 없음 = 입력 차단 의도.
      onPress={() => undefined}
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.message, { color: colors.textPrimary }]}>{message}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position:        'absolute',
    top:             0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'center',
    alignItems:      'center',
    zIndex:          9999,
    elevation:       9999,
  },
  webBackdrop: {
    // RNW: position:absolute 의 top/bottom 100% 보장
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    height: '100%' as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    width:  '100%' as any,
  },
  card: {
    paddingVertical:   spacing[6],
    paddingHorizontal: spacing[8],
    borderRadius:      radius.xl,
    minWidth:          200,
    alignItems:        'center',
    gap:               spacing[3],
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.2,
    shadowRadius:      12,
    elevation:         8,
  },
  message: {
    ...textStyles.body,
  },
});
