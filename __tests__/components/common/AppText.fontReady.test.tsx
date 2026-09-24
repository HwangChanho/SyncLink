/**
 * AppText × 글꼴 준비 신호 회귀 테스트(2026-09-24).
 *
 * 스플래시 아래에서 먼저 그려진 텍스트가 **없는 글꼴**로 폭이 재어져 굳고, 글꼴이 도착해도
 * 다시 재지 않아 끝 글자가 잘렸다(LEAD 실기: "오늘 일정이 없어ᅀ").
 * 잠그는 것: 준비 전엔 브랜드 글꼴을 지정하지 않고, 준비되는 순간 지정한다(= 스타일이 바뀐다).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from '@/components/common/AppText';
import { BRAND_FONT } from '@/constants/fonts';
import { __resetBrandFontsReadyForTest, markBrandFontsReady } from '@/lib/brandFontsReady';

/** 렌더된 텍스트의 최종 fontFamily */
const familyOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style)?.fontFamily;

describe('AppText — 브랜드 글꼴은 준비된 뒤에만', () => {
  beforeEach(() => __resetBrandFontsReadyForTest());

  it('준비 전: 브랜드 글꼴을 지정하지 않는다(시스템 글꼴 폭으로 재도 이후 다시 잰다)', () => {
    render(<Text testID="t" style={{ fontSize: 15 }}>오늘 일정이 없어요</Text>);
    expect(familyOf('t')).toBeUndefined();
  });

  it('준비되는 순간 다시 렌더되어 브랜드 글꼴이 붙는다', () => {
    render(<Text testID="t" style={{ fontSize: 15 }}>오늘 일정이 없어요</Text>);
    act(() => markBrandFontsReady());
    expect(familyOf('t')).toBe(BRAND_FONT.body);
  });

  it('준비 후 새로 그려지는 텍스트는 처음부터 브랜드 글꼴', () => {
    markBrandFontsReady();
    render(<Text testID="t" style={{ fontSize: 22, fontWeight: '700' }}>제목</Text>);
    expect(familyOf('t')).toBe(BRAND_FONT.title);
  });
});
