/**
 * 에메랄드 헤더 = 브랜드 민트(1.5.0) 회귀 테스트.
 *
 * #6CCFAE 는 휘도 0.509 로 contrastingTextColor 의 경계(0.5) 바로 위라, 색을 조금만 바꿔도
 * 헤더 글자가 흰색으로 뒤집혀(대비 1.9) 안 보이게 된다. 글자색과 대비를 함께 잠근다.
 */
import { HEADER_TITLE_COLOR_HEX } from '@/stores/appearanceStore';
import { contrastingTextColor } from '@/lib/colorContrast';

/** WCAG 대비비(#RRGGBB 두 개) */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('에메랄드 헤더 — 브랜드 민트', () => {
  const bg = HEADER_TITLE_COLOR_HEX.emerald as string;

  it('아이콘 달력 띠와 같은 민트다', () => {
    expect(bg).toBe('#6CCFAE');
  });

  it('헤더 글자는 검정이고 대비가 4.5 이상이다(흰 글자로 뒤집히면 안 보인다)', () => {
    const fg = contrastingTextColor(bg);
    expect(fg).toBe('#000000');
    expect(contrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });
});
