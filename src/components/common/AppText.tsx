/**
 * AppText — 앱 전체가 쓰는 공용 `Text` / `TextInput`.
 *
 * RN 의 Text/TextInput 을 감싸서 **브랜드 글꼴을 자동으로 입힌다**
 * (규칙은 src/constants/fonts.ts `resolveBrandFont`). 화면 코드는
 * `import { Text } from '@/components/common/AppText'` 로 바꾸기만 하면 되고
 * 스타일·props 는 RN 과 완전히 같다.
 *
 * 🔴 RN 의 Text 를 직접 import 하지 말 것 — 그 텍스트만 시스템 글꼴로 남는다.
 *    ESLint `@typescript-eslint/no-restricted-imports` 가 막는다(.eslintrc.js 참고).
 *
 * 왜 Text.defaultProps 가 아닌가: React 19(RN 0.81)는 함수 컴포넌트의
 * defaultProps 를 무시한다. RN 내부(Text.render)를 몽키패치하는 방법도 있지만
 * RN 을 올릴 때 조용히 깨질 수 있어 명시적인 래퍼를 택했다.
 */
import React, { forwardRef } from 'react';
import {
  StyleSheet,
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- 이 파일만 RN 원본을 감싼다
  Text as RNText,
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- 이 파일만 RN 원본을 감싼다
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { resolveBrandFont } from '@/constants/fonts';
import { useBrandFontsReady } from '@/lib/brandFontsReady';

/**
 * 스타일에 브랜드 글꼴을 덧붙인다.
 * @param style - 원래 style prop(배열·중첩 허용)
 * @param ready - 브랜드 글꼴 로딩이 끝났는가. 🔴 끝나기 전에는 붙이지 않는다 — 없는 글꼴로 잰
 *                폭이 굳어 끝 글자가 잘린다(lib/brandFontsReady 참고). 준비되면 스타일 값이
 *                바뀌어 iOS 가 폭을 다시 잰다.
 * @returns 원 스타일 뒤에 글꼴 스타일을 붙인 배열(준비 전이거나 원 스타일이 fontFamily 를 가지면 그대로)
 */
function withBrandFont<S>(style: S, ready: boolean): S | [S, Pick<TextStyle, 'fontFamily' | 'fontWeight'>] {
  if (!ready) return style;
  // 중첩 배열·조건부(false/null) 스타일까지 한 객체로 합쳐 크기·굵기를 읽는다
  const flat = StyleSheet.flatten(style as never) as TextStyle | undefined;
  const brand = resolveBrandFont(flat);
  return brand ? [style, brand] : style;
}

/** 브랜드 글꼴이 적용되는 Text. props 는 RN Text 와 같다. */
export const Text = forwardRef<RNText, TextProps>(function AppText({ style, ...rest }, ref) {
  const ready = useBrandFontsReady();
  return <RNText ref={ref} {...rest} style={withBrandFont(style, ready)} />;
});

/** 브랜드 글꼴이 적용되는 TextInput. props 는 RN TextInput 과 같다. */
export const TextInput = forwardRef<RNTextInput, TextInputProps>(function AppTextInput(
  { style, ...rest },
  ref,
) {
  const ready = useBrandFontsReady();
  return <RNTextInput ref={ref} {...rest} style={withBrandFont(style, ready)} />;
});

/**
 * 같은 이름의 **타입**도 내보낸다 — `useRef<TextInput>(null)` 처럼 RN 클래스를
 * 인스턴스 타입으로 쓰던 코드가 import 경로만 바꿔도 그대로 컴파일되게 한다.
 * (TS 는 값과 타입이 같은 이름을 가질 수 있다)
 */
export type Text = RNText;
export type TextInput = RNTextInput;
