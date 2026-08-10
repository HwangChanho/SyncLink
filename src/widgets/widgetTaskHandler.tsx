/**
 * widgetTaskHandler — entry point react-native-android-widget invokes whenever
 * Android needs to render or update a widget instance.
 *
 * Lifecycle events (from the package):
 *   - WIDGET_ADDED    : a new widget was placed on the home screen
 *   - WIDGET_UPDATE   : Android requested a periodic refresh
 *   - WIDGET_RESIZED  : user resized the widget
 *   - WIDGET_DELETED  : last instance removed (cleanup hook)
 *   - WIDGET_CLICK    : a tap carrying our clickAction — see handleToggleTodo
 *
 * Render events read the latest snapshot from AsyncStorage (mirrored there by
 * widgetDataService.refreshWidgetData) rather than the network, which keeps the
 * headless task fast and works offline.
 *
 * 🔴 This runs in a **headless JS context**: no UI tree, no navigation, no
 * React Native modules that assume an Activity. Keep imports narrow.
 */

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { TodoWidget } from './TodoWidget';
import { CalendarWidget } from './CalendarWidget';
import { CheckWidget } from './CheckWidget';
import { WIDGET_ACTION_TOGGLE_TODO } from './shared/theme';
import {
  readWidgetSnapshot,
  patchWidgetSnapshotTodo,
  enqueueWidgetPendingToggle,
  type WidgetSnapshot,
} from '@/services/widgetDataService';

/**
 * app.json widget name → renderer.
 *
 * ⚠️ Keys must match `react-native-android-widget.widgets[].name` in app.json
 * exactly — each one generates an AppWidgetProvider Java class of that name.
 * `SyncLinkWidget` is the original entry and is deliberately kept: renaming it
 * would delete the generated class and break every widget users have already
 * placed on their home screen.
 */
const NAME_TO_COMPONENT = {
  SyncLinkWidget:         TodoWidget,     // 투두형 (원래 이름 유지 = 기존 배치 보존)
  SyncLinkCalendarWidget: CalendarWidget, // 달력형
  SyncLinkCheckWidget:    CheckWidget,    // 체크형
} as const;

type WidgetName = keyof typeof NAME_TO_COMPONENT;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo } = props;
  const Component = NAME_TO_COMPONENT[widgetInfo.widgetName as WidgetName];
  if (!Component) return; // unknown widget — ignore

  const render = (snapshot: WidgetSnapshot | null) =>
    props.renderWidget(
      <Component snapshot={snapshot} width={widgetInfo.width} height={widgetInfo.height} />,
    );

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      render(await readWidgetSnapshot());
      break;

    case 'WIDGET_CLICK':
      if (props.clickAction === WIDGET_ACTION_TOGGLE_TODO) {
        render(await handleToggleTodo(props.clickActionData));
      }
      // Other clickActions (OPEN_APP / OPEN_URI) are handled natively by the
      // package and never reach us.
      break;

    case 'WIDGET_DELETED':
    default:
      break;
  }
}

/**
 * Apply a checkbox tap: draw it immediately, then try to persist it.
 *
 * Order matters. We patch the stored snapshot *first* so the widget redraws as
 * ticked even if the network call is slow or fails — a checkbox that visibly
 * ignores a tap reads as a broken widget. Reconciliation happens later: the
 * next refreshWidgetData overwrites the snapshot with server truth.
 *
 * If the write cannot happen here (no restored session in the headless task, or
 * offline) the toggle goes to the pending queue for the app to replay, so the
 * tap is delayed rather than lost.
 *
 * @returns the snapshot to render (already patched), or null on bad input.
 */
async function handleToggleTodo(
  data: Record<string, unknown> | undefined,
): Promise<WidgetSnapshot | null> {
  const todoId = typeof data?.todoId === 'string' ? data.todoId : null;
  const done = typeof data?.done === 'boolean' ? data.done : null;
  if (!todoId || done === null) return readWidgetSnapshot();

  const patched = await patchWidgetSnapshotTodo(todoId, done);

  try {
    // Imported lazily: todoService pulls in the Supabase client, and we only
    // want that cost (and its session restore) on an actual tap — not on every
    // periodic render.
    const { toggleTodoComplete } = await import('@/services/todoService');
    await toggleTodoComplete(todoId, done);
  } catch (err) {
    // 🔴 Whether a Supabase session restores inside Android's headless task is
    // the one assumption this feature rests on. If it does not, every tap lands
    // here and is replayed on next app launch — degraded but not lost.
    console.warn('[widget] toggle failed, queued for app launch:', todoId, err);
    await enqueueWidgetPendingToggle(todoId, done);
  }

  return patched;
}
