/**
 * useEventForm — event/create + event/edit 공통 폼 state 컨테이너.
 *
 * Phase 2.2 분할 (event/create.tsx 1,440 + edit/[id].tsx 945 = 2,385 줄):
 *  두 화면이 거의 동일한 폼 state 와 picker handler 를 각각 inline 으로
 *  들고 있어 동기화 오류가 잘 났다 (Build-50 endAt 보정 회귀 등). 폼
 *  자체는 같은 도메인이라 hook 한 곳에 모은다. 화면은 데이터 로드 +
 *  최종 save 만 담당.
 *
 * 이 hook 이 다루지 않는 것:
 *  - 서버 호출 (createEvent / updateEvent / deleteEvent / share*)
 *  - 라우팅 (router.push / router.back)
 *  - 권한 / GPS / 카테고리 fetch — 화면이 결정
 *
 * 폼 일관성 규칙 (LEAD 보고로 도입):
 *  - start picker confirm → end <= start 면 end = start + 1h 자동.
 *  - end picker confirm → start >= end 면 start = end - 1h 자동.
 *  - web datetime-local 도 동일 보호.
 */

import { useCallback, useState } from 'react';
import type { RepeatType } from '@/types';

export interface EventFormInitial {
  title?: string;
  allDay?: boolean;
  startAt?: Date;
  endAt?: Date;
  repeatType?: RepeatType;
  repeatWeekdays?: number[];
  location?: string;
  description?: string;
  shareSpaceIds?: string[];
  reminderMinutes?: number[];
  eventColor?: string | null;
  categoryId?: string | null;
  /** Build-96 — 멤버 편집 허용 토글 초기값. default false. */
  editableByMembers?: boolean;
  /** v1.3 — 상대일 일정(기준일+N일) 모드 on/off 초기값. default false. */
  relativeEnabled?: boolean;
  /** v1.3 — 기준일 (발급일/주문일). default null(=UI 는 '오늘' 로 표시). */
  baseDate?: Date | null;
  /** v1.3 — 기준일로부터 +N일. default 1. */
  offsetDays?: number;
  /** v1.3 — D-day 라벨. default ''. */
  offsetLabel?: string;
}

export interface EventFormState {
  title: string;
  allDay: boolean;
  startAt: Date;
  endAt: Date;
  repeatType: RepeatType;
  /** 'custom_weekly' 일 때만 의미 — 0=일..6=토. */
  repeatWeekdays: number[];
  location: string;
  description: string;
  shareSpaceIds: string[];
  reminderMinutes: number[];
  /** null = 카테고리/멤버 색 fallback. */
  eventColor: string | null;
  categoryId: string | null;
  editableByMembers: boolean;
  /** v1.3 — 상대일 일정(기준일+N일) 모드 on/off. */
  relativeEnabled: boolean;
  /** v1.3 — 기준일. null 이면 UI 는 '오늘' 로 간주해 표시. */
  baseDate: Date | null;
  /** v1.3 — 기준일로부터 +N일. */
  offsetDays: number;
  /** v1.3 — D-day 라벨 ('' = 없음). */
  offsetLabel: string;
}

// 모든 setter 를 React.Dispatch 로 노출 — 호출자가 prev 기반 함수형
// 업데이트도 자유롭게 쓸 수 있도록 (useState 와 100% 호환).
export interface EventFormSetters {
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  setAllDay: React.Dispatch<React.SetStateAction<boolean>>;
  setStartAt: React.Dispatch<React.SetStateAction<Date>>;
  setEndAt: React.Dispatch<React.SetStateAction<Date>>;
  setRepeatType: React.Dispatch<React.SetStateAction<RepeatType>>;
  setRepeatWeekdays: React.Dispatch<React.SetStateAction<number[]>>;
  setLocation: React.Dispatch<React.SetStateAction<string>>;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  setShareSpaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  setReminderMinutes: React.Dispatch<React.SetStateAction<number[]>>;
  setEventColor: React.Dispatch<React.SetStateAction<string | null>>;
  setCategoryId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditableByMembers: React.Dispatch<React.SetStateAction<boolean>>;
  setRelativeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setBaseDate: React.Dispatch<React.SetStateAction<Date | null>>;
  setOffsetDays: React.Dispatch<React.SetStateAction<number>>;
  setOffsetLabel: React.Dispatch<React.SetStateAction<string>>;
}

