/**
 * MoreOptionsSection — 일정 폼의 "더보기" 접이식 묶음.
 *
 * 2026-08-28 UX 단순화(docs/plans/2026-08-28-ux-simplification.md).
 * 일정 하나를 만드는 화면이 1,758줄이었고, 원격 DB 실측 기준 거의 안 쓰이는
 * 필드가 상시 노출돼 있었다(전체 일정 223건 중 장소 1건=0.4%, 반복 3건=1.3%).
 * 운동/러닝 입력은 전체 계정 통틀어 1명만 쓰는데 그 종류 토글이 제목보다도
 * 위에 있었다.
 *
 * 🔴 필드를 하나도 없애지 않는다 — 접었을 뿐이고, 펼치면 전부 그대로다.
 * 되돌리려면 `MORE_OPTIONS_DEFAULT_OPEN` 을 true 로 두면 된다.
 *
 * 편집 화면(event/edit)에는 아직 적용하지 않았다. 이미 값이 들어있는 필드를
 * 접으면 "내가 넣은 값이 사라졌다"로 읽힐 수 있어 판단이 따로 필요하다.
 */

import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** 처음부터 펼쳐둘지 여부. **단순화의 롤백 지점**이다. */
export const MORE_OPTIONS_DEFAULT_OPEN = false;

type Props = {
  /** 접히는 필드들. */
  children: ReactNode;
  /** 토글 라벨. */
  label: string;
};

export function MoreOptionsSection({ children, label }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [open, setOpen] = useState(MORE_OPTIONS_DEFAULT_OPEN);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.toggle}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="event-form-more-toggle"
      >
        <Text style={styles.toggleText}>{label}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.primary}
        />
      </Pressable>

      {/*
        접힘일 때 마운트하지 않는다. 여기 들어가는 자식 중에는 마운트 시 권한을
        묻거나(장소=GPS) 네트워크를 타는 것이 있어, 보이지도 않는 필드가 그런
        일을 벌이면 안 된다. 입력값은 부모(useEventForm)가 들고 있으므로
        접었다 펴도 사용자가 넣은 값은 유지된다.
      */}
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      marginTop: spacing[2],
    },
    toggle: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             spacing[1],
      paddingVertical: spacing[3],
      borderRadius:    radius.md,
      borderWidth:     1,
      borderColor:     colors.border,
      backgroundColor: colors.surface,
    },
    toggleText: {
      ...textStyles.label,
      color: colors.primary,
    },
    body: {
      marginTop: spacing[2],
    },
  });
}
