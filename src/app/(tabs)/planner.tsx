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
import { useResponsive } from '@/hooks/useResponsive';
import { desktopContentCentered } from '@/constants/webLayout';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo, Category } from '@/types';
import { getCategories } from '@/services/categoryService';
import { showAlert } from '@/lib/webAlert';
import { useLoginPromptStore } from '@/stores/loginPromptStore';
import { TodoEditSheet } from '@/components/planner/TodoEditSheet';
import { TodoCreateSheet } from '@/components/planner/TodoCreateSheet';
import { CategoryPickerSheet } from '@/components/planner/CategoryPickerSheet';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { makeStyles } from '@/components/planner/plannerStyles';
import { TodoTab } from '@/components/planner/TodoTab';
import { NotesTab } from '@/components/planner/NotesTab';
import { AppErrorBoundary } from '@/components/common/AppErrorBoundary';
import { logError } from '@/lib/errorLogger';
import { PrioritySuggestionCard } from '@/components/planner/PrioritySuggestionCard';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tab type for the planner top tabs. */
type PlannerTab = 'todo' | 'notes';

// ─── Main Screen ──────────────────────────────────────────────────────────────

// Wrapped default export — error boundary catches any render-time throw and
// surfaces a recoverable fallback while reporting to error_logs.
export default function PlannerScreenWithBoundary() {
  return (
    <AppErrorBoundary area="planner">
      <PlannerScreenInner />
    </AppErrorBoundary>
  );
}

function PlannerScreenInner() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  // 데스크탑 웹: 화면 본문(header+content) 적정폭(880) 중앙 정렬. (웹 반응형 S2)
  const { isDesktop } = useResponsive();

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
    } catch (err) {
      // 게스트는 카테고리를 못 불러오는 게 정상 → 로그인 필요 에러는 조용히 무시.
      if (!(err instanceof Error && err.message.includes('로그인이 필요'))) {
        logError({ context: 'planner.loadCategories', error: err }).catch(() => { /* noop */ });
      }
    }
  }, []);

  useEffect(() => {
    // 게스트의 '로그인 필요' 읽기 에러는 정상 → 로그만 생략(write 는 store error
    // 를 통해 LoginPromptSheet 로 따로 유도된다).
    const logIfNotAuth = (context: string) => (err: unknown) => {
      if (!(err instanceof Error && err.message.includes('로그인이 필요'))) {
        logError({ context, error: err });
      }
    };
    void fetchTodos().catch(logIfNotAuth('planner.fetchTodos'));
    void fetchNotes().catch(logIfNotAuth('planner.fetchNotes'));
    loadCategories();
  }, [fetchTodos, fetchNotes, loadCategories]);

  // ── Error display ────────────────────────────────────────────────────────

  // Prevent duplicate Alerts when multiple store operations fail simultaneously
  const alertActiveRef = useRef(false);

  useEffect(() => {
    if (error && !alertActiveRef.current) {
      // 게스트가 추가/수정/삭제 등 write 를 시도하면 서비스가 "로그인이 필요합니다"
      // 를 throw → 여기로 온다. Alert 대신 LoginPromptSheet 로 유도해 캘린더/홈과
      // 톤을 맞춘다(사용자 요청). 그 외 에러는 기존 Alert.
      if (error.includes('로그인이 필요')) {
        clearError();
        // 열려 있을 수 있는 플래너 시트(생성/수정/카테고리)를 먼저 닫는다.
        // 모달 두 개를 동시에 transition 하면 iOS 가 멈추므로(캘린더 picker 와 동일),
        // 시트 dismiss 후로 LoginPromptSheet 를 미뤄 연다.
        setCreateSheetOpen(false);
        setEditingTodo(null);
        setCategoryChangeTodo(null);
        setTimeout(() => useLoginPromptStore.getState().open(), 300);
        return;
      }
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
      {/* 데스크탑 웹: 배경은 풀폭으로 두고 콘텐츠만 880 중앙 정렬해, 양옆 여백이
          본문과 같은 배경색이 되도록 한다. 기존엔 SafeAreaView 자체를 880 으로
          줄여 양옆이 부모 배경색으로 떠 "흰 여백"처럼 보였다(2026-06-09 LEAD 피드백). */}
      <View style={[styles.flex, isDesktop && desktopContentCentered]}>
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
            testID={tab === 'todo' ? 'planner-tab-todo' : 'planner-tab-notes'}
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

      {/* v1.2 Phase 3 — overdue + high priority hint 카드 */}
      {activeTab === 'todo' ? <PrioritySuggestionCard todos={todos} /> : null}

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
      </View>

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
        testID={activeTab === 'notes' ? 'planner-fab-notes' : 'planner-fab-todo'}
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
