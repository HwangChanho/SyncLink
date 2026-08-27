/**
 * storeReviewService — 인앱 리뷰(별점) 요청을 언제 띄울지 한 곳에서 판단한다.
 *
 * 왜 서비스로 빼는가:
 *   호출 지점(할 일 완료 등)은 앞으로 늘어날 수 있는데 "언제 띄울지"의 정책은 한 벌이어야
 *   한다. 정책이 호출 지점마다 흩어지면 사용자가 여러 번 시달리고, 조건을 바꿀 때 빠뜨린다.
 *
 * 🔴 스토어 정책상 반드시 지켜야 하는 두 가지 (Google Play In-App Review 공식 문서):
 *   1. **사전 질문 금지** — "앱이 마음에 드세요?" 같은 만족도 프리프롬프트를 앞에 붙이면 안 된다.
 *      원문: "Your app shouldn't ask the user any questions before or while presenting the
 *      rating button or card, including questions about their opinion".
 *      → 그래서 이 서비스에는 커스텀 UI 가 없다. 조건이 맞으면 네이티브 시트를 곧장 띄운다.
 *   2. **버튼으로 API 를 호출하면 안 된다** — 사용자가 이미 스토어 할당량을 다 쓴 상태면
 *      아무 일도 일어나지 않아 "고장난 버튼"이 된다.
 *      원문: "you should not have a call-to-action option (such as a button) to trigger the
 *      API ... redirect the user to the Play Store instead".
 *      → 설정 화면의 "리뷰 남기기" 버튼은 `openStoreListing()`(스토어 URL)을 쓰고,
 *        자동 노출만 `requestReviewNow()`(네이티브 API)를 쓴다. 둘을 섞으면 안 된다.
 *
 * 🔴 성공 여부는 알 수 없다. 시트가 실제로 떴는지, 사용자가 별점을 남겼는지 두 스토어 모두
 *    앱에 알려주지 않는다(할당량 초과면 조용히 아무 일도 안 한다). 그래서 여기서 세는 건
 *    "요청했다"뿐이다 — 이 값을 "리뷰가 달렸다"로 읽으면 안 된다.
 *
 * 기록은 로컬(AsyncStorage)이다. 재설치하면 초기화된다. 서버에 두면 정확하지만 앱 시작마다
 * 왕복이 생기고, 최악의 손해가 "리뷰 요청 한 번 더"라 그 값을 치를 이유가 없다.
 * (`useAdGate` 도 같은 판단을 했다.)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import * as StoreReview from 'expo-store-review';

/** AsyncStorage 키. 상태를 JSON 한 덩어리로 둔다(항목별 키를 쓰면 부분 갱신이 어긋난다). */
const STORAGE_KEY = 'synclink.storeReview.state';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 노출 정책. 숫자를 바꾸려면 여기만 고치면 된다.
 *
 * 근거:
 *  · 설치 직후·몇 번 안 써본 사용자에게 물으면 "앱을 충분히 겪어보고 유용한 피드백을 줄 수
 *    있는 시점"이라는 Google 권고에 어긋난다. 그래서 경과일·실행횟수·긍정순간을 **모두** 본다.
 *  · 재요청 간격 120일 + 평생 3회는 iOS 자체 제한(365일 3회)보다 보수적이다. 어차피 OS 가
 *    할당량을 넘기면 조용히 무시하므로, 우리 쪽이 더 촘촘해봐야 낭비만 늘어난다.
 */
export const REVIEW_POLICY = {
  /** 설치(최초 실행) 후 최소 경과일. */
  minDaysSinceInstall: 3,
  /** 최소 앱 실행 횟수(콜드 스타트 기준). */
  minOpenCount: 5,
  /** 최소 긍정 순간 누적 횟수(할 일 완료 등). */
  minPositiveCount: 10,
  /** 직전 요청 이후 최소 경과일. */
  minDaysBetweenPrompts: 120,
  /** 평생 최대 요청 횟수. 세 번 물어도 안 남긴 사용자는 더 물어도 안 남긴다. */
  maxPrompts: 3,
} as const;

/**
 * 긍정 순간 직후 시트를 띄우기까지의 지연(ms).
 * 체크박스 애니메이션·햅틱과 겹치면 시트가 튀어나온 것처럼 보인다.
 */
const PROMPT_DELAY_MS = 1200;

