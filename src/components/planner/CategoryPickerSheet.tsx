/**
 * CategoryPickerSheet — Bottom-sheet style picker for todo categories.
 *
 * Renders as a native Modal anchored to the bottom of the screen (consistent
 * with the existing EditTodoModal pattern). Avoids the extra native setup
 * burden of @gorhom/bottom-sheet while still providing the same UX:
 *   - scrollable category list
 *   - inline "+ 새 카테고리" creator with color palette
 *   - keyboard-aware on iOS via KeyboardAvoidingView
 *
 * Sprint 14 TASK-1413
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { Category } from '@/types';
import { createCategory, getCategories } from '@/services/categoryService';

// ─── Color palette ────────────────────────────────────────────────────────────

/**
 * Predefined colors for new categories. Chosen for accessibility (WCAG AA
 * against both light and dark backgrounds for the white chip text).
 */
const CATEGORY_COLORS: string[] = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#10B981', // emerald
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#6B7280', // gray
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CategoryPickerSheetProps {
  /** Whether the sheet is visible. */
  visible: boolean;

  /** Currently selected category id (null = uncategorized). */
  selectedId: string | null;

  /** Close the sheet without choosing. */
  onClose: () => void;

  /**
   * Called when the user picks a category (or "uncategorized" via null).
   * Parent is responsible for persisting the choice.
   */
  onSelect: (categoryId: string | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Bottom-sheet picker that lists existing categories and allows inline
 * creation. Refreshes the list when `visible` becomes true so newly added
 * categories from elsewhere are picked up.
 */
export function CategoryPickerSheet({
  visible,
  selectedId,
  onClose,
  onSelect,
}: CategoryPickerSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // ── Category list state ────────────────────────────────────────────────────

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Inline creation state ──────────────────────────────────────────────────

  /** When true, reveal the name/color picker at the bottom. */
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(CATEGORY_COLORS[0] ?? '#3B82F6');
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // ── Effects ────────────────────────────────────────────────────────────────

  /**
   * Load categories whenever the sheet opens. A fresh fetch avoids stale
   * lists if the user created a category elsewhere since last open.
   */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const cats = await getCategories();
        if (!cancelled) setCategories(cats);
      } catch {
        // Non-fatal — keep showing the cached list.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Reset the creation form each time the sheet closes.
  useEffect(() => {
    if (!visible) {
      setCreating(false);
      setNewName('');
      setNewColor(CATEGORY_COLORS[0] ?? '#3B82F6');
    }
  }, [visible]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Submit inline "new category" and auto-select it. */
  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (trimmed.length === 0 || submittingCreate) return;

    setSubmittingCreate(true);
    try {
      const created = await createCategory({ name: trimmed, color: newColor });
      setCategories((prev) => [...prev, created]);
      onSelect(created.id);
      onClose();
    } catch {
      // Show a soft error via the creation row (non-blocking).
      setSubmittingCreate(false);
    }
  }, [newName, newColor, onSelect, onClose, submittingCreate]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        {/*
         * stopPropagation on the sheet prevents the overlay press from
         * dismissing the sheet when interacting with controls inside.
         */}
        <Pressable style={styles.sheetWrapper} onPress={(e) => e.stopPropagation()}>
          <KeyboardAvoidingView
            // TASK-004: 카테고리 추가 시 키보드가 TextInput + 색상 palette 가렸음.
            // iOS는 padding + offset, Android는 height behavior로 sheet 자체 압축.
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
            style={styles.sheet}
          >
            {/* Header */}
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{t('planner.change_category')}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* Loading */}
            {loading && categories.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <FlatList
                // Build-54 — "카테고리 없음" 항목 제거. 새 일정의 기본은
                // 기타(builtin "other") 카테고리, 사용자가 명시적으로
                // 다른 카테고리를 골라야만 변경됨. 모든 일정에 카테고리가
                // 강제로 부여되므로 색/필터/뷰가 일관되게 동작함.
                data={categories}
                keyExtractor={(c) => c.id ?? ''}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const isSelected = selectedId === item.id;
                  return (
                    <Pressable
                      style={({ pressed }) => [
                        styles.row,
                        pressed && styles.rowPressed,
                      ]}
                      onPress={() => {
                        onSelect(item.id as string);
                        onClose();
                      }}
                    >
                      <View
                        style={[
                          styles.rowDot,
                          {
                            backgroundColor: item.color ?? colors.textTertiary,
                          },
                        ]}
                      />
                      <Text style={styles.rowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.primary}
                        />
                      )}
                    </Pressable>
                  );
                }}
              />
            )}

            {/* Inline create */}
            {!creating ? (
              <Pressable
                style={styles.createTrigger}
                onPress={() => setCreating(true)}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={styles.createTriggerText}>
                  {t('planner.new_category')}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.createForm}>
                <TextInput
                  style={styles.createInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('planner.new_category')}
                  placeholderTextColor={colors.textPlaceholder}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => void handleCreate()}
                />
                {/* Color palette */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.paletteRow}
                >
                  {CATEGORY_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      style={[
                        styles.swatch,
                        { backgroundColor: c },
                        newColor === c && styles.swatchSelected,
                      ]}
                      onPress={() => setNewColor(c)}
                      accessibilityLabel={`color ${c}`}
                    />
                  ))}
                </ScrollView>
                <Pressable
                  style={[
                    styles.createSubmit,
                    (submittingCreate || newName.trim().length === 0) &&
                      styles.createSubmitDisabled,
                  ]}
                  onPress={() => void handleCreate()}
                  disabled={submittingCreate || newName.trim().length === 0}
                >
                  {submittingCreate ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={styles.createSubmitText}>
                      {t('common.save')}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheetWrapper: {
      width: '100%',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing[5],
      paddingTop: spacing[2],
      paddingBottom: spacing[8],
      maxHeight: '80%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[3],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing[3],
    },
    title: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    center: {
      padding: spacing[6],
      alignItems: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[2],
      borderRadius: radius.md,
    },
    rowPressed: {
      backgroundColor: colors.backgroundAlt,
    },
    rowDot: {
      width: 12,
      height: 12,
      borderRadius: radius.full,
    },
    rowName: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex: 1,
    },

    // Create button
    createTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[2],
      marginTop: spacing[2],
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    createTriggerText: {
      ...textStyles.labelLg,
      color: colors.primary,
    },

    createForm: {
      gap: spacing[3],
      marginTop: spacing[2],
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing[3],
    },
    createInput: {
      ...textStyles.body,
      color: colors.textPrimary,
      backgroundColor: colors.inputBackground,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    paletteRow: {
      gap: spacing[2],
      paddingVertical: spacing[1],
    },
    swatch: {
      width: 28,
      height: 28,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    swatchSelected: {
      borderColor: colors.textPrimary,
    },
    createSubmit: {
      backgroundColor: colors.primary,
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      alignItems: 'center',
    },
    createSubmitDisabled: {
      opacity: 0.5,
    },
    createSubmitText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
  });
}
