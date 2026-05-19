/**
 * ConflictSuggestionCard — 캘린더 일정 생성 시 충돌 대안 카드 (v1.2 Phase 3).
 *
 * 일정 등록/편집 화면에서 startAt/endAt 입력 후 같은 시간대에 다른 일정이
 * 있으면 suggest-slot Edge Fn 호출 → 대안 3개를 chip 으로 노출. 사용자가
 * chip 탭하면 시간 자동 갱신.
 *
 * 클라이언트 호출 절제:
 *   - 충돌이 명확할 때만 (1개 이상 overlap)
 *   - 디바운싱 500ms (사용자가 시간 조정하면서 자주 fire 안 되게)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

interface Slot {
  startAt: string;
  endAt: string;
  reason: string;
}

interface Props {
  /** 사용자가 입력 중인 일정 정보. */
  proposed: { title: string; startAt: Date; endAt: Date } | null;
  /** 같은 날의 다른 일정들 (overlap 검사 + Edge Fn 컨텍스트). */
  busySlots: Array<{ startAt: Date; endAt: Date }>;
  /** 사용자가 대안 선택 시 호출 — 새 startAt/endAt 으로 갱신. */
  onSelectAlternative: (startAt: Date, endAt: Date) => void;
}

export function ConflictSuggestionCard({ proposed, busySlots, onSelectAlternative }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [alternatives, setAlternatives] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);

  const hasConflict = !!proposed && busySlots.some((b) =>
    proposed.startAt < b.endAt && proposed.endAt > b.startAt,
  );

  useEffect(() => {
    if (!hasConflict || !proposed) {
      setAlternatives([]);
      return;
    }
    // Debounce 500ms — 사용자가 입력 중에 자주 fire 안 되게.
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke<{ alternatives: Slot[] }>(
          'suggest-slot',
          {
            body: {
              proposed: {
                title:   proposed.title,
                startAt: proposed.startAt.toISOString(),
                endAt:   proposed.endAt.toISOString(),
              },
              busySlots: busySlots.map((b) => ({
                startAt: b.startAt.toISOString(),
                endAt:   b.endAt.toISOString(),
              })),
              locale: 'ko',
            },
          },
        );
        if (!error && data?.alternatives) {
          setAlternatives(data.alternatives.slice(0, 3));
        }
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [hasConflict, proposed, busySlots]);

  const handlePick = useCallback((slot: Slot) => {
    onSelectAlternative(new Date(slot.startAt), new Date(slot.endAt));
  }, [onSelectAlternative]);

  if (!hasConflict) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="alert-circle" size={18} color={colors.warning} />
        <Text style={styles.title}>다른 일정과 겹쳐요</Text>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      {alternatives.length > 0 ? (
        <View style={styles.chipRow}>
          {alternatives.map((slot) => (
            <Pressable key={slot.startAt} onPress={() => handlePick(slot)} style={styles.chip}>
              <Text style={styles.chipText}>{formatChip(slot)}</Text>
            </Pressable>
          ))}
        </View>
      ) : !loading ? (
        <Text style={styles.subtle}>대안을 찾는 중…</Text>
      ) : null}
    </View>
  );
}

function formatChip(slot: Slot): string {
  const start = new Date(slot.startAt);
  const h = String(start.getHours()).padStart(2, '0');
  const m = String(start.getMinutes()).padStart(2, '0');
  return `${h}:${m} · ${slot.reason}`;
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      padding: spacing[3],
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.warning + '60',
      marginVertical: spacing[2],
      gap: spacing[2],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    title:    { ...(textStyles.body as object), color: colors.textPrimary, fontWeight: '600', flex: 1 },
    subtle:   { ...(textStyles.bodySm as object), color: colors.textTertiary },
    chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    chip: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.background,
    },
    chipText: { ...(textStyles.labelSm as object), color: colors.primary },
  });
}
