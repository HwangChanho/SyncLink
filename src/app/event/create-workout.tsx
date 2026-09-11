/**
 * 운동 기록 등록 화면.
 *
 * 왜 별도 화면인가: 2026-08-28 UX 단순화로 일반 일정 폼의 운동 입력을 "더보기"
 * 안으로 넣었는데, 그러면서 **운동을 기록하려면 매번 더보기를 펼쳐야 했다**.
 * 실측상 운동 필드를 쓰는 사람은 적지만(전체 계정 중 1명), 쓰는 사람에게는
 * 매번 두 번 더 눌러야 하는 화면이 됐다. 등록 경로를 종류별로 쪼개면
 * **일반 일정은 짧게 두면서 운동은 곧바로** 갈 수 있다.
 * (2026-09-02 LEAD 지시)
 *
 * 간편화 장치:
 *  - 시각 기본값 = 지금. 운동은 대개 **하고 나서** 기록한다.
 *  - 제목을 비워도 된다 — 종류와 거리로 자동으로 짓는다("러닝 5km").
 *  - 색상·카테고리는 묻지 않는다. eventService 가 운동 종류별 예약 색을 강제한다.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { trackFunnel } from '@/services/funnelService';
import { Ionicons } from '@expo/vector-icons';
import { createEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import { useColors } from '@/hooks/useColors';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { BodyParts } from '@/components/event/BodyParts';
import { SimpleToast, useSimpleToast } from '@/components/common/SimpleToast';
import { showAlert } from '@/lib/webAlert';
import { logError } from '@/lib/errorLogger';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { WorkoutPartDb } from '@/types';

type Kind = 'workout' | 'running';

/** 기본 운동 시간(분). 시작~종료를 이만큼 벌려 캘린더에서 한 칸을 차지하게 한다. */
const DEFAULT_DURATION_MIN = 60;

