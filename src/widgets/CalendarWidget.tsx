/**
 * 달력형 (calendar) — Android home-screen widget.
 *
 * A 6-week month grid with a coloured dot per event, mirroring the iOS Large
 * widget that already exists. widgetDataService emits exactly this window
 * (Sunday on/before the 1st, 42 days) so the grid below and the snapshot
 * always agree on which events are in range.
 *
 * Read-only: there is nothing on a month grid to tick.
 *
 * Sizing: declared with a 4x3 minimum in app.json. A month grid squeezed into
 * a 2x1 cell is unreadable, so we prevent that placement rather than trying to
 * degrade gracefully into something that is no longer a calendar.
 *
 * Headless-context rule: import nothing that needs a UI or navigation tree.
 */

import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from '@/services/widgetDataService';
import { WIDGET_COLORS as C, WEEKDAY_LABELS, toLocalDateKey } from './shared/theme';

interface Props {
  snapshot: WidgetSnapshot | null;
  width:    number;
  height:   number;
}

/** Grid is always 6 weeks — same constant widgetDataService builds against. */
const WEEKS = 6;
const DAYS_PER_WEEK = 7;
/** Dots per cell before we stop drawing. More than 3 is visual noise at this size. */
const MAX_DOTS = 3;

export function CalendarWidget({ snapshot, width, height }: Props) {
  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const compact = width < 320 || height < 260;

  // Grid starts on the Sunday on or before the 1st of the current month.
  const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  const gridStart = new Date(monthFirst);
  gridStart.setDate(monthFirst.getDate() - monthFirst.getDay());

  // Bucket events by date once — doing it per cell would be 42 passes.
  const byDate = new Map<string, string[]>();
  for (const e of snapshot?.events ?? []) {
    const bucket = byDate.get(e.dateKey);
    if (bucket) {
      if (bucket.length < MAX_DOTS) bucket.push(e.color);
    } else {
      byDate.set(e.dateKey, [e.color]);
    }
  }

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height:          'match_parent',
        width:           'match_parent',
        flexDirection:   'column',
        backgroundColor: C.bg,
        padding:         10,
        borderRadius:    16,
      }}
    >
      <TextWidget
        text={`${now.getFullYear()}년 ${now.getMonth() + 1}월`}
        style={{ fontSize: 12, fontWeight: '700', color: C.textHi, marginBottom: 4 }}
      />

      {/* Weekday header. Sunday red / Saturday blue matches the in-app calendar. */}
      <FlexWidget style={{ flexDirection: 'row', marginBottom: 2 }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <FlexWidget key={label} style={{ flex: 1, alignItems: 'center' }}>
            <TextWidget
              text={label}
              style={{ fontSize: 9, color: weekdayColor(i, C.textLo) }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>

      {Array.from({ length: WEEKS }, (_, week) => (
        <FlexWidget key={`w${week}`} style={{ flexDirection: 'row', flex: 1 }}>
          {Array.from({ length: DAYS_PER_WEEK }, (_, dow) => {
            const cellDate = new Date(gridStart);
            cellDate.setDate(gridStart.getDate() + week * DAYS_PER_WEEK + dow);
            const key = toLocalDateKey(cellDate);
            const isToday = key === todayKey;
            // Leading/trailing days from neighbouring months are dimmed rather
            // than blanked, so the grid keeps its shape.
            const outside = cellDate.getMonth() !== now.getMonth();
            const dots = byDate.get(key) ?? [];

            return (
              <FlexWidget
                key={key}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}
              >
                <FlexWidget
                  style={{
                    width: 16, height: 16, borderRadius: 8,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isToday ? C.today : 'transparent',
                  }}
                >
                  <TextWidget
                    text={String(cellDate.getDate())}
                    style={{
                      fontSize: 9,
                      fontWeight: isToday ? '700' : '400',
                      color: isToday
                        ? C.textHi
                        : outside
                          ? C.divider
                          : weekdayColor(dow, C.textHi),
                    }}
                  />
                </FlexWidget>

                {/* Dots sit under the date. Hidden on compact placements where
                    there is not enough vertical room for both. */}
                {!compact && dots.length > 0 && (
                  <FlexWidget style={{ flexDirection: 'row', marginTop: 1 }}>
                    {dots.map((color, i) => (
                      <FlexWidget
                        key={`${key}-${i}`}
                        style={{
                          width: 3, height: 3, borderRadius: 2,
                          backgroundColor: outside ? C.divider : color,
                          marginHorizontal: 1,
                        }}
                      />
                    ))}
                  </FlexWidget>
                )}
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** Sunday red, Saturday blue, weekdays the caller's default. */
function weekdayColor(dayOfWeek: number, fallback: string): string {
  if (dayOfWeek === 0) return '#F87171';
  if (dayOfWeek === 6) return '#60A5FA';
  return fallback;
}
