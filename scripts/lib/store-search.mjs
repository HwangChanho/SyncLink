/**
 * store-search — 양 스토어의 **검색 결과 목록**을 가져와 특정 앱의 순위를 찾는다.
 *
 * ASO 의 핵심 질문은 "키워드에 넣었는가"가 아니라 **"그 검색어로 우리가 몇 위에 보이는가"** 다.
 * 키워드 필드는 100자뿐이라, 넣어도 순위가 안 나오는 단어는 그 자리를 낭비하는 셈이다.
 * 이 모듈은 그 판정을 위한 **측정만** 담당한다(문구 변경은 listing-text 스크립트의 몫).
 *
 * 🔑 두 스토어의 측정 방식이 근본적으로 다르다 — 정밀도도 다르다.
 *   · App Store : 공식 검색 API(JSON). 최대 200위까지 정확히 셀 수 있다.
 *   · Play      : 공식 검색 API가 없어 **검색 페이지 HTML 을 파싱**한다. 첫 화면에 실리는
 *                 30~50개가 한계이고, 페이지에 추천/광고 블록이 섞이면 순서가 흔들린다.
 *                 → Play 순위는 "대략의 위치"로만 읽을 것(1~2계단 차이는 노이즈다).
 *
 * 🔴 레이트 리밋: 두 곳 모두 연속 호출하면 막힌다(iTunes 는 429, Play 는 빈 HTML).
 *    호출자가 반드시 간격을 두어야 한다 — 이 모듈은 대기하지 않는다(단일 책임).
 */

/** 검색 시 브라우저로 위장할 UA. Play 는 UA 가 없으면 축약 HTML 을 주는 경우가 있다. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * fetch 래퍼 — 타임아웃과 1회 재시도를 붙인다.
 *
 * @param {string} url            요청 URL
 * @param {object} [opt]
 * @param {number} [opt.timeoutMs=15000]  응답 제한 시간
 * @param {number} [opt.retryDelayMs=3000] 429/5xx 일 때 재시도 전 대기
 * @returns {Promise<{ok: boolean, status: number, text: string}>}
 */
async function fetchOnce(url, { timeoutMs = 15000, retryDelayMs = 3000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
      });
      const text = await res.text();
      // 429(레이트 리밋)·5xx 는 한 번만 더 시도한다. 그 이상은 호출자가 간격을 늘려야 한다.
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      return { ok: res.ok, status: res.status, text };
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      return { ok: false, status: 0, text: String(e?.message ?? e) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, text: 'unreachable' };
}

/**
 * App Store 검색 — iTunes Search API.
 *
 * ⚠️ `limit` 을 작게 두면 우리 앱이 목록에 없다는 이유로 **"색인 안 됨"으로 오판**한다
 *    (08-24 에 limit=10 으로 재서 실제로 그렇게 오판한 적이 있다). 기본 200 을 유지할 것.
 *
 * @param {string} term            검색어
 * @param {object} [opt]
 * @param {string} [opt.country='kr'] 스토어 국가
 * @param {number} [opt.limit=200]    최대 조회 수(API 상한 200)
 * @returns {Promise<{ok: boolean, apps: Array<{id: string, name: string}>, error?: string}>}
 *          apps 는 검색 결과 순서 그대로다(0번이 1위).
 */
export async function searchAppStore(term, { country = 'kr', limit = 200 } = {}) {
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({
      term,
      country,
      entity: 'software',
      limit: String(limit),
      lang: 'ko_kr',
    });

  const res = await fetchOnce(url);
  if (!res.ok) return { ok: false, apps: [], error: `HTTP ${res.status}` };

  try {
    const json = JSON.parse(res.text);
    const apps = (json.results ?? []).map((r) => ({
      id: String(r.trackId),
      name: r.trackName ?? '',
    }));
    return { ok: true, apps };
  } catch {
    return { ok: false, apps: [], error: 'JSON 파싱 실패' };
  }
}

/**
 * Play 검색 — 검색 페이지 HTML 에서 앱 링크를 **등장 순서대로** 뽑는다.
 *
 * 🔑 Play 는 같은 패키지 링크가 한 카드 안에서 여러 번 나오므로 **중복을 제거하며 순서를 유지**한다.
 * ⚠️ 첫 화면 밖(스크롤 로딩)은 보이지 않는다 → 목록에 없으면 "미노출"이 아니라
 *    **"첫 화면 밖"**으로 읽어야 한다. 호출자가 `apps.length` 를 함께 기록할 것.
 *
 * @param {string} term          검색어
 * @param {object} [opt]
 * @param {string} [opt.hl='ko'] 표시 언어
 * @param {string} [opt.gl='KR'] 국가
 * @returns {Promise<{ok: boolean, apps: Array<{id: string}>, error?: string}>}
 */
export async function searchPlay(term, { hl = 'ko', gl = 'KR' } = {}) {
  const url =
    'https://play.google.com/store/search?' +
    new URLSearchParams({ q: term, c: 'apps', hl, gl });

  const res = await fetchOnce(url);
  if (!res.ok) return { ok: false, apps: [], error: `HTTP ${res.status}` };

  const seen = new Set();
  const apps = [];
  // 앱 상세 링크에서 패키지명만 추출한다. 패키지명 문자 집합은 [A-Za-z0-9._] 로 충분하다.
  const re = /\/store\/apps\/details\?id=([A-Za-z0-9._]+)/g;
  let m;
  while ((m = re.exec(res.text)) !== null) {
    const pkg = m[1];
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    apps.push({ id: pkg });
  }
  return { ok: true, apps };
}

/**
 * 결과 목록에서 대상 앱의 순위를 찾는다.
 *
 * @param {Array<{id: string}>} apps  검색 결과(순서 = 순위)
 * @param {string} targetId           App Store 는 trackId, Play 는 패키지명
 * @returns {number|null}             1-based 순위. 목록에 없으면 null
 */
export function rankOf(apps, targetId) {
  const i = apps.findIndex((a) => a.id === targetId);
  return i < 0 ? null : i + 1;
}
