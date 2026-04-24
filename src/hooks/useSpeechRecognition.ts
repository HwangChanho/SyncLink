/**
 * useSpeechRecognition — cross-platform speech-to-text hook.
 *
 * Platform strategy:
 *  - Web:    Uses the browser's Web Speech API (window.SpeechRecognition /
 *            window.webkitSpeechRecognition). Supported in Chrome and Edge.
 *            Not available in Firefox/Safari without flags.
 *  - Native: Uses @react-native-voice/voice for iOS and Android.
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

    // Cleanup on unmount
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      return () => {
        recognitionRef.current?.stop();
      };
    }, []);

    const startListening = useCallback(async () => {
      if (!isSupported || !WebSpeechAPI || isListening) return;

      const recognition = new WebSpeechAPI();
      recognition.lang = language;
      recognition.continuous = true;      // keep listening until stopListening()
      recognition.interimResults = true;  // deliver partial results for live feedback

      /**
       * Accumulate only newly-confirmed transcript segments.
       * We track the last `resultIndex` to avoid re-delivering already-processed results.
       */
      let lastResultIndex = 0;

      recognition.onresult = (event: WebSpeechRecognitionEvent) => {
        let finalText = '';
        for (let i = lastResultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // result may be undefined in some browser implementations — guard defensively
          if (result && result.isFinal) {
            const alternative = result[0];
            if (alternative) {
              finalText += alternative.transcript;
            }
            lastResultIndex = i + 1;
          }
        }
        if (finalText && onResult) {
          onResult(finalText);
        }
      };

      recognition.onerror = (event: WebSpeechRecognitionErrorEvent) => {
        console.error('[SpeechRecognition] web error:', event.error);
        setIsListening(false);
        onError?.(event.error);
      };

      recognition.onend = () => {
        setIsListening(false);
        onEnd?.();
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    }, [isSupported, WebSpeechAPI, isListening, language, onResult, onEnd, onError]);

    const stopListening = useCallback(async () => {
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
  };

  const isSupported = true; // Always available on iOS/Android

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    /**
     * Partial results — fire continuously as the user speaks.
     * We emit each partial result so the caller can show live feedback.
     */
    Voice.onSpeechPartialResults = (e: { value?: string[] }) => {
      const partial = e.value?.[0];
      if (partial && onResult) {
        onResult(partial);
      }
    };

    /** Final results — delivered when recognition completes a utterance. */
    Voice.onSpeechResults = (e: { value?: string[] }) => {
      const text = e.value?.[0];
      if (text && onResult) {
        onResult(text);
      }
    };

    Voice.onSpeechError = (e: { error?: { message?: string } }) => {
      const msg = e.error?.message ?? 'Speech recognition error';
      console.error('[SpeechRecognition] native error:', msg);
      setIsListening(false);
      onError?.(msg);
    };

    Voice.onSpeechEnd = () => {
      setIsListening(false);
      onEnd?.();
    };

    return () => {
      void Voice.destroy();
      Voice.onSpeechResults        = null;
      Voice.onSpeechPartialResults = null;
      Voice.onSpeechError          = null;
      Voice.onSpeechEnd            = null;
    };
  // Callbacks are stable references — intentionally excluded from deps to avoid
  // tearing down Voice listeners on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(async () => {
    if (isListening) return;
    try {
      await Voice.start(language);
      setIsListening(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice recognition';
      console.error('[SpeechRecognition] start failed:', msg);
      onError?.(msg);
    }
  }, [isListening, language, Voice, onError]);

  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
    } catch {
      // Ignore stop errors — recognition may have already ended
    }
    setIsListening(false);
  }, [Voice]);

  return { isListening, isSupported, startListening, stopListening };
}
