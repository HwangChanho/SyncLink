/**
 * Chat — AI 비서 모달 화면.
 *
 * v1.1.5 UX 정리 (LEAD 2026-05-21):
 *   - 자체 헤더 + 닫기 버튼 제거 — 모달 시스템 헤더로 일원화 (카드뷰 swipe-down
 *     으로 닫을 수 있어 별도 ✕ 불필요. 타이틀 중복 해소).
 *   - 컨셉 전환: 단순 일정 등록 (자연어 NLInputBar 와 기능 겹침) → "내
 *     일정 분석 + 인사이트 추출" 에 초점.
 *   - 대화 초기화 (refresh) 버튼은 ChatMessageList 우상단 floating mini 로
 *     이동 (메시지 1개 이상일 때만).
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { sendAssistantTurn } from '@/services/assistantChatService';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const pushUser = useChatStore((s) => s.pushUser);
  const pushAssistant = useChatStore((s) => s.pushAssistant);
  const setLoading = useChatStore((s) => s.setLoading);
  const getOutgoing = useChatStore((s) => s.getOutgoingMessages);

  // v1.2.8 — NLInputBar 에서 모호한 입력 (confidence != high) 을 받았을 때
  // /chat 으로 prefill query 와 함께 push 됨. 마운트 시 1회 자동으로 첫
  // user 메시지로 추가 + assistant 응답 trigger.
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const prefillAppliedRef = useRef(false);

  useEffect(() => {
    if (!prefill || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    const initial = `다음 발화를 일정으로 등록하고 싶어요. 시작 시간/종료 시간/제목이 모호하면 짧게 다시 물어봐주세요.\n\n"${prefill}"`;
    pushUser(initial);
    setLoading(true);
    (async () => {
      try {
        const resp = await sendAssistantTurn({ messages: getOutgoing() });
        if (resp.result?.text) {
          pushAssistant(resp.result.text, resp.result.executed);
        } else if (resp.error) {
          pushAssistant(`(에러) ${resp.error.message}`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [prefill, pushUser, pushAssistant, setLoading, getOutgoing]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{
          title: 'AI 비서',
          presentation: 'modal',
          // v1.2.8 — 다크 모드에서 native 기본 흰색 헤더가 본문과 mismatch.
          // 테마 background 색으로 일관 처리 + 텍스트/아이콘 색도 자동 대비.
          headerStyle:        { backgroundColor: colors.background },
          headerTintColor:    colors.textPrimary,
          headerTitleStyle:   { color: colors.textPrimary },
          headerShadowVisible: false,
        }}
      />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 16 : 0}
      >
        <View style={styles.topSpacer} />
        <ChatMessageList messages={messages} isLoading={isLoading} />
        <ChatComposer />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1 },
  content:    { flex: 1 },
  topSpacer:  { height: 12 },
});
