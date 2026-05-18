/**
 * widgetDataService — write today's events + due todos to a shared store
 * that the home-screen widgets can read in their own process.
 *
 * Why a separate service:
 *  - Widget extensions on iOS run in a different process than the host app.
 *    AsyncStorage (sqlite under the hood) is invisible to them. The standard
 *    bridge is an App Group + UserDefaults; we serialise our payload into
 *    that suite via a tiny native module.
 *  - On Android, the widget RemoteViews are also out-of-process. The
 *    `react-native-android-widget` package handles the bridge for us; we
 *    just call `requestWidgetUpdate` after writing to AsyncStorage so the
 *    next render reads the latest snapshot.
 *
 * Payload shape is intentionally tiny (events × N + todos × M, ~few KB) so
 * write/read across the IPC boundary stays cheap.
 *
 * Integration:
 *  - Call `refreshWidgetData()` after any of:
 *      • app foreground / login / data sync
 *      • event create/update/delete
 *      • todo create/update/complete
 *      • midnight rollover (a "today" boundary changed)
 *  - The function is idempotent and safe to call from background tasks.
 *
 * Sprint 19 TASK-1900.
 */

import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventSummary } from '@/types/event';
import type { TodoSummary } from '@/types/todo';

/** Maximum events surfaced in the widget today section. Beyond this we
 *  collapse to "+N more". */
const MAX_TODAY_EVENTS = 6;
/** Maximum todos surfaced — same rationale. */
const MAX_WIDGET_TODOS = 4;
/** Window for the large widget's monthly grid — 6 weeks (42 cells) is the
 *  Naver/Apple calendar standard, covering current month plus leading/trailing
 *  days from neighbouring months. */
const MONTH_GRID_DAYS = 42;
/** Hard ceiling on emitted events to keep the IPC payload tiny. */
const MAX_GRID_EVENTS = 100;

/** Storage key used inside the App Group / SharedPreferences. */
export const WIDGET_DATA_KEY = 'synclink.widgetSnapshot.v1';

/** Snapshot shape persisted to the shared store. Stable contract — bump v1 if you change. */
export interface WidgetSnapshot {
  /** ISO datetime when this snapshot was generated (for staleness checks). */
  generatedAt: string;
  /** Today's events, chronological. allDay first within each block. */
  events: WidgetEvent[];
  /** Pending todos due today or overdue. */
  todos:  WidgetTodo[];
  /** Counts before truncation so the widget can show "+N more" honestly. */
  totals: { events: number; todos: number };
}

export interface WidgetEvent {
  id:        string;
  title:     string;
  startTime: string; // HH:MM (24h) or "" for all-day
  color:     string; // #RRGGBB
  /** ISO date the event occurs (YYYY-MM-DD). Used by the large widget to
   *  group events by weekday in its grid view. */
  dateKey:   string;
  /** When the event is shared from another member, the displayed prefix
   *  (e.g. "쎄엠"). Empty string for own events. */
  ownerNickname: string;
}

