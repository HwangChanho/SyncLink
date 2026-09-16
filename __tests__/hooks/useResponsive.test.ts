/**
 * __tests__/hooks/useResponsive.test.ts
 *
 * 폴더블(iPhone Duo)·Split View 대응 훅 3종 테스트. (2026-09-16)
 *
 * 왜 이 테스트가 필요한가:
 *  ① **회귀 잠금** — 기존 폰 폭(320~430)에서 값이 예전과 똑같이 나오는지 고정한다.
 *     차트 폭과 노트 그리드 열 수는 "폴더블 대응" 하다가 폰 UI 를 바꿔 버리기 쉬운 자리다.
 *  ② 🔴 **useGridColumns 의 핵심 계약: cols 가 바뀌면 gridKey 도 반드시 바뀐다.**
 *     이게 깨지면 `numColumns` 가 실행 중에 바뀌는데 목록이 재마운트되지 않아
 *     RN 이 앱을 죽인다(Changing numColumns on the fly is not supported).
 *     형제 프로젝트가 실제로 겪은 사고라, 계약 자체를 테스트로 박아 둔다.
 *  ③ 폭이 0 에 가까워도 차트 폭이 0·음수가 되지 않는지(차트 라이브러리가 NaN 을 그린다).
 *
 * Mock 전략:
 *  react-native 의 `useWindowDimensions` 만 갈아끼워 폭을 마음대로 준다.
 *  🔑 팩토리 안에서 참조하는 변수는 이름이 `mock` 으로 시작해야 한다(jest 호이스팅 규칙).
 */

import { renderHook } from '@testing-library/react-native';
import { useResponsive, useContentWidth, useGridColumns } from '@/hooks/useResponsive';

/** 테스트마다 바꿔 끼우는 가상 화면 폭. */
let mockWindowWidth = 390;

// 🔑 'react-native' 통째로 mock 하면 jest.setup.js 의 기존 RN mock 과 충돌해
//    useWindowDimensions 가 통째로 사라진다(실제로 당했다). **구현 모듈만** 겨냥한다.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: 844, scale: 3, fontScale: 1 }),
}));

/** 폭을 세팅하고 훅을 한 번 렌더해 결과를 돌려주는 헬퍼. */
function renderAt<T>(width: number, hook: () => T): T {
  mockWindowWidth = width;
  return renderHook(hook).result.current;
}

describe('useContentWidth — 차트 등 "폭을 숫자로 받는 뷰"의 폭', () => {
  it('폰 폭에서는 기존 계산(window - 64)과 같다 — 회귀 없음', () => {
    expect(renderAt(390, () => useContentWidth())).toBe(390 - 64);
    expect(renderAt(430, () => useContentWidth())).toBe(430 - 64);
  });

  it('maxWidth 를 주면 그 이상으로는 커지지 않는다 (데스크탑 웹 본문 880 클램프)', () => {
    expect(renderAt(1440, () => useContentWidth({ maxWidth: 880 }))).toBe(880 - 64);
    // 상한보다 좁은 화면은 상한의 영향을 받지 않는다.
    expect(renderAt(390, () => useContentWidth({ maxWidth: 880 }))).toBe(390 - 64);
  });

  it('🔴 아주 좁은 화면에서도 0·음수가 되지 않는다 (차트가 NaN 을 그리는 걸 막는다)', () => {
    expect(renderAt(100, () => useContentWidth())).toBeGreaterThan(0);
    expect(renderAt(0, () => useContentWidth())).toBeGreaterThan(0);
  });

  it('폭이 바뀌면 값도 따라 바뀐다 — 모듈 상수였다면 안 바뀌던 부분', () => {
    const folded = renderAt(374, () => useContentWidth());
    const unfolded = renderAt(744, () => useContentWidth());
    expect(unfolded).toBeGreaterThan(folded);
  });
});

describe('useGridColumns — 그리드 열 수', () => {
  /** 노트 그리드(NotesTab)가 실제로 쓰는 설정. */
  const NOTES = { minColumnWidth: 140, maxColumns: 3, horizontalPadding: 24 } as const;

  it('폰 폭(320~430)에서는 항상 2열 — 기존 numColumns={2} 와 동일', () => {
    for (const width of [320, 375, 390, 414, 430]) {
      expect(renderAt(width, () => useGridColumns(NOTES)).cols).toBe(2);
    }
  });

  it('펼친 폴더블·태블릿 폭에서는 열이 늘고, maxColumns 를 넘지 않는다', () => {
    expect(renderAt(744, () => useGridColumns(NOTES)).cols).toBe(3);
    expect(renderAt(1280, () => useGridColumns(NOTES)).cols).toBe(3); // 상한
  });

  it('아주 좁으면 1열까지 내려간다 (Split View 최소 폭)', () => {
    expect(renderAt(160, () => useGridColumns(NOTES)).cols).toBe(1);
  });

  it('🔴 cols 가 바뀌면 gridKey 도 바뀐다 — FlatList 재마운트를 보장하는 계약', () => {
    const phone = renderAt(390, () => useGridColumns(NOTES));
    const wide = renderAt(744, () => useGridColumns(NOTES));

    expect(wide.cols).not.toBe(phone.cols);
    // key 가 같으면 RN 이 목록을 재사용해 numColumns 변경 크래시가 난다.
    expect(wide.gridKey).not.toBe(phone.gridKey);
  });

  it('cols 가 같으면 gridKey 도 같다 — 폭이 조금 변했다고 목록이 헛되이 재마운트되지 않는다', () => {
    const a = renderAt(390, () => useGridColumns(NOTES));
    const b = renderAt(414, () => useGridColumns(NOTES));

    expect(a.cols).toBe(b.cols);
    expect(a.gridKey).toBe(b.gridKey);
  });
});

describe('useResponsive — 기존 breakpoint (회귀 확인)', () => {
  it('폰 / 태블릿 / 데스크탑 경계가 그대로다', () => {
    expect(renderAt(390, useResponsive).isPhone).toBe(true);
    expect(renderAt(768, useResponsive).isTablet).toBe(true);
    expect(renderAt(1024, useResponsive).isDesktop).toBe(true);
  });
});
