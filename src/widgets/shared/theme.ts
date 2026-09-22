/**
 * Shared tokens + helpers for the Android home-screen widgets.
 *
 * Widgets render in a headless JS context with no navigation tree and no
 * theme provider, so they cannot use `useColors()` or any hook-based styling.
 * Everything here must be plain constants / pure functions.
 *
 * The palette is fixed dark on purpose: Android gives a widget no reliable
 * signal about the launcher's wallpaper or the app's in-app theme, and a
 * translucent light card is unreadable on most wallpapers.
 */

/** Widget palette. Mirrors the app's dark surface tokens closely enough to
 *  look related without importing the theme module (which pulls in RN). */
export const WIDGET_COLORS = {
  bg:       '#0F172A',
  surface:  '#1E293B',
  textHi:   '#F8FAFC',
  textLo:   '#94A3B8',
  /** Completed todo text — dimmed further than textLo so the strike reads. */
  textDone: '#64748B',
  divider:  '#334155',
  warning:  '#F87171',
  /** 완료 체크 표시 색 — 어두운 위젯 배경 위라 밝은 브랜드 민트(아이콘 달력 띠와 같은 값). */
  accent:   '#6CCFAE',
  /**
   * 캘린더 그리드의 오늘 칸 배경. 🔴 위에 흰 숫자가 올라가므로 밝은 민트를 쓰면 안 된다 —
   * 앱 라이트 테마 primary 와 같은 짙은 민트(흰색 대비 ≥ 4.5, themePalette 대비 보정 값).
   */
  today:    '#2A8466',
} as const;

/**
 * Click action emitted when the user taps a todo's checkbox.
 *
 * Declared here (not inline) so the renderers and widgetTaskHandler cannot
 * drift apart — a typo would silently make taps do nothing, and widgets have
 * no console to notice it in.
 */
export const WIDGET_ACTION_TOGGLE_TODO = 'TOGGLE_TODO';

/** Shape of `clickActionData` carried by a TOGGLE_TODO click. */
export interface ToggleTodoClickData {
  todoId: string;
  /** The state the user is asking for — i.e. the opposite of what was drawn. */
  done: boolean;
}

/** Local-time date key in YYYY-MM-DD form. Mirrors widgetDataService.toDateKey.
 *  Local time (not UTC) because "today" for the user is a wall-clock concept. */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** "8월 10일 (월)" — compact header label. */
export function formatToday(now: Date = new Date()): string {
  return `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS_KO[now.getDay()]})`;
}

/** Weekday initials for the calendar grid header. */
export const WEEKDAY_LABELS = WEEKDAYS_KO;