/** 로컬에 보관하는 상태. 모든 필드가 없을 수 있다(첫 실행). */
export interface ReviewState {
  /** 최초 실행 시각(ms epoch). */
  firstOpenAt: number;
  /** 앱 실행 횟수(콜드 스타트). */
  openCount: number;
  /** 긍정 순간 누적 횟수. */
  positiveCount: number;
  /** 마지막으로 리뷰를 "요청한" 시각. 아직 없으면 null. */
  lastPromptedAt: number | null;
  /** 요청 횟수(=시트를 띄우려 시도한 횟수. 실제 노출 여부는 알 수 없다). */
  promptCount: number;
}

/** 아직 아무 기록이 없을 때의 초기값. */
function emptyState(now: number): ReviewState {
  return { firstOpenAt: now, openCount: 0, positiveCount: 0, lastPromptedAt: null, promptCount: 0 };
}

/** 왜 안 띄웠는지. 로그·테스트에서 조건을 특정하려고 남긴다. */
export type ReviewSkipReason =
  | 'unavailable'            // 플랫폼이 리뷰 시트를 못 띄운다(웹, TestFlight, 구형 Android)
  | 'too_soon_after_install' // 설치한 지 얼마 안 됐다
  | 'not_enough_opens'       // 실행 횟수 부족
  | 'not_enough_positive'    // 긍정 순간 부족
  | 'recently_prompted'      // 최근에 이미 물었다
  | 'max_prompts';           // 평생 한도 소진

export interface ReviewDecision {
  /** 지금 리뷰 시트를 띄워도 되는가. */
  shouldPrompt: boolean;
  /** `shouldPrompt=false` 인 이유. true 면 undefined. */
  reason?: ReviewSkipReason;
}

/**
 * 순수 판단 함수 — 저장소도 네이티브도 건드리지 않는다. 정책 검증은 여기를 겨냥한다.
 *
 * @param state      현재 누적 상태
 * @param now        현재 시각(ms epoch)
 * @param available  네이티브 리뷰 시트를 띄울 수 있는 플랫폼인가
 * @returns 띄울지 여부와, 아니라면 그 이유
 */
export function decideReviewPrompt(state: ReviewState, now: number, available: boolean): ReviewDecision {
  if (!available) return { shouldPrompt: false, reason: 'unavailable' };

  // 평생 한도부터 본다 — 다른 조건을 아무리 만족해도 여기서 끝이다.
  if (state.promptCount >= REVIEW_POLICY.maxPrompts) {
    return { shouldPrompt: false, reason: 'max_prompts' };
  }

  // 직전 요청과의 간격. 한 번도 안 물었으면 이 조건은 통과.
  if (state.lastPromptedAt !== null) {
    const daysSincePrompt = (now - state.lastPromptedAt) / ONE_DAY_MS;
    if (daysSincePrompt < REVIEW_POLICY.minDaysBetweenPrompts) {
      return { shouldPrompt: false, reason: 'recently_prompted' };
    }
  }

  const daysSinceInstall = (now - state.firstOpenAt) / ONE_DAY_MS;
  if (daysSinceInstall < REVIEW_POLICY.minDaysSinceInstall) {
    return { shouldPrompt: false, reason: 'too_soon_after_install' };
  }
  if (state.openCount < REVIEW_POLICY.minOpenCount) {
    return { shouldPrompt: false, reason: 'not_enough_opens' };
  }
  if (state.positiveCount < REVIEW_POLICY.minPositiveCount) {
    return { shouldPrompt: false, reason: 'not_enough_positive' };
  }

  return { shouldPrompt: true };
}

// ─── 저장소 ────────────────────────────────────────────────────────────────────

/**
 * 저장된 상태를 읽는다. 없거나 깨졌으면 초기값을 준다.
 * 🔑 읽기 실패를 예외로 올리지 않는다 — 리뷰 요청은 부가 기능이라, 저장소 문제로
 *    호출한 화면이 깨지면 손해가 훨씬 크다.
 */
