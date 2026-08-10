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

/**
 * Storage key used inside the App Group / SharedPreferences.
 *
 * v2 adds `done` on todos so the widget can render — and optimistically flip —
 * a checkbox. We keep writing v1 as well: a user who updates the app before the
 * OS refreshes the widget extension would otherwise see an empty widget until
 * the next reload.
 */
export const WIDGET_DATA_KEY    = 'synclink.widgetSnapshot.v1';
export const WIDGET_DATA_KEY_V2 = 'synclink.widgetSnapshot.v2';

/**
 * Toggles made **on the widget** that have not reached the server yet.
 *
 * iOS only. A WidgetKit App Intent runs inside the widget extension where no
 * JS (and no Supabase session) exists, so it appends here and the app drains
 * the queue on next launch. Android has no such queue — its widget click runs
 * in a headless JS task that can call the service directly.
 */
export const WIDGET_PENDING_TOGGLES_KEY = 'synclink.widgetPendingToggles.v1';

/** One optimistic toggle recorded by the widget. */
export interface WidgetPendingToggle {
  todoId: string;
  /** Desired completion state the user tapped for. */
  done:   boolean;
  /** ISO datetime of the tap — used to resolve ordering when several queue up. */
  at:     string;
}

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
  /** Completion state. Always false today (only pending todos are emitted),
   *  but the widget needs the field to render a checkbox and to flip it
   *  optimistically after a tap. */
  done:     boolean;
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
  // platform branch. Both keys carry the same JSON — v2 is a superset of v1
  // (extra `done` field), so an old reader parsing v2 would still work; we
  // write both only so a not-yet-reloaded widget extension never sees a gap.
  await AsyncStorage.multiSet([
    [WIDGET_DATA_KEY, json],
    [WIDGET_DATA_KEY_V2, json],
  ]);

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
      done:    false,   // only pending todos are emitted; see `pending` filter above
      dueDate: t.dueDate ? toDateKey(t.dueDate) : null,
      overdue: t.dueDate ? toDateKey(t.dueDate) < todayKey : false,
    })),
    totals: { events: todays.length, todos: pending.length },
  };
}

/**
 * Drain toggles the **iOS widget** recorded while the app was closed.
 *
 * The widget extension cannot reach Supabase (no JS, no session), so an App
 * Intent appends to WIDGET_PENDING_TOGGLES_KEY in the shared App Group and we
 * reconcile here — on app launch / foreground.
 *
 * Ordering: if the same todo was toggled several times, only the **last** tap
 * wins. Tapping check→uncheck→check must not produce three writes.
 *
 * The queue is cleared only after `apply` resolves, so a crash mid-sync leaves
 * the toggles queued for the next launch rather than losing them.
 *
 * @param apply Callback that persists one todo's completion to the server.
 * @returns number of todos actually reconciled.
 */
export async function drainWidgetPendingToggles(
  apply: (todoId: string, done: boolean) => Promise<void>,
): Promise<number> {
  const raw = await AsyncStorage.getItem(WIDGET_PENDING_TOGGLES_KEY);
  if (!raw) return 0;

  let queue: WidgetPendingToggle[];
  try {
    queue = JSON.parse(raw) as WidgetPendingToggle[];
  } catch {
    // Corrupt payload is not worth retrying forever — drop it and move on.
    await AsyncStorage.removeItem(WIDGET_PENDING_TOGGLES_KEY);
    return 0;
  }
  if (!Array.isArray(queue) || queue.length === 0) {
    await AsyncStorage.removeItem(WIDGET_PENDING_TOGGLES_KEY);
    return 0;
  }

  // Last tap per todo wins.
  const latest = new Map<string, WidgetPendingToggle>();
  for (const t of queue) {
    if (!t?.todoId) continue;
    const prev = latest.get(t.todoId);
    if (!prev || t.at > prev.at) latest.set(t.todoId, t);
  }

  let applied = 0;
  for (const t of latest.values()) {
    try {
      await apply(t.todoId, t.done);
      applied++;
    } catch (err) {
      // One failure must not block the rest; the queue is cleared regardless
      // because the widget's optimistic state is already stale by now and the
      // next refreshWidgetData will overwrite it with server truth.
      console.warn('[widget] pending toggle failed:', t.todoId, err);
    }
  }

  await AsyncStorage.removeItem(WIDGET_PENDING_TOGGLES_KEY);
  return applied;
}

