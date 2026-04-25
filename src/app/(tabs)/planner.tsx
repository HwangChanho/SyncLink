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
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
  Pressable,
} from 'react-native';
// Swipeable enables the two-way gesture actions (delete vs. change category)
// required by TASK-1414. Import from gesture-handler's legacy path which is
// the only bundle compatible with Reanimated 3 as installed in this project.
import { Swipeable } from 'react-native-gesture-handler';
import { showAlert } from '@/lib/webAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo, Category } from '@/types';
import { getCategories } from '@/services/categoryService';
import { TodoEditSheet } from '@/components/planner/TodoEditSheet';
import { TodoCreateSheet } from '@/components/planner/TodoCreateSheet';
import { CategoryPickerSheet } from '@/components/planner/CategoryPickerSheet';
import { DateTimeModal } from '@/components/common/DateTimeModal';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab type for the planner top tabs. */
type PlannerTab = 'todo' | 'notes';

// Priority labels are now loaded via useTranslation inside components.

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A single todo item row with checkbox, title, priority badge, and swipe-delete.
 * Wrapped in memo to prevent re-renders when parent re-renders (TASK-701).
 *
 * @param todo     - The todo item to display
 * @param onToggle - Called when the checkbox is pressed
 * @param onEdit   - Called when the row is tapped (open edit modal)
 * @param onDelete - Called when the delete action is triggered
 * @param colors   - Active theme color tokens
 * @param styles   - Pre-computed styles for current theme
 */
