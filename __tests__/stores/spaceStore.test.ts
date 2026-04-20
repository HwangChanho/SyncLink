/**
 * __tests__/stores/spaceStore.test.ts
 *
 * TASK-111: Space Test Suite — spaceStore.ts 유닛 테스트
 * ISSUE-005 해결
 *
 * 전략:
 *  - spaceService 전체를 jest.mock으로 대체 → 실제 DB 호출 없음
 *  - useSpaceStore.setState()로 각 테스트 전 초기 상태 리셋
 *  - Zustand 싱글톤 특성: 테스트 간 상태 오염 방지 필수
 *
 * 커버리지:
 *  초기 상태              — spaces/activeSpaceId/spaceDetails/isLoading/error
 *  setSpaces              — 배열 교체
 *  setActiveSpaceId       — ID 설정 / null
 *  setSpaceDetail         — 캐시 upsert
 *  removeSpace            — 목록 + 캐시 + activeSpaceId 삭제
 *  setLoading / setError  — 플래그 업데이트
 *  fetchMySpaces 성공     — spaces 업데이트, activeSpaceId 자동 설정
 *  fetchMySpaces 기존 active — 기존 activeSpaceId 유지
 *  fetchMySpaces 실패     — error 상태
 *  fetchSpaceById 성공    — 캐시에 저장
 *  fetchSpaceById 캐시 히트 — service 호출 없음
 *  fetchSpaceById 실패    — error + throw
 *
 * @task TASK-111
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/services/spaceService');

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as spaceService from '@/services/spaceService';
import { useSpaceStore } from '@/stores/spaceStore';
import type { SpaceSummary, Space } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** SpaceSummary 픽스처 (목록에 표시되는 요약 정보) */
const mockSpaceSummary1: SpaceSummary = {
  id: 'space-001',
  name: 'Morning Crew',
  type: 'group',
  memberCount: 3,
  coverImageUrl: null,
};

const mockSpaceSummary2: SpaceSummary = {
  id: 'space-002',
  name: 'Just Us Two',
  type: 'couple',
  memberCount: 2,
  coverImageUrl: null,
};

