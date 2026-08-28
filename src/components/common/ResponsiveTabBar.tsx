/**
 * ResponsiveTabBar — 웹 데스크탑에서 하단 탭바를 좌측 사이드 네비로 전환.
 *
 * - 모바일/태블릿/네이티브: 기존 하단 탭바(@react-navigation 의 BottomTabBar) 그대로.
 * - 웹 데스크탑(>=1024): 좌측 고정 세로 사이드 네비(아이콘 + 라벨).
 *
 * 콘텐츠가 사이드 네비에 가리지 않도록, (tabs)/_layout 의 sceneStyle 에
 * paddingLeft: SIDE_NAV_WIDTH 를 데스크탑에서만 적용한다.
 *
 * 회귀 격리: isDesktop 이 아닐 때는 그대로 <BottomTabBar/> 를 반환하므로
 * 모바일/네이티브 경험은 전혀 바뀌지 않는다.
 */

import { BottomTabBar, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { useResponsive } from '@/hooks/useResponsive';
import { useColors } from '@/hooks/useColors';

/** 데스크탑 사이드 네비 폭. (tabs)/_layout sceneStyle paddingLeft 와 동일해야 함. */
export const SIDE_NAV_WIDTH = 240;

export function ResponsiveTabBar(props: BottomTabBarProps) {
  const { isDesktop } = useResponsive();
  const colors = useColors();

  // 데스크탑이 아니면 기존 하단 탭바 그대로 (모바일/네이티브 회귀 0).
  if (!isDesktop) return <BottomTabBar {...props} />;

  const { state, descriptors, navigation } = props;

  return (
    <View
      style={[
        styles.side,
        { width: SIDE_NAV_WIDTH, backgroundColor: colors.surface, borderRightColor: colors.border },
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        /*
         * 탭바에서 숨긴 라우트는 사이드 네비에서도 빼야 한다.
         *
         * 🔴 판정 기준을 실측으로 고쳤다(2026-08-28). 예전 조건은
         *    `options.href === null || options.tabBarButton === null` 이었는데 **둘 다 절대
         *    참이 되지 않는다**. expo-router 는 `href: null` 을 options 에 그대로 넘기지 않고
         *    다음으로 바꿔서 준다(브라우저 콘솔로 확인):
         *      · href            → 아예 없음 (undefined)
         *      · tabBarButton    → null 이 아니라 **함수**
         *      · tabBarItemStyle → **{ display: 'none' }**   ← 이것만이 유일하게 믿을 수 있는 신호
         *    그래서 탭 6→3 단순화 후에도 데스크탑 웹 사이드 네비에만 6개가 그대로 남아 있었다.
         *
         * flatten 을 거치는 이유: tabBarItemStyle 은 배열로 올 수도 있는 StyleProp 이다.
         */
        const itemStyle = StyleSheet.flatten(options.tabBarItemStyle) as
          | { display?: string }
          | undefined;
        if (options.tabBarButton === null || itemStyle?.display === 'none') {
          return null;
        }
        const focused = state.index === index;
        const color = focused ? colors.tabActive : colors.tabInactive;
        const label = typeof options.title === 'string' ? options.title : route.name;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            style={[styles.item, focused && { backgroundColor: colors.backgroundAlt }]}
          >
            {options.tabBarIcon?.({ focused, color, size: 22 })}
            <Text style={[styles.label, { color }, focused && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  side: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 28,
    zIndex: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  label: { fontSize: 15, fontWeight: '500' },
  labelActive: { fontWeight: '700' },
});
