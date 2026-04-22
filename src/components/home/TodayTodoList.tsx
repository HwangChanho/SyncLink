/**
 * TodayTodoList — today's uncompleted todos widget for the Home tab.
 *
 * Shows todos with dueDate = today and isCompleted = false.
 * Tapping the checkbox toggles completion via todoStore.toggleTodo().
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD local string. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Checks if a Date falls on today (local time). */
function isDueToday(date: Date | null): boolean {
  if (!date) return false;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return iso === todayIso();
}

// ─── Todo row ─────────────────────────────────────────────────────────────────

/** Priority color dot — uses fixed semantic colors, not theme-dependent. */
const PRIORITY_COLOR: Record<string, string> = {
  high:   '#EF4444',
  medium: '#F59E0B',
  low:    '#6B7280',
};

interface TodoRowProps {
  todo: Todo;
  onToggle: () => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}

function TodoRow({ todo, onToggle, colors: _colors, styles }: TodoRowProps) {
  return (
    <View style={styles.row}>
      {/* Checkbox */}
      <TouchableOpacity
        style={[styles.checkbox, todo.isCompleted && styles.checkboxChecked]}
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {todo.isCompleted && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      {/* Title */}
      <Text
        style={[styles.todoTitle, todo.isCompleted && styles.todoTitleDone]}
        numberOfLines={1}
      >
        {todo.title}
      </Text>

      {/* Priority dot */}
      <View
        style={[
          styles.priorityDot,
          { backgroundColor: PRIORITY_COLOR[todo.priority] ?? PRIORITY_COLOR.medium },
        ]}
      />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TodayTodoList() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { todos, fetchTodos, toggleTodo } = useTodoStore();

  // Load todos due today on mount
  useEffect(() => {
    const today = new Date();
    void fetchTodos({
      contentType: 'todo',
      dueBefore:   today,
      dueAfter:    today,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter to just today's items (the service returns a range; guard here too)
  const todayTodos = todos.filter(t => isDueToday(t.dueDate));

  const incomplete = todayTodos.filter(t => !t.isCompleted);
  const completed  = todayTodos.filter(t => t.isCompleted);

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('todo.today_list_title')}</Text>
        {todayTodos.length > 0 && (
          <Text style={styles.headerCount}>
            {completed.length}/{todayTodos.length}
          </Text>
        )}
      </View>

      {todayTodos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('todo.today_list_title')} {t('common.none')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {/* Incomplete todos first */}
          {incomplete.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() => void toggleTodo(todo.id)}
              colors={colors}
              styles={styles}
            />
          ))}
          {/* Completed todos (greyed out) */}
          {completed.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() => void toggleTodo(todo.id)}
              colors={colors}
              styles={styles}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      marginHorizontal: spacing[4],
      marginBottom:     spacing[4],
    },
    header: {
      flexDirection:  'row',
      justifyContent: 'space-between',
      alignItems:     'center',
      marginBottom:   spacing[2],
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    headerCount: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    list: {
      backgroundColor: colors.surface,
      borderRadius:    radius.md,
      borderWidth:     1,
      borderColor:     colors.border,
      overflow:        'hidden',
    },
    row: {
      flexDirection:    'row',
      alignItems:       'center',
      paddingVertical:  spacing[2],
      paddingHorizontal: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    checkbox: {
      width:        22,
      height:       22,
      borderRadius: 11,
      borderWidth:  2,
      borderColor:  colors.border,
      alignItems:   'center',
      justifyContent: 'center',
      marginRight:  spacing[3],
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor:     colors.primary,
    },
    checkmark: {
      color:      '#FFF',
      fontSize:   12,
      fontWeight: '700',
    },
    todoTitle: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex:  1,
    },
    todoTitleDone: {
      color:          colors.textTertiary,
      textDecorationLine: 'line-through',
    },
    priorityDot: {
      width:        8,
      height:       8,
      borderRadius: 4,
      marginLeft:   spacing[2],
    },
    emptyContainer: {
      paddingVertical: spacing[3],
      alignItems:      'center',
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },
  });
}