export default function CreateWorkoutScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  // 퍼널(1.4.14) — 폼 "진입"을 센다. 저장 성공(event_created)만 세면
  // "폼까지 왔다가 포기" 와 "폼에 오지도 않음" 이 똑같이 0 으로 보인다.
  useEffect(() => { void trackFunnel('event_form_view:workout'); }, []);
  const colors = useColors();
  const styles = makeStyles(colors);
  const { upsertEvent } = useEventStore();
  const { toast, showToast } = useSimpleToast();

  const [kind, setKind] = useState<Kind>('workout');
  const [title, setTitle] = useState('');
  // 운동은 대개 끝내고 나서 기록한다 → 지금 시각이 기본.
  const [startAt, setStartAt] = useState(() => new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [parts, setParts] = useState<WorkoutPartDb[]>([]);
  const [distanceKm, setDistanceKm] = useState('');
  const [paceMin, setPaceMin] = useState('');
  const [paceSec, setPaceSec] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const togglePart = (p: WorkoutPartDb) => {
    setParts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  /** 제목을 안 적었을 때 대신 쓸 이름. 사용자가 매번 "헬스"라고 칠 이유가 없다. */
  const autoTitle = (): string => {
    if (kind === 'running') {
      const d = parseFloat(distanceKm);
      return Number.isFinite(d) && d > 0
        ? t('event.create.workout_auto_title_running', { distance: d })
        : t('event.create.workout_kind_running');
    }
    return t('event.create.workout_kind_gym');
  };

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const finalTitle = title.trim() || autoTitle();
      const endAt = new Date(startAt.getTime() + DEFAULT_DURATION_MIN * 60_000);

      // 러닝 수치는 비워둘 수 있다(그냥 뛴 기록). 값이 있을 때만 넘긴다.
      const dist = parseFloat(distanceKm);
      const pm = parseInt(paceMin, 10);
      const ps = parseInt(paceSec, 10);
      const paceSeconds = Number.isFinite(pm) ? pm * 60 + (Number.isFinite(ps) ? ps : 0) : null;

      const created = await createEvent({
        title: finalTitle,
        startAt,
        endAt,
        allDay: false,
        eventKind: kind,
        ...(kind === 'workout' ? { workoutParts: parts } : {}),
        ...(kind === 'running' && Number.isFinite(dist) ? { distanceKm: dist } : {}),
        ...(kind === 'running' && paceSeconds ? { avgPaceSeconds: paceSeconds } : {}),
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

      showToast(t('event.create.workout_saved'));
      router.back();
    } catch (err) {
      void logError({ context: 'event.workout.create', error: err });
      showAlert(t('event.create.save_failed_title'), err instanceof Error ? err.message : t('event.create.save_failed_body'));
      setIsSaving(false);
    }
    // autoTitle 은 아래 상태들만 읽으므로 의존성에 개별로 넣는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, startAt, kind, parts, distanceKm, paceMin, paceSec, isSaving, upsertEvent, colors.primary, router, showToast, t]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerCancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('event.create.workout_header')}</Text>
        <Pressable style={styles.headerButton} onPress={() => void handleSave()} disabled={isSaving}>
          {isSaving
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text style={styles.headerSave}>{t('common.save')}</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* 종류 — 이 선택에 따라 아래 입력이 통째로 바뀐다 */}
        <View style={styles.segment}>
          {(['workout', 'running'] as const).map((k) => (
            <Pressable
              key={k}
              testID={`workout-kind-${k}`}
              style={[styles.segmentItem, kind === k && styles.segmentItemOn]}
              onPress={() => setKind(k)}
            >
              <Ionicons
                name={k === 'workout' ? 'barbell-outline' : 'walk-outline'}
                size={18}
                color={kind === k ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.segmentText, kind === k && styles.segmentTextOn]}>
                {k === 'workout' ? t('event.create.workout_kind_gym') : t('event.create.workout_kind_running')}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 제목 — 비워도 된다 */}
        <TextInput
          testID="workout-title-input"
          style={styles.titleInput}
          placeholder={`${autoTitle()} (비워두면 이 이름으로 저장돼요)`}
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
        />

        {/* 시각 */}
        <View style={styles.card}>
          <Text style={styles.label}>{t('event.create.workout_time')}</Text>
          {Platform.OS === 'web' ? (
            <input
              type="datetime-local"
              value={(() => {
                const p = (n: number) => String(n).padStart(2, '0');
                return `${startAt.getFullYear()}-${p(startAt.getMonth() + 1)}-${p(startAt.getDate())}T${p(startAt.getHours())}:${p(startAt.getMinutes())}`;
              })()}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                const d = new Date(v);
                if (!Number.isNaN(d.getTime())) setStartAt(d);
              }}
              style={{
                fontSize: 16, padding: 8, borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surface, color: colors.textPrimary,
              }}
            />
          ) : (
            <Pressable style={styles.dateButton} onPress={() => setPickerOpen(true)} testID="workout-time-button">
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text style={styles.dateText}>
                {`${startAt.getMonth() + 1}월 ${startAt.getDate()}일 ${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`}
              </Text>
            </Pressable>
          )}
        </View>

        {/* 종류별 입력 */}
        {kind === 'workout' ? (
          <View style={styles.card}>
            <Text style={styles.label}>{t('event.create.workout_parts')}</Text>
            <BodyParts selected={parts} onToggle={togglePart} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>{t('event.create.workout_record')}</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('event.create.workout_distance')}</Text>
              <TextInput
                testID="workout-distance-input"
                style={styles.numInput}
                value={distanceKm}
                onChangeText={setDistanceKm}
                keyboardType="decimal-pad"
                placeholder="0.0"
                placeholderTextColor={colors.textTertiary}
              />
              <Text style={styles.unit}>km</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('event.create.workout_pace')}</Text>
              <TextInput
                style={styles.numInputSm}
                value={paceMin}
                onChangeText={setPaceMin}
                keyboardType="number-pad"
                placeholder="5"
                placeholderTextColor={colors.textTertiary}
                maxLength={2}
              />
              <Text style={styles.unit}>{t('event.create.workout_minutes')}</Text>
              <TextInput
                style={styles.numInputSm}
                value={paceSec}
                onChangeText={setPaceSec}
                keyboardType="number-pad"
                placeholder="30"
                placeholderTextColor={colors.textTertiary}
                maxLength={2}
              />
              <Text style={styles.unit}>{t('event.create.workout_sec_per_km')}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {Platform.OS !== 'web' && pickerOpen && (
        <DateTimeModal
          visible={pickerOpen}
          initialValue={startAt}
          allDay={false}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(d: Date) => { setStartAt(d); setPickerOpen(false); }}
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
    segment: {
      flexDirection: 'row', gap: spacing[2],
      backgroundColor: colors.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border, padding: spacing[1],
    },
    segmentItem: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: spacing[2], paddingVertical: spacing[3], borderRadius: radius.md,
    },
    segmentItemOn: { backgroundColor: colors.primary },
    segmentText: { ...textStyles.label, color: colors.textSecondary },
    segmentTextOn: { color: colors.textInverse, fontWeight: '700' },

    titleInput: {
      ...textStyles.labelLg,
      color: colors.textPrimary, backgroundColor: colors.surface,
      borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: colors.border,
      padding: spacing[4], gap: spacing[2],
    },
    label: { ...textStyles.label, color: colors.textSecondary },
    dateButton: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
    dateText: { ...textStyles.labelLg, color: colors.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1] },
    rowLabel: { ...textStyles.body, color: colors.textSecondary, minWidth: 76 },
    numInput: {
      ...textStyles.body, color: colors.textPrimary,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      minWidth: 72, paddingVertical: spacing[1], textAlign: 'right',
    },
    numInputSm: {
      ...textStyles.body, color: colors.textPrimary,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      minWidth: 40, paddingVertical: spacing[1], textAlign: 'right',
    },
    unit: { ...textStyles.caption, color: colors.textSecondary },
  });
}
