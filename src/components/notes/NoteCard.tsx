/**
 * NoteCard — compact card for displaying a note in grid/list view.
 *
 * Shows a truncated markdown preview of the note content.
 * Uses react-native-markdown-display for rendering.
 * Tapping navigates to the full note detail screen.
 */

import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { Todo } from '@/types';
import { light as colors } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontSize } from '@/constants/typography';

// ─── Props ────────────────────────────────────────────────────────────────────

interface NoteCardProps {
  /** Note item (Todo with contentType='note'). */
  note: Todo;
  /** Card width — passed by the parent grid for consistent sizing. */
  width?: number;
  /** Called after deletion (parent should remove item from list). */
  onDelete?: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strips markdown syntax for a plain-text preview (max 120 chars).
 * Full markdown is rendered in the detail screen.
 */
function markdownPreview(text: string | null, maxLength = 120): string {
  if (!text) return '';
  const plain = text
    .replace(/#{1,6}\s/g, '')          // remove headings
    .replace(/\*\*(.+?)\*\*/g, '$1')   // remove bold
    .replace(/\*(.+?)\*/g, '$1')       // remove italic
    .replace(/`(.+?)`/g, '$1')         // remove inline code
    .replace(/- \[[ x]\] /g, '')       // remove checklist markers
    .replace(/^\s*[-*+]\s+/gm, '')     // remove list bullets
    .replace(/\n+/g, ' ')              // collapse newlines
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

/** Formats a date as a relative string (오늘, 어제, or date). */
function formatNoteDate(date: Date): string {
  const today = new Date();
  const diff  = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NoteCard({ note, width, onDelete: _onDelete }: NoteCardProps) {
  const router = useRouter();

  const preview  = markdownPreview(note.content);
  const dateText = formatNoteDate(note.updatedAt);

  const handlePress = () => {
    router.push(`/note/${note.id}`);
  };

  return (
    <TouchableOpacity
      style={[styles.card, width ? { width } : undefined]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Note title */}
      <Text style={styles.title} numberOfLines={2}>
        {note.title}
      </Text>

      {/* Content preview (plain text, not full markdown for performance) */}
      {preview ? (
        <Text style={styles.preview} numberOfLines={4}>
          {preview}
        </Text>
      ) : (
        <Text style={styles.emptyPreview}>내용 없음</Text>
      )}

      {/* Footer: updated date */}
      <View style={styles.footer}>
        <Text style={styles.date}>{dateText}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border,
    padding:         spacing[3],
    // Minimum height so cards in a 2-column grid look balanced
    minHeight:       120,
    // Shadow for depth
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.06,
    shadowRadius:    2,
    elevation:       1,
  },
  title: {
    ...textStyles.labelLg,
    color:        colors.textPrimary,
    marginBottom: spacing[1],
  },
  preview: {
    fontSize:     fontSize.sm,
    color:        colors.textSecondary,
    lineHeight:   fontSize.sm * 1.5,
    flex:         1,
  },
  emptyPreview: {
    fontSize:  fontSize.sm,
    color:     colors.textTertiary,
    fontStyle: 'italic',
    flex:      1,
  },
  footer: {
    marginTop:  spacing[2],
    alignItems: 'flex-end',
  },
  date: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
});
