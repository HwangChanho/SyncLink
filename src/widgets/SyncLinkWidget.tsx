/**
 * Android home-screen widget — rendered via react-native-android-widget.
 *
 * Reads the WidgetSnapshot mirror that widgetDataService.refreshWidgetData
 * persists to AsyncStorage on every change. Android RN runs the widget
 * component in a headless context, so this file must only import code
 * that is safe to evaluate without a UI / navigation tree.
 *
 * Layout adapts to widget size:
 *   - small  (≈ 2x1) → 2 events, no todos
 *   - medium (≈ 4x1) → 3 events + 2 todos
 *   - large  (≈ 4x2) → 4 events + 4 todos
 *
 * Sprint 19 TASK-1900.
 */

import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from '@/services/widgetDataService';

interface Props {
  /** Snapshot loaded by widgetTaskHandler before this component renders. */
  snapshot: WidgetSnapshot | null;
  /** Widget physical size — used to pick the layout density. */
  width:    number;
  height:   number;
}

const COLORS = {
  bg:        '#0F172A',
  surface:   '#1E293B',
  textHi:    '#F8FAFC',
  textLo:    '#94A3B8',
  divider:   '#334155',
  warning:   '#F87171',
};

export function SyncLinkWidget({ snapshot, width, height }: Props) {
  const family = pickFamily(width, height);
  const events = (snapshot?.events ?? []).slice(0, family.eventLimit);
  const todos  = (snapshot?.todos  ?? []).slice(0, family.todoLimit);
  const empty  = events.length === 0 && todos.length === 0;

  return (
    <FlexWidget
      style={{
        height:           'match_parent',
        width:            'match_parent',
        flexDirection:    'column',
        backgroundColor:  COLORS.bg,
        padding:          12,
        borderRadius:     16,
      }}
    >
      {/* Header — brand + today's date. */}
      <FlexWidget
        style={{
          flexDirection:  'row',
          justifyContent: 'space-between',
          marginBottom:   6,
        }}
      >
        <TextWidget
          text="SyncLink"
          style={{ fontSize: 11, fontWeight: '700', color: COLORS.textLo }}
        />
        <TextWidget
          text={formatToday()}
          style={{ fontSize: 11, color: COLORS.textLo }}
        />
      </FlexWidget>

      {empty ? (
        <FlexWidget
          style={{
            flex:           1,
            justifyContent: 'center',
            alignItems:     'center',
          }}
        >
          <TextWidget
            text="오늘 일정이 없어요"
            style={{ fontSize: 12, color: COLORS.textLo }}
          />
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
                  width:           6,
                  height:          6,
                  borderRadius:    3,
                  backgroundColor: e.color,
                  marginRight:     6,
                }}
              />
              {!!e.startTime && (
                <TextWidget
                  text={e.startTime}
                  style={{ fontSize: 11, color: COLORS.textLo, marginRight: 6 }}
                />
              )}
              <TextWidget
                text={e.title}
                maxLines={1}
                style={{ fontSize: 12, color: COLORS.textHi, flex: 1 }}
              />
            </FlexWidget>
          ))}

          {family.todoLimit > 0 && todos.length > 0 && (
            <FlexWidget
              style={{
                height:          1,
                backgroundColor: COLORS.divider,
                marginVertical:  4,
              }}
            />
          )}

          {todos.map((t) => (
            <FlexWidget
              key={t.id}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}
            >
              <IconWidget
                font="material"
                icon={t.overdue ? 'error' : 'radio_button_unchecked'}
                size={12}
                style={{ color: t.overdue ? COLORS.warning : COLORS.textLo, marginRight: 6 }}
              />
              <TextWidget
                text={t.title}
                maxLines={1}
                style={{
                  fontSize: 12,
                  color: t.overdue ? COLORS.warning : COLORS.textHi,
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
 * Pick how many rows to render based on the physical widget size that
 * Android passes us at render time.
 *
 * Thresholds (dp):
 *   - small   (≈ 2x1 phone)   width < 280, height < 140
 *   - medium  (≈ 4x1 phone)   width ≥ 280, height < 200
 *   - large   (≈ 4x2 phone)   height ≥ 200, width < 480
 *   - tablet  (≈ 4x4 / 5x4)   width  ≥ 480 OR height ≥ 360 (resized on tablet)
 *
 * The widget is `resizeMode: "horizontal|vertical"` so users on Android
 * tablets / foldables can drag any corner to grow the cell — we honour
 * the larger render area by surfacing more rows.
 */
function pickFamily(width: number, height: number): Family {
  if (width >= 480 || height >= 360) return { eventLimit: 8, todoLimit: 6 }; // tablet
  if (height >= 200)                 return { eventLimit: 4, todoLimit: 4 }; // large
  if (width >= 280)                  return { eventLimit: 3, todoLimit: 2 }; // medium
  return                                    { eventLimit: 2, todoLimit: 0 }; // small
}

function formatToday(): string {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}