export interface EventFormHelpers {
  /**
   * Picker (DateTimeModal) 가 한 필드의 새 값을 commit 했을 때 호출.
   * 양쪽 끝 일관성을 자동 보장한다.
   */
  applyPickerValue: (target: 'start' | 'end', selected: Date) => void;
  /** Web `<input type="datetime-local">` change 도 동일 보호. */
  applyWebDateChange: (field: 'start' | 'end', isoStr: string) => void;
  /** start/end 시각을 분 단위로 +/- 이동 (chip 단축). */
  shiftTime: (field: 'start' | 'end', deltaMinutes: number) => void;
}

const HOUR_MS = 60 * 60 * 1000;

function defaultStart(): Date {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = minutes < 30 ? 30 : 0;
  const hourOffset = minutes < 30 ? 0 : 1;
  const d = new Date();
  d.setHours(now.getHours() + hourOffset, roundedMinutes, 0, 0);
  return d;
}

function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + HOUR_MS);
}

export function useEventForm(initial: EventFormInitial = {}): {
  state: EventFormState;
  setters: EventFormSetters;
  helpers: EventFormHelpers;
} {
  const initialStart = initial.startAt ?? defaultStart();
  const initialEnd = initial.endAt ?? defaultEnd(initialStart);

  const [title, setTitle] = useState(initial.title ?? '');
  const [allDay, setAllDay] = useState(initial.allDay ?? false);
  const [startAt, setStartAt] = useState<Date>(initialStart);
  const [endAt, setEndAt] = useState<Date>(initialEnd);
  const [repeatType, setRepeatType] = useState<RepeatType>(initial.repeatType ?? 'none');
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>(initial.repeatWeekdays ?? []);
  const [location, setLocation] = useState(initial.location ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [shareSpaceIds, setShareSpaceIds] = useState<string[]>(initial.shareSpaceIds ?? []);
  const [reminderMinutes, setReminderMinutes] = useState<number[]>(initial.reminderMinutes ?? []);
  const [eventColor, setEventColor] = useState<string | null>(initial.eventColor ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId ?? null);
  const [editableByMembers, setEditableByMembers] = useState<boolean>(initial.editableByMembers ?? false);
  // v1.3 — 상대일 일정 (기준일 + N일 → D-day).
  const [relativeEnabled, setRelativeEnabled] = useState<boolean>(initial.relativeEnabled ?? false);
  const [baseDate, setBaseDate] = useState<Date | null>(initial.baseDate ?? null);
  const [offsetDays, setOffsetDays] = useState<number>(initial.offsetDays ?? 1);
  const [offsetLabel, setOffsetLabel] = useState<string>(initial.offsetLabel ?? '');

  const applyPickerValue = useCallback((target: 'start' | 'end', selected: Date) => {
    if (target === 'start') {
      setStartAt(selected);
      // start 가 end 보다 늦거나 같으면 end 를 start + 1h 로 보정.
      setEndAt((prev) => (prev <= selected ? new Date(selected.getTime() + HOUR_MS) : prev));
    } else {
      setEndAt(selected);
      // 대칭 보호 — end 가 start 보다 같거나 빠르면 start = end - 1h.
      setStartAt((prev) => (selected <= prev ? new Date(selected.getTime() - HOUR_MS) : prev));
    }
  }, []);

  const applyWebDateChange = useCallback((field: 'start' | 'end', isoStr: string) => {
    if (!isoStr) return;
    const parsed = new Date(isoStr);
    if (isNaN(parsed.getTime())) return;
    applyPickerValue(field, parsed);
  }, [applyPickerValue]);

  const shiftTime = useCallback((field: 'start' | 'end', deltaMinutes: number) => {
    const setter = field === 'start' ? setStartAt : setEndAt;
    setter((prev) => {
      const next = new Date(prev);
      next.setMinutes(next.getMinutes() + deltaMinutes);
      return next;
    });
  }, []);

  return {
    state: {
      title, allDay, startAt, endAt, repeatType, repeatWeekdays,
      location, description, shareSpaceIds, reminderMinutes, eventColor, categoryId,
      editableByMembers,
      relativeEnabled, baseDate, offsetDays, offsetLabel,
    },
    setters: {
      setTitle, setAllDay, setStartAt, setEndAt, setRepeatType, setRepeatWeekdays,
      setLocation, setDescription, setShareSpaceIds, setReminderMinutes, setEventColor, setCategoryId,
      setEditableByMembers,
      setRelativeEnabled, setBaseDate, setOffsetDays, setOffsetLabel,
    },
    helpers: { applyPickerValue, applyWebDateChange, shiftTime },
  };
}
