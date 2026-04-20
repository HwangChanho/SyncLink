/**
 * Planner tab — Todo list + Notes viewer.
 *
 * Layout:
 *  [탭: Todo | Notes]
 *    Todo 탭:
 *      - 카테고리별 섹션 (헤더: 카테고리명, 항목: 체크박스 + 제목 + 우선순위)
 *      - 완료 항목 접기/펼치기
 *      - 빠른 추가 입력창 (하단 고정)
 *      - 항목 탭 → 상세/편집 모달
 *      - 스와이프 삭제 (Pressable + long press)
 *    Notes 탭:
 *      - 최근 수정 순 카드 목록
 *      - 빠른 작성 FAB (Floating Action Button)
 *
 * TASK-400 (Sprint 4)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
  Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { light as colors } from '@/constants/colors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo, Category } from '@/types';
import { getCategories } from '@/services/categoryService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab type for the planner top tabs. */
type PlannerTab = 'todo' | 'notes';

/** Priority color mapping for visual badges. */
const PRIORITY_COLORS: Record<string, string> = {
  high:   colors.error,
  medium: colors.warning,
  low:    colors.success,
};

/** Priority labels in Korean. */
const PRIORITY_LABELS: Record<string, string> = {
  high:   '높음',
  medium: '보통',
  low:    '낮음',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A single todo item row with checkbox, title, priority badge, and swipe-delete.
 *
 * @param todo - The todo item to display
 * @param onToggle - Called when the checkbox is pressed
 * @param onEdit - Called when the row is tapped (open edit modal)
 * @param onDelete - Called when the delete action is triggered
 */
function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: Todo;
  onToggle: (id: string) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
}) {
  const priorityColor = PRIORITY_COLORS[todo.priority] ?? colors.textTertiary;

  return (
    <Pressable
      style={({ pressed }) => [styles.todoRow, pressed && styles.todoRowPressed]}
      onPress={() => onEdit(todo)}
      onLongPress={() => {
        Alert.alert(
          '할일 삭제',
          `"${todo.title}"을(를) 삭제하시겠습니까?`,
          [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => onDelete(todo.id) },
          ],
        );
      }}
    >
      {/* Checkbox */}
      <TouchableOpacity
        style={styles.checkboxContainer}
        onPress={() => onToggle(todo.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <View style={[styles.checkbox, todo.isCompleted && styles.checkboxChecked]}>
          {todo.isCompleted && (
            <Ionicons name="checkmark" size={14} color={colors.textInverse} />
          )}
        </View>
      </TouchableOpacity>

      {/* Title */}
      <Text
        style={[styles.todoTitle, todo.isCompleted && styles.todoTitleCompleted]}
        numberOfLines={2}
      >
        {todo.title}
      </Text>

      {/* Priority badge */}
      <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '22' }]}>
        <Text style={[styles.priorityText, { color: priorityColor }]}>
          {PRIORITY_LABELS[todo.priority] ?? todo.priority}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Category section header row.
 *
 * @param category - Category object or null for uncategorized
 * @param count    - Number of items in this category
 * @param isExpanded - Whether completed items are shown
 * @param onToggleExpand - Toggle show/hide completed
 */
