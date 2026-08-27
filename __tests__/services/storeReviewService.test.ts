/**
 * storeReviewService 테스트 — 인앱 리뷰 노출 정책.
 *
 * 여기서 지키려는 것:
 *  1. 조건을 **하나라도** 못 채우면 안 띄운다(설치 직후·저사용 사용자에게 묻지 않는다).
 *  2. 한 번 물었으면 한동안 다시 안 묻고, 평생 한도를 넘지 않는다.
 *  3. 웹처럼 시트를 띄울 수 없는 환경에서 네이티브 호출을 시도하지 않는다.
 *
 * 🔑 정책 판단은 순수 함수(`decideReviewPrompt`)라 시간·저장소 없이 그대로 검증할 수 있다.
 *    부수효과(누적·기록)는 AsyncStorage 목으로 따로 본다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import {
  decideReviewPrompt,
  loadReviewState,
  recordAppOpen,
  recordPositiveMoment,
  requestReviewNow,
  openStoreListing,
  REVIEW_POLICY,
  __resetScheduledForTest,
  type ReviewState,
} from '@/services/storeReviewService';

const DAY = 24 * 60 * 60 * 1000;
/** 고정 기준 시각. Date.now() 를 쓰면 테스트가 실행 시각에 흔들린다. */
const NOW = 1_700_000_000_000;

/** 모든 조건을 넉넉히 만족하는 상태. 각 테스트는 여기서 한 가지씩만 무너뜨린다. */
function passingState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    firstOpenAt: NOW - 30 * DAY,
    openCount: 20,
    positiveCount: 50,
    lastPromptedAt: null,
    promptCount: 0,
    ...overrides,
  };
}

