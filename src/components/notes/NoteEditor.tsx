/**
 * NoteEditor — full-screen plain-text editor for creating/editing notes.
 *
 * Editing mode: plain text (TextInput).
 * View mode: rendered markdown via react-native-markdown-display.
 *
 * The editor is self-contained and manages its own title/content state.
 * The parent provides initial values and onSave/onCancel callbacks.
 *
 * Features:
 *  - Title input + markdown toolbar shortcuts
 *  - Plain-text content input (multiline)
 *  - Cross-platform placeholder fix (web vs. native Android)
 *  - Voice-to-text mic button in the toolbar (Sprint 13)
 *      Web:    window.SpeechRecognition (Chrome / Edge)
 *      Native: @react-native-voice/voice (iOS / Android)
 */

import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
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
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [title,   setTitle]   = useState(initialTitle);
  const [content, setContent] = useState(initialContent);

  /**
   * Tracks whether the content TextInput is focused.
   * Used for the Android placeholder workaround (see TextInput below).
   */
  const [isContentFocused, setIsContentFocused] = useState(false);

  // Ref for the content TextInput — needed for toolbar insertion
  const contentRef = useRef<TextInput>(null);
  // Track cursor position for toolbar insertions
  const cursorRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // ── Voice input ──────────────────────────────────────────────────────────

  /**
   * Animated scale for the mic button — pulses while listening.
   */
  const pulseAnim = useRef(new Animated.Value(1)).current;

  /**
   * Append each recognised speech segment to the note body.
   * A space separator is added automatically when the preceding text doesn't
   * already end in whitespace.
   */
  const handleSpeechResult = useCallback((text: string) => {
    setContent(prev => {
      const separator = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return prev + separator + text;
    });
  }, []);

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 500, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition({
    language:  'ko-KR',
    onResult:  handleSpeechResult,
    onEnd:     stopPulse,
    onError:   stopPulse,
  });

  /** Toggle the microphone: start if idle, stop if active. */
  const handleMicPress = useCallback(async () => {
    if (isListening) {
      await stopListening();
    } else {
      startPulse();
      await startListening();
    }
  }, [isListening, startListening, stopListening, startPulse]);

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
          <Text style={styles.headerButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('note.label')}</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.headerButton, !canSave && styles.headerButtonDisabled]}
          disabled={!canSave}
        >
          <Text style={[styles.headerButtonText, styles.saveText, !canSave && styles.saveTextDisabled]}>
            {isSaving ? t('common.saving') : t('common.save')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Title input ── */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder={t('note.title_placeholder')}
          placeholderTextColor={colors.textPlaceholder}
          returnKeyType="next"
          onSubmitEditing={() => contentRef.current?.focus()}
          maxLength={255}
        />

        {/* Divider */}
        <View style={styles.divider} />

        {/* ── Markdown toolbar (+ mic button at the end) ── */}
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

          {/*
           * Mic button in the markdown toolbar.
           * Only rendered when speech recognition is available on this device/browser.
           * A separator line visually groups it apart from the formatting shortcuts.
           */}
          {isSupported && (
            <>
              <View style={styles.toolbarSeparator} />
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                  style={[styles.toolbarBtn, styles.micBtn, isListening && styles.micBtnActive]}
                  onPress={() => void handleMicPress()}
                  accessibilityLabel={isListening ? '음성 인식 중지' : '음성으로 입력'}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={isListening ? 'mic' : 'mic-outline'}
                    size={16}
                    color={isListening ? colors.textInverse : colors.primary}
                  />
                </TouchableOpacity>
              </Animated.View>
            </>
          )}
        </ScrollView>

        {/* ── Content input ── */}
        {/*
         * On web: React Native's TextInput renders as a <textarea>, and the native
         * `placeholder` attribute already disappears on focus automatically — no
         * custom workaround needed. Passing an empty string when focused caused the
         * placeholder to flicker on web (briefly visible on re-render after focus).
         *
         * On native (Android): some older builds don't clear the placeholder on focus;
         * we pass '' when focused to handle that edge case.
         *
         * Solution: use the native placeholder prop unconditionally on web,
         * and apply the '' trick only on native platforms.
         */}
        <TextInput
          ref={contentRef}
          style={styles.contentInput}
          value={content}
          onChangeText={setContent}
          placeholder={
            Platform.OS === 'web'
              ? t('nl.placeholder')                            // web: let HTML handle it natively
              : (isContentFocused ? '' : t('nl.placeholder'))  // native: empty string on focus (Android fix)
          }
          placeholderTextColor={colors.textPlaceholder}
          multiline
          textAlignVertical="top"
          onFocus={() => setIsContentFocused(true)}
          onBlur={() => setIsContentFocused(false)}
          onSelectionChange={(e) => {
            cursorRef.current = e.nativeEvent.selection;
          }}
        />

        {/* Voice status indicator — shown below the content when listening */}
        {isListening && (
          <View style={styles.listeningBadge}>
            <View style={styles.listeningDot} />
            <Text style={styles.listeningText}>음성 인식 중...</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
    alignItems:        'center',
  },
  toolbarBtn: {
    backgroundColor:   colors.surfaceAlt,
    borderRadius:      radius.sm,
    paddingVertical:   spacing[1],
    paddingHorizontal: spacing[2],
    minWidth:          36,
    alignItems:        'center',
    justifyContent:    'center',
  },
  toolbarBtnText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },

  /** Vertical separator line between markdown shortcuts and mic button. */
  toolbarSeparator: {
    width:           1,
    height:          24,
    backgroundColor: colors.border,
    marginHorizontal: spacing[1],
  },

  /** Mic button variant of the toolbar button. */
  micBtn: {
    backgroundColor: colors.primaryLight,
    minWidth:        36,
    height:          32,
  },
  micBtnActive: {
    backgroundColor: colors.error,
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

  /** Badge shown below the content area while voice recognition is active. */
  listeningBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[2],
    marginHorizontal:  spacing[4],
    marginBottom:      spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1.5],
    backgroundColor:   colors.primaryLight,
    borderRadius:      radius.full,
    alignSelf:         'flex-start',
  },
  listeningDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: colors.primary,
  },
  listeningText: {
    ...textStyles.caption,
    color: colors.primary,
  },
  });
}