/** Space 상세 정보 픽스처 (spaceDetails 캐시용) */
const mockSpaceDetail: Space = {
  id: 'space-001',
  name: 'Morning Crew',
  type: 'group',
  inviteCode: 'ABC123',
  coverImageUrl: null,
  createdBy: 'user-123',
  members: [
    {
      userId: 'user-123',
      nickname: 'TestUser',
      avatarUrl: null,
      role: 'owner',
      color: '#8B5CF6',
      joinedAt: new Date(),
    },
  ],
  dDayCount: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceStore', () => {
  /** 각 테스트 전 스토어를 초기 상태로 완전 리셋 */
  beforeEach(() => {
    jest.clearAllMocks();
    useSpaceStore.setState({
      spaces: [],
      activeSpaceId: null,
      spaceDetails: {},
      isLoading: false,
      error: null,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 초기 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('초기 상태', () => {
    it('spaces는 빈 배열이어야 함', () => {
      expect(useSpaceStore.getState().spaces).toEqual([]);
    });

    it('activeSpaceId는 null이어야 함', () => {
      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });

    it('spaceDetails는 빈 객체이어야 함', () => {
      expect(useSpaceStore.getState().spaceDetails).toEqual({});
    });

    it('isLoading은 false이어야 함', () => {
      expect(useSpaceStore.getState().isLoading).toBe(false);
    });

    it('error는 null이어야 함', () => {
      expect(useSpaceStore.getState().error).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setSpaces
  // ══════════════════════════════════════════════════════════════════════════

  describe('setSpaces', () => {
    it('spaces 배열을 교체', () => {
      useSpaceStore.getState().setSpaces([mockSpaceSummary1, mockSpaceSummary2]);

      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(2);
      expect(spaces[0]?.id).toBe('space-001');
      expect(spaces[1]?.id).toBe('space-002');
    });

    it('빈 배열로 초기화 가능', () => {
      useSpaceStore.setState({ spaces: [mockSpaceSummary1] });
      useSpaceStore.getState().setSpaces([]);

      expect(useSpaceStore.getState().spaces).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setActiveSpaceId
  // ══════════════════════════════════════════════════════════════════════════

  describe('setActiveSpaceId', () => {
    it('activeSpaceId를 설정', () => {
      useSpaceStore.getState().setActiveSpaceId('space-001');

      expect(useSpaceStore.getState().activeSpaceId).toBe('space-001');
    });

    it('null로 초기화 가능', () => {
      useSpaceStore.setState({ activeSpaceId: 'space-001' });
      useSpaceStore.getState().setActiveSpaceId(null);

      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setSpaceDetail
  // ══════════════════════════════════════════════════════════════════════════

  describe('setSpaceDetail', () => {
    it('spaceDetails에 Space 객체를 캐시에 upsert', () => {
      useSpaceStore.getState().setSpaceDetail(mockSpaceDetail);

      const { spaceDetails } = useSpaceStore.getState();
      expect(spaceDetails['space-001']).toEqual(mockSpaceDetail);
    });

    it('다른 space의 캐시를 덮어쓰지 않음', () => {
      const anotherSpace: Space = { ...mockSpaceDetail, id: 'space-002', name: 'Another' };

      useSpaceStore.getState().setSpaceDetail(mockSpaceDetail);
      useSpaceStore.getState().setSpaceDetail(anotherSpace);

      const { spaceDetails } = useSpaceStore.getState();
      expect(Object.keys(spaceDetails)).toHaveLength(2);
      expect(spaceDetails['space-001']?.name).toBe('Morning Crew');
      expect(spaceDetails['space-002']?.name).toBe('Another');
    });

    it('같은 ID로 다시 setSpaceDetail: 캐시 업데이트', () => {
      useSpaceStore.getState().setSpaceDetail(mockSpaceDetail);

      const updatedSpace: Space = { ...mockSpaceDetail, name: 'Updated Name' };
      useSpaceStore.getState().setSpaceDetail(updatedSpace);

      expect(useSpaceStore.getState().spaceDetails['space-001']?.name).toBe('Updated Name');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // removeSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('removeSpace', () => {
    beforeEach(() => {
      // 상태를 spaces + spaceDetails + activeSpaceId 있는 상태로 초기화
      useSpaceStore.setState({
        spaces: [mockSpaceSummary1, mockSpaceSummary2],
        spaceDetails: { 'space-001': mockSpaceDetail },
        activeSpaceId: 'space-001',
      });
    });

    it('spaces 목록에서 해당 space 제거', () => {
      useSpaceStore.getState().removeSpace('space-001');

      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(1);
      expect(spaces[0]?.id).toBe('space-002');
    });

    it('spaceDetails 캐시에서도 제거', () => {
      useSpaceStore.getState().removeSpace('space-001');

      expect(useSpaceStore.getState().spaceDetails['space-001']).toBeUndefined();
    });

    it('activeSpaceId가 제거된 space면 null로 초기화', () => {
      // activeSpaceId = 'space-001'인 상태에서 space-001 제거
      useSpaceStore.getState().removeSpace('space-001');

      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });

    it('activeSpaceId가 다른 space면 유지됨', () => {
      useSpaceStore.setState({ activeSpaceId: 'space-002' });
      useSpaceStore.getState().removeSpace('space-001');

      // 다른 space 삭제는 activeSpaceId에 영향 없음
      expect(useSpaceStore.getState().activeSpaceId).toBe('space-002');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setLoading / setError
  // ══════════════════════════════════════════════════════════════════════════

  describe('setLoading', () => {
    it('isLoading을 true로 업데이트', () => {
      useSpaceStore.getState().setLoading(true);
      expect(useSpaceStore.getState().isLoading).toBe(true);
    });

    it('isLoading을 false로 업데이트', () => {
      useSpaceStore.setState({ isLoading: true });
      useSpaceStore.getState().setLoading(false);
      expect(useSpaceStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('error 메시지를 설정', () => {
      useSpaceStore.getState().setError('Space 목록 조회 실패');
      expect(useSpaceStore.getState().error).toBe('Space 목록 조회 실패');
    });

    it('null로 에러 초기화', () => {
      useSpaceStore.setState({ error: '이전 에러' });
      useSpaceStore.getState().setError(null);
      expect(useSpaceStore.getState().error).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchMySpaces (비동기 thunk)
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchMySpaces', () => {
    it('성공: spaces 배열 업데이트, isLoading=false', async () => {
      (spaceService.getMySpaces as jest.Mock).mockResolvedValue([
        mockSpaceSummary1,
        mockSpaceSummary2,
      ]);

      await useSpaceStore.getState().fetchMySpaces();

      const { spaces, isLoading, error } = useSpaceStore.getState();
      expect(spaces).toHaveLength(2);
      expect(spaces[0]?.id).toBe('space-001');
      expect(isLoading).toBe(false);
      expect(error).toBeNull();
    });

    it('성공 + activeSpaceId=null: 첫 번째 space를 자동 선택', async () => {
      (spaceService.getMySpaces as jest.Mock).mockResolvedValue([
        mockSpaceSummary1,
        mockSpaceSummary2,
      ]);

      await useSpaceStore.getState().fetchMySpaces();

      // activeSpaceId가 null → 첫 번째 space로 자동 설정
      expect(useSpaceStore.getState().activeSpaceId).toBe('space-001');
    });

    it('성공 + 기존 activeSpaceId 있음: 기존 값 유지', async () => {
      // 이미 선택된 space가 있는 상태
      useSpaceStore.setState({ activeSpaceId: 'space-002' });
      (spaceService.getMySpaces as jest.Mock).mockResolvedValue([
        mockSpaceSummary1,
        mockSpaceSummary2,
      ]);

      await useSpaceStore.getState().fetchMySpaces();

      // 기존 activeSpaceId 유지
      expect(useSpaceStore.getState().activeSpaceId).toBe('space-002');
    });

    it('성공 + 빈 배열: activeSpaceId = null 유지', async () => {
      (spaceService.getMySpaces as jest.Mock).mockResolvedValue([]);

      await useSpaceStore.getState().fetchMySpaces();

      expect(useSpaceStore.getState().spaces).toEqual([]);
      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });

    it('실패: error 상태 업데이트, isLoading=false', async () => {
      (spaceService.getMySpaces as jest.Mock).mockRejectedValue(
        new Error('로그인이 필요합니다.'),
      );

      await useSpaceStore.getState().fetchMySpaces();

      const { error, isLoading, spaces } = useSpaceStore.getState();
      expect(error).toBe('로그인이 필요합니다.');
      expect(isLoading).toBe(false);
      // spaces는 초기 빈 배열 유지
      expect(spaces).toEqual([]);
    });

    it('실패 + Error 인스턴스 아닌 경우: 기본 메시지 사용', async () => {
      (spaceService.getMySpaces as jest.Mock).mockRejectedValue('unknown error');

      await useSpaceStore.getState().fetchMySpaces();

      expect(useSpaceStore.getState().error).toBe('Space 목록을 불러오지 못했습니다.');
    });

    it('호출 중: isLoading=true 상태 시작', async () => {
      // 완료되지 않는 Promise
      let resolveMySpaces!: (value: SpaceSummary[]) => void;
      (spaceService.getMySpaces as jest.Mock).mockReturnValue(
        new Promise(resolve => { resolveMySpaces = resolve; }),
      );

      const fetchPromise = useSpaceStore.getState().fetchMySpaces();

      // fetchMySpaces 시작 직후: isLoading=true
      expect(useSpaceStore.getState().isLoading).toBe(true);
      expect(useSpaceStore.getState().error).toBeNull();

      // cleanup
      resolveMySpaces([]);
      await fetchPromise;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchSpaceById (비동기 thunk)
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchSpaceById', () => {
    it('성공: Space를 spaceDetails 캐시에 저장 후 반환', async () => {
      (spaceService.getSpaceById as jest.Mock).mockResolvedValue(mockSpaceDetail);

      const result = await useSpaceStore.getState().fetchSpaceById('space-001');

      expect(spaceService.getSpaceById).toHaveBeenCalledWith('space-001');
      expect(result).toEqual(mockSpaceDetail);
      expect(useSpaceStore.getState().spaceDetails['space-001']).toEqual(mockSpaceDetail);
      expect(useSpaceStore.getState().isLoading).toBe(false);
    });

    it('캐시 히트: 이미 캐시에 있으면 service 호출 없이 캐시 반환', async () => {
      // 캐시에 미리 저장
      useSpaceStore.setState({ spaceDetails: { 'space-001': mockSpaceDetail } });

      const result = await useSpaceStore.getState().fetchSpaceById('space-001');

      // service 호출 없음
      expect(spaceService.getSpaceById).not.toHaveBeenCalled();
      expect(result).toEqual(mockSpaceDetail);
    });

    it('실패: error 상태 업데이트 + 에러 throw (호출자에게 전파)', async () => {
      const fetchError = new Error('Space를 찾을 수 없습니다.');
      (spaceService.getSpaceById as jest.Mock).mockRejectedValue(fetchError);

      await expect(
        useSpaceStore.getState().fetchSpaceById('nonexistent'),
      ).rejects.toThrow('Space를 찾을 수 없습니다.');

      expect(useSpaceStore.getState().error).toBe('Space를 찾을 수 없습니다.');
      expect(useSpaceStore.getState().isLoading).toBe(false);
    });

    it('실패 + Error 인스턴스 아닌 경우: 기본 에러 메시지 저장', async () => {
      (spaceService.getSpaceById as jest.Mock).mockRejectedValue('raw error string');

      await expect(
        useSpaceStore.getState().fetchSpaceById('space-001'),
      ).rejects.toBeTruthy();

      expect(useSpaceStore.getState().error).toBe('Space 정보를 불러오지 못했습니다.');
    });
  });
});
