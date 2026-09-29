/**
 * OtaAutoUpdater — 화면에 아무것도 그리지 않고 OTA 업데이트를 조용히 받아 적용한다.
 *
 * 2026-09-29 LEAD «OTA 버튼 안 눌리고 내부적으로 변경사항 반영되게» 로 UpdateBanner 를 대체했다.
 * 동작(언제 받고 언제 적용하는지)은 useOtaAutoApply 에 있다.
 *
 * 왜 루트 레이아웃에서 훅을 바로 부르지 않고 컴포넌트로 뺐나: 루트 레이아웃은 이미 크고,
 * 이 기능만 떼어 넣고 빼기 쉽게 한 줄(<OtaAutoUpdater />)로 두려는 것이다.
 */
import { useOtaAutoApply } from '@/hooks/useOtaAutoApply';

export function OtaAutoUpdater(): null {
  useOtaAutoApply();
  return null;
}
