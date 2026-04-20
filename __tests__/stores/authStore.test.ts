/**
 * __tests__/stores/authStore.test.ts
 *
 * TASK-110: Auth Test Suite — authStore.ts 유닛 테스트
 *
 * 전략:
 *  - Zustand store를 직접 import하여 상태 머신처럼 검증
 *  - useAuthStore.getState() / setState()로 사이드이펙트 없는 순수 상태 테스트
 *  - 각 테스트 전 beforeEach에서 초기 상태로 리셋
 *
 * 커버리지:
 *  초기 상태         — user=null, isLoading=true, isAuthenticated=false
 *  setUser(user)    — user/isAuthenticated/isLoading 동시 업데이트
 *  setUser(null)    — 로그아웃 시 null 초기화
 *  setLoading()     — isLoading 단독 업데이트, 다른 상태 미변경 확인
 *
 * @task TASK-110
 */

import { useAuthStore } from '@/stores/authStore';
import type { UserRow } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** 테스트용 UserRow 픽스처 */
const mockUserRow: UserRow = {
  id: 'user-123',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar_url: null,
  push_token: null,
  notification_settings: {
    event_reminders: true,
    partner_changes: true,
    space_invites: true,
    smart_reminders: true,
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('authStore', () => {
  /**
   * 각 테스트 전 스토어를 초기 상태로 리셋.
   * Zustand 싱글톤 특성상 테스트 간 상태가 오염될 수 있으므로 필수.
   */
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isLoading: true,
      isAuthenticated: false,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 초기 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('초기 상태', () => {
    it('user는 null이어야 함 (미로그인 상태)', () => {
      const { user } = useAuthStore.getState();
      expect(user).toBeNull();
    });

    it('isLoading은 true여야 함 (세션 복원 대기 중)', () => {
      // 앱 시작 시 세션 복원 전까지 isLoading=true를 유지해야
      // 로그인 화면으로의 premature redirect를 방지
      const { isLoading } = useAuthStore.getState();
      expect(isLoading).toBe(true);
    });

    it('isAuthenticated는 false여야 함', () => {
      const { isAuthenticated } = useAuthStore.getState();
      expect(isAuthenticated).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setUser
  // ══════════════════════════════════════════════════════════════════════════

  describe('setUser', () => {
    it('유저 설정: user, isAuthenticated=true, isLoading=false로 동시 업데이트', () => {
      useAuthStore.getState().setUser(mockUserRow);

      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toEqual(mockUserRow);
      expect(isAuthenticated).toBe(true);
      // 로그인 완료 후 로딩 상태 해제
      expect(isLoading).toBe(false);
    });

    it('유저 객체 전체가 올바르게 저장됨 (deep equality)', () => {
      useAuthStore.getState().setUser(mockUserRow);

      const { user } = useAuthStore.getState();
      expect(user?.id).toBe('user-123');
      expect(user?.email).toBe('test@example.com');
      expect(user?.nickname).toBe('TestUser');
      expect(user?.notification_settings.event_reminders).toBe(true);
    });

    it('로그아웃: setUser(null) → user=null, isAuthenticated=false, isLoading=false', () => {
      // 먼저 로그인 상태로 설정
      useAuthStore.getState().setUser(mockUserRow);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);

      // 로그아웃
      useAuthStore.getState().setUser(null);

      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toBeNull();
      expect(isAuthenticated).toBe(false);
      // 로그아웃 후에도 isLoading=false 유지
      expect(isLoading).toBe(false);
    });

    it('setUser는 isAuthenticated를 user 유무에 따라 자동 계산', () => {
      // null → false
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);

      // 유저 있음 → true
      useAuthStore.getState().setUser(mockUserRow);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('유저 교체: 다른 유저로 재설정 시 상태 덮어씀', () => {
      useAuthStore.getState().setUser(mockUserRow);

      const anotherUser: UserRow = {
        ...mockUserRow,
        id: 'user-456',
        email: 'another@example.com',
        nickname: 'AnotherUser',
      };
      useAuthStore.getState().setUser(anotherUser);

      const { user } = useAuthStore.getState();
      expect(user?.id).toBe('user-456');
      expect(user?.nickname).toBe('AnotherUser');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setLoading
  // ══════════════════════════════════════════════════════════════════════════

  describe('setLoading', () => {
    it('setLoading(false): isLoading을 false로 업데이트', () => {
      useAuthStore.getState().setLoading(false);

      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('setLoading(true): isLoading을 다시 true로 업데이트', () => {
      useAuthStore.setState({ isLoading: false });
      useAuthStore.getState().setLoading(true);

      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it('setLoading은 user 상태를 변경하지 않음', () => {
      useAuthStore.getState().setUser(mockUserRow);
      useAuthStore.getState().setLoading(true);

      // user 상태 보존 확인
      expect(useAuthStore.getState().user).toEqual(mockUserRow);
    });

    it('setLoading은 isAuthenticated 상태를 변경하지 않음', () => {
      useAuthStore.getState().setUser(mockUserRow);
      // 로그인 후 isAuthenticated = true
      expect(useAuthStore.getState().isAuthenticated).toBe(true);

      useAuthStore.getState().setLoading(false);
      // setLoading이 isAuthenticated에 영향을 주지 않아야 함
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 상태 전이 시나리오
  // ══════════════════════════════════════════════════════════════════════════

  describe('상태 전이 시나리오', () => {
    it('앱 초기화 흐름: isLoading=true → 세션 없음 → isLoading=false', () => {
      // 초기 상태: isLoading=true
      expect(useAuthStore.getState().isLoading).toBe(true);

      // 세션 복원 결과: 로그인 세션 없음
      useAuthStore.getState().setLoading(false);

      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('로그인 흐름: isLoading=true → 세션 복원 → setUser(user) → 완료', () => {
      // 초기: 로딩 중
      expect(useAuthStore.getState().isLoading).toBe(true);

      // 세션 복원 완료, 유저 설정
      useAuthStore.getState().setUser(mockUserRow);

      // 최종 상태 확인
      const { user, isAuthenticated, isLoading } = useAuthStore.getState();
      expect(user).toEqual(mockUserRow);
      expect(isAuthenticated).toBe(true);
      expect(isLoading).toBe(false);
    });
  });
});
