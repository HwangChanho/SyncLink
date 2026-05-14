/**
 * TodoTab — the "할일" tab for the Planner screen.
 *
 * Contains:
 *  - TodoRow: single todo item with swipe-delete / swipe-category-change
 *  - CategorySectionHeader: collapsible section header
 *  - TodoTab: main tab component with grouped todo list
 *
 * Extracted from planner.tsx (TASK-400/TASK-600) to reduce file size.
 */

import { memo, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView,
  TouchableOpacity, ActivityIndicator, Pressable,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import type { ColorTokens } from '@/hooks/useColors';
import type { Todo, Category } from '@/types';
import type { PlannerStyles } from './plannerStyles';

// ─── TodoRow ──────────────────────────────────────────────────────────────────

interface TodoRowProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (todo: Todo) => void;
  colors: ColorTokens;
  styles: PlannerStyles;
}

/**
 * A single todo item row with checkbox, title, priority badge, and swipe-delete.
 * Wrapped in memo to prevent re-renders when parent re-renders (TASK-701).
 */
const TodoRow = memo(function TodoRow({
  todo,
  onToggle,
  onEdit,
  onDelete,
  onChangeCategory,
  colors,
  styles,
}: TodoRowProps) {
  const { t } = useTranslation();

  const priorityColorMap: Record<string, string> = {
    high:   colors.error,
    medium: colors.warning,
    low:    colors.success,
  };
  const priorityColor = priorityColorMap[todo.priority] ?? colors.textTertiary;

  const priorityLabels: Record<string, string> = {
    high:   t('todo.priority.high'),
    medium: t('todo.priority.medium'),
    low:    t('todo.priority.low'),
  };

  // Build-86 LEAD: "왼쪽 스와이프 → 삭제 버튼 뜨지만 누를 수 없고 수정 창
  // 이 뜸". 이전 구현은 actions 가 단순 <View> 라 탭 불가능 + onSwipeableOpen
  // 가 자동 close → 다시 row 가 노출되어 사용자 의도 외 onPress (수정) 발화.
  // 두 가지 수정:
  //  1. actions 를 TouchableOpacity 로 만들어 명시적 탭
  //  2. onSwipeableOpen 의 auto-trigger 제거 (사용자가 의도해서 탭하게)
  const swipeRef = useRef<Swipeable | null>(null);

  const renderRightActions = () => (
    <TouchableOpacity
      testID={`todo-swipe-delete-${todo.id}`}
      style={[styles.swipeAction, styles.swipeDeleteAction]}
      onPress={() => {
        swipeRef.current?.close();
        onDelete(todo.id);
      }}
      activeOpacity={0.8}
    >
      <Ionicons name="trash" size={20} color={colors.textInverse} />
      <Text style={styles.swipeActionText}>{t('common.delete')}</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      testID={`todo-swipe-category-${todo.id}`}
      style={[styles.swipeAction, styles.swipeCategoryAction]}
      onPress={() => {
        swipeRef.current?.close();
        onChangeCategory(todo);
      }}
      activeOpacity={0.8}
    >
      <Ionicons name="folder-open" size={20} color={colors.textInverse} />
      <Text style={styles.swipeActionText}>{t('planner.change_category')}</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      overshootLeft={false}
      overshootRight={false}
    >
      <Pressable
        // testID="todo-row-{id}" — e2e로 특정 할일 행 지정 가능 (ISSUE-011 검증 시나리오)
        testID={`todo-row-${todo.id}`}
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
        <TouchableOpacity
          // testID="todo-checkbox-{id}" — e2e에서 체크박스 토글 검증 (08_planner_todo_crud)
          testID={`todo-checkbox-${todo.id}`}
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

        <Text
          style={[styles.todoTitle, todo.isCompleted && styles.todoTitleCompleted]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {todo.title}
        </Text>

        {/* Build-64 LEAD: "할일 리스트에서 요일이 오른쪽에 노출, 제목
            길어지면 ... 요일 작게". Build-67 — 요일 + 날짜 동시 표시
            (예: "화 5/4"). dueAt 가 있으면 시간도 (예: "화 5/4 14:30"). */}
        {(todo.dueDate || todo.dueAt) && (() => {
          const d = todo.dueAt ?? todo.dueDate!;
          const dow = (t('time.week_days', { returnObjects: true }) as string[])[d.getDay()];
          const date = `${d.getMonth() + 1}/${d.getDate()}`;
          const time = todo.dueAt
            ? ` ${String(todo.dueAt.getHours()).padStart(2, '0')}:${String(todo.dueAt.getMinutes()).padStart(2, '0')}`
            : '';
          return (
            <Text style={styles.todoDow} numberOfLines={1}>
              {dow} {date}{time}
            </Text>
          );
        })()}

        <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '22' }]}>
          <Text style={[styles.priorityText, { color: priorityColor }]}>
            {priorityLabels[todo.priority] ?? todo.priority}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
});

