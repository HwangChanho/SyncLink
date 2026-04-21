/**
 * Tab bar layout — defines the 4 main app tabs.
 *
 * Tab order: Home → Calendar → Planner → My
 * (No AI tab — AI is embedded in Home and Calendar)
 */

import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { componentHeight } from '@/constants/spacing';

// TODO (TASK-200+): Replace text placeholders with proper icons (expo/vector-icons)

export default function TabLayout() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          height: componentHeight.tabBar + (Platform.OS === 'ios' ? 20 : 0),
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          // tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '캘린더',
          // tabBarIcon: ({ color }) => <CalendarIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: '플래너',
          // tabBarIcon: ({ color }) => <CheckSquareIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: 'My',
          // tabBarIcon: ({ color }) => <UserIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
