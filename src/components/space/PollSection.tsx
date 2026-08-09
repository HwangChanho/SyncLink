/**
 * PollSection — Space 상세의 "투표" 섹션.
 *
 * 목록 로드 · Realtime 구독 · 생성 모달을 여기서 관리하고, 표시는 PollCard 에
 * 맡긴다. 부모(space/[id].tsx)는 SectionCard 자리에 이 컴포넌트만 놓으면 된다.
 *
 * Realtime 은 "무엇이 바뀌었는지"를 병합하지 않고 재조회 신호로만 쓴다 —
 * 집계가 걸려 있어 다시 읽는 편이 단순하고 어긋날 여지가 없다.
 *
 * 계획: docs/plans/2026-08-08-space-poll.md
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  listPolls, createPoll, castVote, closePoll, decidePoll, deletePoll, subscribeToPolls,
} from '@/services/spaceService';
import { useAuthStore } from '@/stores/authStore';
import type { Poll, CreatePollInput } from '@/types';
import { SectionCard } from './SectionCard';
import { PollCard } from './PollCard';
import { PollCreateModal } from './PollCreateModal';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface Props {
  spaceId: string;
  /** 현재 사용자가 이 Space 의 owner 인지 — 남의 투표도 관리할 수 있다. */
  isOwner: boolean;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

export function PollSection({ spaceId, isOwner, colors, styles }: Props) {
  const { t } = useTranslation();
  const local = makeStyles(colors);
  const myUserId = useAuthStore((s) => s.user?.id);

  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPolls(await listPolls(spaceId));
    } catch (err) {
      // 섹션 하나 때문에 화면 전체를 막지 않는다 — 조용히 비운다.
      console.warn('[PollSection] listPolls failed:', err);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => { void reload(); }, [reload]);

  // 다른 멤버가 투표하면 즉시 반영된다.
  useEffect(() => subscribeToPolls(spaceId, () => { void reload(); }), [spaceId, reload]);

  const handleCreate = async (input: CreatePollInput) => {
    await createPoll(spaceId, input);
    await reload();
  };

  /** 낙관적 갱신 없이 서버 응답으로 교체한다 — 집계가 어긋나면 더 헷갈린다. */
  const replace = (updated: Poll) =>
    setPolls((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  const guarded = (fn: () => Promise<void>) => async () => {
    try { await fn(); } catch (err) {
      showAlert(t('common.error'), err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <SectionCard
      title={t('space.poll.section')}
      colors={colors}
      styles={styles}
      action={
        <Pressable testID="poll-create-open" onPress={() => setModalVisible(true)} hitSlop={8}>
          <Text style={styles.sectionActionText}>{t('space.add_button')}</Text>
        </Pressable>
      }
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={local.loader} />
      ) : polls.length === 0 ? (
        <View style={local.empty}>
          <Text style={styles.emptyText}>{t('space.poll.empty')}</Text>
          <Text style={local.emptyHint}>{t('space.poll.empty_hint')}</Text>
        </View>
      ) : (
        polls.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            canManage={isOwner || poll.createdBy === myUserId}
            onVote={async (optionId) => { replace(await castVote(poll, optionId)); }}
            onDecide={async (optionId) => {
              // PollCard 가 결과를 기다리지 않으므로(확인 Alert 뒤 void 호출) 여기서 잡는다.
              try { replace(await decidePoll(poll, optionId)); } catch (err) {
                showAlert(t('common.error'), err instanceof Error ? err.message : String(err));
              }
            }}
            onClose={guarded(async () => { await closePoll(poll.id); await reload(); })}
            onDelete={guarded(async () => { await deletePoll(poll.id); await reload(); })}
          />
        ))
      )}

      <PollCreateModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmit={handleCreate}
      />
    </SectionCard>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    loader: { paddingVertical: spacing[3] },
    empty: { alignItems: 'center', gap: spacing[1], paddingVertical: spacing[2] },
    emptyHint: { ...textStyles.caption, color: colors.textTertiary, textAlign: 'center' },
  });
}
