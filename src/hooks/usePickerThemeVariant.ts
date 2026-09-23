/**
 * usePickerThemeVariant — 네이티브 날짜·시간 피커(@react-native-community/datetimepicker)에
 * 넘길 `themeVariant` 를 **앱의** 라이트/다크 설정에 맞춰 돌려준다.
 *
 * 🔴 왜 필요한가(2026-09-23 LEAD 실기 스크린샷):
 *   피커는 themeVariant 가 없으면 **OS** 테마를, 있으면 그 값을 따른다. 그런데 우리 앱은
 *   설정 > 화면에서 OS 와 다른 테마를 고를 수 있다. 캘린더 날짜 휠(WheelDatePicker)은
 *   "dark" 가 하드코딩돼 있어, 앱이 라이트일 때 **밝은 시트 위에 흰 휠 글자**가 떠서
 *   거의 보이지 않았다. 나머지 피커는 OS 를 따라 앱과 어긋날 수 있었다.
 *   → 피커는 모두 이 훅으로 앱 테마를 따른다.
 *
 * @returns 'light' | 'dark' — 앱 appearanceStore 의 resolvedScheme
 */
import { useAppearanceStore } from '@/stores/appearanceStore';

export function usePickerThemeVariant(): 'light' | 'dark' {
  return useAppearanceStore((s) => (s.resolvedScheme === 'dark' ? 'dark' : 'light'));
}
