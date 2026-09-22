/**
 * 브랜드 글꼴 선택 규칙(resolveBrandFont) 테스트 — 1.5.0.
 *
 * 공용 AppText 가 스타일의 크기·굵기만 보고 글꼴을 고르므로, 이 규칙이 틀어지면
 * 앱 전체 텍스트의 글꼴이 한꺼번에 바뀐다. 경계값을 잠가 둔다.
 */
import { BRAND_FONT, resolveBrandFont } from '@/constants/fonts';

describe('resolveBrandFont', () => {
  it('크기 20 이상 + 굵기 600 이상 → 제목(주아)', () => {
    expect(resolveBrandFont({ fontSize: 20, fontWeight: '600' })?.fontFamily).toBe(BRAND_FONT.title);
    expect(resolveBrandFont({ fontSize: 28, fontWeight: 'bold' })?.fontFamily).toBe(BRAND_FONT.title);
  });

  it('크게 써도 굵지 않으면 본문, 굵어도 작으면 본문 Bold', () => {
    expect(resolveBrandFont({ fontSize: 24, fontWeight: '400' })?.fontFamily).toBe(BRAND_FONT.body);
    expect(resolveBrandFont({ fontSize: 19, fontWeight: '700' })?.fontFamily).toBe(BRAND_FONT.bodyBold);
  });

  it('굵기별 본문 파일: ≤500 Regular · 600~700 Bold · ≥800 ExtraBold', () => {
    expect(resolveBrandFont({ fontSize: 15, fontWeight: '500' })?.fontFamily).toBe(BRAND_FONT.body);
    expect(resolveBrandFont({ fontSize: 15, fontWeight: '600' })?.fontFamily).toBe(BRAND_FONT.bodyBold);
    expect(resolveBrandFont({ fontSize: 15, fontWeight: '800' })?.fontFamily).toBe(BRAND_FONT.bodyExtraBold);
    expect(resolveBrandFont({ fontSize: 15, fontWeight: 900 })?.fontFamily).toBe(BRAND_FONT.bodyExtraBold);
  });

  it('스타일이 없으면 본문 Regular', () => {
    expect(resolveBrandFont(undefined)?.fontFamily).toBe(BRAND_FONT.body);
  });

  it('🔴 fontWeight 는 normal 로 되돌린다(가짜 굵게·시스템 글꼴 되돌림 방지)', () => {
    expect(resolveBrandFont({ fontSize: 15, fontWeight: '700' })?.fontWeight).toBe('normal');
  });

  it('이미 fontFamily 가 있으면 건드리지 않는다(아이콘·고정폭 글꼴)', () => {
    expect(resolveBrandFont({ fontFamily: 'Menlo', fontWeight: '700' })).toBeNull();
  });
});