/**
 * Read the snapshot the widgets render from.
 *
 * Prefers v2 and falls back to v1 so a widget process that starts up between
 * an app update and the first refreshWidgetData still finds data.
 */
export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  for (const key of [WIDGET_DATA_KEY_V2, WIDGET_DATA_KEY]) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) return JSON.parse(raw) as WidgetSnapshot;
    } catch {
      // Corrupt entry under one key shouldn't hide a good one under the other.
    }
  }
  return null;
}

/**
 * Flip one todo's `done` inside the stored snapshot and persist it.
 *
 * Android's widget click runs in a headless task that has no access to the
 * Zustand stores, so it cannot rebuild a full snapshot via refreshWidgetData.
 * Patching the stored copy is what makes the checkbox *stay* ticked across the
 * re-render Android triggers right after the tap — without it the widget would
 * redraw from stale data and appear to undo the tap.
 *
 * Server truth overwrites this on the next refreshWidgetData; at that point a
 * completed todo drops out of the list entirely (only pending ones are
 * emitted), which is the intended end state.
 *
 * @returns the patched snapshot, or null if there was nothing to patch.
 */
export async function patchWidgetSnapshotTodo(
  todoId: string,
  done: boolean,
): Promise<WidgetSnapshot | null> {
  const snapshot = await readWidgetSnapshot();
  if (!snapshot) return null;

  let changed = false;
  const todos = snapshot.todos.map((t) => {
    if (t.id !== todoId || t.done === done) return t;
    changed = true;
    return { ...t, done };
  });
  if (!changed) return snapshot;

  const patched: WidgetSnapshot = { ...snapshot, todos };
  const json = JSON.stringify(patched);
  await AsyncStorage.multiSet([
    [WIDGET_DATA_KEY, json],
    [WIDGET_DATA_KEY_V2, json],
  ]);
  return patched;
}

/**
 * Record a toggle that could not reach the server, for the app to replay.
 *
 * Built for iOS (whose widget extension has no session at all), but Android
 * uses it too whenever its headless task has no restored Supabase session or
 * is offline — otherwise that tap would be silently lost, which is worse than
 * a delayed sync because the widget already drew it as done.
 */
export async function enqueueWidgetPendingToggle(
  todoId: string,
  done: boolean,
  at: Date = new Date(),
): Promise<void> {
  let queue: WidgetPendingToggle[] = [];
  try {
    const raw = await AsyncStorage.getItem(WIDGET_PENDING_TOGGLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WidgetPendingToggle[];
      if (Array.isArray(parsed)) queue = parsed;
    }
  } catch {
    // Unreadable queue is dropped rather than blocking this toggle.
  }
  queue.push({ todoId, done, at: at.toISOString() });
  await AsyncStorage.setItem(WIDGET_PENDING_TOGGLES_KEY, JSON.stringify(queue));
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
 * Every widget name declared in app.json's react-native-android-widget config.
 *
 * ⚠️ Must stay in sync with app.json and with widgetTaskHandler's
 * NAME_TO_COMPONENT map. A name missing here means that widget keeps showing
 * stale data after a change — it renders fine, so nothing looks broken.
 */
const ANDROID_WIDGET_NAMES = [
  'SyncLinkWidget',         // 투두형
  'SyncLinkCalendarWidget', // 달력형
  'SyncLinkCheckWidget',    // 체크형
] as const;

/**
 * Notify Android the widget data changed.
 *
 * react-native-android-widget exposes `requestWidgetUpdate({ widgetName })`
 * which forces all instances of the named widget to re-render. The widget
 * components read the same AsyncStorage key (mirrored above).
 *
 * Loaded lazily so iOS / web bundles don't pay the require cost.
 */
async function writeAndroidWidget(_json: string): Promise<void> {
  // require() rather than dynamic import so TS doesn't choke and so the
  // package can be missing without a build error in development.
  let mod: { requestWidgetUpdate?: (opts: { widgetName: string }) => Promise<void> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('react-native-android-widget');
  } catch {
    // Package missing in dev builds without prebuild → silent fall-through.
    return;
  }
  if (!mod.requestWidgetUpdate) return;

  // One widget type failing to refresh must not stop the others — a user who
  // only placed the calendar shouldn't lose updates because the check widget
  // has no instances.
  await Promise.all(
    ANDROID_WIDGET_NAMES.map((widgetName) =>
      mod.requestWidgetUpdate!({ widgetName }).catch(() => undefined),
    ),
  );
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
