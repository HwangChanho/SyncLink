/**
 * 투두형 (todo) — Android home-screen widget.
 *
 * Today's events as context, then the due/overdue todo list with **tappable
 * checkboxes**. This is the evolution of the original read-only widget: the
 * app.json entry is still named `SyncLinkWidget`, so widgets users already
 * placed on their home screen keep working and simply gain checkboxes.
 * (Renaming the app.json entry would delete the generated AppWidgetProvider
 * class and break every placed instance.)
 *
 * Layout adapts to widget size:
 *   - small  (≈ 2x1) → 2 events, 1 todo
 *   - medium (≈ 4x1) → 3 events, 2 todos
 *   - large  (≈ 4x2) → 4 events, 4 todos
 *   - tablet          → 8 events, 6 todos
 *
 * Headless-context rule: import nothing that needs a UI or navigation tree.
 */

import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from '@/services/widgetDataService';
import {
  WIDGET_COLORS as C,
  WIDGET_ACTION_TOGGLE_TODO,
  formatToday,
  toLocalDateKey,
} from './shared/theme';

interface Props {
  /** Snapshot loaded by widgetTaskHandler before this component renders. */
  snapshot: WidgetSnapshot | null;
  /** Widget physical size — used to pick the layout density. */
  width:    number;
  height:   number;
}

export function TodoWidget({ snapshot, width, height }: Props) {
  const family = pickFamily(width, height);
  // widgetDataService emits a 6-week window of events, so filter to today here.
  // Comparing dateKey strings avoids every timezone pitfall.
  const todayKey = toLocalDateKey(new Date());
  const events = (snapshot?.events ?? [])
    .filter((e) => e.dateKey === todayKey)
    .slice(0, family.eventLimit);
  const todos = (snapshot?.todos ?? []).slice(0, family.todoLimit);
  const empty = events.length === 0 && todos.length === 0;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height:          'match_parent',
        width:           'match_parent',
        flexDirection:   'column',
        backgroundColor: C.bg,
        padding:         12,
        borderRadius:    16,
      }}
    >
      <FlexWidget
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}
      >
        {/*
          The 1.4.0 rebrand renamed the app but missed this label, so the widget kept
          showing the old name on users' home screens. The widget *name* stays
          `SyncLinkWidget` — renaming that would break every placed widget.
        */}
        <TextWidget
          text="투투리스트"
          style={{ fontSize: 11, fontWeight: '700', color: C.textLo }}
        />
        <TextWidget text={formatToday()} style={{ fontSize: 11, color: C.textLo }} />
      </FlexWidget>

      {empty ? (
        <FlexWidget style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <TextWidget text="오늘 일정이 없어요" style={{ fontSize: 12, color: C.textLo }} />
        </FlexWidget>
      ) : (
        <>
          {events.map((e) => (
            <FlexWidget
              key={e.id}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}
            >
              <FlexWidget
                style={{
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor: e.color, marginRight: 6,
                }}
              />
              {!!e.startTime && (
                <TextWidget
                  text={e.startTime}
                  style={{ fontSize: 11, color: C.textLo, marginRight: 6 }}
                />
              )}
              <TextWidget
                text={e.ownerNickname ? `${e.ownerNickname} · ${e.title}` : e.title}
                maxLines={1}
                style={{ fontSize: 12, color: C.textHi, flex: 1 }}
              />
            </FlexWidget>
          ))}

          {family.todoLimit > 0 && todos.length > 0 && (
            <FlexWidget
              style={{ height: 1, backgroundColor: C.divider, marginVertical: 4 }}
            />
          )}

          {todos.map((t) => (
            <FlexWidget
              key={t.id}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}
            >
              {/* The checkbox is its own tap target with padding — an 12dp icon
                  alone is far below Android's 48dp touch guidance, and a
                  mis-tap here would open the app instead of ticking. */}
              <FlexWidget
                clickAction={WIDGET_ACTION_TOGGLE_TODO}
                clickActionData={{ todoId: t.id, done: !t.done }}
                style={{
                  paddingVertical: 4, paddingHorizontal: 4,
                  marginRight: 2, borderRadius: 6,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <IconWidget
                  font="material"
                  icon={t.done ? 'check_box' : 'check_box_outline_blank'}
                  size={14}
                  style={{ color: t.done ? C.accent : (t.overdue ? C.warning : C.textLo) }}
                />
              </FlexWidget>
              <TextWidget
                text={t.title}
                maxLines={1}
                style={{
                  fontSize: 12,
                  color: t.done ? C.textDone : (t.overdue ? C.warning : C.textHi),
                  flex: 1,
                }}
              />
            </FlexWidget>
          ))}
        </>
      )}
    </FlexWidget>
  );
}

interface Family { eventLimit: number; todoLimit: number; }

/**
 * Pick how many rows to render from the physical widget size Android passes
 * at render time.
 *
 * Thresholds (dp):
 *   - small   (≈ 2x1 phone)   width < 280, height < 140
 *   - medium  (≈ 4x1 phone)   width ≥ 280, height < 200
 *   - large   (≈ 4x2 phone)   height ≥ 200, width < 480
 *   - tablet  (≈ 4x4 / 5x4)   width ≥ 480 OR height ≥ 360
 *
 * The widget is resizable, so users on tablets / foldables can drag it larger;
 * we honour the extra room by surfacing more rows rather than scaling text.
 */
function pickFamily(width: number, height: number): Family {
  if (width >= 480 || height >= 360) return { eventLimit: 8, todoLimit: 6 }; // tablet
  if (height >= 200)                 return { eventLimit: 4, todoLimit: 4 }; // large
  if (width >= 280)                  return { eventLimit: 3, todoLimit: 2 }; // medium
  return                                    { eventLimit: 2, todoLimit: 1 }; // small
}
