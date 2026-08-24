/**
 * store-ratings Edge Function — 관리자 대시보드용 양 스토어 별점 조회.
 *
 * 왜 서버인가: App Store 는 iTunes Lookup 이 CORS 를 열어 둬서 앱에서 직접 부를 수 있지만,
 * Play 는 집계 별점을 주는 공식 API 가 없어 **스토어 페이지를 읽어야** 하고 브라우저에서는
 * CORS 로 막힌다(관리자 페이지는 웹에서 쓴다). 그래서 둘 다 여기서 받아 한 번에 돌려준다.
 *
 * 반환:
 *   { fetchedAt, ios: {rating,count,currentVersionRating,currentVersionCount,version,error?},
 *                android: {rating,count,error?} }
 *   값이 없으면 null 이다 — 실패와 "아직 평가 없음"을 구분하려고 error 를 따로 둔다.
 *
 * 🔴 Play 추출 규칙(2026-08-24 실측으로 검증):
 *   페이지 하나에 별점 aria-label 이 여러 개 나온다 — 아래쪽 "비슷한 앱" 캐러셀의 다른 앱들
 *   것이다. 그래서 **앱 제목과 "비슷한 앱" 사이**에 있는 첫 값만 인정한다.
 *   · 투두메이트(별점 있음): 첫 별점이 캐러셀보다 앞 → 4.7 채택 ✅
 *   · 투투리스트(리뷰 0 → Play 가 별점 블록 자체를 안 그림): 첫 별점이 캐러셀 뒤 → null ✅
 *   이 가드가 없으면 **남의 앱 별점이 우리 대시보드에 찍힌다**. 숫자가 틀리는 건 없느니만 못하다.
 *
 * 인증: 없음. 공개 스토어 정보만 다루고 고정 URL 두 개만 호출한다(오픈 프록시 아님).
 *
 * Called by: src/services/adminService.ts → getStoreRatings()
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const IOS_APP_ID = '6763083903';
const ANDROID_PKG = 'io.synclink.app';
const COUNTRY = 'kr';

/** 스토어 별점은 자주 바뀌지 않는다. 관리자 새로고침마다 크롤링할 이유가 없다. */
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Play 페이지가 1MB 를 넘어 느릴 때가 있다. 대시보드가 통째로 멈추면 안 된다. */
const FETCH_TIMEOUT_MS = 12_000;

interface PlatformRating {
  rating: number | null;
  count: number | null;
  /** iOS 전용 — 현재 버전 기준 값. */
  currentVersionRating?: number | null;
  currentVersionCount?: number | null;
  version?: string | null;
  /** 조회 자체가 실패한 경우만 채운다. 값이 null 이고 error 도 없으면 "아직 평가 없음". */
  error?: string;
}

interface StoreRatings {
  fetchedAt: string;
  ios: PlatformRating;
  android: PlatformRating;
}

let cache: { at: number; data: StoreRatings } | null = null;

/** 타임아웃이 있는 fetch. 스토어가 늦게 응답해도 함수가 매달리지 않게 한다. */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** App Store — iTunes Lookup 이 집계 별점을 그대로 준다. */
async function fetchIos(): Promise<PlatformRating> {
  try {
    const r = await fetchWithTimeout(
      `https://itunes.apple.com/lookup?id=${IOS_APP_ID}&country=${COUNTRY}&t=${Date.now()}`,
    );
    if (!r.ok) return { rating: null, count: null, error: `HTTP ${r.status}` };
    const j = await r.json();
    const a = j?.results?.[0];
    if (!a) return { rating: null, count: null, error: '앱을 찾지 못했습니다' };
    return {
      rating: typeof a.averageUserRating === 'number' ? a.averageUserRating : null,
      count: typeof a.userRatingCount === 'number' ? a.userRatingCount : null,
      currentVersionRating:
        typeof a.averageUserRatingForCurrentVersion === 'number'
          ? a.averageUserRatingForCurrentVersion
          : null,
      currentVersionCount:
        typeof a.userRatingCountForCurrentVersion === 'number'
          ? a.userRatingCountForCurrentVersion
          : null,
      version: a.version ?? null,
    };
  } catch (e) {
    return { rating: null, count: null, error: String(e).slice(0, 120) };
  }
}

/**
 * Play — 스토어 페이지에서 집계 별점을 읽는다.
 * 파일 상단 주석의 "비슷한 앱" 가드를 반드시 지킬 것.
 */
async function fetchAndroid(): Promise<PlatformRating> {
  try {
    const r = await fetchWithTimeout(
      `https://play.google.com/store/apps/details?id=${ANDROID_PKG}&hl=ko&gl=KR`,
      {
        headers: {
          'Accept-Language': 'ko-KR,ko',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
      },
    );
    if (!r.ok) return { rating: null, count: null, error: `HTTP ${r.status}` };
    const html = await r.text();

    // 우리 앱 페이지가 맞는지부터 확인. 리다이렉트/오류 페이지를 파싱하면 안 된다.
    if (!html.includes(ANDROID_PKG)) {
      return { rating: null, count: null, error: '앱 페이지가 아닙니다' };
    }

    // 캐러셀 시작 위치 — 이 뒤의 별점은 전부 남의 앱 것이다.
    const carousel = [html.indexOf('비슷한 앱'), html.indexOf('유사한 앱'), html.indexOf('Similar apps')]
      .filter((i) => i >= 0);
    const limit = carousel.length ? Math.min(...carousel) : html.length;

    const m = /별표 5개 만점에 ([0-9]+(?:\.[0-9]+)?)개/.exec(html);
    if (!m || m.index >= limit) {
      // 여기가 "아직 평가 없음" 경로다 — 리뷰가 쌓이면 Play 가 블록을 그리기 시작한다.
      return { rating: null, count: null };
    }
    const rating = Number(m[1]);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      return { rating: null, count: null, error: `별점 파싱 이상: ${m[1]}` };
    }

    // 리뷰 수는 페이지 표기가 일정하지 않아(만/천 단위 축약) 못 읽으면 null 로 둔다.
    const cm = /([0-9][0-9,.]*(?:만|천)?)\s*(?:개의\s*)?리뷰/.exec(html.slice(0, limit));
    let count: number | null = null;
    if (cm) {
      const raw = cm[1].replace(/,/g, '');
      if (raw.endsWith('만')) count = Math.round(parseFloat(raw) * 10_000);
      else if (raw.endsWith('천')) count = Math.round(parseFloat(raw) * 1_000);
      else count = Number.isFinite(Number(raw)) ? Number(raw) : null;
    }
    return { rating, count };
  } catch (e) {
    return { rating: null, count: null, error: String(e).slice(0, 120) };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return new Response(JSON.stringify({ ...cache.data, cached: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 한쪽이 실패해도 다른 쪽은 보여줘야 한다 — 각자 자기 error 를 담아 온다.
  const [ios, android] = await Promise.all([fetchIos(), fetchAndroid()]);
  const data: StoreRatings = { fetchedAt: new Date().toISOString(), ios, android };
  cache = { at: Date.now(), data };

  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
