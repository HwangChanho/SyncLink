/* eslint-disable react-hooks/rules-of-hooks --
 * Platform-branched hook: web and native sub-hooks live behind an early
 * return so Voice.* APIs aren't even loaded on the wrong platform. The
 * react-hooks lint rule can't see that Platform.OS is a compile-time
 * constant for any single bundle. Tracked in docs/inbox/REVIEW_2026-04-26.md
 * for a proper split (separate web/native hook files) — Sprint 20.
 */
/**
 * useSpeechRecognition — cross-platform speech-to-text hook.
 *
 * Platform strategy:
 *  - Web:    Uses the browser's Web Speech API (window.SpeechRecognition /
 *            window.webkitSpeechRecognition). Supported in Chrome and Edge.
 *            Not available in Firefox/Safari without flags.
 *  - Native: Uses @react-native-voice/voice for iOS and Android.
 *
 * VAD (Voice Activity Detection):
 *  - Native: onSpeechRecognized(isFinal=true) 수신 시 자동으로 listening 종료.
 *    iOS SFSpeechRecognizer가 말이 끝났다고 판단하면 isFinal 결과를 보냄.
 *    사용자가 말을 멈추면 ~1-2초 내에 자동 종료됨.
 *  - Web: continuous=false 모드로 동작하며, onend 이벤트로 자동 종료.
 *    단, MIN_LISTEN_DURATION_MS 이전에 끝나면 재시작(초반 무음 대응).
 *
 * Noise suppression (iOS):
 *  - @react-native-voice/voice 네이티브 레이어가 AVAudioSession을
 *    PlayAndRecord 카테고리로 설정하지만 mode는 기본값(.measurement).
 *  - voiceChat/voiceRecognition 모드 설정은 추가 네이티브 모듈 필요
 *    → IDEA-026으로 carry (docs/queue/todo/).
 *  - 현재는 iOS SFSpeechRecognizer 자체 노이즈 필터링에 의존.
 *
 * Speaker recognition:
 *  - 모바일 SDK 레이어에서는 직접 지원 불가 → IDEA-025로 carry.
 *
 * Usage:
 *  ```tsx
 *  const { isListening, isSupported, startListening, stopListening, transcript } =
 *    useSpeechRecognition({ language: 'ko-KR' });
 *
 *  // Append live transcript to note content
 *  useEffect(() => {
 *    if (transcript) setContent(prev => prev + transcript);
 *  }, [transcript]);
 *  ```
 *
 * Notes:
 *  - `transcript` is a partial result — reset to '' after appending to avoid duplicates.
 *  - On web, partial results are delivered continuously (interimResults=true).
 *  - On native, Voice fires onSpeechPartialResults with an array of alternatives;
 *    we take the highest-confidence (first) alternative.
 *  - Cleanup is handled automatically via useEffect return.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpeechRecognitionOptions {
  /** BCP-47 language code (e.g. 'ko-KR', 'en-US'). Defaults to 'ko-KR'. */
  language?: string;
  /**
   * Called whenever a new (partial or final) transcript segment is ready.
   * The caller should append this to their text buffer.
   *
   * @param text - The newly recognised text segment
   */
  onResult?: (text: string) => void;
  /** Called when recognition ends (naturally or via stopListening). */
  onEnd?: () => void;
  /** Called when an error occurs. */
  onError?: (error: string) => void;
}

export interface SpeechRecognitionState {
  /** Whether recognition is currently active. */
  isListening: boolean;
  /**
   * Whether speech recognition is available on this platform/browser.
   * Always true on native; on web, false if the browser lacks the API.
   */
  isSupported: boolean;
  /** Start speech recognition. No-op if already listening or not supported. */
  startListening: () => Promise<void>;
  /** Stop speech recognition manually. */
  stopListening: () => Promise<void>;
}

// ─── Web Speech API types (not in @types/web for older TS configs) ────────────

// Minimal ambient declarations so we don't need @types/dom-speech-recognition
declare global {
  interface Window {
    SpeechRecognition: new () => WebSpeechRecognitionInstance;
    webkitSpeechRecognition: new () => WebSpeechRecognitionInstance;
  }
}

interface WebSpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface WebSpeechRecognitionEvent {
  resultIndex: number;
  results: WebSpeechRecognitionResultList;
}

interface WebSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): WebSpeechRecognitionResult;
  [index: number]: WebSpeechRecognitionResult;
}

interface WebSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): WebSpeechRecognitionAlternative;
  [index: number]: WebSpeechRecognitionAlternative;
}

interface WebSpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface WebSpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Minimum listening duration in milliseconds.
 * Browsers and native Voice API stop recognition aggressively on short silences
 * (~1–2s). Users expect the mic to stay open for at least 5 seconds before
 * deciding they're done speaking.
 *
 * Web only: We restart recognition if it ends naturally before this window
 * elapses; after 5s we let onEnd close the session.
 *
 * Native (iOS/Android): MIN_LISTEN_DURATION_MS is NOT used for auto-restart.
 * Instead, VAD relies on onSpeechRecognized(isFinal=true) to detect speech end.
 * The constant is kept for web compatibility only.
 */
