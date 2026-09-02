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
 * 🔴 "당일"은 넣지 않았다. D-Day 는 종일 일정이라 시작 시각이 자정이고,
 *    minutes_before=0 이면 **자정에 알림이 울린다**. 그건 도움이 아니라 방해다.
 *    당일 아침 알림을 하려면 음수 오프셋이 필요한데 스케줄러가 그걸 다루는지
 *    확인되지 않았다 — 검증 없이 넣지 않는다.
 */
const DDAY_REMINDERS: { days: number; minutes: number; label: string }[] = [
  { days: 1, minutes: 1440,  label: '하루 전' },
  { days: 3, minutes: 4320,  label: '3일 전' },
  { days: 7, minutes: 10080, label: '일주일 전' },
];

/** 자정으로 정규화 — D-Day 계산은 시각이 아니라 날짜 단위다. */
function atMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
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
          await updateReminders(created.id, reminders, trimmed, targetDay);
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
      paddingHorizontal: spacing[4], paddingVertical: spacing[3],
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
