/**
 * PollCard — Space 투표 1건 표시 + 투표 인터랙션.
 *
 * 후보마다 득표 비율 막대를 깔고 그 위에 라벨/표수를 얹는다. 내가 고른 후보는
 * 테두리로 강조한다. 마감·확정·삭제는 작성자 또는 Space owner 에게만 보인다
 * (RLS 도 같은 조건이라 UI 는 안내용이고 최종 방어선은 서버).
 *
 * 계획: docs/plans/2026-08-08-space-poll.md
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { Poll, PollOption } from '@/types';

interface Props {
  poll: Poll;
  /** 현재 사용자가 이 투표를 관리할 수 있는지 (작성자 또는 Space owner). */
  canManage: boolean;
  onVote: (optionId: string) => Promise<void>;
  onDecide: (optionId: string) => Promise<void>;
  onClose: () => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * 후보 라벨. 날짜 후보면 "8월 15일 (토) 오후 2:00" 형태로, 자유항목이면 label 그대로.
 * 종료 시각이 같은 날이면 "~ 4:00" 만 덧붙인다.
 */
function optionLabel(option: PollOption, locale: string): string {
  if (!option.startsAt) return option.label ?? '';
  const d = option.startsAt;
  const date = d.toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' });
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  let text = `${date} ${time}`;
  if (option.endsAt && option.endsAt.toDateString() === d.toDateString()) {
    text += ` ~ ${option.endsAt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  }
  // 날짜 후보에 메모를 붙였다면 함께 보여준다.
  return option.label ? `${text} · ${option.label}` : text;
}

export function PollCard({ poll, canManage, onVote, onDecide, onClose, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);

  // 막대 길이 기준. 0표뿐이면 0으로 나누지 않도록 1로 둔다.
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.voteCount));

  const handleVote = async (optionId: string) => {
    if (poll.isClosed) return;
    setBusyOptionId(optionId);
    try {
      await onVote(optionId);
    } catch (err) {
      showAlert(t('common.error'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusyOptionId(null);
    }
  };

  const confirmDecide = (option: PollOption) => {
    showAlert(
      t('space.poll.decide_title'),
      // 날짜 후보면 일정이 만들어진다는 걸 미리 알린다 — 모르고 누르면 놀란다.
      option.startsAt ? t('space.poll.decide_desc_event') : t('space.poll.decide_desc'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('space.poll.decide_confirm'), onPress: () => { void onDecide(option.id); } },
      ],
    );
  };

  const confirmDelete = () => {
    showAlert(t('space.poll.delete_title'), t('space.poll.delete_desc'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { void onDelete(); } },
    ]);
  };

  return (
    <View style={styles.card}>
      {/* ── 헤더 ── */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{poll.title}</Text>
          <Text style={styles.meta}>
            {poll.isClosed ? t('space.poll.closed') : t('space.poll.open')}
            {' · '}
            {t('space.poll.voter_count', { count: poll.voterCount })}
            {poll.allowMultiple ? ` · ${t('space.poll.multi')}` : ''}
            {poll.anonymous ? ` · ${t('space.poll.anonymous')}` : ''}
          </Text>
        </View>
        {canManage && (
          <View style={styles.headerActions}>
            {!poll.isClosed && (
              <Pressable onPress={() => { void onClose(); }} hitSlop={8}>
                <Text style={styles.actionText}>{t('space.poll.close_action')}</Text>
              </Pressable>
            )}
            <Pressable onPress={confirmDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        )}
      </View>

      {poll.description ? <Text style={styles.description}>{poll.description}</Text> : null}

      {/* ── 후보 ── */}
      {poll.options.map((option) => {
        const decided = poll.decidedOptionId === option.id;
        const ratio = option.voteCount / maxVotes;
        return (
          <Pressable
            key={option.id}
            onPress={() => { void handleVote(option.id); }}
            disabled={poll.isClosed || busyOptionId !== null}
            style={[
              styles.option,
              option.votedByMe && styles.optionMine,
              decided && styles.optionDecided,
            ]}
          >
            {/* 득표 비율 막대 — 텍스트 뒤에 깔린다. */}
            <View style={[styles.bar, { width: `${Math.round(ratio * 100)}%` }]} pointerEvents="none" />
            <View style={styles.optionRow}>
              <Text style={styles.optionLabel} numberOfLines={2}>
                {decided ? '✅ ' : ''}{optionLabel(option, i18n.language)}
              </Text>
              {busyOptionId === option.id
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={styles.voteCount}>{option.voteCount}</Text>}
            </View>
            {/* 실명 투표일 때만 누가 골랐는지 보인다. */}
            {!poll.anonymous && option.voterIds.length > 0 && (
              <Text style={styles.voters} numberOfLines={1}>
                {t('space.poll.voted_by', { count: option.voterIds.length })}
              </Text>
            )}
            {canManage && poll.isClosed && !poll.decidedOptionId && (
              <Pressable onPress={() => confirmDecide(option)} hitSlop={6} style={styles.decideBtn}>
                <Text style={styles.decideText}>{t('space.poll.decide_action')}</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}

      {/* 익명 투표는 비밀투표가 아님을 분명히 한다 (서버에는 투표자가 남는다). */}
      {poll.anonymous && <Text style={styles.footnote}>{t('space.poll.anonymous_note')}</Text>}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing[3],
      gap: spacing[2],
      marginBottom: spacing[2],
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
    headerText: { flex: 1, gap: 2 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    title: { ...textStyles.body, fontWeight: '700', color: colors.textPrimary },
    meta: { ...textStyles.caption, color: colors.textTertiary },
    actionText: { ...textStyles.caption, color: colors.primary },
    description: { ...textStyles.caption, color: colors.textSecondary },
    option: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      overflow: 'hidden',
      gap: 2,
    },
    optionMine: { borderColor: colors.primary },
    optionDecided: { borderColor: colors.primary, borderWidth: 2 },
    bar: {
      position: 'absolute',
      left: 0, top: 0, bottom: 0,
      backgroundColor: colors.primaryLight,
      opacity: 0.45,
    },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    optionLabel: { ...textStyles.body, color: colors.textPrimary, flex: 1 },
    voteCount: { ...textStyles.body, fontWeight: '700', color: colors.textPrimary, minWidth: 20, textAlign: 'right' },
    voters: { ...textStyles.caption, color: colors.textTertiary },
    decideBtn: { alignSelf: 'flex-start', marginTop: 2 },
    decideText: { ...textStyles.caption, color: colors.primary, fontWeight: '600' },
    footnote: { ...textStyles.caption, color: colors.textTertiary },
  });
}
