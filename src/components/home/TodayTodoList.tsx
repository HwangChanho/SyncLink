/**
 * TodayTodoList — today's uncompleted todos widget for the Home tab.
 *
 * Shows todos with dueDate = today and isCompleted = false.
 * Tapping the checkbox toggles completion via todoStore.toggleTodo().
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { View, TouchableOpacity, StyleSheet, Vibration } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, elevation } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { Text } from '@/components/common/AppText';
import { PopOnActivate } from '@/components/motion/PopOnActivate';
import { markJustActivated } from '@/components/motion/activationRegistry';
import { hapticSuccessTap } from '@/lib/haptics';

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
      {/* Checkbox
          testID 를 붙인 이유: 테스트가 UNSAFE_getAllByType(TouchableOpacity)[0] 로
          체크박스를 찾고 있었다. 헤더에 버튼이 하나 생기자 곧바로 깨졌다(2026-08-28).
          순서가 아니라 이름으로 찾게 해서 같은 함정을 다시 밟지 않게 한다. */}
      <TouchableOpacity
        onPress={() => {
          // 완료로 바뀔 때만 톡 + "방금 완료" 표시(행이 완료 묶음으로 옮겨져 재마운트돼도 튀게)
          if (!todo.isCompleted) {
            hapticSuccessTap();
            markJustActivated(`todo:${todo.id}`);
          }
          onToggle();
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID={`todo-checkbox-${todo.id}`}
      >
        {/* 1.5.0: 완료되는 순간 체크박스가 통 튄다. 모양 스타일은 튀는 뷰가 갖는다 */}
        <PopOnActivate
          active={todo.isCompleted}
          activationKey={`todo:${todo.id}`}
          style={[styles.checkbox, todo.isCompleted && styles.checkboxChecked]}
        >
          {todo.isCompleted && <Text style={styles.checkmark}>✓</Text>}
        </PopOnActivate>
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
  // Fetch is owned by the parent Home screen (index.tsx) which calls fetchTodos
  // on mount and pull-to-refresh. Fetching here too would race with optimistic
  // toggle updates and cause the UI to revert on server response. (#fix-reactivity)
  const { todos, toggleTodo } = useTodoStore();

  // Filter to just today's items (the service returns a range; guard here too)
  const todayTodos = todos.filter(t => isDueToday(t.dueDate));

  const incomplete = todayTodos.filter(t => !t.isCompleted);
  const completed  = todayTodos.filter(t => t.isCompleted);

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('todo.today_list_title')}</Text>
        {/* 2026-08-28 — 할 일/노트가 탭바에서 내려왔으므로(UX 단순화) 홈에서
            전체 목록으로 갈 수 있는 길을 남긴다. 오늘 할 일이 하나도 없을 때야말로
            전체 목록으로 갈 이유가 크므로 개수와 달리 항상 보인다. */}
        <View style={styles.headerRight}>
          {todayTodos.length > 0 && (
            <Text style={styles.headerCount}>
              {completed.length}/{todayTodos.length}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/planner')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="home-todo-see-all"
          >
            <Text style={styles.headerLink}>{t('common.see_all')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {todayTodos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('todo.today_empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {/* Incomplete todos first */}
          {incomplete.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() => {
                Vibration.vibrate([0, 20]);
                void toggleTodo(todo.id);
              }}
              colors={colors}
              styles={styles}
            />
          ))}
          {/* Completed todos (greyed out) */}
          {completed.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() => {
                Vibration.vibrate([0, 20]);
                void toggleTodo(todo.id);
              }}
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
    /** 개수와 "전체 보기" 를 헤더 오른쪽에 나란히 묶는다. */
    headerRight: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[2],
    },
    headerLink: {
      ...textStyles.caption,
      color: colors.primary,
    },
    list: {
      backgroundColor: colors.surface,
      borderRadius:    radius.lg,
      borderWidth:     1,
      borderColor:     colors.border,
      overflow:        'hidden',
      ...elevation[1],
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
      // textInverse: white in light mode, gray-900 in dark — contrasts with primary checkbox background
      color:      colors.textInverse,
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
    /**
     * 빈 상태 — 2026-09-20 레이아웃 개편.
     *
     * 이전에는 배경도 테두리도 없는 맨 텍스트라 허공에 떠 있었고,
     * 바로 위 "오늘 일정" 카드와 좌우 끝이 맞지 않아 화면이 어긋나 보였다.
     * 같은 면·같은 곡률을 주되 **깊이는 주지 않는다** — 여기는 부차적인
     * 섹션이라, 일정 쪽 빈 카드와 똑같이 떠 버리면 둘 다 주인공이 된다.
     */
    emptyContainer: {
      paddingVertical:   spacing[5],
      paddingHorizontal: spacing[4],
      alignItems:        'center',
      backgroundColor:   colors.surface,
      borderRadius:      radius.lg,
      borderWidth:       1,
      borderColor:       colors.border,
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
    },
  });
}
