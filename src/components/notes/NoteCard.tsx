/**
 * NoteCard — compact card for displaying a note in grid/list view.
 *
 * Shows a truncated markdown preview of the note content.
 * Uses react-native-markdown-display for rendering.
 * Tapping navigates to the full note detail screen.
 */

import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Todo } from '@/types';
import { useColors } from '@/hooks/useColors';
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
 * Truncates markdown text to a max length for card preview.
 * Keeps markdown syntax so the Markdown component can render it.
 * Breaks at the last whitespace within the limit to avoid mid-word cuts.
 */
function truncateForPreview(text: string | null, maxLength = 200): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

// formatNoteDate is now inside the component using i18n.

// ─── Component ────────────────────────────────────────────────────────────────

export function NoteCard({ note, width, onDelete: _onDelete }: NoteCardProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const router = useRouter();

  /** Formats a date as a relative string using i18n. */
  function formatNoteDate(date: Date): string {
    const today = new Date();
    const diff  = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return t('time.today');
    if (diff === 1) return t('time.yesterday');
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  const preview  = truncateForPreview(note.content);
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

      {/* Content preview — rendered as markdown for accurate visual representation */}
      {preview ? (
        <View style={styles.previewContainer}>
          <Markdown style={styles.markdownStyles}>{preview}</Markdown>
        </View>
      ) : (
        <Text style={styles.emptyPreview}>{t('common.none')}</Text>
      )}

      {/* Footer: updated date */}
      <View style={styles.footer}>
        <Text style={styles.date}>{dateText}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 * @returns StyleSheet + markdownPreviewStyles for this component
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  const sheet = StyleSheet.create({
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
    /** Wraps the Markdown preview — clipped to ~4 lines height. */
    previewContainer: {
      flex:       1,
      maxHeight:  fontSize.sm * 1.5 * 4,  // approx 4 lines
      overflow:   'hidden',
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

  /**
   * Markdown styles for the card preview.
   * Keeps all text small and muted to fit within the compact card layout.
   */
  const markdownStyles = {
    body: {
      fontSize:   fontSize.sm,
      color:      colors.textSecondary,
      lineHeight: fontSize.sm * 1.5,
    },
    paragraph: {
      marginTop:    0,
      marginBottom: 0,
    },
    heading1: { fontSize: fontSize.sm, fontWeight: '700' as const, marginBottom: 0 },
    heading2: { fontSize: fontSize.sm, fontWeight: '700' as const, marginBottom: 0 },
    heading3: { fontSize: fontSize.sm, fontWeight: '600' as const, marginBottom: 0 },
    code_inline: { fontSize: fontSize.sm, backgroundColor: 'transparent' },
    fence:       { fontSize: fontSize.sm, backgroundColor: 'transparent', padding: 0 },
    list_item:   { marginBottom: 0 },
  };

  return { ...sheet, markdownStyles };
}
