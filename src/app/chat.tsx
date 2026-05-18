/**
 * Chat — AI 비서 모달 화면 (v1.2 Phase 2).
 *
 * Stack.Screen 의 presentation modal 로 보여짐. ChatFab 에서 router.push('/chat')
 * 으로 진입. 닫기는 헤더의 ← 또는 swipe-down (modal default).
 *
 * v1.1.2 UX fix:
 *   - 헤더-메시지 사이 상단 여백 추가 (헤더 바로 밑에 첫 메시지가 붙는 답답함 해소)
 *   - KeyboardAvoidingView 로 키보드 올라올 때 Composer 가 가려지지 않게
 */

import React from 'react';
import { View, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const clear = useChatStore((s) => s.clear);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'AI 비서',
          headerShown: true,
          presentation: 'modal',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          ),
          headerRight: () =>
            messages.length > 0 ? (
              <Pressable onPress={clear} hitSlop={12}>
                <Ionicons name="refresh" size={22} color={colors.textSecondary} />
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // 헤더 높이만큼 offset. iOS 모달 헤더 ≈ 56pt + insets.top 일부.
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 16 : 0}
      >
        {/* 헤더 바로 밑 여백 — 첫 메시지/empty state 가 답답하게 붙지 않게. */}
        <View style={styles.topSpacer} />
        <ChatMessageList messages={messages} isLoading={isLoading} />
        <ChatComposer />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1 },
  content:     { flex: 1 },
  topSpacer:   { height: spacing[3] },
});
