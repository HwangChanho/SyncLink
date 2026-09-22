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
  View,
  FlatList,
  Image,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import { useGridColumns } from '@/hooks/useResponsive';
import { firstYoutubeThumbnail } from '@/lib/youtube';
import { useNoteSettingsStore } from '@/stores/noteSettingsStore';
import type { ColorTokens } from '@/hooks/useColors';
import type { Todo } from '@/types';
import type { PlannerStyles } from './plannerStyles';
import { Text } from '@/components/common/AppText';

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
  /**
   * 노트 그리드 열 수. 폰에서는 항상 2열(현행 유지), 넓어지면 최대 3열까지 늘어난다.
   *
   * 숫자 근거 — notesGrid 의 좌우 padding 합 24px 을 뺀 폭을 한 칸 최소 140px 으로 나눈다:
   *   320px(가장 좁은 폰) → 296/140 = 2 열   ← 기존과 같다(회귀 없음)
   *   430px(Pro Max)      → 406/140 = 2 열
   *   768px 이상(듀오 펼침·태블릿·Split View 넓게) → 3 열(상한)
   * 칸 자체는 noteCard 의 flex:1 이 나눠 가지므로 폭을 따로 계산할 필요가 없다.
   *
   * 🔴 훅은 아래 조기 return 들보다 **반드시 위**에 있어야 한다(훅 호출 순서 규칙).
   */
  const { cols, gridKey } = useGridColumns({
    minColumnWidth: 140,
    maxColumns: 3,
    horizontalPadding: 24,
  });

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
      // 🔴 key 와 numColumns 는 **반드시 같이** 간다. numColumns 가 실행 중에 바뀌면 RN 이 앱을
      //    죽이므로(Changing numColumns on the fly is not supported), 열 수가 바뀔 때 key 가
      //    함께 바뀌어 목록이 재마운트되게 한다. useGridColumns 가 둘을 한 묶음으로 준다.
      key={gridKey}
      data={notes}
      keyExtractor={(item) => item.id}
      numColumns={cols}
      contentContainerStyle={styles.notesGrid}
      // ⚠️ 1열일 때 columnWrapperStyle 을 주면 RN 이 경고를 낸다.
      columnWrapperStyle={cols > 1 ? styles.notesRow : undefined}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={10}
      renderItem={renderNoteItem}
    />
  );
}
