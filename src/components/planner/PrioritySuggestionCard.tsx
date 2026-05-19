/**
 * PrioritySuggestionCard — 플래너 우선순위 hint (v1.2 Phase 3).
 *
 * overdue + high priority 합쳐 "지금 하면 좋은 일" 1개 카드로 노출. AI 호출
 * 없이 클라이언트 rule baseline. 24h dismiss 지원.
 *
 * 표시 룰:
 *   1. overdue & high priority 가 있으면 최우선
 *   2. overdue 있으면 그 중 가장 오래된 것
 *   3. high priority + 오늘 마감
 *   4. 위 조건 모두 없으면 카드 안 그림
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { isDismissed, dismiss } from '@/lib/cardDismissal';
import type { Todo } from '@/types';

const CATEGORY_KEY = 'planner-priority';

interface Props {
  todos: Todo[];
}

export function PrioritySuggestionCard({ todos }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    void isDismissed(CATEGORY_KEY).then((d) => { if (d) setHidden(true); });
  }, []);

  const target = useMemo(() => pickTarget(todos), [todos]);

  const handleDismiss = useCallback(() => {
    setHidden(true);
    void dismiss(CATEGORY_KEY);
  }, []);

  const handleOpen = useCallback(() => {
    if (target) router.push(`/note/${target.id}`);
  }, [target]);

  if (hidden || !target) return null;

  const reason = pickReason(target);

  return (
    <Pressable onPress={handleOpen} style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name="flame" size={18} color={colors.warning} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{target.title}</Text>
        <Text style={styles.sub}>{reason}</Text>
      </View>
      <Pressable onPress={handleDismiss} hitSlop={12} style={styles.close}>
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </Pressable>
  );
}

function pickTarget(todos: Todo[]): Todo | null {
  const pending = todos.filter((t) => !t.isCompleted);
  if (pending.length === 0) return null;

  const todayKey = new Date().toISOString().slice(0, 10);
  const overdue = pending.filter((t) => t.dueDate && toDateKey(t.dueDate) < todayKey);
  const overdueHi = overdue.find((t) => t.priority === 'high');
  if (overdueHi) return overdueHi;
  if (overdue.length > 0) {
    return overdue.slice().sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))[0] ?? null;
  }
  const todayHi = pending.find((t) => t.priority === 'high' && t.dueDate && toDateKey(t.dueDate) === todayKey);
  return todayHi ?? null;  // eslint-disable-line @typescript-eslint/no-unnecessary-condition
}

function pickReason(todo: Todo): string {
  if (!todo.dueDate) return '우선순위가 높아요';
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueKey = toDateKey(todo.dueDate);
  if (dueKey < todayKey) return `${daysOverdue(todo.dueDate)}일 지연됨`;
  return '오늘 마감';
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysOverdue(due: Date): number {
  const now = new Date();
  const ms = now.getTime() - due.getTime();
  return Math.max(1, Math.floor(ms / 86400000));
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      padding: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: spacing[4],
      marginVertical: spacing[2],
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warning + '15',
    },
    body:  { flex: 1 },
    title: { ...(textStyles.body as object), color: colors.textPrimary, fontWeight: '600' },
    sub:   { ...(textStyles.bodySm as object), color: colors.textTertiary, marginTop: 2 },
    close: { padding: spacing[1] },
  });
}
