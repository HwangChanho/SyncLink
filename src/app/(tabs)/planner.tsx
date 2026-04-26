/**
 * Planner tab — Todo list + Notes viewer.
 *
 * Layout:
 *  [탭: Todo | Notes]
 *    Todo 탭:
 *      - 카테고리별 섹션 (헤더: 카테고리명, 항목: 체크박스 + 제목 + 우선순위)
 *      - 완료 항목 접기/펼치기
 *      - 항목 탭 → 상세/편집 모달
 *      - 스와이프 삭제 (Pressable + long press)
 *    Notes 탭:
 *      - 최근 수정 순 카드 목록
 *      - 빠른 작성 FAB (Floating Action Button)
 *
 * TASK-400 (Sprint 4)
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 * Sprint 20: Sub-components/styles extracted to src/components/planner/
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo, Category } from '@/types';
import { getCategories } from '@/services/categoryService';
import { showAlert } from '@/lib/webAlert';
import { TodoEditSheet } from '@/components/planner/TodoEditSheet';
import { TodoCreateSheet } from '@/components/planner/TodoCreateSheet';
import { CategoryPickerSheet } from '@/components/planner/CategoryPickerSheet';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { makeStyles } from '@/components/planner/plannerStyles';
import { TodoTab } from '@/components/planner/TodoTab';
import { NotesTab } from '@/components/planner/NotesTab';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab type for the planner top tabs. */
type PlannerTab = 'todo' | 'notes';

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlannerScreen() {
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

  const loadCategories = useCallback(async () => {
    try {
      const cats = await getCategories();
      const map = new Map(cats.map(c => [c.id, c]));
      setCategoryMap(map);
    } catch {
      // Non-critical — categories are optional
    }
  }, []);

  useEffect(() => {
    void fetchTodos();
    void fetchNotes();
    loadCategories();
  }, [fetchTodos, fetchNotes, loadCategories]);

  // ── Error display ────────────────────────────────────────────────────────

  // Prevent duplicate Alerts when multiple store operations fail simultaneously
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
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          {activeTab === 'todo' ? (
            <TodoTab
              todos={todos}
              isLoading={isLoading}
              categoryMap={categoryMap}
              todoView={todoView}
              expandedSections={expandedSections}
              toggleTodo={toggleTodo}
              removeTodo={removeTodo}
              toggleExpand={toggleExpand}
              setEditingTodo={setEditingTodo}
              setCategoryChangeTodo={setCategoryChangeTodo}
              colors={colors}
              styles={styles}
            />
          ) : (
            <NotesTab
              notes={notes}
              isLoading={isLoading}
              removeNote={removeNote}
              colors={colors}
              styles={styles}
            />
          )}
        </View>
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
        New-todo bottom sheet (replaces the inline quick-add bar). The
        sheet owns its own KeyboardAvoidingView so the input never sits
        under the keyboard.
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
