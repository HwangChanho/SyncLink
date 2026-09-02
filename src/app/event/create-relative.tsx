/**
 * 상대일 일정 등록 화면 — "기준일 + N일".
 *
 * 예: 발주일에서 3일 뒤 도착예상, 여권 발급일로부터 7일 뒤 수령.
 *
 * D-Day 화면과 **저장 구조가 같고 입력 방향만 반대**다:
 *   · 상대일 : 기준일과 간격을 안다 → 목표일을 계산한다
 *   · D-Day  : 목표일을 안다 → 남은 날을 본다 (base_date = 오늘)
 * 둘 다 base_date / offset_days / offset_label 에 저장되므로 캘린더·홈의
 * `DDayBadge` 가 동일하게 동작한다.
 *
 * 🔴 이 기능은 1.3.2 에 넣었지만 원격 DB 기준 **사용 실적이 0건**이었다.
 *    원인이 "필요 없어서"인지 "일반 폼 깊숙이 있어 못 찾아서"인지 구분할 수 없었다.
 *    등록 경로를 밖으로 꺼내는 이번 변경이 그 답을 준다 — 여전히 0이면 그때는
 *    "안 쓰는 기능"이라고 말할 근거가 생긴다. (외부 캘린더 연동이 메뉴에서 빠진 채
 *    0건이었던 전례가 있어, 0을 볼 때는 진입 경로부터 확인한다.)
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
import { useEventStore } from '@/stores/eventStore';
import { useColors } from '@/hooks/useColors';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { SimpleToast, useSimpleToast } from '@/components/common/SimpleToast';
import { showAlert } from '@/lib/webAlert';
import { logError } from '@/lib/errorLogger';
import { addDays, dDayBadge } from '@/lib/relativeDate';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

function atMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const fmt = (d: Date) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;

export default function CreateRelativeScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { upsertEvent } = useEventStore();
  const { toast, showToast } = useSimpleToast();

  const [title, setTitle] = useState('');
  const [baseDate, setBaseDate] = useState(() => atMidnight(new Date()));
  const [offsetText, setOffsetText] = useState('3');
  const [label, setLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 입력이 비었거나 이상하면 0 으로 본다 — 미리보기가 깨지지 않게.
  const offsetDays = (() => {
    const n = parseInt(offsetText, 10);
    return Number.isFinite(n) ? n : 0;
  })();
  const target = addDays(baseDate, offsetDays);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      showAlert('제목을 입력해 주세요', '무슨 일정인지 있어야 저장할 수 있어요.');
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      const targetDay = atMidnight(addDays(baseDate, offsetDays));
      const created = await createEvent({
        title: trimmed,
        startAt: targetDay,
        endAt: targetDay,
        allDay: true,
        baseDate: atMidnight(baseDate),
        offsetDays,
        ...(label.trim() ? { offsetLabel: label.trim() } : {}),
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

      showToast('상대일 일정을 등록했어요');
      router.back();
    } catch (err) {
      void logError({ context: 'event.relative.create', error: err });
      showAlert('저장 실패', err instanceof Error ? err.message : '다시 시도해 주세요.');
      setIsSaving(false);
    }
  }, [title, baseDate, offsetDays, label, isSaving, upsertEvent, colors.primary, router, showToast]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerCancel}>취소</Text>
        </Pressable>
        <Text style={styles.headerTitle}>상대일 일정</Text>
        <Pressable style={styles.headerButton} onPress={() => void handleSave()} disabled={isSaving}>
          {isSaving
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text style={styles.headerSave}>저장</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          testID="relative-title-input"
          style={styles.titleInput}
          placeholder="무슨 일정인가요? (예: 택배 도착)"
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          autoFocus
          returnKeyType="done"
        />

        {/* 기준일 */}
        <View style={styles.card}>
          <Text style={styles.label}>기준일</Text>
          <Text style={styles.hint}>발주일·발급일처럼 세기 시작하는 날이에요.</Text>
          {Platform.OS === 'web' ? (
            <input
              type="date"
              value={`${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`}
              onChange={(e) => {
                const [y, m, d] = (e.target as HTMLInputElement).value.split('-').map(Number);
                if (y && m && d) setBaseDate(atMidnight(new Date(y, m - 1, d)));
              }}
              style={{
                fontSize: 16, padding: 8, borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surface, color: colors.textPrimary,
              }}
            />
          ) : (
            <Pressable style={styles.dateButton} onPress={() => setPickerOpen(true)} testID="relative-base-button">
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.dateText}>{fmt(baseDate)}</Text>
            </Pressable>
          )}
        </View>

        {/* 간격 + 라벨 */}
        <View style={styles.card}>
          <Text style={styles.label}>며칠 뒤인가요?</Text>
          <View style={styles.row}>
            <TextInput
              testID="relative-offset-input"
              style={styles.numInput}
              value={offsetText}
              onChangeText={setOffsetText}
              keyboardType="number-pad"
              placeholder="3"
              placeholderTextColor={colors.textTertiary}
              maxLength={3}
            />
            <Text style={styles.unit}>일 뒤</Text>
          </View>

          <Text style={[styles.label, { marginTop: spacing[3] }]}>라벨 (선택)</Text>
          <TextInput
            style={styles.textInput}
            value={label}
            onChangeText={setLabel}
            placeholder="예: 도착예상"
            placeholderTextColor={colors.textTertiary}
            maxLength={20}
          />
        </View>

        {/* 계산 결과 — 저장 전에 눈으로 확인하라고 크게 보여준다 */}
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>{fmt(target)}</Text>
          <Text style={styles.previewDday}>{label.trim() ? `${label.trim()} ${dDayBadge(target)}` : dDayBadge(target)}</Text>
        </View>
      </ScrollView>

      {Platform.OS !== 'web' && pickerOpen && (
        <DateTimeModal
          visible={pickerOpen}
          initialValue={baseDate}
          allDay
          onCancel={() => setPickerOpen(false)}
          onConfirm={(d: Date) => { setBaseDate(atMidnight(d)); setPickerOpen(false); }}
        />
      )}

      {toast && <SimpleToast toast={toast} />}
    </SafeAreaView>
  );
}

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
      ...textStyles.h4, color: colors.textPrimary, backgroundColor: colors.surface,
      borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      padding: spacing[4], gap: spacing[2],
    },
    label: { ...textStyles.label, color: colors.textSecondary },
    hint: { ...textStyles.caption, color: colors.textTertiary },
    dateButton: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
    dateText: { ...textStyles.labelLg, color: colors.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    numInput: {
      ...textStyles.h4, color: colors.textPrimary,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      minWidth: 64, paddingVertical: spacing[1], textAlign: 'right',
    },
    textInput: {
      ...textStyles.body, color: colors.textPrimary,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      paddingVertical: spacing[2],
    },
    unit: { ...textStyles.body, color: colors.textSecondary },
    preview: {
      alignItems: 'center', gap: spacing[1],
      paddingVertical: spacing[5],
      backgroundColor: colors.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
    },
    previewLabel: { ...textStyles.label, color: colors.textSecondary },
    previewDday: { ...textStyles.h2, color: colors.primary, fontWeight: '700' },
  });
}
