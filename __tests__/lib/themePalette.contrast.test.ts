/**
 * themePalette 대비 회귀 테스트 (1.5.0).
 *
 * 왜 있나: 예전 팔레트는 모든 hue 에 같은 명도(L=48)를 써서 emerald·amber 프리셋의
 * 버튼(흰 글자)이 WCAG AA 에 못 미쳤다(2.44:1 · 3.06:1). 기본색을 민트로 바꾸면서
 * 명도를 대비 계산으로 정하게 고쳤다. 이 테스트는 **어떤 프리셋이든, 앞으로 추가될
 * 임의 hue 든** 기준을 지키는지 잠근다.
 */
import {
  ACCENT_PRESETS,
  buildPalette,
  contrastWithWhite,
  fitLightnessForWhite,
} from '@/lib/themePalette';

/**
 * buildPalette 가 만든 `hsl(h, s%, l%)` 문자열을 숫자로 푼다.
 * @param color - hsl() 문자열
 * @returns [h, s, l]
 */
function parseHsl(color: string): [number, number, number] {
  const m = color.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
  if (!m) throw new Error(`hsl 형식이 아님: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 흰 글자가 올라가는 라이트 모드 토큰의 흰색 대비 */
const whiteContrast = (color: string) => contrastWithWhite(...parseHsl(color));

describe('themePalette — 흰 글자 대비 보정', () => {
  it('기본 프리셋은 민트(160)다 — 아이콘 달력 띠 #6CCFAE 와 같은 hue', () => {
    expect(ACCENT_PRESETS.default).toBe(160);
  });

  // 설정에 노출되는 것 + 저장값 호환용 키까지 전부 검사한다
  it.each(Object.entries(ACCENT_PRESETS))(
    '라이트 %s(hue %d): primary 위 흰 글자 ≥ 4.5, accent ≥ 3',
    (_name, hue) => {
      const p = buildPalette(hue, false);
      expect(whiteContrast(p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(whiteContrast(p.tabActive)).toBeGreaterThanOrEqual(4.5);
      expect(whiteContrast(p.accent)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(Object.entries(ACCENT_PRESETS))(
    '다크 %s(hue %d): primary 위 흰 아이콘 ≥ 3 · 어두운 글자(textInverse) ≥ 4.5',
    (_name, hue) => {
      const p = buildPalette(hue, true);
      expect(whiteContrast(p.primary)).toBeGreaterThanOrEqual(3);
      // 어두운 글자 대비 = 두 색의 WCAG 휘도비. 휘도는 흰색 대비(1.05/(L+0.05))에서 역산한다
      const lum = (c: string) => 1.05 / contrastWithWhite(...parseHsl(c)) - 0.05;
      const [hi, lo] = [lum(p.primary), lum(p.textInverse)].sort((x, y) => y - x);
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('0~359 모든 hue 에서 primary 가 기준을 지킨다(새 프리셋 추가 대비)', () => {
    for (let h = 0; h < 360; h += 1) {
      expect(whiteContrast(buildPalette(h, false).primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('이미 기준을 넘는 hue 는 명도를 건드리지 않는다(indigo·violet·rose 인상 유지)', () => {
    expect(fitLightnessForWhite(ACCENT_PRESETS.indigo, 52, 48, 4.5)).toBe(48);
    expect(fitLightnessForWhite(ACCENT_PRESETS.violet, 52, 48, 4.5)).toBe(48);
    expect(fitLightnessForWhite(ACCENT_PRESETS.rose, 52, 48, 4.5)).toBe(48);
  });

  it('민트는 L34, amber 는 L38 까지 내려간다(계획서 계산값과 일치)', () => {
    expect(fitLightnessForWhite(160, 52, 48, 4.5)).toBe(34);
    expect(fitLightnessForWhite(38, 52, 48, 4.5)).toBe(38);
  });
});
