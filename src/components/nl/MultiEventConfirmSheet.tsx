/**
 * MultiEventConfirmSheet — 파싱된 일정이 **여러 건일 때** 리스트로 보여 주고
 * 한 번에 등록하는 시트.
 *
 * ## 왜 만들었나 (2026-09-08 LEAD 지시)
 * 종전에는 결과가 N건이어도 `ConfirmModal` 이 **한 건씩** 떴고 사용자가 N번
 * 확인을 눌러야 했다. 시간표 스크린샷 한 장에서 30건이 나오는 지금은 그게
 * 사실상 못 쓰는 흐름이다("하나씩 떠서 확인 누르는게 아니라").
 *
 * 설계:
 *  - 전부 기본 선택. 원치 않는 것만 체크를 끄면 된다(대개 다 등록하려고 올린다).
 *  - 등록은 순차 진행하고 **성공/실패를 각각 센다.** 일부 실패해도 나머지는
 *    남기고, 몇 건이 실패했는지 그대로 알려 준다.
 *  - 등록 중에는 목록을 잠그고 진행 수(3/12)를 보여 준다 — 오래 걸리는 작업에
 *    아무 표시가 없으면 사용자가 앱이 멈춘 줄 안다.
 *
 * 1건일 때는 이 시트를 쓰지 않는다 — 색·공유·반복종료일을 고를 수 있는
 * 기존 `ConfirmModal` 이 그 경우엔 더 낫다.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { NLParseResult } from '@/types';

interface Props {
  visible: boolean;
  /** 보여 줄 파싱 결과들 (2건 이상일 때만 이 시트를 띄운다). */
  results: NLParseResult[];
  /**
   * 일정 **한 건**을 등록한다. 성공하면 true.
   *
   * 🔑 전체를 넘기지 않고 건건이 부르는 이유: 시트가 직접 순회해야
   *    "3/12" 진행 표시를 실제로 올릴 수 있다. 부모에게 통째로 넘기면
   *    시트는 언제 몇 건이 끝났는지 알 수 없다.
   */
  onConfirmOne: (result: NLParseResult) => Promise<boolean>;
  /** 전부 끝난 뒤 호출 — 성공/실패 건수를 넘긴다(요약 토스트용). */
  onFinished: (summary: { ok: number; failed: number }) => void;
  onCancel: () => void;
}

/** "9월 10일 (수) 오전 9:00" 형태. 시간이 없으면 종일로 표기. */
function formatWhen(r: NLParseResult): string {
  const start = r.parsed.startAt?.value;
  if (!start) return '시간 미정';
  const d = new Date(start);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  if (r.parsed.allDay?.value) return `${base} 종일`;
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${base} ${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

export function MultiEventConfirmSheet({ visible, results, onConfirmOne, onFinished, onCancel }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  /** 체크된 항목의 인덱스. 처음엔 전부 선택. */
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(results.map((_, i) => i)),
  );
  const [saving, setSaving] = useState(false);
  /** 등록 진행 표시용 — 완료 건수. */
  const [progress, setProgress] = useState(0);

  // results 가 바뀌면(새 요청) 선택을 초기화한다.
  const resultsKey = useMemo(
    () => results.map((r) => r.parsed.title?.value ?? '').join('|'),
    [results],
  );
  const [seenKey, setSeenKey] = useState(resultsKey);
  if (seenKey !== resultsKey) {
    setSeenKey(resultsKey);
    setSelected(new Set(results.map((_, i) => i)));
    setProgress(0);
  }

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);

  const allSelected = selected.size === results.length && results.length > 0;
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(results.map((_, i) => i)));
  }, [allSelected, results]);

  const handleConfirm = useCallback(async () => {
    if (saving || selected.size === 0) return;
    setSaving(true);
    setProgress(0);
    let ok = 0;
    let failed = 0;
    try {
      const picked = results.filter((_, i) => selected.has(i));
      for (const r of picked) {
        // 한 건이 실패해도 멈추지 않는다 — 30건 중 1건 때문에 나머지를 버릴 수 없다.
        const success = await onConfirmOne(r);
        if (success) ok++; else failed++;
        setProgress((n) => n + 1);
      }
    } finally {
      setSaving(false);
      onFinished({ ok, failed });
    }
  }, [saving, selected, results, onConfirmOne, onFinished]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* ── 헤더 ── */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>일정 {results.length}건을 찾았어요</Text>
              <Text style={styles.subtitle}>등록할 일정을 확인하세요</Text>
            </View>
            <Pressable onPress={onCancel} hitSlop={12} disabled={saving} accessibilityLabel="닫기">
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* ── 전체 선택 ── */}
          <Pressable style={styles.selectAll} onPress={toggleAll} disabled={saving}>
            <Ionicons
              name={allSelected ? 'checkbox' : 'square-outline'}
              size={20}
              color={allSelected ? colors.primary : colors.textTertiary}
            />
            <Text style={styles.selectAllText}>
              전체 선택 ({selected.size}/{results.length})
            </Text>
          </Pressable>

          {/* ── 목록 ── */}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {results.map((r, i) => {
              const on = selected.has(i);
              return (
                <Pressable
                  key={`${r.parsed.title?.value ?? 'event'}-${i}`}
                  style={[styles.row, !on && styles.rowOff]}
                  onPress={() => toggle(i)}
                  disabled={saving}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? colors.primary : colors.textTertiary}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.parsed.title?.value ?? '제목 없음'}
                    </Text>
                    <Text style={styles.rowWhen} numberOfLines={1}>
                      {formatWhen(r)}
                      {r.parsed.location?.value ? ` · ${r.parsed.location.value}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* ── 하단 버튼 ── */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={saving}
            >
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                styles.confirmButton,
                (saving || selected.size === 0) && styles.confirmDisabled,
              ]}
              onPress={handleConfirm}
              disabled={saving || selected.size === 0}
            >
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={styles.confirmText}>
                    등록 중 {progress}/{selected.size}
                  </Text>
                </View>
              ) : (
                <Text style={styles.confirmText}>{selected.size}개 등록</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingBottom: spacing[6],
      // 화면을 다 덮지 않게 — 뒤 맥락이 보이면 사용자가 덜 불안하다.
      maxHeight: '85%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: spacing[4],
      paddingBottom: spacing[2],
    },
    headerText: { flex: 1 },
    title: { ...textStyles.h3, color: colors.textPrimary },
    subtitle: { ...textStyles.bodySm, color: colors.textTertiary, marginTop: 2 },
    selectAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selectAllText: { ...textStyles.label, color: colors.textSecondary },
    list: { flexGrow: 0 },
    listContent: { paddingVertical: spacing[1] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    /** 체크 해제된 항목은 흐리게 — 무엇이 빠지는지 한눈에 보이게. */
    rowOff: { opacity: 0.45 },
    rowBody: { flex: 1 },
    rowTitle: { ...textStyles.body, color: colors.textPrimary, fontWeight: '600' },
    rowWhen: { ...textStyles.bodySm, color: colors.textTertiary, marginTop: 2 },
    footer: {
      flexDirection: 'row',
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingTop: spacing[3],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    button: {
      flex: 1,
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: { backgroundColor: colors.surfaceAlt },
    cancelText: { ...textStyles.label, color: colors.textSecondary },
    confirmButton: { backgroundColor: colors.primary },
    confirmDisabled: { opacity: 0.5 },
    confirmText: { ...textStyles.label, color: colors.textInverse, fontWeight: '600' },
    savingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  });
}
