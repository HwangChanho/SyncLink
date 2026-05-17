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
  View, TextInput, Pressable, Text, ActivityIndicator, Image,
  StyleSheet, Keyboard, Alert, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Voice, { type SpeechResultsEvent, type SpeechErrorEvent } from '@react-native-voice/voice';
import * as ImagePicker from 'expo-image-picker';
import { ConfirmModal } from './ConfirmModal';
import { QuotaExceededSheet } from '@/components/ai/QuotaExceededSheet';
import { FreeBannerAd } from '@/components/ads/FreeBannerAd';
import { parseNaturalLanguage, parseNaturalLanguageMulti } from '@/services/aiService';
import { useVoicePostProcess } from '@/hooks/useVoicePostProcess';
import { createEvent } from '@/services/eventService';
import { logError } from '@/lib/errorLogger';
import { useEventStore } from '@/stores/eventStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import type { NLParseResult, EventSummary } from '@/types';
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

  const eventsByDate = useEventStore(s => s.eventsByDate);
  const [text, setText] = useState('');
  const [inputState, setInputState] = useState<InputState>('idle');
  const [parseResult, setParseResult] = useState<NLParseResult | null>(null);
  // Build-51 — when the user enumerates multiple events ("내일 9시 회의,
  // 12시 점심") parseNaturalLanguageMulti returns >1 result. We hold the
  // pending tail here while the user steps through them one by one via
  // ConfirmModal so each event still gets a per-event confirm/edit UX.
  const [pendingResults, setPendingResults] = useState<NLParseResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // v1.1 Phase 1 — STT 결과를 AI 로 후보정한 뒤 모호한 해석이 둘 이상이면
  // 사용자가 한 번에 고를 수 있도록 chip 으로 노출. 비어있으면 chip 영역
  // 자체를 렌더하지 않는다.
  const [voiceAlternatives, setVoiceAlternatives] = useState<string[]>([]);
  const { refine: refineVoice } = useVoicePostProcess();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * When true, the QuotaExceededSheet is displayed instead of routing to
   * the paywall (Sprint 14 TASK-1404).
   */
  const [quotaSheetVisible, setQuotaSheetVisible] = useState(false);
  /**
   * 첨부된 사진 (Vision NL — 카톡 예약 캡쳐 등). null 이면 text-only 흐름.
   * uri 는 thumbnail 표시용, base64 + mediaType 는 Edge Function 전송용.
   * 사용자가 send 하면 server quota (parse-event-vision: free 1일 2회) 적용.
   */
  const [attachedImage, setAttachedImage] = useState<{
    uri:       string;
    base64:    string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  } | null>(null);
  /**
   * Live keyboard height (px). Tracked via Keyboard events so the bar
   * lifts above the software keyboard on both iOS and Android.
   *
   * iOS:     keyboardWillShow fires before animation starts → smooth lift.
   * Android: keyboardDidShow fires after the window has resized, but
   *          windowSoftInputMode=adjustResize already shrinks the layout,
   *          so we only need this as a safety net on Android.
   * Web:     virtual keyboard is handled by the browser; no offset needed.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // ── Keyboard height tracking ─────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return; // browser handles virtual keyboard
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ── Voice recognition setup ─────────────────────────────────────────────────

  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const recognized = e.value?.[0] ?? '';
      if (!recognized) return;
      // v1.1 Phase 1: STT final 결과를 즉시 setText 한 뒤, nlParser 의 결과가
      // 'low' 일 때만 비동기로 AI 후보정을 돌린다. 응답이 도착하면 더 자연
      // 스러운 문장으로 swap, 대안이 있으면 chip 영역에 노출. 응답 실패는
      // silent — 사용자는 원본 transcript 그대로 send 할 수 있다.
      setText(recognized);
      setVoiceAlternatives([]);
      refineVoice(recognized).then((res) => {
        if (!res || !res.aiUsed) return;
        if (res.best && res.best !== recognized) setText(res.best);
        if (res.alternatives.length > 0) setVoiceAlternatives(res.alternatives);
      });
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
  }, [refineVoice]);

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

  // ── 사진 첨부 (Vision NL) ────────────────────────────────────────────────────

  const handleAttachImage = useCallback(async () => {
    if (inputState === 'loading') return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('common.error'), t('nl.attach_image_permission'));
      return;
    }
    // 1024px max + JPEG quality 0.6 → ~150KB. 더 크면 base64 가 커져
    // Edge Function 요청 한도 (~6MB) 와 비용에 영향.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:   ImagePicker.MediaTypeOptions.Images,
      base64:       true,
      quality:      0.6,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) return;
    // Resolve mediaType from URI extension. iOS picker 가 mimeType 직접 안 줌.
    const ext = asset.uri.split('.').pop()?.toLowerCase();
    const mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
      ext === 'png'  ? 'image/png'  :
      ext === 'gif'  ? 'image/gif'  :
      ext === 'webp' ? 'image/webp' :
                       'image/jpeg';
    setAttachedImage({ uri: asset.uri, base64: asset.base64, mediaType });
  }, [inputState, t]);

  const handleRemoveImage = useCallback(() => {
    setAttachedImage(null);
  }, []);

  // ── Parse submission ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    // image 첨부 시엔 text 가 비어도 허용. text-only 면 빈 입력 차단.
    if (!attachedImage && !trimmed) return;
    if (inputState === 'loading') return;

    Keyboard.dismiss();

    // TASK-505: Check subscription AI limit before calling the Edge Function.
    // The local parser is always free; only the AI fallback is gated.
    // We check the limit here (pre-parse) to avoid a wasted local parse call
    // when we know AI will be needed. After parsing, if source === 'ai',
    // we consume one unit from the daily quota.
    // TASK-1403: canUseAI() now returns a richer object. When the check
    // fails with 'no-credit' we open the QuotaExceededSheet (TASK-1404) so
    // the user can watch an ad or upgrade instead of a hard paywall redirect.
    const gate = canUseAI();
    if (!gate.allowed) {
      setQuotaSheetVisible(true);
      return;
    }

    setInputState('loading');
    setErrorMsg('');

    // image 첨부 흐름: multi-splitter 우회 (single 결과). server vision quota
    // 적용 + 비용 모니터링은 server-side. text-only 흐름은 기존 multi 그대로.
    const results = attachedImage
      ? [await parseNaturalLanguage(trimmed, {
          imageBase64:    attachedImage.base64,
          imageMediaType: attachedImage.mediaType,
        })]
      : await parseNaturalLanguageMulti(trimmed);

    // text-only AI 호출 시 클라 카운트 차감. image 흐름은 server quota 라 skip.
    if (!attachedImage && results.some((r) => r.source === 'ai' && !r.error)) {
      void consumeAI();
    }

    // Build-101 — Vision NL 의 noEventFound: AI 가 이미지에서 일정 못 찾음.
    // 사용자에게 명시적 prompt — 다시 시도 / 직접 입력 / 취소.
    const noEventResult = results.find((r) => r.noEventFound);
    if (noEventResult && results.length === 1) {
      setInputState('idle');
      Alert.alert(
        t('nl.no_event_found_title', { defaultValue: '일정을 찾지 못했어요' }),
        noEventResult.error ?? '이미지에서 일정 정보가 보이지 않아요. 다른 사진을 첨부하거나 직접 입력해주세요.',
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('nl.attach_image', { defaultValue: '다른 사진' }), onPress: () => { void handleAttachImage(); } },
          { text: t('nl.no_event_manual', { defaultValue: '직접 입력' }), onPress: () => router.push('/event/create') },
        ],
      );
      return;
    }

    // AI daily limit exceeded — show snackbar (only when ALL results
    // are low+errored; partial-success multi still proceeds).
    const firstError = results.find((r) => r.error && r.confidence === 'low');
    if (firstError && results.length === 1) {
      setErrorMsg(firstError.error ?? '');
      setInputState('error');
      setTimeout(() => setInputState('idle'), 4000);
      return;
    }

    // Show the first parsed event in ConfirmModal; queue the rest. Each
    // confirm/dismiss advances the queue, so the user reviews every
    // event individually instead of being blindsided by silent batch
    // creation.
    const [head, ...tail] = results;
    setParseResult(head ?? null);
    setPendingResults(tail);
    setInputState('preview');
    // 결과 표시 시 첨부 이미지는 즉시 정리 (재호출 방지 + 미리보기 깨끗).
    if (attachedImage) setAttachedImage(null);
  }, [text, inputState, canUseAI, consumeAI, attachedImage, t, router, handleAttachImage]);

  /**
   * Returns true when [startAt, endAt) overlaps any existing event on
   * the same date. Used to surface a warning toast before persisting so
   * a user accidentally double-booking can confirm or cancel.
   */
  const hasConflict = useCallback((startAt: Date, endAt: Date): EventSummary | null => {
    const dayKey = `${startAt.getFullYear()}-${String(startAt.getMonth()+1).padStart(2,'0')}-${String(startAt.getDate()).padStart(2,'0')}`;
    const dayEvents = eventsByDate[dayKey] ?? [];
    const startMs = startAt.getTime();
    const endMs   = endAt.getTime();
    for (const e of dayEvents) {
      if (e.allDay) continue;
      const es = e.startAt.getTime();
      const ee = e.endAt.getTime();
      // Half-open overlap test: [s,e) ∩ [es,ee) ≠ ∅
      if (startMs < ee && es < endMs) return e;
    }
    return null;
  }, [eventsByDate]);

  // ── Confirm: create event and close (or advance queue) ────────────────────

  const handleConfirm = useCallback(async () => {
    if (!parseResult) return;

    const p = parseResult.parsed;
    const startAt = p.startAt?.value ?? new Date();
    const endAt   = p.endAt?.value ?? (() => {
      const d = new Date(startAt); d.setHours(d.getHours() + 1); return d;
    })();

    // Build-51 — soft conflict check. We log/notify but don't block
    // creation: per LEAD's call, overlapping events can stack visually
    // (the calendar's overlap layout already supports this). Hard-block
    // would frustrate users registering multi-track schedules.
    const conflict = !p.allDay?.value ? hasConflict(startAt, endAt) : null;

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
      const created = await createEvent(createInput);

      if (created) {
        upsertEvent({
          id: created.id,
          title: created.title,
          startAt: created.startAt,
          endAt: created.endAt,
          allDay: created.allDay,
          color: created.color ?? colors.primary,
          isOwn: true,
        });
      }

      // Surface conflict toast AFTER the optimistic create so the chip
      // is already visible — the user can see what overlapped and
      // choose to delete via long-press if needed.
      if (conflict) {
        setErrorMsg(t('nl.conflict_with', { title: conflict.title }));
        setTimeout(() => setErrorMsg(''), 3000);
      }

      // If there are queued events from a multi-event input, advance to
      // the next one instead of clearing the bar.
      if (pendingResults.length > 0) {
        const [next, ...rest] = pendingResults;
        setParseResult(next ?? null);
        setPendingResults(rest);
        // Stay in 'preview' so ConfirmModal stays open with the next event.
        onEventCreated?.();
        return;
      }

      // No more queued events — fully reset.
      setText('');
      setParseResult(null);
      setPendingResults([]);
      setInputState('idle');
      onEventCreated?.();
    } catch (err) {
      void logError({ context: 'nl.confirm', error: err });
      console.error('[NLInputBar] handleConfirm failed:', err);
      setErrorMsg(t('nl.save_failed'));
      setInputState('error');
      setTimeout(() => setInputState('idle'), 4000);
    }
  }, [parseResult, pendingResults, text, upsertEvent, onEventCreated, colors.primary, t, hasConflict]);

  // ── Edit: navigate to /event/create with pre-fill ──────────────────────────

  const handleEdit = useCallback(() => {
    if (!parseResult) return;

    const params = buildPrefillParams(parseResult);
    setParseResult(null);
    setPendingResults([]);   // navigating to /event/create cancels the rest of the queue
    setInputState('idle');
    setText('');

    router.push({
      pathname: '/event/create',
      params,
    });
  }, [parseResult, router]);

  // ── Dismiss preview without acting ─────────────────────────────────────────

  const handleDismiss = useCallback(() => {
    // If a multi-event queue is in progress, dismiss only the current
    // event and advance to the next one. This lets the user skip events
    // they didn't actually want from a comma-enumerated input.
    if (pendingResults.length > 0) {
      const [next, ...rest] = pendingResults;
      setParseResult(next ?? null);
      setPendingResults(rest);
      return;
    }
    setParseResult(null);
    setInputState('idle');
    // Keep input text so the user can re-submit after editing
  }, [pendingResults]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    /**
     * paddingBottom: keyboardHeight lifts the bar above the software keyboard
     * when it rises. On web keyboardHeight is always 0 (browser handles it).
     * On Android, windowSoftInputMode=adjustResize already shrinks the layout,
     * so this acts as a secondary safety net for edge cases where the resize
     * hasn't fully propagated yet.
     */
    <View style={[
      styles.container,
      // Build-76 LEAD: 키보드와 텍스트필드 사이 간격 제거. 이전 +8 px
      // 여백이 사용자 보기에 너무 컸음. 정확히 keyboardHeight 만큼만 lift.
      keyboardHeight > 0 && { paddingBottom: keyboardHeight },
    ]}>
      {/* Suggestion chips — shown when focused with empty text */}
      {isFocused && !text && inputState === 'idle' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chipsRow}
        >
          {(t('nl.suggestions', { returnObjects: true }) as string[]).map((chip, i) => (
            <Pressable
              key={i}
              style={styles.chip}
              onPress={() => {
                setText(chip);
                inputRef.current?.focus();
              }}
            >
              <Text style={styles.chipText}>{chip}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Error snackbar */}
      {inputState === 'error' && errorMsg ? (
        <View style={styles.snackbar} accessibilityRole="alert">
          <Ionicons name="information-circle-outline" size={14} color={colors.textInverse} />
          <Text style={styles.snackbarText} numberOfLines={2}>{errorMsg}</Text>
        </View>
      ) : null}

      {/* v1.1 Phase 1 — STT 후보정 대안이 있을 때만 노출.
          탭하면 그 후보로 텍스트 swap + chip 닫기. */}
      {voiceAlternatives.length > 0 && inputState !== 'loading' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chipsRow}
        >
          {voiceAlternatives.map((alt, i) => (
            <Pressable
              key={`alt-${i}`}
              style={styles.chip}
              onPress={() => {
                setText(alt);
                setVoiceAlternatives([]);
                inputRef.current?.focus();
              }}
            >
              <Text style={styles.chipText}>{alt}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Free banner ad (LEAD 2026-05-03 — "기본 버전은 자연어 입력바
          하단에 배너, 프로는 안나오게"). 컴포넌트 자체에 isPro 가드가
          있어 Pro 면 null 반환. SDK 미설치/web 도 null 이라 안전. */}
      <FreeBannerAd style={styles.adWrap} />

      {/* 첨부된 사진 thumbnail (Vision NL). attachedImage 가 있을 때만. */}
      {attachedImage && (
        <View style={styles.attachmentRow}>
          <Image source={{ uri: attachedImage.uri }} style={styles.attachmentThumb} />
          <Text style={styles.attachmentLabel} numberOfLines={1}>
            {t('nl.attached_image')}
          </Text>
          <Pressable
            onPress={handleRemoveImage}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('nl.remove_image')}
          >
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* 사진 첨부 버튼 (Vision NL) */}
        <Pressable
          style={styles.micButton}
          onPress={handleAttachImage}
          disabled={inputState === 'loading'}
          accessibilityRole="button"
          accessibilityLabel={t('nl.attach_image')}
          testID="nl-button-attach-image"
        >
          <Ionicons
            name="image-outline"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>

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
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setIsFocused(true);
          }}
          onBlur={() => {
            // Delay so chip Pressable onPress fires before focus is lost
            blurTimer.current = setTimeout(() => setIsFocused(false), 200);
          }}
        />

        <Pressable
          style={[
            styles.sendButton,
            ((!text.trim() && !attachedImage) || inputState === 'loading') && styles.sendButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={(!text.trim() && !attachedImage) || inputState === 'loading'}
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y_parse_event')}
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

      {/*
       * Quota-exceeded bottom sheet (Sprint 14 TASK-1404). Replaces the
       * previous hard paywall redirect so free users can choose to watch
       * a rewarded ad to earn credits.
       */}
      <QuotaExceededSheet
        visible={quotaSheetVisible}
        onClose={() => setQuotaSheetVisible(false)}
        onRewardEarned={() => {
          // The earned credit is now on the server; user can retry submit.
        }}
      />
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
    // Symmetric vertical padding around the input row.
    paddingTop:    spacing[3],
    paddingBottom: spacing[3],
    // No marginBottom — tab bar's own paddingBottom (insets.bottom) already
    // clears the home indicator. User feedback Build 44 (real device):
    // "텍스트필드 좀더 낮춰야" → drop the extra gap entirely so the chip
    // sits right above the tab bar.
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // Build-102 — chip ↔ input row 간격 축소 (이전 spacing[2]).
    gap: spacing[1],
  },
  // Free 배너 wrapper. ads/FreeBannerAd 가 자체적으로 isPro 가드를 하므로
  // 여기 스타일은 항상 적용되더라도 Pro 사용자는 자식이 null 이라 보이지
  // 않는다. 입력바와 분리되도록 작은 위쪽 마진만 둔다.
  attachmentRow: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              spacing[2],
    paddingVertical:  spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor:  colors.surface,
    borderRadius:     radius.lg,
    marginBottom:     spacing[2],
  },
  attachmentThumb: {
    width:        40,
    height:       40,
    borderRadius: 6,
  },
  attachmentLabel: {
    ...textStyles.caption,
    color: colors.textSecondary,
    flex:  1,
  },
  adWrap: {
    alignItems: 'center',
    minHeight: 0,
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
  chipsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[1],
    // Build-102 — chip ScrollView 자체의 vertical padding 제거. container 의
    // gap 만으로 chip 과 input row 사이 간격을 결정해 시각적 공백 최소화.
    paddingVertical: 0,
  },
  chip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
  },
  chipText: {
    ...(textStyles.labelSm as object),
    color: colors.primary,
  },
  });
}
