/**
 * NLInputBar
 *
 * Floating input bar at the bottom of the Home and Calendar screens.
 * Users type a natural-language event description; the component parses
 * it via aiService.parseNaturalLanguage and shows a preview → confirm flow.
 *
 * State machine:
 *   idle → loading (awaiting parse) → preview (ConfirmModal visible)
 *     → idle (on dismiss / after confirm / after navigate-to-edit)
 *
 * On "확인": calls createEvent, closes modal, clears input.
 * On "직접 입력": navigates to /event/create with parsed values as query params.
 * On limit error: shows a toast-style snackbar.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, TextInput, Pressable, Text, ActivityIndicator,
  StyleSheet, Keyboard, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Voice, { type SpeechResultsEvent, type SpeechErrorEvent } from '@react-native-voice/voice';
import { ConfirmModal } from './ConfirmModal';
import { parseNaturalLanguage } from '@/services/aiService';
import { createEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import type { NLParseResult } from '@/types';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Types ────────────────────────────────────────────────────────────────────

type InputState = 'idle' | 'loading' | 'preview' | 'error';

interface Props {
  /** Called after a new event is successfully created (e.g. to refresh the view). */
  onEventCreated?: () => void;
}

// ─── Pre-fill serialization ───────────────────────────────────────────────────

/**
 * Serializes NLParseResult fields into a flat object of URL query params
 * that /event/create can read via useLocalSearchParams.
 *
 * Only string/date/boolean primitives are included; complex nested objects
 * are serialised as ISO-8601 strings so Expo Router can pass them as params.
 */