const MIN_LISTEN_DURATION_MS = 5000;

export function useSpeechRecognition({
  language = 'ko-KR',
  onResult,
  onEnd,
  onError,
}: SpeechRecognitionOptions = {}): SpeechRecognitionState {

  const [isListening, setIsListening] = useState(false);

  // ── Web implementation ─────────────────────────────────────────────────────

  if (Platform.OS === 'web') {
    // Detect browser support once (outside state to avoid re-render on init)
    const WebSpeechAPI =
      typeof window !== 'undefined'
        ? (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)
        : null;

    const isSupported = WebSpeechAPI !== null;

    // Hold a ref to the active recognition instance so we can stop it
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const recognitionRef = useRef<WebSpeechRecognitionInstance | null>(null);
    // Track when listening started to enforce MIN_LISTEN_DURATION_MS (web only).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const startTimeRef = useRef<number>(0);
    // Whether the user manually requested stop (so we don't auto-restart).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const userStoppedRef = useRef<boolean>(false);

    // Cleanup on unmount
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      return () => {
        userStoppedRef.current = true;
        recognitionRef.current?.stop();
      };
    }, []);

    /**
     * Create a new recognition instance with all event handlers wired.
     *
     * VAD on web: continuous=false so the browser auto-stops after the user
     * finishes speaking (typically ~1-2s of silence). This mirrors native VAD.
     * interimResults=true is kept for live transcript feedback.
     *
     * MIN_LISTEN_DURATION_MS guard: The browser can fire onend almost
     * immediately if there is silence at session start (before the user begins
     * speaking). We restart once in that case so the user has a chance to begin.
     * After MIN_LISTEN_DURATION_MS the browser's own VAD takes over.
     */
    const createRecognition = useCallback((): WebSpeechRecognitionInstance | null => {
      if (!WebSpeechAPI) return null;
      const recognition = new WebSpeechAPI();
      recognition.lang = language;
      // VAD: continuous=false lets the browser detect speech end and stop
      // automatically. The browser fires onend after ~1-2s of post-speech silence.
      recognition.continuous = false;
      recognition.interimResults = true;

      let lastResultIndex = 0;

      recognition.onresult = (event: WebSpeechRecognitionEvent) => {
        let finalText = '';
        for (let i = lastResultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result && result.isFinal) {
            const alternative = result[0];
            if (alternative) finalText += alternative.transcript;
            lastResultIndex = i + 1;
          }
        }
        if (finalText && onResult) onResult(finalText);
      };

      recognition.onerror = (event: WebSpeechRecognitionErrorEvent) => {
        console.error('[SpeechRecognition] web error:', event.error);
        userStoppedRef.current = true;
        setIsListening(false);
        onError?.(event.error);
      };

      recognition.onend = () => {
        // User explicitly stopped — close session.
        if (userStoppedRef.current) {
          setIsListening(false);
          onEnd?.();
          return;
        }
        // Past MIN_LISTEN_DURATION_MS: the browser's VAD fired after real speech.
        // End the session normally.
        const elapsed = Date.now() - startTimeRef.current;
        if (elapsed >= MIN_LISTEN_DURATION_MS) {
          setIsListening(false);
          onEnd?.();
          return;
        }
        // Too early (< MIN_LISTEN_DURATION_MS): browser ended before the user
        // started speaking (initial silence). Restart once so the user has a
        // chance to begin speaking — this is the only restart we permit.
        try {
          const next = createRecognition();
          if (next) {
            recognitionRef.current = next;
            next.start();
          } else {
            setIsListening(false);
            onEnd?.();
          }
        } catch {
          setIsListening(false);
          onEnd?.();
        }
      };

      return recognition;
    }, [WebSpeechAPI, language, onResult, onEnd, onError]);

    const startListening = useCallback(async () => {
      if (!isSupported || !WebSpeechAPI || isListening) return;

      userStoppedRef.current = false;
      startTimeRef.current = Date.now();
      const recognition = createRecognition();
      if (!recognition) return;
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    }, [isSupported, WebSpeechAPI, isListening, createRecognition]);

    const stopListening = useCallback(async () => {
      userStoppedRef.current = true;
      recognitionRef.current?.stop();
      setIsListening(false);
    }, []);

    return { isListening, isSupported, startListening, stopListening };
  }

  // ── Native implementation (iOS / Android) ──────────────────────────────────

  // Dynamic import to avoid bundling @react-native-voice/voice on web
  // (the package may crash during web initialisation).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Voice = require('@react-native-voice/voice').default as {
    start: (lang: string) => Promise<void>;
    stop: () => Promise<void>;
    destroy: () => Promise<void>;
    onSpeechResults: ((e: { value?: string[] }) => void) | null;
    onSpeechPartialResults: ((e: { value?: string[] }) => void) | null;
    onSpeechError: ((e: { error?: { message?: string } }) => void) | null;
    onSpeechEnd: (() => void) | null;
    /** Fired when iOS SFSpeechRecognizer finalises a recognition result. */
    onSpeechRecognized: ((e: { isFinal?: boolean }) => void) | null;
  };

  const isSupported = true; // Always available on iOS/Android

  // Whether the user manually requested stop — prevents VAD from closing twice.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const userStoppedRef = useRef<boolean>(false);
  /**
   * Guards against duplicate auto-stop: onSpeechRecognized(isFinal=true) and
   * onSpeechEnd can both fire in quick succession. Once we initiate auto-stop
   * we set this flag so the second event is a no-op.
   */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const vadStoppedRef = useRef<boolean>(false);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    /**
     * onSpeechPartialResults — incremental interim transcript.
     * Fired continuously while the user is speaking.
     * We forward the highest-confidence alternative (index 0) to the caller.
     */
    Voice.onSpeechPartialResults = (e: { value?: string[] }) => {
      const partial = e.value?.[0];
      if (partial && onResult) onResult(partial);
    };

    /**
     * onSpeechResults — final consolidated transcript for the utterance.
     * Fired alongside or just before onSpeechRecognized(isFinal=true).
     * We deliver the result to the caller here.
     */
    Voice.onSpeechResults = (e: { value?: string[] }) => {
      const text = e.value?.[0];
      if (text && onResult) onResult(text);
    };

    /**
     * onSpeechRecognized — VAD signal from iOS SFSpeechRecognizer.
     *
     * When isFinal=true the recogniser has determined the user finished speaking
     * (silence detected). We treat this as the VAD trigger and auto-stop.
     *
     * This is the primary auto-stop path for native (iOS/Android).
     * onSpeechEnd below is the fallback for cases where isFinal never fires
     * (e.g., user manually hits stop, or an unexpected engine termination).
     */
    Voice.onSpeechRecognized = (e: { isFinal?: boolean }) => {
      if (!e.isFinal) return;
      // Guard: ignore if user already stopped or we already auto-stopped.
      if (userStoppedRef.current || vadStoppedRef.current) return;

      vadStoppedRef.current = true;
      // Stop the audio engine — this also triggers onSpeechEnd, which will
      // be a no-op because vadStoppedRef is set.
      Voice.stop().catch((err: unknown) => {
        console.warn('[SpeechRecognition] VAD auto-stop failed:', err);
      });
      setIsListening(false);
      onEnd?.();
    };

    Voice.onSpeechError = (e: { error?: { message?: string } }) => {
      const msg = e.error?.message ?? 'Speech recognition error';
      console.error('[SpeechRecognition] native error:', msg);
      userStoppedRef.current = true;
      setIsListening(false);
      onError?.(msg);
    };

    /**
     * onSpeechEnd — fallback termination signal.
     *
     * Fires when the audio engine stops for any reason (VAD auto-stop,
     * user stop, or engine error). If VAD already handled closure via
     * onSpeechRecognized(isFinal=true), vadStoppedRef prevents duplicate
     * onEnd calls. If we arrive here fresh (neither user nor VAD stopped),
     * we close normally rather than restarting — on native the engine has
     * already decided there is nothing more to recognise.
     */
    Voice.onSpeechEnd = () => {
      // Already handled by VAD (onSpeechRecognized isFinal=true) or user stop.
      if (userStoppedRef.current || vadStoppedRef.current) return;

      // Engine ended on its own without a final result (e.g. very short silence
      // at session start). Close cleanly — no restart on native.
      setIsListening(false);
      onEnd?.();
    };

    return () => {
      void Voice.destroy();
      Voice.onSpeechResults        = null;
      Voice.onSpeechPartialResults = null;
      Voice.onSpeechRecognized     = null;
      Voice.onSpeechError          = null;
      Voice.onSpeechEnd            = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(async () => {
    if (isListening) return;
    try {
      // Reset guard flags for a fresh session.
      userStoppedRef.current = false;
      vadStoppedRef.current  = false;
      await Voice.start(language);
      setIsListening(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice recognition';
      console.error('[SpeechRecognition] start failed:', msg);
      onError?.(msg);
    }
  }, [isListening, language, Voice, onError]);

  const stopListening = useCallback(async () => {
    // Mark as user-initiated so VAD / onSpeechEnd don't re-fire onEnd.
    userStoppedRef.current = true;
    try {
      await Voice.stop();
    } catch {
      // Ignore stop errors — recognition may have already ended
    }
    setIsListening(false);
  }, [Voice]);

  return { isListening, isSupported, startListening, stopListening };
}
