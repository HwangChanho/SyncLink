/**
 * __tests__/app/sprint0.navigation.test.tsx
 *
 * QA verification for TASK-004: 네비게이션 scaffold
 *
 * Acceptance Criteria 검증:
 * - [x] src/app/_layout.tsx — 루트 레이아웃 렌더링
 * - [x] src/app/(tabs)/index.tsx — 홈 탭 placeholder 렌더링
 * - [x] src/app/(tabs)/calendar.tsx — 캘린더 탭 placeholder 렌더링
 * - [x] src/app/(tabs)/planner.tsx — 플래너 탭 placeholder 렌더링
 * - [x] src/app/(tabs)/my.tsx — My 탭 placeholder 렌더링
 * - [x] src/app/event/[id].tsx — 이벤트 상세 placeholder 렌더링
 * - [x] src/app/space/[id].tsx — Space 상세 placeholder 렌더링
 * - [x] src/app/auth/login.tsx — 로그인 화면 placeholder 렌더링
 *
 * 검증 수준: 크래시 없이 렌더링되는지 (smoke test).
 * 실제 UI 검증은 Sprint 1-4에서 각 화면 구현 후 수행.
 *
 * @task TASK-004
 * @verifiedBy QA
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── 정적 import — 동적 import(await import())는 Jest CommonJS 환경 미지원 ──
import EventScreen from '@/app/event/[id]';
import SpaceScreen from '@/app/space/[id]';
import LoginScreen from '@/app/auth/login';
import RootLayout from '@/app/_layout';

// ─── 네비게이션 관련 mock ────────────────────────────────────────────────────
// jest.setup.js에서 expo-router가 mock됨.
// 추가로 필요한 RN 모듈들을 여기서 mock.

// ISSUE-002 수정: jest.mock 팩토리 내에서 스코프 밖 변수(React) 참조 불가.
// require()로 팩토리 내부에서 직접 로드해야 함.
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  return {
    SafeAreaView: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    SafeAreaProvider: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  return {
    GestureHandlerRootView: ({ children, style }: { children: unknown; style?: object }) =>
      mockReact.createElement('View', { style }, children),
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// expo-router/Stack은 jest.setup.js에서 mock됨

// ─── Placeholder 화면 import ──────────────────────────────────────────────────

import HomeScreen from '@/app/(tabs)/index';
import CalendarScreen from '@/app/(tabs)/calendar';
import PlannerScreen from '@/app/(tabs)/planner';
import MyScreen from '@/app/(tabs)/my';

// ─── TASK-004: 탭 화면 렌더링 검증 ───────────────────────────────────────────

describe('TASK-004: Tab screens render without crashing', () => {

  it('HomeScreen renders without crash', () => {
    // TASK-404 완전 구현됨 (Sprint 4) — 크래시 없이 렌더링되면 통과.
    // 상세 UI 검증은 __tests__/screens/HomeScreen.test.tsx 에서 수행.
    render(<HomeScreen />);
    expect(true).toBeTruthy();
  });

  it('HomeScreen shows today todo section header', () => {
    const { getByText } = render(<HomeScreen />);
    // TodayTodoList 컴포넌트가 항상 렌더링하는 섹션 헤더
    // i18n 적용 후: 이모지 제거, t('todo.today_list_title') = '오늘 할일'
    expect(getByText('오늘 할일')).toBeTruthy();
  });

  it('CalendarScreen renders', () => {
    const { queryByText } = render(<CalendarScreen />);
    // 크래시 없이 렌더링되었는지 확인
    // (어떤 텍스트라도 렌더링되면 성공)
    expect(true).toBeTruthy();
  });

  it('PlannerScreen renders', () => {
    render(<PlannerScreen />);
    expect(true).toBeTruthy();
  });

  it('MyScreen renders', () => {
    render(<MyScreen />);
    expect(true).toBeTruthy();
  });
});

// ─── TASK-004: 모달 화면 렌더링 검증 ─────────────────────────────────────────

describe('TASK-004: Modal screens render without crashing', () => {
  it('Event detail screen renders', () => {
    render(<EventScreen />);
    expect(true).toBeTruthy();
  });

  it('Space detail screen renders', () => {
    render(<SpaceScreen />);
    expect(true).toBeTruthy();
  });

  it('Login screen renders', () => {
    render(<LoginScreen />);
    expect(true).toBeTruthy();
  });
});

// ─── TASK-004: 루트 레이아웃 검증 ────────────────────────────────────────────

describe('TASK-004: Root layout renders without crashing', () => {
  it('RootLayout renders with mocked providers', () => {
    // 크래시 없이 렌더링 — 실제 Stack 라우팅은 Expo Router 내부에서 처리
    render(<RootLayout />);
    expect(true).toBeTruthy();
  });
});
