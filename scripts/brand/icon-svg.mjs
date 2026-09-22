/**
 * 우리하루 아이콘 원본(SVG) — 모든 아이콘·로고 에셋의 단일 소스.
 *
 * 🔑 왜 PNG 가 아니라 SVG 코드가 원본인가:
 *   예전 로고는 PNG 만 남아 있어서, 웹 로고를 만들 때 PNG 에서 타일을 도려내는
 *   누끼 로직(밝기·flood fill)이 따로 필요했다. 원본이 벡터면 "배경 있음/없음",
 *   "여백 넓힘(Android 적응형)" 을 그리기 단계에서 바로 고를 수 있어 그런 후처리가 없다.
 *
 * 디자인: 「C. 웃는 달력」(2026-09-23 LEAD 선택) — 흰 둥근 달력 카드 + 민트 띠 +
 *   눈웃음·볼터치. 좌표는 1024×1024 기준.
 *
 * 사용처: scripts/brand/build-icons.mjs(앱 아이콘·스플래시·파비콘),
 *         scripts/landing/build-assets.mjs(랜딩 og 카드).
 */

/** 브랜드 색 — 아이콘과 앱 테마가 같은 값을 보게 여기 모은다. */
export const ICON_COLORS = {
  /** 배경 그라데이션 시작(좌상단) */
  bgFrom: '#D6F5E8',
  /** 배경 그라데이션 끝(우하단) */
  bgTo: '#B3E8D4',
  /** 그라데이션을 못 쓰는 곳(Android 적응형 배경·스플래시)의 단색 대표값 */
  bgFlat: '#C4EEDD',
  /** 달력 상단 띠 = 브랜드 민트 */
  band: '#6CCFAE',
  /** 눈·입 선 색 — 순수 검정보다 부드러운 먹색 */
  ink: '#4A4A5A',
  /** 볼터치 */
  blush: '#FFB3C1',
};

/**
 * 달력 마크(카드+얼굴)만 그린 SVG 조각. 배경은 포함하지 않는다.
 * @param {object} [opts]
 * @param {boolean} [opts.shadow=true] 카드 그림자 여부(작은 파비콘에서는 번져 보여 끈다)
 * @returns {string} 1024 좌표계 SVG 조각(<defs> 포함)
 */
export function markSvg({ shadow = true } = {}) {
  const c = ICON_COLORS;
  return `
  <defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.10"/>
    </filter>
  </defs>
  <g ${shadow ? 'filter="url(#soft)"' : ''}>
    <rect x="212" y="250" width="600" height="560" rx="120" fill="#FFFFFF"/>
  </g>
  <!-- 상단 민트 띠: 카드 위쪽 모서리 곡률(rx=120)을 그대로 따른다 -->
  <path d="M212 370 a120 120 0 0 1 120 -120 h360 a120 120 0 0 1 120 120 v20 h-600 z" fill="${c.band}"/>
  <!-- 달력 링 2개 -->
  <rect x="362" y="200" width="56" height="120" rx="28" fill="#FFFFFF"/>
  <rect x="606" y="200" width="56" height="120" rx="28" fill="#FFFFFF"/>
  <!-- 눈웃음 2개 + 입 -->
  <g fill="none" stroke="${c.ink}" stroke-width="26" stroke-linecap="round">
    <path d="M392 585 q35 -40 70 0"/><path d="M562 585 q35 -40 70 0"/>
    <path d="M472 660 q40 34 80 0"/>
  </g>
  <!-- 볼터치 -->
  <ellipse cx="380" cy="660" rx="44" ry="28" fill="${c.blush}"/>
  <ellipse cx="644" cy="660" rx="44" ry="28" fill="${c.blush}"/>`;
}

/**
 * 완성 SVG 문서를 만든다.
 * @param {object} [opts]
 * @param {'gradient'|'flat'|'none'} [opts.background='gradient'] 배경 종류
 *   - gradient: 앱 아이콘(iOS·스토어)
 *   - flat: 단색(필요 시)
 *   - none: 투명 — 웹 로고·파비콘·Android 적응형 전경
 * @param {number} [opts.scale=1] 마크 축소 비율(중심 기준). Android 적응형은 바깥 1/3 이
 *   잘리므로 0.72 정도로 줄여 안전영역(지름 66%) 안에 넣는다.
 * @param {boolean} [opts.shadow=true] 카드 그림자
 * @returns {string} 1024×1024 SVG 문서 문자열
 */
export function iconSvg({ background = 'gradient', scale = 1, shadow = true } = {}) {
  const c = ICON_COLORS;
  const bg =
    background === 'gradient'
      ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="${c.bgFrom}"/><stop offset="1" stop-color="${c.bgTo}"/>
         </linearGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/>`
      : background === 'flat'
        ? `<rect width="1024" height="1024" fill="${c.bgFlat}"/>`
        : '';
  // 중심(512,512) 기준 축소: translate → scale → 원점 복귀
  const t = scale === 1 ? '' : `transform="translate(512 512) scale(${scale}) translate(-512 -512)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${bg}<g ${t}>${markSvg({ shadow })}</g></svg>`;
}
