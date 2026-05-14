/**
 * TodoAttachmentSection — note(Todo) 첨부 UI (최대 5개).
 *
 * Plan: docs/plans/2026-05-14-note-attachments.md
 *
 * Responsibilities:
 *  - Show a thumbnail grid of attached photos and an inline player card for
 *    a recorded voice memo.
 *  - "추가" 버튼 → ActionSheet (사진 / 음성 / 취소).
 *  - Photo picker via expo-image-picker (base64=true so the upload pipeline
 *    has the raw bytes without a second disk read).
 *  - Voice recording via useVoiceRecorder hook (expo-av).
 *
 * Not responsible for: uploads to Supabase Storage — the caller stages the
 * pending items in local state and triggers todoAttachmentService.uploadX
 * after the parent todo row is created/saved.
 */

import { useState } from 'react';
import {
  View, Text, Pressable, Image, StyleSheet, ActionSheetIOS, Platform, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Stub upload item — `localUri` exists until the parent uploads the file. */
export interface PendingPhoto {
  localUri: string;
  base64:   string;
  width:    number;
  height:   number;
}
export interface PendingVoice {
  localUri:   string;
  durationMs: number;
}

/** Already-uploaded row hydrated with a signed URL (matches TodoAttachment). */
export interface UploadedAttachment {
  id:         string;
  kind:       'photo' | 'voice';
  signedUrl:  string;
  duration_ms?: number | null;
}

export interface TodoAttachmentSectionProps {
  pendingPhotos:        PendingPhoto[];
  pendingVoice:         PendingVoice | null;
  uploadedAttachments:  UploadedAttachment[];
  onAddPhoto:           (p: PendingPhoto) => void;
  onAddVoice:           (v: PendingVoice) => void;
  onRemovePendingPhoto: (idx: number) => void;
  onRemovePendingVoice: () => void;
  onRemoveUploaded:     (id: string) => void;
}

const MAX_ATTACHMENTS = 5;

export function TodoAttachmentSection(props: TodoAttachmentSectionProps) {
  const {
    pendingPhotos, pendingVoice, uploadedAttachments,
    onAddPhoto, onAddVoice, onRemovePendingPhoto, onRemovePendingVoice, onRemoveUploaded,
  } = props;
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const recorder = useVoiceRecorder();
  const [recordingMode, setRecordingMode] = useState(false);

  const uploadedPhotos = uploadedAttachments.filter(a => a.kind === 'photo');
  const uploadedVoices = uploadedAttachments.filter(a => a.kind === 'voice');
  const totalCount =
    pendingPhotos.length + (pendingVoice ? 1 : 0) +
    uploadedPhotos.length + uploadedVoices.length;
  const canAddMore = totalCount < MAX_ATTACHMENTS;

  // ── Picker handlers ────────────────────────────────────────────────────────
  async function handlePickPhoto() {
    if (!canAddMore) {
      Alert.alert('첨부 한도', t('note.attachment_limit'));
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      base64: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];

    // Compress to ~1600px max edge to keep storage bills reasonable; the
    // re-encode also strips EXIF (incidental privacy win).
    // Resize on the longest edge only — pass either width or height to
    // ImageManipulator (passing both forces an exact-fit which distorts the
    // aspect ratio when the source is not 16:9 to begin with).
    const resize = a.width > a.height
      ? { width: 1600 }
      : { height: 1600 };
    const compressed = await ImageManipulator.manipulateAsync(
      a.uri,
      [{ resize }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );

    onAddPhoto({
      localUri: compressed.uri,
      base64:   compressed.base64 ?? '',
      width:    compressed.width,
      height:   compressed.height,
    });
  }

  async function handleStartRecording() {
    if (!canAddMore) {
      Alert.alert('첨부 한도', t('note.attachment_limit'));
      return;
    }
    if (pendingVoice) {
      Alert.alert('음성 첨부 1개 제한', '음성은 하나만 첨부할 수 있어요. 기존 음성을 삭제해주세요.');
      return;
    }
    setRecordingMode(true);
    await recorder.start();
  }

  async function handleStopRecording() {
    const result = await recorder.stop();
    setRecordingMode(false);
    if (result) {
      onAddVoice({ localUri: result.uri, durationMs: result.durationMs });
    }
  }

  function openAddMenu() {
    if (!canAddMore) {
      Alert.alert('첨부 한도', t('note.attachment_limit'));
      return;
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t('note.attach_photo'), t('note.attach_voice'), '취소'],
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) handlePickPhoto();
          else if (i === 1) handleStartRecording();
        },
      );
    } else {
      // Simple Android fallback: 2-button Alert as a poor-man's action sheet.
      Alert.alert('첨부 추가', undefined, [
        { text: t('note.attach_photo'), onPress: handlePickPhoto },
        { text: t('note.attach_voice'), onPress: handleStartRecording },
        { text: '취소', style: 'cancel' },
      ]);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{t('note.attachments')} {totalCount}/{MAX_ATTACHMENTS}</Text>
        <Pressable onPress={openAddMenu} hitSlop={8} disabled={!canAddMore}>
          <Ionicons
            name="add-circle"
            size={24}
            color={canAddMore ? colors.primary : colors.textTertiary}
          />
        </Pressable>
      </View>

      {/* Photos — pending + uploaded as a single visual grid */}
      <View style={styles.grid}>
        {pendingPhotos.map((p, idx) => (
          <ThumbCell
            key={`pending-${idx}`}
            uri={p.localUri}
            onRemove={() => onRemovePendingPhoto(idx)}
            colors={colors}
            styles={styles}
          />
        ))}
        {uploadedPhotos.map((a) => (
          <ThumbCell
            key={a.id}
            uri={a.signedUrl}
            onRemove={() => onRemoveUploaded(a.id)}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>

      {/* Voice — single pending or uploaded clip */}
      {pendingVoice && (
        <VoiceCard
          durationMs={pendingVoice.durationMs}
          onPlay={() => { /* pending: parent has the local URI; no playback prior to upload for simplicity */ }}
          onRemove={onRemovePendingVoice}
          colors={colors}
          styles={styles}
          label="음성 메모 (저장 후 재생 가능)"
        />
      )}
      {uploadedVoices.map((a) => (
        <VoiceCard
          key={a.id}
          durationMs={a.duration_ms ?? 0}
          onPlay={() => { /* TODO: play via expo-av in a follow-up */ }}
          onRemove={() => onRemoveUploaded(a.id)}
          colors={colors}
          styles={styles}
          label="음성 메모"
        />
      ))}

      {/* Inline recording indicator */}
      {recordingMode && (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            녹음 중… {formatDuration(recorder.durationMs)}
          </Text>
          <Pressable onPress={handleStopRecording} style={styles.recordingStop}>
            <Ionicons name="stop-circle" size={28} color={colors.error} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThumbCell({
  uri, onRemove, colors, styles,
}: {
  uri: string;
  onRemove: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.thumbCell}>
      <Image source={{ uri }} style={styles.thumb} />
      <Pressable
        style={styles.thumbRemove}
        onPress={onRemove}
        hitSlop={6}
      >
        <Ionicons name="close-circle" size={20} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

function VoiceCard({
  durationMs, onPlay, onRemove, colors, styles, label,
}: {
  durationMs: number;
  onPlay: () => void;
  onRemove: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
  label: string;
}) {
  return (
    <View style={styles.voiceCard}>
      <Pressable onPress={onPlay} hitSlop={8}>
        <Ionicons name="play-circle" size={28} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.voiceLabel}>{label}</Text>
        <Text style={styles.voiceDuration}>{formatDuration(durationMs)}</Text>
      </View>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      gap: spacing[2],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    label: {
      ...(textStyles.label as object),
      color: colors.textSecondary,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
    },
    thumbCell: {
      width: 72,
      height: 72,
      borderRadius: radius.md,
      overflow: 'hidden',
      position: 'relative',
    },
    thumb: {
      width: '100%',
      height: '100%',
    },
    thumbRemove: {
      position: 'absolute',
      top: 2,
      right: 2,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 10,
    },
    voiceCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      backgroundColor: colors.surface,
      padding: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    voiceLabel: {
      ...(textStyles.bodySm as object),
      color: colors.textPrimary,
    },
    voiceDuration: {
      ...(textStyles.caption as object),
      color: colors.textSecondary,
    },
    recordingBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      backgroundColor: colors.surface,
      padding: spacing[3],
      borderRadius: radius.md,
    },
    recordingDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.error,
    },
    recordingText: {
      ...(textStyles.bodySm as object),
      color: colors.textPrimary,
      flex: 1,
    },
    recordingStop: {
      padding: 4,
    },
  });
}