describe('storeReviewService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetScheduledForTest();
    await AsyncStorage.clear();
    (StoreReview.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (StoreReview.requestReview as jest.Mock).mockResolvedValue(undefined);
  });

  // ── decideReviewPrompt (순수 정책) ───────────────────────────────────────────

  describe('decideReviewPrompt', () => {
    it('모든 조건을 채우면 띄운다', () => {
      expect(decideReviewPrompt(passingState(), NOW, true)).toEqual({ shouldPrompt: true });
    });

    it('시트를 못 띄우는 환경(웹 등)이면 다른 조건과 무관하게 안 띄운다', () => {
      expect(decideReviewPrompt(passingState(), NOW, false)).toEqual({
        shouldPrompt: false,
        reason: 'unavailable',
      });
    });

    it('설치한 지 얼마 안 됐으면 안 띄운다', () => {
      const justInstalled = passingState({ firstOpenAt: NOW - (REVIEW_POLICY.minDaysSinceInstall - 1) * DAY });
      expect(decideReviewPrompt(justInstalled, NOW, true)).toEqual({
        shouldPrompt: false,
        reason: 'too_soon_after_install',
      });
    });

    it('실행 횟수가 모자라면 안 띄운다', () => {
      const rarelyOpened = passingState({ openCount: REVIEW_POLICY.minOpenCount - 1 });
      expect(decideReviewPrompt(rarelyOpened, NOW, true)).toEqual({
        shouldPrompt: false,
        reason: 'not_enough_opens',
      });
    });

    it('긍정 순간이 모자라면 안 띄운다', () => {
      const fewWins = passingState({ positiveCount: REVIEW_POLICY.minPositiveCount - 1 });
      expect(decideReviewPrompt(fewWins, NOW, true)).toEqual({
        shouldPrompt: false,
        reason: 'not_enough_positive',
      });
    });

    it('최근에 물었으면 다시 묻지 않는다', () => {
      const askedRecently = passingState({
        lastPromptedAt: NOW - (REVIEW_POLICY.minDaysBetweenPrompts - 1) * DAY,
        promptCount: 1,
      });
      expect(decideReviewPrompt(askedRecently, NOW, true)).toEqual({
        shouldPrompt: false,
        reason: 'recently_prompted',
      });
    });

    it('간격이 충분히 지났으면 다시 묻는다', () => {
      const askedLongAgo = passingState({
        lastPromptedAt: NOW - (REVIEW_POLICY.minDaysBetweenPrompts + 1) * DAY,
        promptCount: 1,
      });
      expect(decideReviewPrompt(askedLongAgo, NOW, true)).toEqual({ shouldPrompt: true });
    });

    it('평생 한도를 채웠으면 간격이 아무리 지나도 안 묻는다', () => {
      const exhausted = passingState({
        lastPromptedAt: NOW - 5 * 365 * DAY,
        promptCount: REVIEW_POLICY.maxPrompts,
      });
      expect(decideReviewPrompt(exhausted, NOW, true)).toEqual({
        shouldPrompt: false,
        reason: 'max_prompts',
      });
    });
  });

  // ── 누적 기록 ────────────────────────────────────────────────────────────────

  describe('recordAppOpen', () => {
    it('첫 실행이면 최초 실행 시각을 남기고 횟수를 1 로 만든다', async () => {
      await recordAppOpen(NOW);

      const state = await loadReviewState(NOW);
      expect(state.openCount).toBe(1);
      expect(state.firstOpenAt).toBe(NOW);
    });

    it('다시 실행해도 최초 실행 시각은 그대로 두고 횟수만 올린다', async () => {
      await recordAppOpen(NOW);
      await recordAppOpen(NOW + 10 * DAY);

      const state = await loadReviewState(NOW + 10 * DAY);
      expect(state.openCount).toBe(2);
      expect(state.firstOpenAt).toBe(NOW); // 설치 경과일 계산의 기준이라 바뀌면 안 된다
    });
  });

  describe('recordPositiveMoment', () => {
    it('조건이 안 찼으면 누적만 하고 네이티브를 부르지 않는다', async () => {
      const decision = await recordPositiveMoment(NOW);

      expect(decision.shouldPrompt).toBe(false);
      expect(StoreReview.requestReview).not.toHaveBeenCalled();
      expect((await loadReviewState(NOW)).positiveCount).toBe(1);
    });

    it('조건이 다 찼으면 잠시 뒤 네이티브 시트를 띄운다', async () => {
      jest.useFakeTimers();
      try {
        await AsyncStorage.setItem(
          'synclink.storeReview.state',
          JSON.stringify(passingState({ positiveCount: REVIEW_POLICY.minPositiveCount })),
        );

        const decision = await recordPositiveMoment(NOW);
        expect(decision.shouldPrompt).toBe(true);
        // 지연 전에는 아직 안 부른다 — 체크 애니메이션과 겹치지 않게 한 박자 쉰다.
        expect(StoreReview.requestReview).not.toHaveBeenCalled();

        jest.runAllTimers();
        await Promise.resolve(); // 예약된 async 호출이 흐르도록 한 틱 넘긴다
        expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('웹처럼 시트를 못 띄우는 환경이면 네이티브를 부르지 않는다', async () => {
      (StoreReview.isAvailableAsync as jest.Mock).mockResolvedValue(false);
      await AsyncStorage.setItem('synclink.storeReview.state', JSON.stringify(passingState()));

      const decision = await recordPositiveMoment(NOW);

      expect(decision).toEqual({ shouldPrompt: false, reason: 'unavailable' });
      expect(StoreReview.requestReview).not.toHaveBeenCalled();
    });
  });

  // ── 요청 기록 ────────────────────────────────────────────────────────────────

  describe('requestReviewNow', () => {
    it('요청에 성공하면 시각과 횟수를 기록한다', async () => {
      expect(await requestReviewNow(NOW)).toBe(true);

      const state = await loadReviewState(NOW);
      expect(state.lastPromptedAt).toBe(NOW);
      expect(state.promptCount).toBe(1);
    });

    it('네이티브 호출이 실패하면 기록을 남기지 않는다(다음 기회에 다시 시도한다)', async () => {
      (StoreReview.requestReview as jest.Mock).mockRejectedValue(new Error('native boom'));

      expect(await requestReviewNow(NOW)).toBe(false);

      const state = await loadReviewState(NOW);
      expect(state.lastPromptedAt).toBeNull();
      expect(state.promptCount).toBe(0);
    });
  });

  // ── 저장소 방어 ──────────────────────────────────────────────────────────────

  describe('loadReviewState', () => {
    it('저장된 값이 깨졌으면 초기값으로 되돌린다', async () => {
      await AsyncStorage.setItem('synclink.storeReview.state', '{ 깨진 JSON');

      const state = await loadReviewState(NOW);

      expect(state).toEqual({
        firstOpenAt: NOW,
        openCount: 0,
        positiveCount: 0,
        lastPromptedAt: null,
        promptCount: 0,
      });
    });
  });

  // ── 스토어 링크 ──────────────────────────────────────────────────────────────

  describe('openStoreListing', () => {
    it('URL 이 없으면(웹) 아무것도 열지 않는다', async () => {
      (StoreReview.storeUrl as jest.Mock).mockReturnValue(null);
      expect(await openStoreListing()).toBe(false);
    });
  });
});
