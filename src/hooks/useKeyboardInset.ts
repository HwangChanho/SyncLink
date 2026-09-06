/**
 * useKeyboardInset — 키보드가 화면 하단을 가리는 높이(pt)를 돌려주는 훅.
 *
 * ## 왜 KeyboardAvoidingView 를 안 쓰나
 * `KeyboardAvoidingView` 는 **자기 View 의 화면상 좌표를 measure** 해서
 * "내 하단 ~ 키보드 상단" 만큼을 패딩으로 채운다. 그런데 iOS 모달
 * (`presentation: 'modal'`)처럼 화면 전체를 쓰지 않는 컨테이너 안에서는 그
 * 좌표가 실제 화면 좌표와 어긋나, 계산된 패딩이 모자라 입력창이 키보드
 * 뒤로 숨는다. 그걸 메우려고 화면마다 `keyboardVerticalOffset` 에
 * `56`, `insets.top + 16`, `8` 같은 경험적 보정값이 붙어 있었고 —
 * 노치 높이가 다른 기기에서 다시 어긋났다 (2026-09-06 LEAD 보고).
 *
 * 이 훅은 measure 를 아예 쓰지 않는다. 키보드 프레임 하나만 보고
 * "키보드 상단이 화면 하단에서 얼마나 올라왔는가"를 계산하므로,
 * 모달·헤더·탭바 구조와 무관하게 같은 값이 나온다.
 *
 * ## 사용법
 * ```tsx
 * const kb = useKeyboardInset();           // 키보드가 가리는 높이
 * const insets = useSafeAreaInsets();
 * // SafeAreaView(edges 에 'bottom' 포함)가 이미 insets.bottom 을 패딩으로
 * // 먹었다면 그만큼 빼야 이중으로 밀리지 않는다.
 * <View style={{ flex: 1, paddingBottom: Math.max(0, kb - insets.bottom) }}>
 * ```
 *
 * @returns 키보드가 가리는 높이(pt). 키보드가 내려가 있으면 0.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, Dimensions, type KeyboardEvent } from 'react-native';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    /**
     * 키보드 프레임 → 가림 높이 변환.
     * `screenY` 는 키보드 상단의 화면 y 좌표다. 화면 높이에서 빼면
     * 키보드가 아래에서부터 덮는 높이가 나온다.
     *
     * ⚠️ 화면 높이는 이벤트가 올 때마다 다시 읽는다 — 회전·분할화면에서
     *    마운트 시점 값이 낡을 수 있다.
     */
    const toInset = (e: KeyboardEvent) => {
      const screenHeight = Dimensions.get('window').height;
      return Math.max(0, screenHeight - e.endCoordinates.screenY);
    };

    // iOS 는 will* 이벤트가 애니메이션과 같은 프레임에 와서 화면이 덜컹이지
    // 않는다. Android 는 will* 이 없어 did* 를 쓴다.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => setInset(toInset(e)));
    const hideSub = Keyboard.addListener(hideEvent, () => setInset(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
