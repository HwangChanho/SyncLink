/**
 * voiceCompat — drop-in replacement for `@react-native-voice/voice`, backed by
 * `expo-speech-recognition`.
 *
 * Why: `@react-native-voice/voice` (v3.1.5) is unmaintained and ships no
 * New-Architecture native spec (no codegenConfig). Under the New Architecture
 * (Expo SDK 54+) its native module never wires up, so `Voice.start()` fails and
 * the app shows "음성 인식에 실패". `expo-speech-recognition` is an Expo module
 * (Expo Modules API → New-Arch native on both platforms) with an equivalent
 * recognizer. This shim maps its event model onto the legacy `Voice.on*`
 * callback API so existing call sites only change their import.
 *
 * It also fixes a latent bug: the app never requested the RECORD_AUDIO runtime
 * permission, so voice failed on any fresh install even on the old arch.
 * `start()` now requests microphone/speech permission first.
 *
 * Event mapping (expo-speech-recognition → @react-native-voice/voice):
 *   start                     → onSpeechStart
 *   result (isFinal=false)    → onSpeechPartialResults({ value })
 *   result (isFinal=true)     → onSpeechResults({ value }) + onSpeechRecognized({ isFinal: true })
 *   error                     → onSpeechError({ error: { code, message } })
 *   end                       → onSpeechEnd
 *
 * The singleton mirrors @react-native-voice/voice, which was also a singleton
 * (a device has one recognizer; the last handler-setter wins).
 */

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { EventSubscription } from 'expo-modules-core';

// ─── Legacy @react-native-voice/voice event shapes (subset the app uses) ───────

export interface SpeechResultsEvent {
  value?: string[];
}

export interface SpeechErrorEvent {
  error?: { code?: string; message?: string };
}

export interface SpeechRecognizedEvent {
  isFinal?: boolean;
}

type Callback<T> = ((event: T) => void) | null;

class VoiceCompat {
  // Legacy settable event handlers — assigned by consumers, invoked by our
  // internal expo-speech-recognition listeners.
  onSpeechStart: (() => void) | null = null;
  onSpeechEnd: (() => void) | null = null;
  onSpeechResults: Callback<SpeechResultsEvent> = null;
  onSpeechPartialResults: Callback<SpeechResultsEvent> = null;
  onSpeechError: Callback<SpeechErrorEvent> = null;
  onSpeechRecognized: Callback<SpeechRecognizedEvent> = null;

  private subscriptions: EventSubscription[] = [];

  /** Attach the underlying expo-speech-recognition listeners once. */
  private attach(): void {
    if (this.subscriptions.length > 0) return;
    this.subscriptions = [
      ExpoSpeechRecognitionModule.addListener('start', () => {
        this.onSpeechStart?.();
      }),
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        // Highest-confidence alternative first — mirror the legacy value[] shape.
        const value = (e.results ?? [])
          .map((r) => r.transcript)
          .filter((t): t is string => Boolean(t));
        if (e.isFinal) {
          this.onSpeechResults?.({ value });
          // Legacy VAD signal used by useSpeechRecognition to auto-stop.
          this.onSpeechRecognized?.({ isFinal: true });
        } else {
          this.onSpeechPartialResults?.({ value });
        }
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        this.onSpeechError?.({ error: { code: String(e.error), message: e.message } });
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        this.onSpeechEnd?.();
      }),
    ];
  }

  private detach(): void {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
  }

  /**
   * Start recognition for `locale` (BCP-47, e.g. 'ko-KR').
   * Requests microphone/speech permission first; throws if denied so callers'
   * existing try/catch can surface their error UI.
   */
  async start(locale = 'ko-KR'): Promise<void> {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Speech recognition permission not granted');
    }
    this.attach();
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      // Auto-stop when the user finishes speaking (VAD) — matches the previous
      // library's behaviour of ending on a final result.
      continuous: false,
    });
  }

  async stop(): Promise<void> {
    ExpoSpeechRecognitionModule.stop();
  }

  async cancel(): Promise<void> {
    ExpoSpeechRecognitionModule.abort();
  }

  async destroy(): Promise<void> {
    ExpoSpeechRecognitionModule.abort();
    this.detach();
  }

  /** Clear all assigned handlers (legacy API). */
  removeAllListeners(): void {
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onSpeechResults = null;
    this.onSpeechPartialResults = null;
    this.onSpeechError = null;
    this.onSpeechRecognized = null;
  }
}

const Voice = new VoiceCompat();
export default Voice;
