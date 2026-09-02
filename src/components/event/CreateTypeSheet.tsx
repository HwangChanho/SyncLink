/**
 * CreateTypeSheet — + 버튼을 눌렀을 때 뜨는 "무엇을 등록할까요" 시트.
 *
 * 2026-09-02 LEAD 지시. 종전에는 + 를 누르면 곧장 일반 일정 폼이 떴고, 운동·
 * 상대일은 그 안에서 찾아야 했다(8-28 단순화 이후로는 "더보기" 안이라 더 깊었다).
 * 등록 종류를 먼저 고르면 **각 화면이 자기 입력만 물어보므로 단계가 짧아진다.**
 *
 * 설계 원칙: 여기서 고르는 건 **입력 방식**이지 데이터 종류가 아니다.
 * 넷 다 결국 events 한 테이블에 저장되고, 캘린더에서 함께 보인다.
 */

import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** 시트에서 고를 수 있는 등록 방식. */
export type CreateType = 'event' | 'workout' | 'dday' | 'relative';

type Item = {
  type: CreateType;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
};

/**
 * 순서는 **쓰는 빈도** 순이다. 일반 일정이 압도적으로 많고(실측 223건 중 대부분),
 * 나머지는 목적이 뚜렷할 때만 고른다.
 */
const ITEMS: Item[] = [
  { type: 'event',    icon: 'calendar-outline', title: '일정',      desc: '약속·회의처럼 시간이 정해진 일' },
  { type: 'workout',  icon: 'barbell-outline',  title: '운동 기록', desc: '헬스 부위, 러닝 거리·페이스' },
  { type: 'dday',     icon: 'flag-outline',     title: 'D-Day',     desc: '목표 날짜까지 남은 날 + 알림' },
  { type: 'relative', icon: 'git-compare-outline', title: '상대일 일정', desc: '기준일에서 N일 뒤' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  /** 항목을 고르면 부모가 라우팅한다 — 시트는 화면 이동을 모른다. */
  onSelect: (type: CreateType) => void;
};

export function CreateTypeSheet({ visible, onClose, onSelect }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 바깥을 누르면 닫힌다 — 시트에서 흔히 기대하는 동작 */}
      <Pressable style={styles.backdrop} onPress={onClose} testID="create-type-backdrop">
        {/* 시트 본체에서의 탭이 backdrop 으로 새지 않게 빈 onPress 로 막는다 */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.heading}>무엇을 등록할까요?</Text>

          {ITEMS.map((item) => (
            <Pressable
              key={item.type}
              testID={`create-type-${item.type}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => onSelect(item.type)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.texts}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.desc}>{item.desc}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
      paddingBottom: spacing[8],
      gap: spacing[1],
    },
    grabber: {
      alignSelf: 'center',
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing[3],
    },
    heading: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
      marginBottom: spacing[2],
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing[3],
      paddingVertical: spacing[3],
    },
    rowPressed: { opacity: 0.6 },
    iconWrap: {
      width: 40, height: 40, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.backgroundAlt,
    },
    texts: { flex: 1, gap: 2 },
    title: { ...textStyles.labelLg, color: colors.textPrimary },
    desc: { ...textStyles.caption, color: colors.textTertiary },
    chevron: { fontSize: 22, color: colors.textTertiary, fontWeight: '300' },
  });
}
