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

import React from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'AI 비서', presentation: 'modal' }} />

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
