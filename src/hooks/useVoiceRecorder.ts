/**
 * useVoiceRecorder — Thin wrapper around expo-av Audio.Recording.
 *
 * Plan: docs/plans/2026-05-14-note-attachments.md
 *
 * Responsibility:
 *  - Manage microphone permission, recording lifecycle, and playback of the
 *    last captured clip.
 *  - Hide expo-av's verbose state machine behind a small reactive surface
 *    that the TodoAttachmentSection UI can consume.
 *
 * Not responsible for:
 *  - Uploading the file (caller invokes todoAttachmentService.uploadVoice
 *    once the URI is finalised).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

// Lazy-require expo-av so a missing/broken native binding does not crash
// modules that merely import this hook (planner.tsx → TodoCreateSheet →
// TodoAttachmentSection → useVoiceRecorder). Native binding is only touched
// when the user actually starts a recording.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Audio: any = null;
function loadAudio() {
  if (Audio) return Audio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Audio = require('expo-av').Audio;
  } catch (err) {
    console.warn('[useVoiceRecorder] expo-av not available', err);
    Audio = null;
  }
  return Audio;
}

/** Maximum recording length — UI hint only, hard cap enforced via auto-stop. */
const MAX_DURATION_MS = 60_000;

export interface VoiceRecorderState {
  isRecording: boolean;
  isPlaying:   boolean;
  /** Length of the *currently-being-recorded* clip in ms. */
  durationMs:  number;
  /** Last finalised recording — null until the user stops. */
  lastUri:     string | null;
  /** Duration of the lastUri clip. */
  lastDurationMs: number;
}

export interface VoiceRecorderApi extends VoiceRecorderState {
  start:     () => Promise<void>;
  stop:      () => Promise<{ uri: string; durationMs: number } | null>;
  play:      () => Promise<void>;
  pause:     () => Promise<void>;
  reset:     () => void;
}

export function useVoiceRecorder(): VoiceRecorderApi {
  const [isRecording,    setIsRecording]    = useState(false);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [durationMs,     setDurationMs]     = useState(0);
  const [lastUri,        setLastUri]        = useState<string | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState(0);

  // Recording/Sound types come from the lazy-loaded native module.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordingRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const soundRef     = useRef<any>(null);
  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop interval + release native resources on unmount.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    recordingRef.current?.stopAndUnloadAsync().catch(() => { /* ignore */ });
    soundRef.current?.unloadAsync().catch(() => { /* ignore */ });
  }, []);

  // ── start ────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    const A = loadAudio();
    if (!A) {
      Alert.alert('음성 메모 사용 불가', '이 빌드는 음성 녹음 기능을 지원하지 않습니다.');
      return;
    }
    try {
      const perm = await A.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('마이크 권한 필요', '음성 메모 녹음을 위해 마이크 권한이 필요합니다. 설정에서 허용해주세요.');
        return;
      }
      await A.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await A.Recording.createAsync(
        A.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setDurationMs(0);

      // Tick every 100ms — cheap enough; UI shows seconds resolution anyway.
      tickRef.current = setInterval(async () => {
        const status = await recording.getStatusAsync();
        if (status.isRecording) {
          setDurationMs(status.durationMillis ?? 0);
          // Hard cap at MAX_DURATION_MS to prevent runaway recordings
          if ((status.durationMillis ?? 0) >= MAX_DURATION_MS) {
            stop().catch(() => { /* ignore */ });
          }
        }
      }, 100);
    } catch (err) {
      console.warn('[useVoiceRecorder] start failed', err);
      setIsRecording(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── stop ─────────────────────────────────────────────────────────────────
  const stop = useCallback(async (): Promise<{ uri: string; durationMs: number } | null> => {
    const rec = recordingRef.current;
    if (!rec) return null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      const status = await rec.getStatusAsync();
      const ms = status.durationMillis ?? durationMs;
      recordingRef.current = null;
      setIsRecording(false);
      if (uri) {
        setLastUri(uri);
        setLastDurationMs(ms);
        return { uri, durationMs: ms };
      }
      return null;
    } catch (err) {
      console.warn('[useVoiceRecorder] stop failed', err);
      setIsRecording(false);
      return null;
    }
  }, [durationMs]);

  // ── play ─────────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    if (!lastUri) return;
    // If a previous sound is loaded, just resume — avoids re-loading the file
    if (soundRef.current) {
      await soundRef.current.playAsync();
      setIsPlaying(true);
      return;
    }
    const A = loadAudio();
    if (!A) return;
    const { sound } = await A.Sound.createAsync({ uri: lastUri });
    soundRef.current = sound;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.isLoaded && status.didJustFinish) {
        setIsPlaying(false);
      }
    });
    await sound.playAsync();
    setIsPlaying(true);
  }, [lastUri]);

  // ── pause ────────────────────────────────────────────────────────────────
  const pause = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    }
  }, []);

  // ── reset ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    soundRef.current?.unloadAsync().catch(() => { /* ignore */ });
    soundRef.current = null;
    setIsPlaying(false);
    setLastUri(null);
    setLastDurationMs(0);
    setDurationMs(0);
  }, []);

  return {
    isRecording,
    isPlaying,
    durationMs,
    lastUri,
    lastDurationMs,
    start,
    stop,
    play,
    pause,
    reset,
  };
}
