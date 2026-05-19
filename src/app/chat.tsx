/**
 * Chat — AI 비서 모달 화면 (v1.2 Phase 2).
 *
 * v1.1.2 UX fix:
 *   - 네이티브 헤더 비활성화 + 자체 헤더 (테마 색상 일관, 닫기 버튼 정확
 *     정렬, 작은 원형, 아이콘 가시성 보장)
 *   - 헤더-메시지 사이 상단 여백
 *   - KeyboardAvoidingView 로 키보드 올라올 때 Composer 가 가려지지 않게
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />

      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.surfaceAlt }]}
          hitSlop={8}
          accessibilityLabel="닫기"
        >
          <Ionicons name="close" size={18} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>AI 비서</Text>
        {messages.length > 0 ? (
          <Pressable
            onPress={clear}
            style={[styles.iconBtn, { backgroundColor: colors.surfaceAlt }]}
            hitSlop={8}
            accessibilityLabel="대화 초기화"
          >
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

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
  container: { flex: 1 },
  content:   { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...(textStyles.h3 as object),
    flex: 1,
    textAlign: 'center',
  },
  topSpacer: { height: spacing[3] },
});