// ─── CategorySectionHeader ────────────────────────────────────────────────────

interface CategorySectionHeaderProps {
  category: Category | null;
  count: number;
  completedCount: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  colors: ColorTokens;
  styles: PlannerStyles;
  labelOverride?: string;
}

function CategorySectionHeader({
  category,
  count,
  completedCount,
  isExpanded,
  onToggleExpand,
  colors,
  styles,
  labelOverride,
}: CategorySectionHeaderProps) {
  const { t: tCat } = useTranslation();
  const name = labelOverride ?? category?.name ?? tCat('todo.uncategorized');
  const color = category?.color ?? colors.textTertiary;

  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.categoryDot, { backgroundColor: color }]} />
      <Text style={styles.sectionTitle}>{name}</Text>
      <Text style={styles.sectionCount}>{count - completedCount}개</Text>

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

// ─── TodoTab ──────────────────────────────────────────────────────────────────

export interface TodoTabProps {
  todos: Todo[];
  isLoading: boolean;
  categoryMap: Map<string, Category>;
  todoView: 'category' | 'date' | 'priority';
  expandedSections: Set<string>;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  toggleExpand: (key: string) => void;
  setEditingTodo: (todo: Todo | null) => void;
  setCategoryChangeTodo: (todo: Todo | null) => void;
  colors: ColorTokens;
  styles: PlannerStyles;
}

export function TodoTab({
  todos,
  isLoading,
  categoryMap,
  todoView,
  expandedSections,
  toggleTodo,
  removeTodo,
  toggleExpand,
  setEditingTodo,
  setCategoryChangeTodo,
  colors,
  styles,
}: TodoTabProps) {
  const { t } = useTranslation();

  /**
   * Build the ordered, grouped list the todo tab renders. Three modes:
   *   - 'category': by categoryId, original behaviour
   *   - 'date': by due date (overdue → today → later → none)
   *   - 'priority': by priority (high → med → low → none)
   */
  const groups = useMemo(() => {
    const groupMap = new Map<string, Todo[]>();

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
      const existing = groupMap.get(key);
      if (existing) existing.push(todo);
      else groupMap.set(key, [todo]);
    }

    const result: {
      key: string;
      label: string;
      category: Category | null;
      items: Todo[];
    }[] = [];

    for (const [key, items] of groupMap.entries()) {
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

  return (
    <ScrollView
      style={styles.listContainer}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {groups.map(({ key, category, items, label }) => {
        const incompleteTodos = items.filter(item => !item.isCompleted);
        const completedTodos  = items.filter(item => item.isCompleted);
        // 기본 보기에서 완료 항목까지 노출 — expandedSections 는 사용자가
        // 명시적으로 접은 section 만 기록. 의미가 반전됐지만 변수명은 유지.
        const isExpanded = !expandedSections.has(key);

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
}
