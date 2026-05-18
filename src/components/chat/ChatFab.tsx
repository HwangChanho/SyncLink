/**
 * ChatFab — AI 비서 진입점 (v1.2 Phase 2).
 *
 * 글로벌 floating action button. 5번째 탭을 추가하면 가로 공간 부담 + v1.1
 * "AI를 자연스럽게 녹이기" 콘셉트와 충돌해서 별도 진입점으로 분리. Home
 * 우하단에 고정.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';

interface ChatFabProps {
  /** Home 화면 등 특정 위치에서만 활성화. 기본 true. */
  visible?: boolean;
}

export function ChatFab({ visible = true }: ChatFabProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const handlePress = useCallback(() => {
    router.push('/chat');
  }, []);

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        style={styles.fab}
        onPress={handlePress}
        accessibilityLabel="AI 비서 열기"
      >
        <Ionicons name="sparkles" size={22} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      right: spacing[4],
      bottom: spacing[6],
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // shadow (iOS) + elevation (Android)
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 6,
    },
  });
}
