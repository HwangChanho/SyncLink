/**
 * Chat — AI 비서 모달 화면 (v1.2 Phase 2).
 *
 * Stack.Screen 의 presentation modal 로 보여짐. ChatFab 에서 router.push('/chat')
 * 으로 진입. 닫기는 헤더의 ← 또는 swipe-down (modal default).
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
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
      <View style={[styles.content, { paddingTop: insets.top > 0 ? 0 : spacing[2] }]}>
        <ChatMessageList messages={messages} isLoading={isLoading} />
        <ChatComposer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { flex: 1 },
});
