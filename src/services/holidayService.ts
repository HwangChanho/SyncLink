/**
 * holidayService — v1.2.0 국가별 공휴일 표시.
 *
 * 외부 API 호출 없이 정적 JSON 파일에서 조회. 매년 수동 갱신.
 * 지원 국가: KR(default) / JP / US. 'other' 또는 매칭 안 됨 → 빈 배열.
 *
 * 사용:
 *   const list = getHolidaysInRange('KR', startDate, endDate);
 *
 * @see src/data/holidays/{country}.json
 */

import krJson from '@/data/holidays/kr.json';
import usJson from '@/data/holidays/us.json';
import jpJson from '@/data/holidays/jp.json';

/** 지원 국가 코드 — ISO 3166-1 alpha-2. */
export type CountryCode = 'KR' | 'US' | 'JP' | 'other';

export interface Holiday {
  /** YYYY-MM-DD (local date). */
  date: string;
  /** 한국어/현지어 공휴일 이름. */
  name: string;
}

interface HolidayBundle {
  country: string;
  country_name_ko: string;
  holidays: Holiday[];
}

const BUNDLES: Record<Exclude<CountryCode, 'other'>, HolidayBundle> = {
  KR: krJson as HolidayBundle,
  US: usJson as HolidayBundle,
  JP: jpJson as HolidayBundle,
};

/** 지원 국가 목록 (드롭다운 등 UI 용). */
export const SUPPORTED_COUNTRIES: Array<{ code: CountryCode; label: string }> = [
  { code: 'KR', label: '대한민국' },
  { code: 'US', label: '미국' },
  { code: 'JP', label: '일본' },
  { code: 'other', label: '기타' },
];

/**
 * 특정 국가의 공휴일 전체.
 * 'other' 또는 알 수 없는 코드 → 빈 배열.
 */
export function getAllHolidays(country: CountryCode): Holiday[] {
  if (country === 'other') return [];
  const bundle = BUNDLES[country];
  return bundle?.holidays ?? [];
}

/**
 * 특정 범위 안 공휴일만 필터.
 * @param country  사용자 국가
 * @param startKey YYYY-MM-DD 포함
 * @param endKey   YYYY-MM-DD 포함
 */
export function getHolidaysInRange(
  country: CountryCode,
  startKey: string,
  endKey: string,
): Holiday[] {
  return getAllHolidays(country).filter(
    (h) => h.date >= startKey && h.date <= endKey,
  );
}

/**
 * 빠른 조회용 Map (dateKey → Holiday[]).
 * MonthView 등에서 매 cell render 마다 호출되므로 memoize 권장.
 */
export function getHolidaysByDate(country: CountryCode): Record<string, Holiday[]> {
  const out: Record<string, Holiday[]> = {};
  for (const h of getAllHolidays(country)) {
    (out[h.date] ??= []).push(h);
  }
  return out;
}
