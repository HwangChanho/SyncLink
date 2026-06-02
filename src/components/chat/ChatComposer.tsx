/**
 * ChatComposer — 사용자가 비서에게 보낼 메시지 입력 UI (v1.2 Phase 2).
 *
 * 단순 텍스트 입력 + 보내기 버튼. 음성 입력은 v1.2.1+ 에서 useSpeechRecognition
 * 통합 예정 (지금은 텍스트만 지원해 첫 출시 안정성 우선).
 *
 * 보내기 동작:
 *   1. 입력 검증 (빈 텍스트 X, 500자 hard cap)
 *   2. chatStore.pushUser + setLoading(true)
 *   3. sendAssistantTurn 호출
 *   4. 성공 → chatStore.pushAssistant
 *   5. 실패 → quota/auth 분기 토스트
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useChatStore } from '@/stores/chatStore';
import { sendAssistantTurn } from '@/services/assistantChatService';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { router } from 'expo-router';

const MAX_LEN = 500;

export function ChatComposer() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [text, setText] = useState('');
  // v1.2 마무리 — Pro 전용 사진 첨부. base64 + mediaType 페어로 보관.
  const [attachedImage, setAttachedImage] = useState<{
    uri: string;
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  } | null>(null);
  const pushUser = useChatStore((s) => s.pushUser);
  const pushAssistant = useChatStore((s) => s.pushAssistant);
  const setLoading = useChatStore((s) => s.setLoading);
  const getOutgoing = useChatStore((s) => s.getOutgoingMessages);
  const isLoading = useChatStore((s) => s.isLoading);
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');

  // v1.2 마무리 — 음성 입력 통합. 결과는 input 박스에 prefill, 사용자가
  // 검토 후 send 버튼으로 발신.
  const speech = useSpeechRecognition({
    language: 'ko-KR',
    onResult: (transcript) => setText(transcript),
  });

  const handleAttachImage = useCallback(async () => {
    if (!isPro) {
      Alert.alert(
        'Pro 전용 기능',
        '사진 첨부는 Pro 구독자만 사용할 수 있어요.',
        [
          { text: '취소', style: 'cancel' },
          { text: 'Pro 보기', onPress: () => router.push('/subscription/paywall') },
        ],
      );
      return;
    }
    if (isLoading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:    ImagePicker.MediaTypeOptions.Images,
      base64:        true,
      quality:       0.6,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) return;
    const ext = asset.uri.split('.').pop()?.toLowerCase();
    const mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      'image/jpeg';
    setAttachedImage({ uri: asset.uri, base64: asset.base64, mediaType });
  }, [isPro, isLoading]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (trimmed.length > MAX_LEN) {
      Alert.alert('너무 긴 메시지', `${MAX_LEN}자 이내로 입력해 주세요.`);
      return;
    }
    setText('');
    const image = attachedImage;
    setAttachedImage(null);
    pushUser(trimmed + (image ? ' [사진 첨부]' : ''));
    setLoading(true);
    const outgoing = getOutgoing();
    const { result, error } = await sendAssistantTurn({
      messages: outgoing,
      ...(image ? { image: { base64: image.base64, mediaType: image.mediaType } } : {}),
    });
    setLoading(false);

    if (error) {
      // v1.2 마무리 — Pro paywall UI. quota 초과 시 메시지 + 구독 화면 안내 버튼.
      if (error.kind === 'quota' && !isPro) {
        pushAssistant(error.message + '\n(Pro 로 업그레이드하면 무제한)');
        // 토스트 대신 inline 메시지로 유도. 사용자가 한 번 더 시도하지 않게.
      } else {
        pushAssistant(error.message);
      }
      return;
    }
    if (result) {
      pushAssistant(result.text, result.executed);
    }
  }, [text, isLoading, pushUser, pushAssistant, setLoading, getOutgoing, isPro, attachedImage]);

  const handleUpgrade = useCallback(() => {
    router.push('/subscription/paywall');
  }, []);

  const handleVoiceToggle = useCallback(() => {
    if (!speech.isSupported) {
      Alert.alert('음성 인식 미지원', '이 기기에서는 음성 입력을 사용할 수 없어요.');
      return;
    }
    if (speech.isListening) {
      void speech.stopListening();
    } else {
      void speech.startListening();
    }
  }, [speech]);

  const canSend = text.trim().length > 0 && !isLoading;

  return (
    <View>
      {attachedImage ? (
        <View style={styles.imagePreviewWrap}>
          <Image source={{ uri: attachedImage.uri }} style={styles.imagePreview} />
          <Pressable
            onPress={() => setAttachedImage(null)}
            style={styles.imageRemove}
            accessibilityLabel="첨부 사진 제거"
          >
            <Ionicons name="close-circle" size={20} color={colors.textInverse} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
      <Pressable
        onPress={handleVoiceToggle}
        style={[styles.iconBtn, speech.isListening && styles.iconBtnActive]}
        accessibilityLabel="음성 입력"
        disabled={isLoading}
      >
        <Ionicons
          name={speech.isListening ? 'mic' : 'mic-outline'}
          size={20}
          color={speech.isListening ? colors.textInverse : colors.textSecondary}
        />
      </Pressable>
      <Pressable
        onPress={handleAttachImage}
        style={[styles.iconBtn, !isPro && styles.iconBtnLocked]}
        accessibilityLabel="사진 첨부 (Pro)"
        disabled={isLoading}
      >
        <Ionicons name="image-outline" size={20} color={isPro ? colors.textSecondary : colors.textPlaceholder} />
      </Pressable>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={speech.isListening ? '듣는 중…' : '내 일정에 대해 분석/질문하기'}
        placeholderTextColor={colors.textPlaceholder}
        multiline
        maxLength={MAX_LEN}
        editable={!isLoading}
      />
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        accessibilityLabel="보내기"
      >
        <Ionicons name="send" size={18} color={canSend ? colors.textInverse : colors.textPlaceholder} />
      </Pressable>
      {!isPro ? (
        <Pressable onPress={handleUpgrade} style={styles.proBadge} accessibilityLabel="Pro 업그레이드">
          <Ionicons name="star" size={11} color={colors.warning} />
          <Text style={styles.proBadgeText}>PRO</Text>
        </Pressable>
      ) : null}
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing[2],
      padding: spacing[3],
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
      color: colors.textPrimary,
      ...(textStyles.body as object),
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    sendBtnDisabled: {
      backgroundColor: colors.surfaceAlt,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    iconBtnActive: {
      backgroundColor: colors.error,
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      height: 24,
      paddingHorizontal: 8,
      borderRadius: radius.full,
      backgroundColor: colors.warning + '20',
    },
    proBadgeText: {
      ...(textStyles.caption as object),
      fontSize: 11,
      lineHeight: 13,
      fontWeight: '700',
      color: colors.warning,
    },
    iconBtnLocked: {
      opacity: 0.5,
    },
    imagePreviewWrap: {
      alignSelf: 'flex-start',
      marginLeft: spacing[3],
      marginTop: spacing[2],
      position: 'relative',
    },
    imagePreview: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    imageRemove: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
