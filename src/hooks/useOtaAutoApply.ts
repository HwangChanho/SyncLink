/**
 * useOtaAutoApply — OTA 새 업데이트를 뒤에서 받아 두었다가 **사용자 조작 없이** 적용하는 훅.
 *
 * 2026-09-29 LEAD 지시 «OTA 버튼 안 눌리고 내부적으로 변경사항 반영되게»: 예전 UpdateBanner
 * ("앱 업데이트가 있습니다 [나중에] [지금 적용]")를 없애고 이 훅으로 바꿨다. 화면에는 아무것도
 * 뜨지 않는다.
 *
 * 확인(다운로드) 시점:
 *   1) 앱이 켜질 때 1회
 *   2) 앱이 백그라운드에서 돌아올 때(AppState → active). 단 MIN_INTERVAL_MS 안에 이미
 *      확인했으면 건너뛴다 — 앱을 잠깐 전환할 때마다 서버를 두드리지 않게.
 *
 * 적용(리로드) 시점 — 둘 중 먼저 오는 쪽:
 *   A) 받아 둔 뒤 백그라운드에 1분 이상 있다가 돌아온 순간(shouldApplyOnResume)
 *   B) 다음 실행 — expo-updates 가 받아 둔 최신 업데이트로 알아서 띄운다(코드 불필요)
 *   🔴 사용자가 화면을 쓰는 도중에는 절대 리로드하지 않는다(쓰던 입력이 사라진다).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  applyOtaUpdate,
  fetchOtaUpdateIfAvailable,
  shouldApplyOnResume,
} from '@/services/otaUpdateService';

/** 복귀할 때 다시 확인하는 최소 간격(5분) */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function useOtaAutoApply(): void {
  // 새 업데이트를 받아 두었다(= 다음 적당한 복귀 때 적용할 것이 있다)
  const readyRef = useRef(false);
  // 마지막으로 백그라운드로 간 시각 — 복귀하면 null 로 되돌린다
  const backgroundedAtRef = useRef<number | null>(null);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  useEffect(() => {
    /**
     * 새 업데이트를 확인·다운로드한다(중복 실행·짧은 간격 재확인은 건너뜀).
     * @param force true 면 최소 간격을 무시한다(앱 시작 때)
     */
    const check = async (force: boolean) => {
      if (readyRef.current || checkingRef.current) return; // 이미 받아 뒀으면 더 받을 필요 없다
      const now = Date.now();
      if (!force && now - lastCheckRef.current < MIN_INTERVAL_MS) return;
      checkingRef.current = true;
      lastCheckRef.current = now;
      try {
        if (await fetchOtaUpdateIfAvailable()) readyRef.current = true;
      } finally {
        checkingRef.current = false;
      }
    };

    void check(true);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        // iOS 는 active → inactive → background 순서다. inactive(알림센터 내리기·권한 팝업 등)는
        // 앱을 떠난 게 아니므로 background 만 센다.
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (state !== 'active') return;

      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;

      // 1) 받아 둔 업데이트가 있고, 충분히 오래 비웠다가 돌아왔다 → 지금 조용히 적용
      if (readyRef.current && shouldApplyOnResume(backgroundedAt, Date.now())) {
        applyOtaUpdate().catch(() => {
          // 리로드 실패 — 앱은 그대로 쓰면 되고, 다음 실행 때 expo-updates 가 적용한다
        });
        return;
      }
      // 2) 아니면 새 업데이트가 있는지 확인만 해 둔다
      void check(false);
    });
    return () => sub.remove();
  }, []);
}