export async function loadReviewState(now: number = Date.now()): Promise<ReviewState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  if (!raw) return emptyState(now);
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewState>;
    return {
      firstOpenAt: typeof parsed.firstOpenAt === 'number' ? parsed.firstOpenAt : now,
      openCount: typeof parsed.openCount === 'number' ? parsed.openCount : 0,
      positiveCount: typeof parsed.positiveCount === 'number' ? parsed.positiveCount : 0,
      lastPromptedAt: typeof parsed.lastPromptedAt === 'number' ? parsed.lastPromptedAt : null,
      promptCount: typeof parsed.promptCount === 'number' ? parsed.promptCount : 0,
    };
  } catch {
    // 깨진 JSON 은 초기값으로 되돌린다. 이 상태를 고쳐 쓸 방법이 없다.
    return emptyState(now);
  }
}

/** 상태를 저장한다. 실패는 삼킨다(다음 기회에 다시 쓰면 된다). */
async function saveReviewState(state: ReviewState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => { /* 기록 실패는 무해 */ });
}

// ─── 부수효과 ──────────────────────────────────────────────────────────────────

/** 지연 요청이 이미 예약돼 있는지. 긍정 순간이 연달아 와도 시트는 한 번만 예약한다. */
let promptScheduled = false;

/**
 * 앱을 켤 때 한 번 부른다(루트 레이아웃). 실행 횟수를 세고 최초 실행 시각을 남긴다.
 * 여기서는 시트를 띄우지 않는다 — 앱을 켠 직후는 "긍정적인 순간"이 아니다.
 */
export async function recordAppOpen(now: number = Date.now()): Promise<void> {
  const state = await loadReviewState(now);
  await saveReviewState({ ...state, openCount: state.openCount + 1 });
}

/**
 * 사용자가 좋은 경험을 한 순간에 부른다(할 일 완료 등).
 * 누적 횟수를 올리고, 정책이 허락하면 잠시 뒤 네이티브 리뷰 시트를 띄운다.
 *
 * @returns 이번 호출의 판단 결과. 호출부는 무시해도 된다(로그·테스트용).
 */
export async function recordPositiveMoment(now: number = Date.now()): Promise<ReviewDecision> {
  const state = await loadReviewState(now);
  const next: ReviewState = { ...state, positiveCount: state.positiveCount + 1 };
  await saveReviewState(next);

  const available = await isReviewAvailable();
  const decision = decideReviewPrompt(next, now, available);
  if (!decision.shouldPrompt || promptScheduled) return decision;

  // 체크 애니메이션이 끝난 뒤에 띄운다. 예약은 한 번만.
  promptScheduled = true;
  setTimeout(() => {
    promptScheduled = false;
    void requestReviewNow();
  }, PROMPT_DELAY_MS);

  return decision;
}

/** 네이티브 리뷰 시트를 띄울 수 있는 플랫폼인가. 웹·TestFlight 에서는 false. */
async function isReviewAvailable(): Promise<boolean> {
  return StoreReview.isAvailableAsync().catch(() => false);
}

/**
 * 실제로 네이티브 리뷰 시트를 요청하고 그 사실을 기록한다.
 * 🔴 이 함수는 **자동 노출 경로 전용**이다. 버튼에 연결하지 말 것(위 헤더의 정책 2번).
 *
 * @returns 요청을 보냈으면 true. (시트가 실제로 떴는지는 알 수 없다.)
 */
export async function requestReviewNow(now: number = Date.now()): Promise<boolean> {
  try {
    await StoreReview.requestReview();
  } catch {
    // 네이티브 호출 실패는 무시한다. 기록도 남기지 않아 다음 기회에 다시 시도된다.
    return false;
  }
  const state = await loadReviewState(now);
  await saveReviewState({ ...state, lastPromptedAt: now, promptCount: state.promptCount + 1 });
  return true;
}

/** 스토어 등록정보 URL. app.json 의 `ios.appStoreUrl` / `android.playStoreUrl` 에서 온다. */
export function getStoreUrl(): string | null {
  return StoreReview.storeUrl();
}

/**
 * 스토어 페이지를 연다 — 설정 화면의 "리뷰 남기기" 버튼용.
 * 네이티브 API 대신 URL 을 쓰는 이유는 위 헤더의 정책 2번.
 *
 * @returns 열었으면 true. URL 이 없거나(웹) 열지 못하면 false.
 */
export async function openStoreListing(): Promise<boolean> {
  const url = getStoreUrl();
  if (!url) return false;
  return Linking.openURL(url).then(() => true).catch(() => false);
}

/** 테스트용 — 모듈 수준의 예약 플래그를 초기화한다. */
export function __resetScheduledForTest(): void {
  promptScheduled = false;
}
