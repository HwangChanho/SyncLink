/**
 * D-Day 등록 화면.
 *
 * 왜 별도 화면인가: 일반 일정 폼은 시작·종료·반복·카테고리까지 다 물어보는데,
 * D-Day 에 필요한 건 **제목과 목표 날짜 둘뿐**이다. 같은 폼을 쓰면 쓸데없는 입력을
 * 지나가야 한다. 2026-09-02 LEAD 지시로 등록 경로를 종류별로 쪼갰다.
 *
 * 🔑 저장 구조는 상대일 일정과 **같은 컬럼을 쓴다**(마이그레이션 불필요):
 *   base_date   = 오늘
 *   offset_days = 목표일 - 오늘
 *   start_at    = 목표일 (all_day)
 * `DDayBadge` 가 `baseDate` 가 있을 때만 뜨므로, 이렇게 저장해야 홈·캘린더에
 * "D-94" 배지가 그대로 나온다. 상대일과 다른 건 **입력 방향**뿐이다 —
 * 상대일은 기준일+간격으로 목표일을 구하고, D-Day 는 목표일에서 남은 날을 본다.
 *
 * 알림: 기존 `event_reminders` 를 그대로 쓴다. 분 단위 컬럼이라 일수를 분으로
 * 환산해 넣는다(하루 전 = 1440). DB 에 체크 제약이 없어 그대로 들어간다.
 *
 * 🔴 트리거 시각은 목표일 자정에서 빼면 안 된다. 종일 일정이라 start_at 이 자정
 *    이어서, "하루 전"(1440분)이 곧 **전날 0시**가 된다 — 자는 시간에 울린다.
 *    그래서 트리거 계산만 `NOTIFY_HOUR` 를 기준으로 한다. 저장되는
 *    `minutes_before` 는 1440 그대로라 알림 문구("1일 전 알림")도 어긋나지 않는다.
 */

import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createEvent } from '@/services/eventService';
import { updateReminders } from '@/services/reminderService';
import { useEventStore } from '@/stores/eventStore';
import { useColors } from '@/hooks/useColors';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { SimpleToast, useSimpleToast } from '@/components/common/SimpleToast';
import { showAlert } from '@/lib/webAlert';
import { logError } from '@/lib/errorLogger';
import { dDayBadge } from '@/lib/relativeDate';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── 알림 프리셋 ──────────────────────────────────────────────────────────────

/**
 * D-Day 알림 선택지. 분으로 환산해 `event_reminders.minutes_before` 에 넣는다.
 *
 * 🔴 "당일"은 넣지 않았다. 스케줄러가 음수 오프셋을 다루는지 확인되지 않았다 —
 *    검증 없이 넣지 않는다.
 *    (처음엔 "당일 = 자정에 울려서 방해"라고만 적었는데, 기준이 자정인 이상
 *     1440·4320·10080 도 똑같이 자정이었다. 그래서 `NOTIFY_HOUR` 를 도입했다.)
 */
const DDAY_REMINDERS: { days: number; minutes: number; label: string }[] = [
  { days: 1, minutes: 1440,  label: '하루 전' },
  { days: 3, minutes: 4320,  label: '3일 전' },
  { days: 7, minutes: 10080, label: '일주일 전' },
];

/**
 * 알림이 울릴 로컬 시각(24시간제). 목표일의 이 시각을 기준으로 `minutes_before`
 * 를 빼기 때문에, "하루 전"은 전날 09:00 · "일주일 전"은 7일 전 09:00 이 된다.
 *
 * 🔑 이 값은 **트리거 계산에만** 쓴다. 일정 자체(`start_at`)는 종일이라 자정에
 *    그대로 저장되고, D-Day 배지 계산도 날짜 단위라 영향을 받지 않는다.
 */
const NOTIFY_HOUR = 9;

/** 자정으로 정규화 — D-Day 계산은 시각이 아니라 날짜 단위다. */
function atMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * 알림 트리거 계산의 기준이 되는 시각 — 해당 날짜의 `NOTIFY_HOUR` 시 정각.
 *
 * @param d - 목표일(시각은 무시하고 날짜만 쓴다)
 * @returns 같은 날 오전 9시의 Date
 *
 * 주의: 반환값을 일정 저장에 쓰면 안 된다. `start_at` 은 종일 일정이라
 * 자정이어야 하고, 이 값은 `updateReminders` 에만 넘긴다.
 */
