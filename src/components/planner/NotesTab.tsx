/**
 * NotesTab — the "노트" tab for the Planner screen.
 *
 * Contains:
 *  - NoteCard: single note card with press/long-press delete
 *  - NotesTab: main tab component with notes grid
 *  - formatRelativeDate: Korean relative date helper
 *
 * Extracted from planner.tsx to reduce file size.
 */

import { memo } from 'react';
import {
  View, Text, FlatList, Image,
  ActivityIndicator, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import { firstYoutubeThumbnail } from '@/lib/youtube';
import { useNoteSettingsStore } from '@/stores/noteSettingsStore';
import type { ColorTokens } from '@/hooks/useColors';
import type { Todo } from '@/types';
import type { PlannerStyles } from './plannerStyles';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a date into a relative Korean label.
 * e.g. "오늘", "어제", "3일 전", "2주 전"
 */
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return `${Math.floor(diffDays / 30)}개월 전`;
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: Todo;
  onPress: (note: Todo) => void;
  onDelete: (id: string) => void;
  styles: PlannerStyles;
}

/**
 * Note card for the Notes tab.
 * Wrapped in memo to prevent re-renders when scrolling (TASK-701).
 */
const NoteCard = memo(function NoteCard({
  note,
  onPress,
  onDelete,
  styles,
}: NoteCardProps) {
  const { t: tNote } = useTranslation();
  const preview = note.content?.slice(0, 100) ?? '';
  const updatedLabel = formatRelativeDate(note.updatedAt);

  // Show a YouTube thumbnail when the note body has a YouTube link and the
  // user hasn't turned thumbnails off (settings/notes). null = no thumbnail.
  const showThumbnail = useNoteSettingsStore((s) => s.showYoutubeThumbnails);
  const thumbnail = showThumbnail ? firstYoutubeThumbnail(note.content) : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.noteCard, pressed && styles.noteCardPressed]}
      onPress={() => onPress(note)}
      onLongPress={() => {
        showAlert(
          tNote('note.delete'),
          `"${note.title}"을(를) 삭제하시겠습니까?`,
          [
            { text: tNote('common.cancel'), style: 'cancel' },
            { text: tNote('common.delete'), style: 'destructive', onPress: () => onDelete(note.id) },
          ],
        );
      }}
    >
      {thumbnail && (
        <Image
          source={{ uri: thumbnail }}
          style={styles.noteCardThumbnail}
          resizeMode="cover"
        />
      )}
      <Text style={styles.noteCardTitle} numberOfLines={1}>{note.title}</Text>
      {preview.length > 0 && (
        <Text style={styles.noteCardPreview} numberOfLines={3}>{preview}</Text>
      )}
      <Text style={styles.noteCardDate}>{updatedLabel}</Text>
    </Pressable>
  );
});

// ─── NotesTab ─────────────────────────────────────────────────────────────────

export interface NotesTabProps {
  notes: Todo[];
  isLoading: boolean;
  removeNote: (id: string) => void;
  colors: ColorTokens;
  styles: PlannerStyles;
}

export function NotesTab({
  notes,
  isLoading,
  removeNote,
  colors,
  styles,
}: NotesTabProps) {
  const { t } = useTranslation();

  if (isLoading && notes.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (notes.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="document-text-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.emptyText}>{t('note.label')} {t('common.none')}</Text>
      </View>
    );
  }

  const renderNoteItem = ({ item }: { item: Todo }) => (
    <NoteCard
      note={item}
      onPress={(note) => router.push(`/note/${note.id}`)}
      onDelete={removeNote}
      styles={styles}
    />
  );

  return (
    <FlatList
      data={notes}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={styles.notesGrid}
      columnWrapperStyle={styles.notesRow}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={10}
      renderItem={renderNoteItem}
    />
  );
}