const TodoRow = memo(function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
  onChangeCategory,
  colors,
  styles,
}: {
  todo: Todo;
  onToggle: (id: string) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  /** Fired when the user swipes in the "category" direction (TASK-1414). */
  onChangeCategory: (todo: Todo) => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  // Priority color mapping — uses live color tokens
  const priorityColorMap: Record<string, string> = {
    high:   colors.error,
    medium: colors.warning,
    low:    colors.success,
  };
  const priorityColor = priorityColorMap[todo.priority] ?? colors.textTertiary;

  /** Priority labels loaded from i18n. */
  const priorityLabels: Record<string, string> = {
    high:   t('todo.priority.high'),
    medium: t('todo.priority.medium'),
    low:    t('todo.priority.low'),
  };

  // Right action (swipe LEFT to reveal): destructive delete. Keeps the
  // existing long-press confirmation path alive as a fallback for users
  // who miss the swipe affordance.
  const renderRightActions = () => (
    <View style={[styles.swipeAction, styles.swipeDeleteAction]}>
      <Ionicons name="trash" size={20} color={colors.textInverse} />
      <Text style={styles.swipeActionText}>{t('common.delete')}</Text>
    </View>
  );

  // Left action (swipe RIGHT to reveal): change category (TASK-1414).
  const renderLeftActions = () => (
    <View style={[styles.swipeAction, styles.swipeCategoryAction]}>
      <Ionicons name="folder-open" size={20} color={colors.textInverse} />
      <Text style={styles.swipeActionText}>{t('planner.change_category')}</Text>
    </View>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      onSwipeableOpen={(direction, swipeable) => {
        // React to the gesture then collapse so the row doesn't stay open.
        swipeable.close();
        if (direction === 'right') {
          // "right" here means the user swiped right → revealing LEFT action.
          onChangeCategory(todo);
        } else {
          onDelete(todo.id);
        }
      }}
      overshootLeft={false}
      overshootRight={false}
    >
      <Pressable
        style={({ pressed }) => [styles.todoRow, pressed && styles.todoRowPressed]}
        onPress={() => onEdit(todo)}
        onLongPress={() => {
          showAlert(
            t('todo.delete'),
            `"${todo.title}"을(를) 삭제하시겠습니까?`,
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.delete'), style: 'destructive', onPress: () => onDelete(todo.id) },
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
            {priorityLabels[todo.priority] ?? todo.priority}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
});

/**
 * Category section header row.
 *
 * @param category       - Category object or null for uncategorized
 * @param count          - Total items in this category
 * @param completedCount - Completed items count
 * @param isExpanded     - Whether completed items are shown
 * @param onToggleExpand - Toggle show/hide completed
 * @param colors         - Active theme color tokens
 * @param styles         - Pre-computed styles for current theme
 */
function CategorySectionHeader({
  category,
  count,
  completedCount,
  isExpanded,
  onToggleExpand,
  colors,
  styles,
  labelOverride,
}: {
  category: Category | null;
  count: number;
  completedCount: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
  /**
   * Optional override for non-category grouping modes (e.g. date/priority).
   * When provided, takes precedence over `category?.name`.
   */
  labelOverride?: string;
}) {
  const { t: tCat } = useTranslation();
  const name = labelOverride ?? category?.name ?? tCat('todo.uncategorized');
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
 * Wrapped in memo to prevent re-renders when scrolling (TASK-701).
 *
 * @param note    - Note Todo object
 * @param onPress - Called when card is tapped
 * @param onDelete - Called when delete is long-pressed
 * @param styles  - Pre-computed styles for current theme
 */
const NoteCard = memo(function NoteCard({
  note,
  onPress,
  onDelete,
  styles,
}: {
  note: Todo;
  onPress: (note: Todo) => void;
  onDelete: (id: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t: tNote } = useTranslation();
  // Show first ~100 chars of content as preview
  const preview = note.content?.slice(0, 100) ?? '';
  const updatedLabel = formatRelativeDate(note.updatedAt);

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
      <Text style={styles.noteCardTitle} numberOfLines={1}>{note.title}</Text>
      {preview.length > 0 && (
        <Text style={styles.noteCardPreview} numberOfLines={3}>{preview}</Text>
      )}
      <Text style={styles.noteCardDate}>{updatedLabel}</Text>
    </Pressable>
  );
});

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlannerScreen() {
  // Dark mode: resolve current theme colors and build dynamic styles
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { todos, notes, isLoading, error, fetchTodos, fetchNotes, addTodo, editTodo, removeTodo, removeNote, toggleTodo, clearError } = useTodoStore();

  const [activeTab, setActiveTab] = useState<PlannerTab>('todo');
  /** Map from categoryId to Category for O(1) lookup. */
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  /** Which category sections have completed items expanded. */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  /** Todo currently being edited. */
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  /**
   * Todo whose category is being changed via swipe (TASK-1414).
   * When non-null, the CategoryPickerSheet opens.
   */
  const [categoryChangeTodo, setCategoryChangeTodo] = useState<Todo | null>(null);
  /**
   * Category preselected for the next quick-add todo. Null = 카테고리 없음.
   * Lets the user pick a category before tapping + so new items land in the
   * right bucket without opening the edit sheet.
   */
  const [quickAddCategoryId, setQuickAddCategoryId] = useState<string | null>(null);
  /** Whether the category picker for the quick-add bar is visible. */
  const [quickAddPickerVisible, setQuickAddPickerVisible] = useState(false);
  /** Due date preselected for the next quick-add todo. */
  const [quickAddDueDate, setQuickAddDueDate] = useState<Date | null>(null);
  /** Whether the native date picker is open for quick-add. */
  const [quickAddDateModalVisible, setQuickAddDateModalVisible] = useState(false);
  /** Todo tab view grouping. Default 'category' matches prior behaviour. */
  const [todoView, setTodoView] = useState<'category' | 'date' | 'priority'>('category');
  /** TodoCreateSheet visibility — FAB on Todo tab opens it. */
  const [createSheetOpen, setCreateSheetOpen] = useState(false);


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

  // Prevent duplicate Alerts when multiple store operations fail simultaneously
  // (e.g. fetchTodos + fetchNotes both error on mount).
  const alertActiveRef = useRef(false);

  useEffect(() => {
    if (error && !alertActiveRef.current) {
      alertActiveRef.current = true;
      showAlert(t('common.error'), error, [{
        text: t('common.ok'),
        onPress: () => {
          clearError();
          alertActiveRef.current = false;
        },
      }]);
    }
  }, [error, clearError, t]);


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
  /**
   * Build the ordered, grouped list the todo tab renders. Three modes:
   *   - 'category': by categoryId, original behaviour
   *   - 'date': by due date (overdue → today → later → none)
   *   - 'priority': by priority (high → med → low → none)
   * The returned `category` field is populated only in 'category' mode;
   * for the other modes it's null and the `label` field carries the
   * human-readable bucket name.
   */
  const groupedTodos = useCallback((): Array<{
    key: string;
    label: string;
    category: Category | null;
    items: Todo[];
  }> => {
    const groups = new Map<string, Todo[]>();

    const dateBucket = (d: Date | null): string => {
      if (!d) return 'zzz_none';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(d);
      target.setHours(0, 0, 0, 0);
      if (target < today) return '0_overdue';
      if (target.getTime() === today.getTime()) return '1_today';
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (target.getTime() === tomorrow.getTime()) return '2_tomorrow';
      const in7 = new Date(today);
      in7.setDate(in7.getDate() + 7);
      if (target < in7) return '3_this_week';
      return '4_later';
    };
    const dateLabel = (bucket: string): string => ({
      '0_overdue': '지난 일정',
      '1_today': '오늘',
      '2_tomorrow': '내일',
      '3_this_week': '이번 주',
      '4_later': '나중에',
      'zzz_none': '마감일 없음',
    }[bucket] ?? bucket);

    const priorityBucket = (p: Todo['priority']): string => (p ?? 'zzz_none');
    const priorityLabel = (bucket: string): string => ({
      high: '높음',
      medium: '보통',
      low: '낮음',
      'zzz_none': '우선순위 없음',
    }[bucket] ?? bucket);

    for (const todo of todos) {
      let key: string;
      if (todoView === 'date') key = dateBucket(todo.dueDate);
      else if (todoView === 'priority') key = priorityBucket(todo.priority);
      else key = todo.categoryId ?? '__uncategorized';
      const existing = groups.get(key);
      if (existing) existing.push(todo);
      else groups.set(key, [todo]);
    }

    const result: Array<{
      key: string;
      label: string;
      category: Category | null;
      items: Todo[];
    }> = [];
    for (const [key, items] of groups.entries()) {
      let label: string;
      let category: Category | null = null;
      if (todoView === 'date') label = dateLabel(key);
      else if (todoView === 'priority') label = priorityLabel(key);
      else {
        category = key !== '__uncategorized' ? (categoryMap.get(key) ?? null) : null;
        label = category?.name ?? '카테고리 없음';
      }
      result.push({ key, label, category, items });
    }

    // Sort: numeric prefix buckets use their natural key order; otherwise by label.
    result.sort((a, b) => {
      if (todoView === 'category') {
        if (a.key === '__uncategorized') return 1;
        if (b.key === '__uncategorized') return -1;
        return a.label.localeCompare(b.label);
      }
      return a.key.localeCompare(b.key);
    });

    return result;
  }, [todos, categoryMap, todoView]);

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
          <Text style={styles.emptyText}>{t('todo.label')} {t('common.none')}</Text>
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
        {groups.map(({ key, category, items, label }) => {
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
                colors={colors}
                styles={styles}
                {...(todoView !== 'category' ? { labelOverride: label } : {})}
              />

              {/* Incomplete todos */}
              {incompleteTodos.map(todo => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={toggleTodo}
                  onEdit={setEditingTodo}
                  onDelete={removeTodo}
                  onChangeCategory={setCategoryChangeTodo}
                  colors={colors}
                  styles={styles}
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
                  onChangeCategory={setCategoryChangeTodo}
                  colors={colors}
                  styles={styles}
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
          <Text style={styles.emptyText}>{t('note.label')} {t('common.none')}</Text>
        </View>
      );
    }

    // Memoized renderItem to prevent unnecessary re-renders on scroll (TASK-701)
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
        keyExtractor={(item) => item.id}    // explicit keyExtractor (TASK-701)
        numColumns={2}
        contentContainerStyle={styles.notesGrid}
        columnWrapperStyle={styles.notesRow}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}        // remove off-screen items (TASK-701)
        maxToRenderPerBatch={10}            // limit batch render size (TASK-701)
        windowSize={5}                      // keep 5x viewport in memory (TASK-701)
        initialNumToRender={10}             // initial render count (TASK-701)
        renderItem={renderNoteItem}
      />
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/*
        Top label removed — the tab navigator already renders "플래너"
        in its bold title slot, having a second copy below it was
        redundant. Keep the category-management shortcut, but right-
        align it on its own row so it remains accessible.
      */}
      <View style={styles.header}>
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
              {tab === 'todo' ? t('todo.label') : t('note.label')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Todo grouping mode — segmented control under the tab bar. Only
          visible on the Todo tab. Categorisation mode stays the default. */}
      {activeTab === 'todo' && (
        <View style={styles.viewModeBar}>
          {([
            { key: 'category', label: '카테고리별' },
            { key: 'date',     label: '날짜순' },
            { key: 'priority', label: '우선순위' },
          ] as const).map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.viewModeItem, todoView === m.key && styles.viewModeItemActive]}
              onPress={() => setTodoView(m.key)}
            >
              <Text
                style={[
                  styles.viewModeLabel,
                  todoView === m.key && styles.viewModeLabelActive,
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // Set offset to 0: the quick-add bar sits at the bottom of this
        // KeyboardAvoidingView, so behavior="padding" pushes the whole
        // content above the keyboard. The previous tabBar offset caused
        // the bar to stop ~80 px below the keyboard top.
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          {activeTab === 'todo' ? renderTodoTab() : renderNotesTab()}
        </View>

        {/* Inline quick-add bar removed — replaced by FAB + TodoCreateSheet. */}
      </KeyboardAvoidingView>

      {/* Quick-add category picker — controlled by the chip above */}
      <CategoryPickerSheet
        visible={quickAddPickerVisible}
        selectedId={quickAddCategoryId}
        onClose={() => setQuickAddPickerVisible(false)}
        onSelect={(id) => {
          setQuickAddCategoryId(id);
          setQuickAddPickerVisible(false);
          // Refresh local category map so the chip's color updates immediately
          // after creating a new category inside the picker.
          void getCategories().then((list) => {
            setCategoryMap(new Map(list.map((c) => [c.id, c])));
          });
        }}
      />

      {/* Quick-add due-date picker */}
      {quickAddDateModalVisible && (
        <DateTimeModal
          visible={quickAddDateModalVisible}
          initialValue={quickAddDueDate ?? (() => {
            const d = new Date();
            d.setHours(9, 0, 0, 0);
            return d;
          })()}
          allDay={true}
          onCancel={() => setQuickAddDateModalVisible(false)}
          onConfirm={(d) => {
            setQuickAddDueDate(d);
            setQuickAddDateModalVisible(false);
          }}
        />
      )}

      {/*
        FAB — opens TodoCreateSheet on Todo tab, or navigates to the note
        composer on Notes tab. Same bottom-right anchor in both cases so
        the affordance is consistent.
      */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          if (activeTab === 'notes') {
            router.push('/note/new');
          } else {
            setCreateSheetOpen(true);
          }
        }}
        activeOpacity={0.8}
        accessibilityLabel={activeTab === 'notes' ? '새 노트' : '새 할일'}
      >
        <Ionicons name="add" size={28} color={colors.textInverse} />
      </TouchableOpacity>

      {/*
       * Bottom-sheet todo editor (Sprint 14 TASK-1412).
       * Replaces the old mid-screen EditTodoModal so the keyboard never
       * obscures the input when editing title / memo.
       */}
      <TodoEditSheet
        todo={editingTodo}
        categoryMap={categoryMap}
        onClose={() => setEditingTodo(null)}
        onSave={editTodo}
      />

      {/*
        New-todo bottom sheet (replaces the inline quick-add bar).  The
        sheet owns its own KeyboardAvoidingView so the input never sits
        under the keyboard, which was the problem report.
      */}
      <TodoCreateSheet
        visible={createSheetOpen}
        categoryMap={categoryMap}
        defaultCategoryId={quickAddCategoryId}
        onClose={() => setCreateSheetOpen(false)}
        onCreate={(input) => addTodo(input)}
      />

      {/*
       * Swipe-triggered category picker (TASK-1414).
       * Opens when the user swipes a row in the "change category" direction.
       * On select, patches the todo via the todo store (optimistic update
       * is already handled inside editTodo).
       */}
      <CategoryPickerSheet
        visible={categoryChangeTodo !== null}
        selectedId={categoryChangeTodo?.categoryId ?? null}
        onClose={() => setCategoryChangeTodo(null)}
        onSelect={(newCategoryId) => {
          if (!categoryChangeTodo) return;
          const target = categoryChangeTodo;
          setCategoryChangeTodo(null);
          void editTodo(target.id, { categoryId: newCategoryId })
            .then(() => {
              showAlert(t('planner.category_changed'), '');
            })
            .catch(() => {
              // Surfaced via the store's error state already.
            });
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 * @returns StyleSheet object for the planner screen and sub-components
 */
function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },

    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // Header — title removed; this row only holds the right-side action icon.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
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
      // paddingTop removed so the first category section sits flush
      // with the view-mode segmented control above it.
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

    // Swipe action backdrops (TASK-1414)
    swipeAction: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: 96,
      gap: spacing[1],
    },
    swipeDeleteAction: {
      backgroundColor: colors.error,
    },
    swipeCategoryAction: {
      backgroundColor: colors.primary,
    },
    swipeActionText: {
      ...textStyles.labelSm,
      color: colors.textInverse,
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
    // Inline category chip on the quick-add bar. Neutral styling by default;
    // per-chip colour overrides applied inline when a category is selected.
    quickAddCategoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 110,
      paddingHorizontal: spacing[2],
      height: componentHeight.buttonSm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
    quickAddCategoryLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    // Small circular icon button on the quick-add bar (date / priority).
    quickAddIconBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing[2],
      height: componentHeight.buttonSm,
      minWidth: componentHeight.buttonSm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
    quickAddIconLabel: {
      ...textStyles.caption,
    },
    // Segmented control for Todo tab grouping.
    viewModeBar: {
      flexDirection: 'row',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      gap: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    viewModeItem: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    viewModeItemActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    viewModeLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    viewModeLabelActive: {
      color: colors.textInverse,
      fontWeight: '600',
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
}
