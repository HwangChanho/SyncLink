/**
 * 이탈 지점 기록(퍼널 로깅).
 *
 * 왜 만들었나: 2026-08-28 실측에서 **실사용자 25명 중 20명(80%)이 가입한 날 이후로
 * 다시 오지 않는다**는 걸 알았는데, 우리가 아는 건 딱 거기까지다. 소개 화면에서
 * 떠났는지·로그인에서 막혔는지·홈까지 왔다가 나갔는지 **구분할 방법이 없었다.**
 * 이 표가 없으면 UX 단순화의 효과를 4주 뒤에 재도 원인을 못 가른다.
 * → docs/plans/2026-08-28-ux-simplification.md 의 "검증" 1번
 *
 * 설계 원칙 (errorLogger 와 같은 계열이지만 **정반대인 점이 하나 있다**):
 *  - 실패는 절대 throw 하지 않는다. 기록 때문에 화면이 깨지면 본말전도다.
 *  - 화면 이름·플랫폼·앱 버전 외에는 아무것도 담지 않는다(개인정보 최소).
 *  - 🔴 **production 에서도 항상 기록한다.** `error_logs` 는 LEAD 방침으로
 *    production 빌드에서 INSERT 하지 않는데, 그 사실을 잊고 "행이 없으니 정상"이라고
 *    오판한 적이 두 번 있다. 퍼널은 정확히 반대다 — production 사용자의 행동이
 *    유일한 관심사다. 여기에 환경 분기를 넣으면 이 기능은 존재 이유를 잃는다.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * 퍼널 단계. DB 는 자유 text 라 여기서만 값을 통제한다.
 * 새 단계를 추가할 때 마이그레이션은 필요 없다 — 이 union 에만 더하면 된다.
 *
 * 순서가 곧 사용자가 밟는 길이다:
 *   app_open → onboarding_view → onboarding_done → login_view → signed_in
 *            → home_view → event_created
 */
export type FunnelStep =
  /** 앱이 떠서 첫 화면을 그리기 시작함(로그인 여부 무관). 퍼널의 분모. */
  | 'app_open'
  /** 최초 실행 소개 3페이지에 도달 */
  | 'onboarding_view'
  /** 소개를 끝냈거나 건너뜀 */
  | 'onboarding_done'
  /** 로그인 화면에 도달 */
  | 'login_view'
  /** 로그인 성공 */
  | 'signed_in'
  /** 홈(탭)에 도달 — 여기까지 와야 앱을 "써본" 것이다 */
  | 'home_view'
  /** 일정을 하나 만듦 — 이 앱의 핵심 행동 */
  | 'event_created';

// ─── 기기 로컬 익명 ID ────────────────────────────────────────────────────────

const ANON_ID_KEY = 'synclink.funnel.anonId';

/**
 * 로그인 전 단계와 로그인 후를 잇는 **유일한 실**.
 * 이게 없으면 "소개 화면에서 떠난 사람"을 셀 수 없다 — 그 시점엔 user_id 가 없다.
 *
 * 재설치하면 새로 발급된다(그래도 무방하다. 재설치는 새 여정으로 세는 게 맞다).
 */
let anonIdCache: string | null = null;

async function getAnonId(): Promise<string> {
  if (anonIdCache) return anonIdCache;
  try {
    const saved = await AsyncStorage.getItem(ANON_ID_KEY);
    if (saved) {
      anonIdCache = saved;
      return saved;
    }
  } catch {
    // 저장소를 못 읽어도 기록은 계속한다 — 아래에서 새로 만든다.
  }
  const fresh = Crypto.randomUUID();
  anonIdCache = fresh;
  // 저장 실패는 무시한다. 이번 실행 동안은 메모리 캐시로 일관성이 유지된다.
  void AsyncStorage.setItem(ANON_ID_KEY, fresh).catch(() => {});
  return fresh;
}

// ─── 중복 억제 ────────────────────────────────────────────────────────────────

/**
 * 이번 앱 실행에서 이미 남긴 단계들.
 *
 * 홈은 탭을 옮길 때마다 다시 그려지므로 그대로 두면 `home_view` 가 수십 줄씩 쌓인다.
 * 퍼널에서 알고 싶은 건 "도달했는가"지 "몇 번 봤는가"가 아니다.
 * 앱을 껐다 켜면 초기화된다 — 재실행은 새 세션으로 세는 게 맞다.
 */
const seenThisSession = new Set<FunnelStep>();

// ─── 기록 ─────────────────────────────────────────────────────────────────────

/**
 * 퍼널 단계를 남긴다. **호출부는 await 하지 말고 `void track(...)` 로 부르면 된다.**
 *
 * @param step  남길 단계
 * @param opts.always  true 면 세션당 1회 제한을 무시하고 매번 남긴다
 *                     (예: `event_created` 는 여러 번 세는 게 의미 있다)
 * @returns 항상 resolve 한다. 실패해도 조용히 삼킨다.
 */
export async function trackFunnel(
  step: FunnelStep,
  opts: { always?: boolean } = {},
): Promise<void> {
  try {
    if (!opts.always) {
      if (seenThisSession.has(step)) return;
      // 네트워크 왕복 전에 먼저 표시한다. 실패해도 재시도하지 않는다 —
      // 실패한 기록을 쫓다가 같은 단계를 여러 번 남기는 편이 더 해롭다.
      seenThisSession.add(step);
    }

    const anonId = await getAnonId();
    // 로그인 상태면 user_id 를 함께 남긴다. RLS 가 "null 이거나 본인"만 허용하므로
    // 여기서 다른 사람 id 를 넣을 수는 없다.
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id ?? null;

    await supabase.from('funnel_events').insert({
      user_id: userId,
      anon_id: anonId,
      step,
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version ?? null,
    });
  } catch {
    // 의도적으로 조용하다. 퍼널 기록이 사용자 화면에 영향을 주면 안 된다.
  }
}

/**
 * 테스트용 — 세션 중복 억제 상태를 비운다.
 * 프로덕션 코드에서 부를 일은 없다.
 */
export function __resetFunnelSessionForTest(): void {
  seenThisSession.clear();
  anonIdCache = null;
}
