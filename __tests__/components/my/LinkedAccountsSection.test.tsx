/**
 * __tests__/components/my/LinkedAccountsSection.test.tsx
 *
 * Sprint 25 TASK-002 (carry): LinkedAccountsSection 컴포넌트 단위 테스트
 *
 * 전략:
 *  - authService 전체 모듈을 jest.mock 처리 → linkProvider/getLinkedProviders/
 *    unlinkProvider 호출만 검증 (실제 OAuth 흐름은 services 레이어 테스트가 담당).
 *  - Alert.alert는 spy로 가로채 호출 인자 검증.
 *  - 비동기 effect(refresh) 완료를 기다리기 위해 waitFor를 사용한다.
 *
 * 커버리지 (4개 시나리오):
 *  1. 연결된 provider 목록 렌더 (Google + Kakao 연결됨)
 *  2. 빈 목록 (모든 provider 미연결 → 모든 행에 "연결" 라벨)
 *  3. "연결" 버튼 → linkProvider 호출
 *  4. "해제" 동작 → unlinkProvider 호출 (마지막 1개 가드도 함께 검증)
 *
 * @task TASK-002
 * @sprint 25
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────
// Note: jest.mock는 hoisted 되므로 import 전에 선언해야 한다.
// authService 전체를 mock 하고, 각 테스트에서 mockResolvedValue로 응답을 제어한다.
jest.mock('@/services/authService', () => ({
  linkProvider:        jest.fn(),
  getLinkedProviders:  jest.fn(),
  unlinkProvider:      jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as authService from '@/services/authService';
import { LinkedAccountsSection } from '@/components/my/LinkedAccountsSection';

// 타입 캐스팅 헬퍼 — jest.Mock 으로 좁혀서 mockResolvedValue 사용 편의 확보
const mockedGet    = authService.getLinkedProviders as jest.Mock;
const mockedLink   = authService.linkProvider       as jest.Mock;
const mockedUnlink = authService.unlinkProvider     as jest.Mock;

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('LinkedAccountsSection', () => {
  /** Alert.alert를 spy로 가로채 호출 검증 + 노이즈 차단 */
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 응답: 마운트 직후 refresh()가 호출되므로 항상 resolve 되도록 설정
    mockedGet.mockResolvedValue([]);
    mockedLink.mockResolvedValue(undefined);
    mockedUnlink.mockResolvedValue(undefined);

    // Alert.alert는 native modal — Jest에서 호출만 추적
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1) 연결된 provider 목록 렌더 (Google + Kakao 연결 상태)
  // ══════════════════════════════════════════════════════════════════════════
  it('연결된 provider는 "연결됨" 배지를 표시한다 (Google + Kakao)', async () => {
    mockedGet.mockResolvedValue(['google', 'kakao']);

    const { findAllByText, getByText } = render(<LinkedAccountsSection />);

    // refresh() 완료 대기 — google/kakao는 "연결됨", apple은 "연결" 표시
    const linkedBadges = await findAllByText('연결됨');
    expect(linkedBadges).toHaveLength(2);

    // Apple은 미연결 → "연결" 라벨 1개만
    expect(getByText('연결')).toBeTruthy();

    // 각 provider 라벨 노출 검증
    expect(getByText('Google')).toBeTruthy();
    expect(getByText('Kakao')).toBeTruthy();
    expect(getByText('Apple')).toBeTruthy();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2) 빈 목록 (모든 provider 미연결)
  // ══════════════════════════════════════════════════════════════════════════
  it('모든 provider 미연결 시 모든 행에 "연결" 라벨이 표시된다', async () => {
    mockedGet.mockResolvedValue([]);

    const { findAllByText, queryByText } = render(<LinkedAccountsSection />);

    // refresh 완료 대기 후, 3개 모두 "연결" 라벨
    const linkLabels = await findAllByText('연결');
    expect(linkLabels).toHaveLength(3);

    // "연결됨" 배지는 단 하나도 없어야 한다
    expect(queryByText('연결됨')).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3) "연결" 버튼 → linkProvider 호출
  // ══════════════════════════════════════════════════════════════════════════
  it('미연결 provider 행을 누르면 linkProvider가 해당 키로 호출된다', async () => {
    mockedGet.mockResolvedValue([]); // 모두 미연결

    const { findByLabelText } = render(<LinkedAccountsSection />);

    // accessibilityLabel = `${label} 연결` (handleToggle 분기 기준)
    const googleRow = await findByLabelText('Google 연결');

    // 비동기 액션이므로 act로 감싸 effect/state 업데이트를 한 번에 flush
    await act(async () => {
      fireEvent.press(googleRow);
    });

    expect(mockedLink).toHaveBeenCalledTimes(1);
    expect(mockedLink).toHaveBeenCalledWith('google');
    // 정상 흐름이므로 Alert는 호출되지 않아야 한다
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4) "해제" 동작 → unlinkProvider 호출 + 마지막 1개 가드
  // ══════════════════════════════════════════════════════════════════════════
  describe('연결 해제', () => {
    it('연결된 provider가 2개 이상이면 unlinkProvider가 호출된다', async () => {
      mockedGet.mockResolvedValue(['google', 'kakao']);

      const { findByLabelText } = render(<LinkedAccountsSection />);

      // accessibilityLabel = `${label} 연결 해제`
      const googleRow = await findByLabelText('Google 연결 해제');

      await act(async () => {
        fireEvent.press(googleRow);
      });

      expect(mockedUnlink).toHaveBeenCalledTimes(1);
      expect(mockedUnlink).toHaveBeenCalledWith('google');
      // 정상 해제 → Alert 미호출
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('연결된 provider가 1개뿐이면 해제 차단 Alert가 표시되고 unlinkProvider는 호출되지 않는다', async () => {
      // 마지막 로그인 방법 가드 — Google만 연결된 상태
      mockedGet.mockResolvedValue(['google']);

      const { findByLabelText } = render(<LinkedAccountsSection />);
      const googleRow = await findByLabelText('Google 연결 해제');

      await act(async () => {
        fireEvent.press(googleRow);
      });

      // Alert.alert('해제 불가', ...) 호출 검증
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        '해제 불가',
        expect.stringContaining('마지막 로그인 방법'),
      );
      // 가드에 의해 unlinkProvider는 절대 호출되면 안 된다
      expect(mockedUnlink).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 마운트 동작 — getLinkedProviders 자동 호출 보강 검증
  // ══════════════════════════════════════════════════════════════════════════
  it('마운트 시 getLinkedProviders가 한 번 호출된다', async () => {
    mockedGet.mockResolvedValue([]);

    render(<LinkedAccountsSection />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
  });
});
