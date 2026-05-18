/**
 * AISuggestionCard — 홈 화면 빈 시간 활동 제안 카드 (v1.2 Phase 3).
 *
 * 사용자의 다음 빈 슬롯을 탐지해 "이번 주 토요일 14:00–16:00 비어있어요.
 * 운동 어떠세요?" 같은 자연어 제안. AI 호출 X — 클라이언트 rule baseline
 * (시간대별 활동 매트릭스) 만 사용. AI 비용 0.
 *
 * 24h dismiss 지원. 사용자 X → 같은 카테고리 24h 안 보임.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { isDismissed, dismiss } from '@/lib/cardDismissal';

const CATEGORY_KEY = 'home-free-time';

interface Props {
  /** 다음 빈 슬롯 정보 (caller 가 계산해서 전달). null 이면 카드 안 그림. */
  slot: { startAt: Date; endAt: Date; suggestion: string } | null;
}

export function AISuggestionCard({ slot }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // 초기엔 보이는 상태로 시작 — useEffect 가 dismissed 체크 후 숨기는 게
  // 정상 사용자에게 flicker 없는 경로. 이전 코드는 hidden=true 로 시작해서
  // dismissed 체크 race 때문에 카드가 영구 안 보이는 케이스가 있었음.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    void isDismissed(CATEGORY_KEY).then((d) => {
      if (d) setHidden(true);
    });
  }, []);

  const handleDismiss = useCallback(() => {
    setHidden(true);
    void dismiss(CATEGORY_KEY);
  }, []);

  if (hidden || !slot) return null;

  const range = `${formatTime(slot.startAt)} – ${formatTime(slot.endAt)}`;

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name="sparkles" size={18} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{slot.suggestion}</Text>
        <Text style={styles.sub}>빈 시간: {range}</Text>
      </View>
      <Pressable onPress={handleDismiss} hitSlop={12} style={styles.close}>
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      padding: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: spacing[4],
      marginVertical: spacing[2],
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '15',
    },
    body: { flex: 1 },
    title: { ...(textStyles.body as object), color: colors.textPrimary, fontWeight: '600' },
    sub:   { ...(textStyles.bodySm as object), color: colors.textTertiary, marginTop: 2 },
    close: { padding: spacing[1] },
  });
}
