/**
 * useOtaUpdatePrompt — OTA 새 업데이트가 준비되면 배너를 띄울지 알려 주는 훅.
 *
 * 확인 시점:
 *   1) 앱이 켜질 때 1회
 *   2) 앱이 백그라운드에서 돌아올 때(AppState → active). 단 MIN_INTERVAL_MS 안에 이미
 *      확인했으면 건너뛴다 — 앱을 잠깐 전환할 때마다 서버를 두드리지 않게.
 *
 * @returns
 *   - ready:   내려받기가 끝나 적용할 수 있는 업데이트가 있다
 *   - apply:   지금 적용(리로드)
 *   - dismiss: "나중에" — 이번 실행에서는 다시 띄우지 않는다(다음 실행 때 자동 적용된다)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { applyOtaUpdate, fetchOtaUpdateIfAvailable } from '@/services/otaUpdateService';

/** 복귀할 때 다시 확인하는 최소 간격(5분) */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function useOtaUpdatePrompt(): { ready: boolean; apply: () => void; dismiss: () => void } {
  const [ready, setReady] = useState(false);
  // "나중에" 를 누르면 이번 실행 동안은 다시 띄우지 않는다
  const dismissedRef = useRef(false);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  /** 새 업데이트를 확인·다운로드한다(중복 실행·짧은 간격 재확인은 건너뜀) */
  const check = useCallback(async (force: boolean) => {
    if (dismissedRef.current || checkingRef.current) return;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < MIN_INTERVAL_MS) return;
    checkingRef.current = true;
    lastCheckRef.current = now;
    try {
      if (await fetchOtaUpdateIfAvailable()) setReady(true);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void check(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check(false);
    });
    return () => sub.remove();
  }, [check]);

  const apply = useCallback(() => {
    void applyOtaUpdate();
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setReady(false);
  }, []);

  return { ready, apply, dismiss };
}
