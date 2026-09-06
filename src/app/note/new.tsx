/**
 * Note creation screen — allows the user to write a new note.
 *
 * Presented as a modal from the Planner tab's Notes FAB.
 * Route: /note/new
 *
 * Features:
 *  - Title + body text input
 *  - Voice-to-text: microphone button at the bottom of the editor
 *      Web:    window.SpeechRecognition (Chrome / Edge)
 *      Native: @react-native-voice/voice (iOS / Android)
 *  - Cross-platform Alert via showAlert (works on web)
 *
 * TASK-402 (Sprint 4)
 * Voice input added (Sprint 13)
 */

import { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
  Animated,
} from 'react-native';
import { showAlert } from '@/lib/webAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useTodoStore } from '@/stores/todoStore';
import { logError } from '@/lib/errorLogger';

export default function NoteNewScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { addTodo } = useTodoStore();

  const [title, setTitle]     = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Animated scale for the mic button — pulses while listening to give
   * clear visual feedback that the microphone is active.
   */
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Speech recognition ─────────────────────────────────────────────────────

  /**
   * Append recognised speech to the note body.
   * On web we receive final segments only (interimResults filtered in hook).
   * On native we receive partial results which are replaced on next call —
   * we therefore always append rather than replace to avoid data loss.
   */
  const handleSpeechResult = useCallback((text: string) => {
    setContent(prev => {
      // Add a space separator if the existing content doesn't end with whitespace
      const separator = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return prev + separator + text;
    });
  }, []);

  const handleSpeechEnd = useCallback(() => {
    // Stop pulsing animation
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const handleSpeechError = useCallback((err: string) => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
    // Only show errors that are not "no-speech" (common when user pauses)
    if (err !== 'no-speech') {
      showAlert('음성 인식 오류', err);
    }
  }, [pulseAnim]);

  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition({
    language:  'ko-KR',
    onResult:  handleSpeechResult,
    onEnd:     handleSpeechEnd,
    onError:   handleSpeechError,
  });

  /**
   * Start the pulse animation loop while the microphone is active.
   * The button scales between 1.0 and 1.15 repeatedly.
   */
  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 500, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  /** Toggle the microphone: start if idle, stop if listening. */
  const handleMicPress = useCallback(async () => {
    if (isListening) {
      await stopListening();
    } else {
      startPulse();
      await startListening();
    }
  }, [isListening, startListening, stopListening, startPulse]);

  // ── Save ───────────────────────────────────────────────────────────────────

  /**
   * Save the new note and navigate back.
   * Validates that title is non-empty.
   */
  const handleSave = useCallback(async () => {
    // Stop voice recognition if still active before saving
    if (isListening) {
      await stopListening();
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      showAlert(t('common.error'), t('note.title_placeholder'));
      return;
    }

    setIsSaving(true);
    try {
      const trimmedContent = content.trim();
      await addTodo({
        title: trimmedTitle,
        // Omit content when empty (exactOptionalPropertyTypes: content must be string, not undefined)
        ...(trimmedContent.length > 0 ? { content: trimmedContent } : {}),
        contentType: 'note',
      });
      router.back();
    } catch (err) {
      // Log to error_logs (production triage) and console (web devtools).
      void logError({ context: 'note.new.save', error: err });
      console.error('[NoteNew] save failed:', err);
      showAlert(t('common.error'), err instanceof Error ? err.message : t('note.save_failed'));
    } finally {
      setIsSaving(false);
    }
  }, [title, content, addTodo, router, isListening, stopListening, t]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('note.label')}</Text>
        <TouchableOpacity
          style={[styles.headerBtn, styles.saveBtn, isSaving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving
            ? <ActivityIndicator size="small" color={colors.textInverse} />
            : <Text style={styles.saveBtnText}>{t('common.save')}</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Editor */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/*
          🔴 v1.4.10 — 본문이 길어지면 커서가 있는 줄이 키보드 뒤로 들어갔다
          (LEAD 보고 "줄바꿈이 되면 아래 글이 짤려", 2026-09-06 시뮬 재현).
          KeyboardAvoidingView 는 *바깥 컨테이너*를 밀어 올릴 뿐이고,
          ScrollView 안에서 커서를 따라가는 건 별개다.
          `automaticallyAdjustKeyboardInsets` 가 키보드 높이만큼 contentInset 을
          잡아 줘서, 마지막 줄까지 스크롤이 닿는다(iOS 전용 — Android 는
          windowSoftInputMode=adjustResize 로 이미 같은 효과가 난다).
        */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.editorContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {/* Title input */}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder={t('note.title_placeholder')}
            placeholderTextColor={colors.textPlaceholder}
            multiline={false}
            returnKeyType="next"
            autoFocus
          />

          {/* Divider */}
          <View style={styles.divider} />

          {/* Body input — supports markdown syntax as plain text */}
          <TextInput
            style={styles.bodyInput}
            value={content}
            onChangeText={setContent}
            placeholder={t('nl.placeholder')}
            placeholderTextColor={colors.textPlaceholder}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>

        {/*
         * Microphone toolbar — fixed above the keyboard.
         * Only rendered when speech recognition is available on this platform/browser.
         *
         * Visual feedback:
         *  - Idle:     mic icon, primary colour, normal size
         *  - Listening: mic icon filled, error/red colour, pulsing scale animation
         */}
        {isSupported && (
          <View style={styles.voiceBar}>
            {/* Status label */}
            <Text style={[styles.voiceStatus, isListening && styles.voiceStatusActive]}>
              {isListening ? '음성 인식 중...' : '음성으로 입력'}
            </Text>

            {/* Mic button */}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[
                  styles.micButton,
                  isListening && styles.micButtonActive,
                ]}
                onPress={() => void handleMicPress()}
                accessibilityLabel={isListening ? '음성 인식 중지' : '음성 인식 시작'}
                accessibilityRole="button"
              >
                <Ionicons
                  name={isListening ? 'mic' : 'mic-outline'}
                  size={24}
                  color={isListening ? colors.textInverse : colors.primary}
                />
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: componentHeight.navHeader,
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing[2],
  },
  headerBtn: {
    padding: spacing[1],
  },
  headerTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
    borderRadius: radius.full,
  },
  saveBtnText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  buttonDisabled: { opacity: 0.5 },

  editorContent: {
    padding: spacing[4],
    flexGrow: 1,
  },
  titleInput: {
    ...textStyles.h3,
    color: colors.textPrimary,
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing[3],
  },
  bodyInput: {
    ...textStyles.body,
    color: colors.textPrimary,
    minHeight: 300,
    lineHeight: 24,
  },

  // ── Voice toolbar ──────────────────────────────────────────────────────────

  /**
   * Thin toolbar at the bottom of the editor area.
   * Sits above the system keyboard (KeyboardAvoidingView handles the offset).
   */
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing[3],
  },

  /**
   * Status text to the left of the mic button.
   * Shows "음성으로 입력" when idle, "음성 인식 중..." when active.
   */
  voiceStatus: {
    ...textStyles.caption,
    color: colors.textTertiary,
    flex: 1,
  },
  voiceStatusActive: {
    color: colors.primary,
  },

  /** Circular mic button — white fill when idle, primary fill when recording. */
  micButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    // Shadow (iOS + web)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  micButtonActive: {
    backgroundColor: colors.error,
  },
  });
}
