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
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useChatStore } from '@/stores/chatStore';
import {
  sendAssistantTurn,
  MAX_ASSISTANT_IMAGES,
  type AssistantImageMediaType,
} from '@/services/assistantChatService';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { router } from 'expo-router';

const MAX_LEN = 500;

export function ChatComposer() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [text, setText] = useState('');
  /**
   * v1.2 마무리 — Pro 전용 사진 첨부. base64 + mediaType 페어로 보관.
   * v1.4.10 — 한 장 → 최대 {@link MAX_ASSISTANT_IMAGES} 장. 배열 순서가 곧
   * 모델이 사진을 보는 순서라, 사용자가 고른 순서를 그대로 유지한다.
   * `uri` 는 미리보기 전용이며 서버로는 보내지 않는다.
   */
  const [attachedImages, setAttachedImages] = useState<{
    uri: string;
    base64: string;
    mediaType: AssistantImageMediaType;
  }[]>([]);
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

    // 이미 담은 장수를 빼고 남은 만큼만 고르게 한다. 0 이면 피커를 열지 않는다 —
    // 열어 놓고 고른 뒤에 거절하면 사용자가 한 일이 통째로 버려진다.
    const remaining = MAX_ASSISTANT_IMAGES - attachedImages.length;
    if (remaining <= 0) {
      Alert.alert('사진은 최대 10장', `한 번에 ${MAX_ASSISTANT_IMAGES}장까지 보낼 수 있어요.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:              ImagePicker.MediaTypeOptions.Images,
      base64:                  true,
      quality:                 0.6,
      allowsEditing:           false,
      allowsMultipleSelection: true,
      // selectionLimit 은 OS 피커가 직접 강제한다(iOS 14+ / Android 13+).
      // 그 아래 버전은 무시될 수 있어 아래 slice 로 한 번 더 자른다.
      selectionLimit:          remaining,
    });
    if (result.canceled) return;

    /**
     * base64 가 없는 자산은 조용히 버린다. 형식 판정은 확장자로 하되,
     * 🔴 하드코딩 금지 — iOS 스크린샷은 PNG 라 jpeg 로 선언하면 Anthropic 이 거부한다.
     */
    const picked = result.assets
      .filter((a) => !!a.base64)
      .slice(0, remaining)
      .map((a) => {
        const ext = a.uri.split('.').pop()?.toLowerCase();
        const mediaType: AssistantImageMediaType =
          ext === 'png' ? 'image/png' :
          ext === 'webp' ? 'image/webp' :
          ext === 'gif' ? 'image/gif' :
          'image/jpeg';
        return { uri: a.uri, base64: a.base64 as string, mediaType };
      });
    if (picked.length === 0) return;

    setAttachedImages((prev) => [...prev, ...picked]);
  }, [isPro, isLoading, attachedImages.length]);

  /** 미리보기에서 사진 한 장 제거 (인덱스 기준 — 같은 사진을 두 번 골랐을 수 있다). */
  const handleRemoveImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (trimmed.length > MAX_LEN) {
      Alert.alert('너무 긴 메시지', `${MAX_LEN}자 이내로 입력해 주세요.`);
      return;
    }
    setText('');
    const images = attachedImages;
    setAttachedImages([]);
    // 히스토리에는 사진 자체가 아니라 몇 장 붙였는지만 남긴다 — base64 를 스토어에
    // 넣으면 다음 턴에 같은 이미지를 또 태우게 된다.
    pushUser(trimmed + (images.length ? ` [사진 ${images.length}장]` : ''));
    setLoading(true);
    const outgoing = getOutgoing();
    const { result, error } = await sendAssistantTurn({
      messages: outgoing,
      ...(images.length
        ? { images: images.map(({ base64, mediaType }) => ({ base64, mediaType })) }
        : {}),
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
  }, [text, isLoading, pushUser, pushAssistant, setLoading, getOutgoing, isPro, attachedImages]);

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
      {/*
        첨부 미리보기 — 최대 10장이라 가로 스크롤로 둔다. 줄바꿈(wrap)으로 쌓으면
        입력창이 화면 절반까지 밀려 올라온다.
        키는 uri 가 아니라 index 를 섞어 쓴다 — 같은 사진을 두 번 고를 수 있어
        uri 만으로는 유일하지 않다.
      */}
      {attachedImages.length > 0 ? (
        <View style={styles.previewBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewScroll}
            keyboardShouldPersistTaps="handled"
          >
            {attachedImages.map((img, i) => (
              <View key={`${img.uri}-${i}`} style={styles.imagePreviewWrap}>
                <Image source={{ uri: img.uri }} style={styles.imagePreview} />
                <Pressable
                  onPress={() => handleRemoveImage(i)}
                  style={styles.imageRemove}
                  hitSlop={8}
                  accessibilityLabel={`첨부 사진 ${i + 1} 제거`}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textInverse} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.previewCount}>
            {attachedImages.length}/{MAX_ASSISTANT_IMAGES}
          </Text>
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
          <Ionicons name="star" size={11} color={colors.textInverse} />
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
    // Pro 업그레이드 칩 — HomeHeader 의 PRO 배지와 동일한 보라 배경 + 흰 글씨로
    // 통일. (이전엔 노랑 배경+노랑 글씨라 텍스트/아이콘이 묻혀 빈 노란 점처럼 보였음)
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      height: 24,
      paddingHorizontal: 8,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    proBadgeText: {
      ...(textStyles.caption as object),
      fontSize: 11,
      lineHeight: 13,
      fontWeight: '700',
      color: colors.textInverse,
    },
    iconBtnLocked: {
      opacity: 0.5,
    },
    /** 썸네일 가로 스트립 + 오른쪽 장수 표시를 한 줄에 놓는 바. */
    previewBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingRight: spacing[3],
    },
    previewScroll: {
      // 썸네일의 삭제 버튼이 위로 6px 튀어나오므로 잘리지 않게 위쪽 여백을 준다.
      paddingTop: spacing[2],
      paddingLeft: spacing[3],
      paddingRight: spacing[1],
      gap: spacing[2],
    },
    previewCount: {
      ...(textStyles.caption as object),
      color: colors.textSecondary,
    },
    imagePreviewWrap: {
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
