/**
 * Category management screen.
 *
 * Shows system default categories (read-only: 개인/업무/기타)
 * and user-defined categories (create/edit/delete).
 *
 * Route: /settings/categories
 * Entry: My 탭 → 설정 → 카테고리 관리
 *
 * TASK-401 (Sprint 4)
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/services/categoryService';
import type { Category, CreateCategoryInput } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Preset colors for the color picker ──────────────────────────────────────

const PRESET_COLORS = [
  '#4A90E2', '#E24A4A', '#9B9B9B', '#27AE60',
  '#F39C12', '#8E44AD', '#E91E63', '#00BCD4',
  '#FF5722', '#607D8B', '#795548', '#009688',
] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Individual category row in the list.
 * System categories show a lock icon; user categories have edit/delete buttons.
 *
 * @param category - Category to display
 * @param onEdit   - Called when the edit button is pressed
 * @param onDelete - Called when the delete button is pressed
 * @param colors   - Active theme color tokens
 * @param styles   - Pre-computed styles for current theme
 */
function CategoryRow({
  category,
  onEdit,
  onDelete,
  colors,
  styles,
}: {
  category: Category;
  onEdit:   (cat: Category) => void;
  onDelete: (cat: Category) => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}) {
  const isSystem = category.userId === null;

  return (
    <View style={styles.categoryRow}>
      {/* Color swatch */}
      <View style={[styles.colorSwatch, { backgroundColor: category.color }]} />

      {/* Name */}
      <Text style={styles.categoryName}>{category.name}</Text>

      {/* Lock for system, edit/delete for user categories */}
      {isSystem ? (
        <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
      ) : (
        <View style={styles.rowActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(category)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="pencil-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onDelete(category)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/**
 * Modal for creating or editing a user-defined category.
 * Includes a name text input and a preset color picker.
 *
 * @param visible  - Whether the modal is visible
 * @param editing  - Non-null when editing an existing category
 * @param onClose  - Called when the modal should close
 * @param onSave   - Called with validated name and color
 * @param colors   - Active theme color tokens
 * @param styles   - Pre-computed styles for current theme
 */
function CategoryFormModal({
  visible,
  editing,
  onClose,
  onSave,
  colors,
  styles,
}: {
  visible: boolean;
  /** If non-null, editing an existing category. If null, creating new. */
  editing: Category | null;
  onClose: () => void;
  onSave:  (name: string, color: string) => Promise<void>;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [name,      setName]      = useState('');
  // Explicit string type prevents literal type narrowing of PRESET_COLORS[0]
  const [color,     setColor]     = useState<string>(PRESET_COLORS[0]);
  const [isSaving,  setIsSaving]  = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
    } else {
      setName('');
      setColor(PRESET_COLORS[0]);
    }
  }, [editing, visible]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      Alert.alert('오류', '카테고리 이름을 입력해 주세요.');
      return;
    }
    setIsSaving(true);
    try {
      await onSave(trimmed, color);
      onClose();
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
          <Text style={styles.modalTitle}>
            {editing ? '카테고리 수정' : '새 카테고리'}
          </Text>

          {/* Name input */}
          <Text style={styles.fieldLabel}>이름</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="카테고리 이름"
            placeholderTextColor={colors.textPlaceholder}
            maxLength={30}
            autoFocus={!editing}
          />

          {/* Color picker */}
          <Text style={[styles.fieldLabel, { marginTop: spacing[4] }]}>색상</Text>
          <View style={styles.colorGrid}>
            {PRESET_COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorOption,
                  { backgroundColor: c },
                  color === c && styles.colorOptionSelected,
                ]}
                onPress={() => setColor(c)}
              >
                {color === c && (
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Preview */}
          <View style={styles.previewRow}>
            <View style={[styles.previewDot, { backgroundColor: color }]} />
            <Text style={styles.previewName}>{name || '미리보기'}</Text>
          </View>

          {/* Action buttons */}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.disabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.saveBtnText}>저장</Text>
              }
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CategoriesScreen() {
  // Dark mode: resolve current theme colors and build dynamic styles
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading,  setIsLoading]  = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCat,   setEditingCat]   = useState<Category | null>(null);

  // ── Load categories ────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const cats = await getCategories();
      setCategories(cats);
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '카테고리를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleCreate = () => {
    setEditingCat(null);
    setModalVisible(true);
  };

  const handleEdit = (cat: Category) => {
    setEditingCat(cat);
    setModalVisible(true);
  };

  const handleDelete = (cat: Category) => {
    Alert.alert(
      '카테고리 삭제',
      `"${cat.name}"을(를) 삭제하시겠습니까?\n연결된 할일의 카테고리가 초기화됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(cat.id);
              setCategories(prev => prev.filter(c => c.id !== cat.id));
            } catch (err) {
              Alert.alert('오류', err instanceof Error ? err.message : '삭제에 실패했습니다.');
            }
          },
        },
      ],
    );
  };

  const handleSave = async (name: string, color: string) => {
    if (editingCat) {
      // Update existing
      const updated = await updateCategory(editingCat.id, { name, color });
      setCategories(prev => prev.map(c => c.id === updated.id ? updated : c));
    } else {
      // Create new
      const created = await createCategory({ name, color } as CreateCategoryInput);
      setCategories(prev => [...prev, created]);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>카테고리 관리</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleCreate}>
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <CategoryRow
              category={item}
              onEdit={handleEdit}
              onDelete={handleDelete}
              colors={colors}
              styles={styles}
            />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>
              기본 카테고리는 수정·삭제할 수 없습니다.
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>카테고리가 없습니다.</Text>
            </View>
          }
        />
      )}

      {/* Create / Edit modal */}
      <CategoryFormModal
        visible={modalVisible}
        editing={editingCat}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        colors={colors}
        styles={styles}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 * @returns StyleSheet object for the categories screen and sub-components
 */
function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      flex:            1,
      backgroundColor: colors.background,
    },

    // Header
    header: {
      flexDirection:     'row',
      alignItems:        'center',
      height:            componentHeight.navHeader,
      paddingHorizontal: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: {
      padding:  spacing[1],
      minWidth: 40,
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
      flex:  1,
      textAlign: 'center',
    },
    addBtn: {
      padding:  spacing[1],
      minWidth: 40,
      alignItems: 'flex-end',
    },

    // List
    listContent: {
      paddingVertical: spacing[2],
    },
    sectionLabel: {
      ...textStyles.caption,
      color:             colors.textTertiary,
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[2],
    },

    // Category row
    categoryRow: {
      flexDirection:     'row',
      alignItems:        'center',
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor:   colors.background,
      gap:               spacing[3],
    },
    colorSwatch: {
      width:        24,
      height:       24,
      borderRadius: radius.sm,
      flexShrink:   0,
    },
    categoryName: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex:  1,
    },
    rowActions: {
      flexDirection: 'row',
      gap:           spacing[2],
    },
    actionBtn: {
      padding: spacing[1],
    },

    // Modal
    modalOverlay: {
      flex:            1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent:  'flex-end',
    },
    modalSheet: {
      backgroundColor:     colors.background,
      borderTopLeftRadius:  radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      padding:              spacing[6],
      gap:                  spacing[3],
    },
    modalTitle: {
      ...textStyles.h4,
      color:        colors.textPrimary,
      textAlign:    'center',
      marginBottom: spacing[2],
    },
    fieldLabel: {
      ...textStyles.label,
      color:        colors.textSecondary,
      marginBottom: spacing[1],
    },
    input: {
      height:            componentHeight.inputField,
      backgroundColor:   colors.inputBackground,
      borderWidth:       1,
      borderColor:       colors.inputBorder,
      borderRadius:      radius.md,
      paddingHorizontal: spacing[4],
      ...textStyles.body,
      color:             colors.textPrimary,
    },

    // Color grid
    colorGrid: {
      flexDirection:  'row',
      flexWrap:       'wrap',
      gap:            spacing[2],
    },
    colorOption: {
      width:          36,
      height:         36,
      borderRadius:   18,
      alignItems:     'center',
      justifyContent: 'center',
    },
    colorOptionSelected: {
      borderWidth: 3,
      borderColor: colors.textPrimary,
    },

    // Preview
    previewRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[2],
      paddingVertical:   spacing[2],
      paddingHorizontal: spacing[3],
      backgroundColor:   colors.surfaceAlt,
      borderRadius:      radius.md,
    },
    previewDot: {
      width:        12,
      height:       12,
      borderRadius: 6,
    },
    previewName: {
      ...textStyles.body,
      color: colors.textPrimary,
    },

    // Modal actions
    modalActions: {
      flexDirection: 'row',
      gap:           spacing[3],
      marginTop:     spacing[2],
    },
    cancelBtn: {
      flex:              1,
      height:            componentHeight.buttonSm,
      borderRadius:      radius.md,
      borderWidth:       1,
      borderColor:       colors.border,
      alignItems:        'center',
      justifyContent:    'center',
    },
    cancelBtnText: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
    },
    saveBtn: {
      flex:              1,
      height:            componentHeight.buttonSm,
      borderRadius:      radius.md,
      backgroundColor:   colors.primary,
      alignItems:        'center',
      justifyContent:    'center',
    },
    saveBtnText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
    disabled: {
      opacity: 0.5,
    },

    // Empty / loading states
    centered: {
      flex:           1,
      justifyContent: 'center',
      alignItems:     'center',
      paddingVertical: spacing[10],
    },
    emptyText: {
      ...textStyles.body,
      color: colors.textTertiary,
    },
  });
}