export interface WidgetTodo {
  id:       string;
  title:    string;
  /** ISO date (YYYY-MM-DD) when the todo is due. Past dates → overdue. */
  dueDate:  string | null;
  overdue:  boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reduce store data into a widget snapshot and persist it to the shared
 * store. Caller passes pre-loaded events/todos so this service stays
 * decoupled from store layout.
 *
 * @param allEvents  Full list of EventSummary the user has visibility on.
 * @param allTodos   Full list of TodoSummary the user has.
 * @param now        Override "now" for testing; defaults to new Date().
 */
export async function refreshWidgetData(
  allEvents: EventSummary[],
  allTodos: TodoSummary[],
  now: Date = new Date(),
): Promise<void> {
  const snapshot = buildSnapshot(allEvents, allTodos, now);
  const json = JSON.stringify(snapshot);

  // Always mirror to AsyncStorage so non-widget code paths (e.g. an
  // in-app "today summary" card) can read the same shape without a
  // platform branch.
  await AsyncStorage.setItem(WIDGET_DATA_KEY, json);

  if (Platform.OS === 'ios') {
    await writeIOSAppGroup(json);
  } else if (Platform.OS === 'android') {
    await writeAndroidWidget(json);
  }
}

// ─── Snapshot building ────────────────────────────────────────────────────────

/**
 * Project full event/todo lists into the trimmed widget shape.
 * Pure function — exported only for unit tests.
 */
export function buildSnapshot(
  allEvents: EventSummary[],
  allTodos:  TodoSummary[],
  now:       Date,
): WidgetSnapshot {
  const todayKey = toDateKey(now);
  const todayStart = startOfDay(now);
  // Large widget shows a 6-week monthly grid. Grid starts at the Sunday on
  // or before the 1st of the current month, ends 42 days later. Events that
  // intersect that window are forwarded so the widget can render bars in
  // any visible cell.
  const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  const gridStart = startOfDay(monthFirst);
  gridStart.setDate(gridStart.getDate() - monthFirst.getDay());
  const gridEnd = endOfDay(new Date(gridStart.getTime()));
  gridEnd.setDate(gridStart.getDate() + MONTH_GRID_DAYS - 1);

  // Events whose [startAt, endAt] intersect the 6-week grid window.
  const inWindow = allEvents
    .filter((e) => e.startAt <= gridEnd && e.endAt >= gridStart)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.startAt.getTime() - b.startAt.getTime();
    });

  // Subset that intersect TODAY specifically — used by both the small widget
  // and the large widget's right-side "today list".
  const todays = inWindow.filter((e) =>
    e.startAt <= endOfDay(now) && e.endAt >= todayStart,
  );

  // Pending todos: not done, due today or before.
  const pending = allTodos
    .filter((t) => !t.isCompleted)
    .filter((t) => {
      if (!t.dueDate) return false;
      const due = toDateKey(t.dueDate);
      return due <= todayKey;
    })
    .sort((a, b) => {
      const aDue = a.dueDate ? a.dueDate.getTime() : Infinity;
      const bDue = b.dueDate ? b.dueDate.getTime() : Infinity;
      return aDue - bDue;
    });

  // Emit events for the full 6-week grid window — Swift filters per family.
  // Capped at MAX_GRID_EVENTS to keep IPC payload tiny.
  const eventsOut = inWindow.slice(0, MAX_GRID_EVENTS).map((e) => ({
    id:            e.id,
    title:         e.title,
    startTime:     e.allDay ? '' : formatHM(e.startAt),
    color:         e.color,
    dateKey:       toDateKey(e.startAt),
    ownerNickname: e.isOwn ? '' : (e.ownerNickname ?? ''),
  }));

  return {
    generatedAt: now.toISOString(),
    events: eventsOut,
    todos: pending.slice(0, MAX_WIDGET_TODOS).map((t) => ({
      id:      t.id,
      title:   t.title,
      dueDate: t.dueDate ? toDateKey(t.dueDate) : null,
      overdue: t.dueDate ? toDateKey(t.dueDate) < todayKey : false,
    })),
    totals: { events: todays.length, todos: pending.length },
  };
}

// MAX_TODAY_EVENTS exported so tests can reason about truncation policy.
export const _WIDGET_LIMITS = { MAX_TODAY_EVENTS, MAX_WIDGET_TODOS, MONTH_GRID_DAYS, MAX_GRID_EVENTS };

// ─── Platform bridges ─────────────────────────────────────────────────────────

/**
 * Write the snapshot JSON into the iOS App Group's UserDefaults so the
 * widget extension (which only sees that suite) can read it.
 *
 * Native module contract — implemented in `ios/SyncLinkWidget/Bridge`:
 *   AppGroupBridge.write(suiteName: String, key: String, value: String)
 *
 * If the module isn't installed yet (development builds before the widget
 * target is added), we fall back to AsyncStorage only — the in-app data
 * still works, just no widget refresh.
 */
async function writeIOSAppGroup(json: string): Promise<void> {
  const Bridge = (NativeModules as { AppGroupBridge?: { write: (suite: string, key: string, value: string) => Promise<void> } }).AppGroupBridge;
  if (!Bridge?.write) return;
  // App Group ID must match the entitlement on both targets.
  await Bridge.write('group.io.synclink.app.widget', WIDGET_DATA_KEY, json);
}

/**
 * Notify Android the widget data changed.
 *
 * react-native-android-widget exposes `requestWidgetUpdate({ widgetName })`
 * which forces all instances of the named widget to re-render. The widget
 * component reads the same AsyncStorage key (mirrored above).
 *
 * Loaded lazily so iOS / web bundles don't pay the require cost.
 */
function writeAndroidWidget(_json: string): Promise<void> {
  // require() rather than dynamic import so TS doesn't choke and so the
  // package can be missing without a build error in development.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-android-widget') as {
      requestWidgetUpdate?: (opts: { widgetName: string }) => Promise<void>;
    };
    return mod.requestWidgetUpdate?.({ widgetName: 'SyncLinkWidget' }) ?? Promise.resolve();
  } catch {
    // Package missing in dev builds without prebuild → silent fall-through.
    return Promise.resolve();
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatHM(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