function buildPrefillParams(result: NLParseResult): Record<string, string> {
  const p = result.parsed;
  const params: Record<string, string> = {};

  if (p.title?.value)   params.title   = p.title.value;
  if (p.startAt?.value) params.startAt = p.startAt.value.toISOString();
  if (p.endAt?.value)   params.endAt   = p.endAt.value.toISOString();
  if (p.location?.value) params.location = p.location.value;
  if (p.allDay?.value)  params.allDay  = 'true';
  if (p.repeatType?.value && p.repeatType.value !== 'none') {
    params.repeatType = p.repeatType.value;
  }

  return params;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NLInputBar({ onEventCreated }: Props) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const router = useRouter();
  const upsertEvent = useEventStore(s => s.upsertEvent);
  const { canUseAI, consumeAI } = useSubscriptionStore();

  const [text, setText] = useState('');
  const [inputState, setInputState] = useState<InputState>('idle');
  const [parseResult, setParseResult] = useState<NLParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // ── Voice recognition setup ─────────────────────────────────────────────────

  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const recognized = e.value?.[0] ?? '';
      if (recognized) setText(recognized);
    };

    Voice.onSpeechError = (_e: SpeechErrorEvent) => {
      setIsListening(false);
    };

    Voice.onSpeechEnd = () => {
      setIsListening(false);
    };

    return () => {
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  }, []);

  const handleVoiceToggle = useCallback(async () => {
    if (isListening) {
      await Voice.stop();
      setIsListening(false);
      return;
    }
    try {
      setText('');
      await Voice.start('ko-KR');
      setIsListening(true);
    } catch {
      Alert.alert(t('common.error'), t('nl.voice_error'));
    }
  }, [isListening, t]);

  // ── Parse submission ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || inputState === 'loading') return;

    Keyboard.dismiss();

    // TASK-505: Check subscription AI limit before calling the Edge Function.
    // The local parser is always free; only the AI fallback is gated.
    // We check the limit here (pre-parse) to avoid a wasted local parse call
    // when we know AI will be needed. After parsing, if source === 'ai',
    // we consume one unit from the daily quota.
    if (!canUseAI()) {
      // Navigate to paywall instead of running the parse
      router.push('/subscription/paywall');
      return;
    }

    setInputState('loading');
    setErrorMsg('');

    const result = await parseNaturalLanguage(trimmed);

    // If the AI fallback was used, record the usage
    if (result.source === 'ai' && !result.error) {
      consumeAI();
    }

    // AI daily limit exceeded — show snackbar
    if (result.error && result.confidence === 'low') {
      setErrorMsg(result.error);
      setInputState('error');
      // Auto-clear error after 4 seconds
      setTimeout(() => setInputState('idle'), 4000);
      return;
    }

    setParseResult(result);
    setInputState('preview');
  }, [text, inputState]);

  // ── Confirm: create event and close ────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (!parseResult) return;

    const p = parseResult.parsed;
    // Build CreateEventInput — endAt defaults to startAt + 1 hour if not parsed
    const startAt = p.startAt?.value ?? new Date();
    const endAt   = p.endAt?.value ?? (() => {
      const d = new Date(startAt); d.setHours(d.getHours() + 1); return d;
    })();
    try {
      const createInput = {
        title:      p.title?.value ?? text.trim(),
        startAt,
        endAt,
        ...(p.allDay?.value ? { allDay: true } as const : {}),
        ...(p.location?.value ? { location: p.location.value } : {}),
        ...(p.repeatType?.value && p.repeatType.value !== 'none'
          ? { repeatType: p.repeatType.value }
          : {}),
      };
      const eventId = await createEvent(createInput);

      // Sync store so the calendar reflects the new event immediately
      if (eventId) {
        // fetchEvents will be triggered by the parent screen; upsertEvent handles
        // optimistic updates if the caller provides it.
      }

      setText('');
      setParseResult(null);
      setInputState('idle');
      onEventCreated?.();
    } catch {
      setErrorMsg(t('nl.save_failed'));
      setInputState('error');
      setTimeout(() => setInputState('idle'), 4000);
    }
  }, [parseResult, text, upsertEvent, onEventCreated]);

  // ── Edit: navigate to /event/create with pre-fill ──────────────────────────

  const handleEdit = useCallback(() => {
    if (!parseResult) return;

    const params = buildPrefillParams(parseResult);
    setParseResult(null);
    setInputState('idle');
    setText('');

    router.push({
      pathname: '/event/create',
      params,
    });
  }, [parseResult, router]);

  // ── Dismiss preview without acting ─────────────────────────────────────────

  const handleDismiss = useCallback(() => {
    setParseResult(null);
    setInputState('idle');
    // Keep input text so the user can re-submit after editing
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Error snackbar */}
      {inputState === 'error' && errorMsg ? (
        <View style={styles.snackbar} accessibilityRole="alert">
          <Ionicons name="information-circle-outline" size={14} color={colors.textInverse} />
          <Text style={styles.snackbarText} numberOfLines={2}>{errorMsg}</Text>
        </View>
      ) : null}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* Microphone button */}
        <Pressable
          style={[styles.micButton, isListening && styles.micButtonActive]}
          onPress={handleVoiceToggle}
          disabled={inputState === 'loading'}
          accessibilityRole="button"
          accessibilityLabel={isListening ? t('nl.voice_stop') : t('nl.voice_start')}
        >
          <Ionicons
            name={isListening ? 'mic' : 'mic-outline'}
            size={18}
            color={isListening ? colors.error : colors.textSecondary}
          />
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={isListening ? '듣는 중…' : t('nl.placeholder')}
          placeholderTextColor={isListening ? colors.error : colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={handleSubmit}
          editable={inputState !== 'loading'}
          multiline={false}
          maxLength={200}
        />

        <Pressable
          style={[
            styles.sendButton,
            (!text.trim() || inputState === 'loading') && styles.sendButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!text.trim() || inputState === 'loading'}
          accessibilityRole="button"
          accessibilityLabel="일정 파싱"
        >
          {inputState === 'loading' ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Ionicons name="send" size={16} color={colors.textInverse} />
          )}
        </Pressable>
      </View>

      {/* Confirm modal — shown when parse result is ready */}
      {parseResult && (
        <ConfirmModal
          visible={inputState === 'preview'}
          result={parseResult}
          onConfirm={handleConfirm}
          onEdit={handleEdit}
          onDismiss={handleDismiss}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    paddingTop: spacing[2],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing[2],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing[4],
    paddingRight: spacing[1],
    paddingVertical: spacing[1],
  },
  input: {
    flex: 1,
    ...(textStyles.body as object),
    color: colors.textPrimary,
    paddingVertical: spacing[2],
    minHeight: 36,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: {
    backgroundColor: colors.primaryLight,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  snackbar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.textSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  snackbarText: {
    ...(textStyles.bodySm as object),
    color: colors.textInverse,
    flex: 1,
  },
  });
}
