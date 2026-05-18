/**
 * ChatMessageList — AI 비서 채팅 메시지 버블 리스트 (v1.2 Phase 2).
 *
 * 사용자/비서 발화를 버블로 표시. 비서 메시지 아래에는 executed 도구 결과를
 * 작은 chip 으로 함께 표시 ("일정 1건 생성됨" 같은 시그널).
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { ChatUiMessage } from '@/stores/chatStore';

interface Props {
  messages: ChatUiMessage[];
  isLoading: boolean;
}

export function ChatMessageList({ messages, isLoading }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const scrollRef = useRef<ScrollView>(null);

  // 메시지 추가 시 맨 아래로 자동 스크롤.
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length, isLoading]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>무엇을 도와드릴까요?</Text>
          <Text style={styles.emptyHint}>예: "내일 오후 7시 카페 약속 추가해줘"</Text>
        </View>
      ) : null}

      {messages.map((m) => (
        <View
          key={m.id}
          style={[
            styles.bubbleWrap,
            m.role === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapAssistant,
          ]}
        >
          <View
            style={[
              styles.bubble,
              m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                m.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant,
              ]}
            >
              {m.content}
            </Text>
          </View>
          {m.executed && m.executed.length > 0 ? (
            <View style={styles.executedRow}>
              {m.executed.map((e, idx) => (
                <View
                  key={`${m.id}-${idx}`}
                  style={[styles.execChip, !e.ok && styles.execChipFailed]}
                >
                  <Text style={styles.execChipText}>{e.summary}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>생각 중…</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: { padding: spacing[4], gap: spacing[3] },
    empty: { alignItems: 'center', paddingVertical: spacing[10] },
    emptyTitle: { ...(textStyles.h3 as object), color: colors.textPrimary, marginBottom: spacing[2] },
    emptyHint: { ...(textStyles.body as object), color: colors.textTertiary },

    bubbleWrap: { gap: spacing[1] },
    bubbleWrapUser: { alignItems: 'flex-end' },
    bubbleWrapAssistant: { alignItems: 'flex-start' },

    bubble: {
      maxWidth: '85%',
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: radius.lg,
    },
    bubbleUser:      { backgroundColor: colors.primary },
    bubbleAssistant: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    bubbleText:      { ...(textStyles.body as object) },
    bubbleTextUser:      { color: colors.textInverse },
    bubbleTextAssistant: { color: colors.textPrimary },

    executedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
    execChip: {
      paddingVertical: 2,
      paddingHorizontal: spacing[2],
      borderRadius: radius.full,
      backgroundColor: colors.surfaceAlt,
    },
    execChipFailed: { backgroundColor: colors.error + '20' },
    execChipText: { ...(textStyles.labelSm as object), color: colors.textSecondary },

    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
    loadingText: { ...(textStyles.bodySm as object), color: colors.textTertiary },
  });
}
