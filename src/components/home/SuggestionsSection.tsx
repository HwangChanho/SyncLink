/**
 * SuggestionsSection — 홈의 "오늘의 제안" 접이식 묶음.
 *
 * 2026-08-28 UX 단순화(docs/plans/2026-08-28-ux-simplification.md).
 * 홈에 카드가 12개까지 쌓여 **정작 앱을 여는 이유인 "오늘 일정"이 9번째**에
 * 밀려 있었다. AI·부가 카드들을 이 한 덩어리로 묶어 기본 접힘으로 두고,
 * 오늘/다음 일정을 최상단으로 올린다.
 *
 * 🔴 카드를 지우는 게 아니다 — 펼치면 이전과 똑같이 전부 있다.
 * 되돌리려면 아래 `SUGGESTIONS_DEFAULT_OPEN` 을 true 로 바꾸면 접힘 이전 동작이
 * 되고, 이 컴포넌트를 통째로 걷어내면 완전히 원래대로다.
 *
 * 접힘 상태를 저장소에 남기지 않는 이유: 최악의 손해가 "한 번 더 펼치기"라
 * AsyncStorage 왕복 비용을 치를 이유가 없다(useAdGate·storeReviewService 와 같은 판단).
 */

import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/**
 * 첫 진입 시 펼쳐둘지 여부. **단순화의 롤백 지점**이다.
 * true 로 두면 2026-08-28 이전처럼 모든 카드가 처음부터 보인다.
 */
export const SUGGESTIONS_DEFAULT_OPEN = false;

type Props = {
  /** 접었다 펼 카드들. 접힘 상태에서는 마운트되지 않는다. */
  children: ReactNode;
  /** 헤더에 표시할 제목. */
  title: string;
};

export function SuggestionsSection({ children, title }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [open, setOpen] = useState(SUGGESTIONS_DEFAULT_OPEN);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="home-suggestions-toggle"
      >
        <Text style={styles.title}>{title}</Text>
        {/* 방향만으로 상태를 읽을 수 있게 — 접힘=아래(펼 수 있다), 펼침=위(접을 수 있다) */}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
        />
      </Pressable>

      {/*
        접힘일 때 children 을 렌더하지 않는 것은 의도적이다. 홈의 AI 카드들은
        마운트 시점에 스스로 Edge Function 을 호출한다(usage_metrics 기준
        suggest-date 89회·weekly-review 53회가 전부 자동 트리거였다).
        숨기기만 하고 마운트하면 보이지도 않는 카드 때문에 AI 비용이 계속 나간다.
      */}
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      marginHorizontal: spacing[4],
      marginBottom:     spacing[4],
      backgroundColor:  colors.surface,
      borderRadius:     radius.md,
      borderWidth:      1,
      borderColor:      colors.border,
      overflow:         'hidden',
    },
    header: {
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[3],
    },
    title: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    body: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop:     spacing[3],
    },
  });
}
