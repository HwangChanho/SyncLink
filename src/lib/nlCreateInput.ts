/**
 * nlCreateInput — NLParseResult 를 `createEvent` 입력으로 바꾸는 단일 변환기.
 *
 * ## 왜 뺐나
 * 이 조립 로직은 원래 `NLInputBar.handleConfirm` 안에 인라인이었다. 한 건씩
 * 확인하던 시절엔 문제가 없었지만, v1.4.12 에 **여러 건 일괄 등록**(리스트에서
 * 체크한 것들을 한 번에)이 생기면서 같은 로직이 두 곳에서 필요해졌다.
 * 복사해 두면 한쪽만 고쳐지는 사고가 나므로 여기 하나로 모은다.
 *
 * 여기 담긴 가드들은 전부 **실제 회귀에서 나온 것**이라 지우지 말 것:
 *  - title 25자 컷: p.title 이 없을 때 발화 전체가 제목이 되던 문제
 *  - custom_weekly + 빈 weeklyDays → weekly 강등: 캘린더에 아예 안 뜨던 문제
 *  - offsetDays 가 있으면 종일 + 기준일(오늘) 저장: D-day 배지가 뜨는 조건
 */

import type { NLParseResult } from '@/types';

/** 일괄 등록 시 항목별로 다르게 줄 수 있는 옵션. */
export interface NLCreateOptions {
  /** ConfirmModal 의 ColorPicker 에서 고른 색. null 이면 카테고리/기본색. */
  color?: string | null;
  /** 즉시 공유할 스페이스. 비면 비공개. */
  spaceIds?: string[];
  /** 반복 일정 종료일. null 이면 무기한. */
  repeatUntil?: Date | null;
  /** 제목이 비었을 때 쓸 대체 문자열(보통 사용자가 입력한 원문). */
  fallbackTitle?: string;
  /** 제목이 끝내 비면 쓸 값(i18n 의 '제목 없음'). */
  untitledLabel: string;
}

/** `createEvent` 가 받는 입력 형태(필요한 필드만). */
export type NLCreateInput = ReturnType<typeof buildCreateInput>;

/**
 * 파싱 결과 하나를 createEvent 입력으로 변환한다.
 *
 * @param result 파싱 결과 1건
 * @param opts   색·공유·반복종료일 등 사용자가 고른 부가 정보
 */
export function buildCreateInput(result: NLParseResult, opts: NLCreateOptions) {
  const p = result.parsed;
  const startAt = p.startAt?.value ?? new Date();
  const endAt = p.endAt?.value ?? (() => {
    const d = new Date(startAt);
    d.setHours(d.getHours() + 1);
    return d;
  })();

  // title raw 가드 — p.title 이 없을 때 발화 전체가 제목으로 저장되던 회귀.
  const titleCandidate = (p.title?.value ?? opts.fallbackTitle ?? '').trim();
  const safeTitle = titleCandidate.length === 0
    ? opts.untitledLabel
    : titleCandidate.length > 25
      ? titleCandidate.slice(0, 25) + '…'
      : titleCandidate;

  // custom_weekly 인데 weeklyDays 가 비면 occurrence 가 0 이라 캘린더에서 사라진다.
  // 서버에서 1차로 걸러도 여기서 한 번 더 막는다.
  const resolvedRepeatType = (() => {
    const rt = p.repeatType?.value;
    if (rt === 'custom_weekly' && (p.weeklyDays?.value ?? []).length === 0) return 'weekly';
    return rt;
  })();

  return {
    title: safeTitle,
    startAt,
    endAt,
    ...(p.allDay?.value ? { allDay: true } as const : {}),
    ...(p.location?.value ? { location: p.location.value } : {}),
    ...(resolvedRepeatType && resolvedRepeatType !== 'none'
      ? { repeatType: resolvedRepeatType }
      : {}),
    ...(resolvedRepeatType === 'custom_weekly' && p.weeklyDays?.value?.length
      ? { repeatWeekdays: p.weeklyDays.value }
      : {}),
    ...(resolvedRepeatType && resolvedRepeatType !== 'none' && opts.repeatUntil
      ? { repeatUntil: opts.repeatUntil }
      : {}),
    ...(opts.color ? { color: opts.color } : {}),
    ...((opts.spaceIds?.length ?? 0) > 0 ? { shareToSpaceIds: opts.spaceIds } : {}),
    // 상대일 일정("택배 3일 뒤 도착예상") — 오늘을 기준일로 저장해야 D-day 배지가 뜬다.
    ...(p.offsetDays?.value != null
      ? {
          allDay: true as const,
          baseDate: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
          offsetDays: p.offsetDays.value,
          ...(p.offsetLabel?.value ? { offsetLabel: p.offsetLabel.value } : {}),
        }
      : {}),
  };
}
