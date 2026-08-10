/**
 * 체크형 (check) — Android home-screen widget.
 *
 * Todos only, large checkboxes, few rows. Where 투두형 is a glanceable list,
 * this one is built for actually tapping: the touch target is sized for a
 * thumb rather than for information density, so it stays usable in the small
 * 2x2 cell most people keep free on their home screen.
 *
 * No events here on purpose — mixing them back in would make this a narrower
 * copy of 투두형 rather than a distinct widget.
 *
 * Headless-context rule: import nothing that needs a UI or navigation tree.
 */

import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from '@/services/widgetDataService';
import { WIDGET_COLORS as C, WIDGET_ACTION_TOGGLE_TODO } from './shared/theme';

interface Props {
  snapshot: WidgetSnapshot | null;
  width:    number;
  height:   number;
}

export function CheckWidget({ snapshot, width, height }: Props) {
  const limit = pickLimit(width, height);
  const todos = (snapshot?.todos ?? []).slice(0, limit);
  const remaining = Math.max(0, (snapshot?.totals?.todos ?? todos.length) - todos.length);

  return (
    <FlexWidget
      style={{
        height:          'match_parent',
        width:           'match_parent',
        flexDirection:   'column',
        backgroundColor: C.bg,
        padding:         12,
        borderRadius:    16,
      }}
    >
      {/* Header doubles as the "open the app" target so the rows below stay
          dedicated to ticking — tapping a row must never be ambiguous. */}
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          flexDirection: 'row', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 8,
        }}
      >
        <TextWidget text="할 일" style={{ fontSize: 12, fontWeight: '700', color: C.textLo }} />
        {remaining > 0 && (
          <TextWidget text={`+${remaining}`} style={{ fontSize: 11, color: C.textLo }} />
        )}
      </FlexWidget>

      {todos.length === 0 ? (
        <FlexWidget style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <IconWidget
            font="material"
            icon="task_alt"
            size={24}
            style={{ color: C.textLo, marginBottom: 6 }}
          />
          <TextWidget text="다 끝냈어요" style={{ fontSize: 12, color: C.textLo }} />
        </FlexWidget>
      ) : (
        todos.map((t) => (
          // The whole row is the tap target here (unlike 투두형, where only the
          // box is) — this widget exists to be tapped, so a thumb-sized area
          // matters more than being able to open the app from the row.
          <FlexWidget
            key={t.id}
            clickAction={WIDGET_ACTION_TOGGLE_TODO}
            clickActionData={{ todoId: t.id, done: !t.done }}
            style={{
              flexDirection:   'row',
              alignItems:      'center',
              backgroundColor: C.surface,
              borderRadius:    10,
              paddingVertical:   8,
              paddingHorizontal: 8,
              marginBottom:    6,
            }}
          >
            <IconWidget
              font="material"
              icon={t.done ? 'check_box' : 'check_box_outline_blank'}
              size={20}
              style={{
                color: t.done ? C.accent : (t.overdue ? C.warning : C.textLo),
                marginRight: 8,
              }}
            />
            <TextWidget
              text={t.title}
              maxLines={2}
              style={{
                fontSize: 13,
                color: t.done ? C.textDone : (t.overdue ? C.warning : C.textHi),
                flex: 1,
              }}
            />
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}

/**
 * Rows to show. Deliberately far fewer than 투두형 at the same size — the
 * padded rows are ~3x taller, and cramming them would defeat the point.
 */
function pickLimit(width: number, height: number): number {
  if (width >= 480 || height >= 360) return 6; // tablet
  if (height >= 200)                 return 4; // large
  if (height >= 140)                 return 3; // medium
  return                                    2; // small
}
