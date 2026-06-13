/**
 * SelectedDayPanel — 데스크탑 캘린더 월뷰 우측의 "선택일 일정" 패널 (웹 반응형 S3).
 *
 * 데스크탑(웹)은 가로 공간이 넓어 월 그리드 옆에 선택한 날짜의 일정을 동시에
 * 보여주는 master-detail 레이아웃이 가능하다. 이 패널이 그 우측 영역을 담당한다.
 * 모바일/네이티브에는 렌더되지 않는다(CalendarScreen 이 isDesktop 으로 분기).
 *
 * 디자인은 홈의 TodayEventList row(컬러바 + 제목 + 시간 + 공유배지)와 톤을 맞춰
 * 앱 전반의 일정 표현을 일관되게 유지한다.
 */
import { View, Text, ScrollView, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { DDayBadge } from '@/components/event/DDayBadge';
import type { EventSummary } from '@/types';

interface Props {
  /** 현재 선택된 날짜(월뷰에서 탭한 셀). */
  selectedDate: Date;
  /** 선택일의 일정 목록(부모가 sourceFilteredEvents[dateKey] 로 전달). */
  events: EventSummary[];
  /** 일정 행 탭 → 상세 화면. */
  onEventPress: (event: EventSummary) => void;
  /** 헤더 + 버튼 / 빈 상태 탭 → 해당 날짜로 일정 생성. */
  onCreatePress: () => void;
}

/** "HH:MM" 24h 포맷 — 홈 TodayEventList 와 동일 규칙으로 일관성 유지. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * 선택일 일정 패널. 부모(CalendarScreen)가 데스크탑 + 월뷰일 때만 마운트한다.
 */
export function SelectedDayPanel({ selectedDate, events, onEventPress, onCreatePress }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // 시간순 정렬(원본 배열 불변 유지).
  const sorted = [...events].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // 날짜 헤더 — 활성 로케일 기반 포맷이라 별도 i18n 키가 필요 없다.
  const dateLabel = selectedDate.toLocaleDateString(i18n.language, {
    month: 'long', day: 'numeric', weekday: 'long',
  });

  return (
    <View style={styles.panel}>
      {/* 헤더: 선택일 라벨 + 일정 추가 버튼 */}
      <View style={styles.header}>
        <Text style={styles.dateLabel} numberOfLines={1}>{dateLabel}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={onCreatePress}
          accessibilityLabel={t('common.a11y_create_event')}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* 일정 리스트(시간순) 또는 빈 상태 */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <Pressable style={styles.empty} onPress={onCreatePress} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={26} color={colors.textTertiary} />
            <Text style={styles.emptyText}>{t('calendar.day_empty')}</Text>
          </Pressable>
        ) : (
          sorted.map((ev) => {
            const timeLabel = ev.allDay
              ? t('time.all_day')
              : `${formatTime(ev.startAt)} – ${formatTime(ev.endAt)}`;
            return (
              <TouchableOpacity
                key={ev.id}
                style={styles.row}
                onPress={() => onEventPress(ev)}
                activeOpacity={0.7}
              >
                {/* 카테고리 색상 바 */}
                <View style={[styles.colorBar, { backgroundColor: ev.color ?? colors.primary }]} />
                <View style={styles.rowContent}>
                  <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                  <Text style={styles.eventTime}>{timeLabel}</Text>
                  {/* v1.3 — 상대일 일정이면 D-day 배지. */}
                  {ev.baseDate ? <DDayBadge target={ev.startAt} label={ev.offsetLabel ?? null} /> : null}
                </View>
                {/* 공유 받은 일정 표시(내 일정이 아닐 때) */}
                {!ev.isOwn && (
                  <View style={styles.sharedBadge}>
                    <Text style={styles.sharedBadgeText}>{t('space.shared_badge')}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    panel: {
      // 고정폭 우측 패널 — 월뷰가 좌측 남은 공간을 flex 로 차지.
      width: 320,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dateLabel: {
      ...textStyles.h4,
      color: colors.textPrimary,
      flex: 1,
    },
    addBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    list: {
      padding: spacing[4],
      gap: spacing[2],
    },
    empty: {
      paddingVertical: spacing[10],
      alignItems: 'center',
      gap: spacing[2],
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    colorBar: {
      width: 4,
      alignSelf: 'stretch',
    },
    rowContent: {
      flex: 1,
      paddingVertical: spacing[2],
      paddingLeft: spacing[3],
      paddingRight: spacing[2],
    },
    eventTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    eventTime: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: spacing[0.5],
    },
    sharedBadge: {
      backgroundColor: palette.violet100,
      borderRadius: radius.sm,
      paddingVertical: spacing[0.5],
      paddingHorizontal: spacing[1.5],
      marginRight: spacing[2],
    },
    sharedBadgeText: {
      ...textStyles.labelSm,
      color: colors.primary,
    },
  });
}
