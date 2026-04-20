/**
 * NoteEditor — full-screen plain-text editor for creating/editing notes.
 *
 * Editing mode: plain text (TextInput).
 * View mode: rendered markdown via react-native-markdown-display.
 *
 * The editor is self-contained and manages its own title/content state.
 * The parent provides initial values and onSave/onCancel callbacks.
 */

import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { light as colors } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontSize } from '@/constants/typography';

// ─── Markdown toolbar item ─────────────────────────────────────────────────

interface ToolbarItem {
  label: string;
  /** Wraps selection with prefix/suffix or inserts at cursor. */
  prefix: string;
  suffix?: string;
}

// Basic markdown shortcuts shown in the editor toolbar
const TOOLBAR_ITEMS: ToolbarItem[] = [
  { label: 'B',  prefix: '**', suffix: '**' },
  { label: 'I',  prefix: '*',  suffix: '*'  },
  { label: '–',  prefix: '- '              },
  { label: '[ ]', prefix: '- [ ] '          },
  { label: '#',  prefix: '# '              },
  { label: '``', prefix: '`',  suffix: '`'  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface NoteEditorProps {
  /** Initial note title. */
  initialTitle?: string;
  /** Initial note content (markdown). */
  initialContent?: string;
  /** Called when user taps Save. */
  onSave: (title: string, content: string) => void;
  /** Called when user taps Cancel or closes the editor. */
  onCancel: () => void;
  /** Whether the save operation is in progress (shows loading state). */
  isSaving?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NoteEditor({
  initialTitle = '',
  initialContent = '',
  onSave,
  onCancel,
  isSaving = false,
}: NoteEditorProps) {
  const [title,   setTitle]   = useState(initialTitle);
  const [content, setContent] = useState(initialContent);

  // Ref for the content TextInput — needed for toolbar insertion
  const contentRef = useRef<TextInput>(null);
  // Track cursor position for toolbar insertions
  const cursorRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // ── Toolbar action: wrap selection or insert at cursor ────────────────────

  const handleToolbar = (item: ToolbarItem) => {
    const { start, end } = cursorRef.current;
    const selected = content.slice(start, end);
    const before   = content.slice(0, start);
    const after    = content.slice(end);

    let inserted: string;
    if (item.suffix && selected.length > 0) {
      // Wrap selected text
      inserted = `${before}${item.prefix}${selected}${item.suffix}${after}`;
    } else {
      // Insert prefix at cursor (e.g. '- ' for bullet)
      inserted = `${before}${item.prefix}${selected}${item.suffix ?? ''}${after}`;
    }

    setContent(inserted);
    // Move cursor after insertion
    const newPos = start + item.prefix.length + selected.length;
    setTimeout(() => {
      contentRef.current?.setNativeProps({
        selection: { start: newPos, end: newPos },
      });
    }, 50);
  };

  // ── Save handler ──────────────────────────────────────────────────────────

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return; // require at least a title
    onSave(trimmedTitle, content);
  };

  const canSave = title.trim().length > 0 && !isSaving;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>취소</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>노트</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.headerButton, !canSave && styles.headerButtonDisabled]}
          disabled={!canSave}
        >
          <Text style={[styles.headerButtonText, styles.saveText, !canSave && styles.saveTextDisabled]}>
            {isSaving ? '저장 중…' : '저장'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Title input ── */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="제목"
          placeholderTextColor={colors.textPlaceholder}
          returnKeyType="next"
          onSubmitEditing={() => contentRef.current?.focus()}
          maxLength={255}
        />

        {/* Divider */}
        <View style={styles.divider} />

        {/* ── Markdown toolbar ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.toolbar}
          contentContainerStyle={styles.toolbarContent}
        >
          {TOOLBAR_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.toolbarBtn}
              onPress={() => handleToolbar(item)}
            >
              <Text style={styles.toolbarBtnText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Content input ── */}
        <TextInput
          ref={contentRef}
          style={styles.contentInput}
          value={content}
          onChangeText={setContent}
          placeholder="내용을 입력하세요. 마크다운을 지원합니다."
          placeholderTextColor={colors.textPlaceholder}
          multiline
          textAlignVertical="top"
          onSelectionChange={(e) => {
            cursorRef.current = e.nativeEvent.selection;
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  headerButton: {
    paddingVertical:   spacing[1],
    paddingHorizontal: spacing[2],
    minWidth:          60,
  },
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerButtonText: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  saveText: {
    color:      colors.primary,
    fontWeight: '600',
    textAlign:  'right',
  },
  saveTextDisabled: {
    color: colors.textTertiary,
  },
  scroll: {
    flex: 1,
  },
  titleInput: {
    fontSize:          fontSize.xl,
    fontWeight:        '600',
    color:             colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingTop:        spacing[4],
    paddingBottom:     spacing[2],
  },
  divider: {
    height:            1,
    backgroundColor:   colors.border,
    marginHorizontal:  spacing[4],
    marginBottom:      spacing[2],
  },
  toolbar: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarContent: {
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[2],
    gap:               spacing[2],
  },
  toolbarBtn: {
    backgroundColor:   colors.surfaceAlt,
    borderRadius:      radius.sm,
    paddingVertical:   spacing[1],
    paddingHorizontal: spacing[2],
    minWidth:          36,
    alignItems:        'center',
  },
  toolbarBtnText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  contentInput: {
    flex:              1,
    fontSize:          fontSize.base,
    color:             colors.textPrimary,
    lineHeight:        fontSize.base * 1.6,
    paddingHorizontal: spacing[4],
    paddingTop:        spacing[3],
    paddingBottom:     spacing[10],
    minHeight:         300,
  },
});