function CategorySectionHeader({
  category,
  count,
  completedCount,
  isExpanded,
  onToggleExpand,
}: {
  category: Category | null;
  count: number;
  completedCount: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const name = category?.name ?? '미분류';
  const color = category?.color ?? colors.textTertiary;

  return (
    <View style={styles.sectionHeader}>
      {/* Category color dot + name */}
      <View style={[styles.categoryDot, { backgroundColor: color }]} />
      <Text style={styles.sectionTitle}>{name}</Text>
      <Text style={styles.sectionCount}>{count - completedCount}개</Text>

      {/* Completed toggle */}
      {completedCount > 0 && (
        <TouchableOpacity
          style={styles.completedToggle}
          onPress={onToggleExpand}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Text style={styles.completedToggleText}>
            완료 {completedCount}개 {isExpanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Note card for the Notes tab.
 *
 * @param note    - Note Todo object
 * @param onPress - Called when card is tapped
 * @param onDelete - Called when delete is long-pressed
 */
function NoteCard({
  note,
  onPress,
  onDelete,
}: {
  note: Todo;
  onPress: (note: Todo) => void;
  onDelete: (id: string) => void;
}) {
  // Show first ~100 chars of content as preview
  const preview = note.content?.slice(0, 100) ?? '';
  const updatedLabel = formatRelativeDate(note.updatedAt);

  return (
    <Pressable
      style={({ pressed }) => [styles.noteCard, pressed && styles.noteCardPressed]}
      onPress={() => onPress(note)}
      onLongPress={() => {
        Alert.alert(
          '노트 삭제',
          `"${note.title}"을(를) 삭제하시겠습니까?`,
          [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => onDelete(note.id) },
          ],
        );
      }}
    >
      <Text style={styles.noteCardTitle} numberOfLines={1}>{note.title}</Text>
      {preview.length > 0 && (
        <Text style={styles.noteCardPreview} numberOfLines={3}>{preview}</Text>
      )}
      <Text style={styles.noteCardDate}>{updatedLabel}</Text>
    </Pressable>
  );
}

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

// ─── Edit Modal ───────────────────────────────────────────────────────────────

/**
 * Simple inline edit modal for a todo item.
 * Shows title input, priority selector, due date input.
 */
function EditTodoModal({
  todo,
  visible,
  onClose,
  onSave,
}: {
  todo: Todo | null;
  visible: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Todo>) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Sync input when todo changes
  useEffect(() => {
    setTitle(todo?.title ?? '');
  }, [todo]);

  const handleSave = useCallback(async () => {
    if (!todo || title.trim().length === 0) return;
    setIsSaving(true);
    try {
      await onSave(todo.id, { title: title.trim() });
      onClose();
    } catch {
      Alert.alert('오류', '수정에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [todo, title, onSave, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>할일 수정</Text>
          <TextInput
            style={styles.modalInput}
            value={title}
            onChangeText={setTitle}
            placeholder="할일 제목"
            placeholderTextColor={colors.textPlaceholder}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose} disabled={isSaving}>
              <Text style={styles.modalCancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSaveBtn, isSaving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.modalSaveText}>저장</Text>
              }
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  const { todos, notes, isLoading, error, fetchTodos, fetchNotes, addTodo, editTodo, removeTodo, removeNote, toggleTodo, clearError } = useTodoStore();

  const [activeTab, setActiveTab] = useState<PlannerTab>('todo');
  /** Map from categoryId to Category for O(1) lookup. */
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  /** Quick-add input value. */
  const [quickInput, setQuickInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  /** Which category sections have completed items expanded. */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  /** Todo currently being edited. */
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);

  const inputRef = useRef<TextInput>(null);

  // ── Load data on mount ───────────────────────────────────────────────────

  useEffect(() => {
    void fetchTodos();
    void fetchNotes();
    loadCategories();
  }, [fetchTodos, fetchNotes]);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await getCategories();
      // Build the lookup map — categories list itself is not rendered directly
      const map = new Map(cats.map(c => [c.id, c]));
      setCategoryMap(map);
    } catch {
      // Non-critical — categories are optional
    }
  }, []);

  // ── Error display ────────────────────────────────────────────────────────

  useEffect(() => {
    if (error) {
      Alert.alert('오류', error, [{ text: '확인', onPress: clearError }]);
    }
  }, [error, clearError]);

  // ── Quick add ────────────────────────────────────────────────────────────

  const handleQuickAdd = useCallback(async () => {
    const trimmed = quickInput.trim();
    if (trimmed.length === 0) return;

    setIsAdding(true);
    try {
      await addTodo({
        title: trimmed,
        contentType: activeTab === 'notes' ? 'note' : 'todo',
      });
      setQuickInput('');
    } catch {
      // Error already set in store
    } finally {
      setIsAdding(false);
    }
  }, [quickInput, activeTab, addTodo]);

  // ── Toggle expand completed ──────────────────────────────────────────────

  const toggleExpand = useCallback((sectionKey: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  // ── Render Todo tab ──────────────────────────────────────────────────────

  /**
   * Group todos by categoryId.
   * Returns an ordered array of [categoryId | '__uncategorized', Todo[]] tuples.
   */
  const groupedTodos = useCallback((): Array<{ key: string; category: Category | null; items: Todo[] }> => {
    const groups = new Map<string, Todo[]>();

    for (const todo of todos) {
      const key = todo.categoryId ?? '__uncategorized';
      const existing = groups.get(key);
      if (existing) {
        existing.push(todo);
      } else {
        groups.set(key, [todo]);
      }
    }

    // Sort: categorized first (alphabetically), uncategorized last
    const result: Array<{ key: string; category: Category | null; items: Todo[] }> = [];
    for (const [key, items] of groups.entries()) {
      result.push({
        key,
        category: key !== '__uncategorized' ? (categoryMap.get(key) ?? null) : null,
        items,
      });
    }

    result.sort((a, b) => {
      if (a.key === '__uncategorized') return 1;
      if (b.key === '__uncategorized') return -1;
      return (a.category?.name ?? '').localeCompare(b.category?.name ?? '');
    });

    return result;
  }, [todos, categoryMap]);

  const renderTodoTab = () => {
    if (isLoading && todos.length === 0) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (todos.length === 0) {
      return (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>할일이 없습니다</Text>
          <Text style={styles.emptySubText}>아래 입력창으로 할일을 추가해 보세요</Text>
        </View>
      );
    }

    const groups = groupedTodos();

    return (
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map(({ key, category, items }) => {
          const incompleteTodos = items.filter(t => !t.isCompleted);
          const completedTodos  = items.filter(t => t.isCompleted);
          const isExpanded = expandedSections.has(key);

          return (
            <View key={key} style={styles.categorySection}>
              <CategorySectionHeader
                category={category}
                count={items.length}
                completedCount={completedTodos.length}
                isExpanded={isExpanded}
                onToggleExpand={() => toggleExpand(key)}
              />

              {/* Incomplete todos */}
              {incompleteTodos.map(todo => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={toggleTodo}
                  onEdit={setEditingTodo}
                  onDelete={removeTodo}
                />
              ))}

              {/* Completed todos (collapsible) */}
              {isExpanded && completedTodos.map(todo => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={toggleTodo}
                  onEdit={setEditingTodo}
                  onDelete={removeTodo}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ── Render Notes tab ─────────────────────────────────────────────────────

  const renderNotesTab = () => {
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
          <Text style={styles.emptyText}>노트가 없습니다</Text>
          <Text style={styles.emptySubText}>아래 버튼으로 첫 노트를 작성해 보세요</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.notesGrid}
        columnWrapperStyle={styles.notesRow}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            onPress={(note) => router.push(`/note/${note.id}`)}
            onDelete={removeNote}
          />
        )}
      />
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>플래너</Text>
        {/* Category management shortcut */}
        <TouchableOpacity
          style={styles.headerAction}
          onPress={() => router.push('/settings/categories')}
        >
          <Ionicons name="options-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['todo', 'notes'] as PlannerTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === 'todo' ? '할일' : '노트'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={componentHeight.tabBar + (Platform.OS === 'ios' ? 20 : 0)}
      >
        <View style={styles.flex}>
          {activeTab === 'todo' ? renderTodoTab() : renderNotesTab()}
        </View>

        {/* Quick add bar — Todo tab only */}
        {activeTab === 'todo' && (
          <View style={styles.quickAddBar}>
            <TextInput
              ref={inputRef}
              style={styles.quickAddInput}
              value={quickInput}
              onChangeText={setQuickInput}
              placeholder="할일 빠르게 추가..."
              placeholderTextColor={colors.textPlaceholder}
              returnKeyType="done"
              onSubmitEditing={handleQuickAdd}
              editable={!isAdding}
            />
            <TouchableOpacity
              style={[styles.quickAddBtn, (isAdding || quickInput.trim().length === 0) && styles.buttonDisabled]}
              onPress={handleQuickAdd}
              disabled={isAdding || quickInput.trim().length === 0}
            >
              {isAdding
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Ionicons name="add" size={22} color={colors.textInverse} />
              }
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* FAB — Notes tab only */}
      {activeTab === 'notes' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/note/new')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color={colors.textInverse} />
        </TouchableOpacity>
      )}

      {/* Edit modal for todos */}
      <EditTodoModal
        todo={editingTodo}
        visible={editingTodo !== null}
        onClose={() => setEditingTodo(null)}
        onSave={editTodo}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: componentHeight.navHeader,
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...textStyles.h3,
    color: colors.textPrimary,
    flex: 1,
  },
  headerAction: {
    padding: spacing[1],
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  tabItem: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    ...textStyles.labelLg,
    color: colors.textSecondary,
  },
  tabLabelActive: {
    color: colors.primary,
  },

  // List
  listContainer: { flex: 1 },
  listContent: {
    paddingTop: spacing[2],
    paddingBottom: spacing[20],
  },

  // Category section
  categorySection: {
    marginBottom: spacing[2],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
    backgroundColor: colors.backgroundAlt,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  sectionTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex: 1,
  },
  sectionCount: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  completedToggle: {
    paddingHorizontal: spacing[2],
  },
  completedToggleText: {
    ...textStyles.caption,
    color: colors.primary,
  },

  // Todo row
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing[3],
    backgroundColor: colors.background,
  },
  todoRowPressed: {
    backgroundColor: colors.backgroundAlt,
  },
  checkboxContainer: {
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  todoTitle: {
    ...textStyles.body,
    color: colors.textPrimary,
    flex: 1,
  },
  todoTitleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textTertiary,
  },
  priorityBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: radius.sm,
  },
  priorityText: {
    ...textStyles.labelSm,
  },

  // Notes grid
  notesGrid: {
    padding: spacing[3],
    paddingBottom: spacing[20],
  },
  notesRow: {
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  noteCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    minHeight: 120,
    gap: spacing[1],
  },
  noteCardPressed: {
    backgroundColor: colors.backgroundAlt,
  },
  noteCardTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  noteCardPreview: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
    flex: 1,
  },
  noteCardDate: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginTop: spacing[1],
  },

  // Quick add bar
  quickAddBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  quickAddInput: {
    flex: 1,
    height: componentHeight.buttonSm,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.full,
    paddingHorizontal: spacing[4],
    ...textStyles.body,
    color: colors.textPrimary,
  },
  quickAddBtn: {
    width: componentHeight.buttonSm,
    height: componentHeight.buttonSm,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // FAB
  fab: {
    position: 'absolute',
    right: spacing[5],
    bottom: spacing[8],
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },

  // Empty states
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  emptyText: {
    ...textStyles.h4,
    color: colors.textSecondary,
  },
  emptySubText: {
    ...textStyles.bodySm,
    color: colors.textTertiary,
    textAlign: 'center',
  },

  // Edit modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    padding: spacing[6],
    gap: spacing[4],
  },
  modalTitle: {
    ...textStyles.h4,
    color: colors.textPrimary,
  },
  modalInput: {
    height: componentHeight.inputField,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    ...textStyles.body,
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  modalCancelBtn: {
    flex: 1,
    height: componentHeight.buttonSm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    ...textStyles.labelLg,
    color: colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    height: componentHeight.buttonSm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