function atNotifyHour(d: Date): Date {
  const x = atMidnight(d);
  x.setHours(NOTIFY_HOUR, 0, 0, 0);
  return x;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateDDayScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { upsertEvent } = useEventStore();
  const { toast, showToast } = useSimpleToast();

  const [title, setTitle] = useState('');
  // 기본값은 일주일 뒤 — D-Day 는 보통 앞날을 잡는다. 오늘로 두면 대부분 고쳐야 한다.
  const [target, setTarget] = useState(() => {
    const d = atMidnight(new Date());
    d.setDate(d.getDate() + 7);
    return d;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reminders, setReminders] = useState<number[]>([1440]); // 기본 '하루 전'
  const [isSaving, setIsSaving] = useState(false);

  const toggleReminder = (minutes: number) => {
    setReminders((prev) =>
      prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes],
    );
  };

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      showAlert('제목을 입력해 주세요', 'D-Day 이름이 있어야 저장할 수 있어요.');
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      const today = atMidnight(new Date());
      const targetDay = atMidnight(target);
      // 하루를 86400000ms 로 나눈다. DST 가 있는 지역에서도 자정 정규화 + round 면
      // 하루가 밀리지 않는다.
      const offsetDays = Math.round((targetDay.getTime() - today.getTime()) / 86_400_000);

      const created = await createEvent({
        title: trimmed,
        startAt: targetDay,
        // 종일 일정이라 종료도 같은 날. 캘린더가 하루 칸을 차지하게 된다.
        endAt: targetDay,
        allDay: true,
        // 🔑 상대일과 같은 저장 구조 — DDayBadge 가 이 값으로 배지를 그린다.
        baseDate: today,
        offsetDays,
      });

      upsertEvent({
        id: created.id,
        title: created.title,
        startAt: created.startAt,
        endAt: created.endAt,
        allDay: created.allDay,
        color: created.color ?? colors.primary,
        isOwn: true,
      });

      // 알림은 일정이 만들어진 뒤에 붙인다. 실패해도 일정 자체는 남아야 하므로
      // 여기서 throw 하지 않고 알린다.
      if (reminders.length > 0) {
        try {
          // 🔴 targetDay(자정)를 넘기면 "하루 전"이 전날 0시가 된다 → 오전 9시 기준.
          await updateReminders(created.id, reminders, trimmed, atNotifyHour(targetDay));
        } catch (err) {
          void logError({ context: 'event.dday.reminders', error: err });
          showToast('일정은 저장됐지만 알림 설정에 실패했어요');
        }
      }

      showToast('D-Day를 등록했어요');
      router.back();
    } catch (err) {
      void logError({ context: 'event.dday.create', error: err });
      showAlert('저장 실패', err instanceof Error ? err.message : '다시 시도해 주세요.');
      setIsSaving(false);
    }
  }, [title, target, reminders, isSaving, upsertEvent, colors.primary, router, showToast]);

  const dday = dDayBadge(target);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerCancel}>취소</Text>
        </Pressable>
        <Text style={styles.headerTitle}>D-Day</Text>
        <Pressable style={styles.headerButton} onPress={() => void handleSave()} disabled={isSaving}>
          {isSaving
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text style={styles.headerSave}>저장</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* 제목 */}
        <TextInput
          testID="dday-title-input"
          style={styles.titleInput}
          placeholder="무엇을 기다리나요?"
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          autoFocus
          returnKeyType="done"
        />

        {/* 목표 날짜 + D-Day 미리보기 */}
        <View style={styles.card}>
          <Text style={styles.label}>목표 날짜</Text>
          {Platform.OS === 'web' ? (
            // 웹은 네이티브 피커가 없다 — 브라우저 date input 을 쓴다.
            <input
              type="date"
              value={`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`}
              onChange={(e) => {
                const [y, m, d] = (e.target as HTMLInputElement).value.split('-').map(Number);
                if (y && m && d) setTarget(atMidnight(new Date(y, m - 1, d)));
              }}
              style={{
                fontSize: 16, padding: 8, borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surface, color: colors.textPrimary,
              }}
            />
          ) : (
            <Pressable style={styles.dateButton} onPress={() => setPickerOpen(true)} testID="dday-date-button">
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.dateText}>
                {`${target.getFullYear()}. ${target.getMonth() + 1}. ${target.getDate()}.`}
              </Text>
            </Pressable>
          )}

          {/* 지금 고른 날짜가 며칠 남았는지 즉시 보여준다 — 저장 전에 확인하라고. */}
          <View style={styles.ddayPreview}>
            <Text style={styles.ddayText}>{dday}</Text>
          </View>
        </View>

        {/* 알림 */}
        <View style={styles.card}>
          <Text style={styles.label}>알림</Text>
          <Text style={styles.hint}>선택한 시점에 푸시 알림을 보내드려요.</Text>
          <View style={styles.chipRow}>
            {DDAY_REMINDERS.map((r) => {
              const on = reminders.includes(r.minutes);
              return (
                <Pressable
                  key={r.minutes}
                  testID={`dday-reminder-${r.days}`}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => toggleReminder(r.minutes)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {Platform.OS !== 'web' && pickerOpen && (
        <DateTimeModal
          visible={pickerOpen}
          initialValue={target}
          allDay
          onCancel={() => setPickerOpen(false)}
          onConfirm={(d: Date) => { setTarget(atMidnight(d)); setPickerOpen(false); }}
        />
      )}

      {toast && <SimpleToast toast={toast} />}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.backgroundAlt },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      // 모달로 뜨는 화면이라 상태바 바로 아래에 붙는다. iOS 네비게이션 바 표준이
      // 44pt 인데 그보다 얇아 눌려 보였다(2026-09-03 LEAD 지적) → 표준에 맞춘다.
      paddingTop: spacing[4],
      paddingBottom: spacing[4],
      minHeight: 56,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    headerButton: { minWidth: 52, alignItems: 'center' },
    headerTitle: { ...textStyles.labelLg, color: colors.textPrimary, fontWeight: '700' },
    headerCancel: { ...textStyles.label, color: colors.textSecondary },
    headerSave: { ...textStyles.label, color: colors.primary, fontWeight: '700' },

    body: { padding: spacing[4], gap: spacing[4] },
    titleInput: {
      ...textStyles.h4,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      padding: spacing[4], gap: spacing[2],
    },
    label: { ...textStyles.label, color: colors.textSecondary },
    hint: { ...textStyles.caption, color: colors.textTertiary },
    dateButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing[2],
      paddingVertical: spacing[2],
    },
    dateText: { ...textStyles.labelLg, color: colors.textPrimary },
    ddayPreview: { alignItems: 'center', paddingVertical: spacing[3] },
    ddayText: { ...textStyles.h2, color: colors.primary, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] },
    chip: {
      paddingHorizontal: spacing[3], paddingVertical: spacing[2],
      borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.background,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...textStyles.caption, color: colors.textSecondary },
    chipTextOn: { color: colors.textInverse, fontWeight: '600' },
  });
}
