/**
 * AppearanceSettingsScreen — 화면 설정.
 *
 * 기능:
 *  1. 라이트 / 다크 / 시스템 모드 선택
 *  2. 6개 액센트 프리셋 선택 → buildPalette() 로 앱 전체 색상 즉시 변경
 *  3. 미리보기 영역 — 선택 즉시 실시간으로 전체 UI 색조 확인
 *
 * 아키텍처:
 *  - setAccentPreset() 호출 → appearanceStore.accentHue 업데이트
 *  → useColors() 구독 중인 모든 컴포넌트 자동 리렌더
 *  → 헤더·배경·카드·탭바 등 전체 UI 색상 변경
 */

import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  useAppearanceStore,
  ACCENT_PRESETS,
  type AccentPresetKey,
  type ColorSchemePreference,
} from '@/stores/appearanceStore';
import { buildPalette } from '@/lib/themePalette';

// ─── 액센트 프리셋 UI 정의 ────────────────────────────────────────────────────

/**
 * 6개 프리셋 목록.
 * hue 값은 ACCENT_PRESETS 에서 참조하므로 여기서는 key + label만 관리.
 */
const ACCENT_OPTIONS: { key: AccentPresetKey; label: string }[] = [
  { key: 'default',  label: '기본 (바이올렛)' },
  { key: 'primary',  label: '인디고' },
  { key: 'rose',     label: '로즈' },
  { key: 'emerald',  label: '에메랄드' },
  { key: 'amber',    label: '앰버' },
  { key: 'violet',   label: '바이올렛' },
];

// ─── 색 모드(라이트/다크/시스템) UI 정의 ──────────────────────────────────────

const SCHEME_OPTIONS: { key: ColorSchemePreference; label: string; icon: string }[] = [
  { key: 'light',  label: '라이트',  icon: 'sunny-outline' },
  { key: 'dark',   label: '다크',    icon: 'moon-outline' },
  { key: 'system', label: '시스템',  icon: 'phone-portrait-outline' },
];

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function AppearanceSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);

  // Store 상태 구독
  const accentPreset   = useAppearanceStore((s) => s.accentPreset);
  const accentHue      = useAppearanceStore((s) => s.accentHue);
  const colorScheme    = useAppearanceStore((s) => s.colorScheme);
  const resolvedScheme = useAppearanceStore((s) => s.resolvedScheme);

  const setAccentPreset = useAppearanceStore((s) => s.setAccentPreset);
  const setColorScheme  = useAppearanceStore((s) => s.setColorScheme);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>화면 설정</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── 색 모드 선택 ── */}
        <Text style={styles.sectionLabel}>색 모드</Text>
        <View style={styles.schemeRow}>
          {SCHEME_OPTIONS.map((opt) => {
            const active = colorScheme === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.schemeChip, active && styles.schemeChipActive]}
                onPress={() => setColorScheme(opt.key)}
              >
                <Ionicons
                  name={opt.icon as React.ComponentProps<typeof Ionicons>['name']}
                  size={16}
                  color={active ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.schemeLabel, active && { color: colors.primary, fontWeight: '700' }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* ── 앱 색상 테마 선택 ── */}
        <Text style={styles.sectionLabel}>앱 색상 테마</Text>
        <Text style={styles.sectionHelp}>
          선택한 색상이 배경·버튼·탭바 등 앱 전체에 자연스럽게 적용됩니다.
        </Text>

        <View style={styles.colorGrid}>
          {ACCENT_OPTIONS.map((opt) => {
            const hue = ACCENT_PRESETS[opt.key];
            const isDark = resolvedScheme === 'dark';
            // 각 칩의 샘플 팔레트: 해당 hue 기준으로 빠르게 미리보기 색 계산
            const samplePrimary = buildPalette(hue, isDark).primary;
            const sampleBg     = buildPalette(hue, isDark).primaryLight;
            const selected = accentPreset === opt.key;

            return (
              <Pressable
                key={opt.key}
                style={[
                  styles.colorChip,
                  { backgroundColor: sampleBg },
                  selected && { borderColor: samplePrimary, borderWidth: 2 },
                ]}
                onPress={() => setAccentPreset(opt.key)}
              >
                <View style={[styles.colorSwatch, { backgroundColor: samplePrimary }]} />
                <Text style={[
                  styles.colorLabel,
                  { color: selected ? samplePrimary : colors.textSecondary },
                  selected && { fontWeight: '700' },
                ]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* ── 미리보기 ── */}
        <Text style={styles.sectionLabel}>미리보기</Text>
        <Text style={styles.sectionHelp}>
          현재 선택한 테마({resolvedScheme === 'dark' ? '다크' : '라이트'} · hue {Math.round(accentHue)}°)가 아래와 같이 적용됩니다.
        </Text>
        <PreviewCard colors={colors} />

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 미리보기 카드 컴포넌트 ───────────────────────────────────────────────────

/**
 * 현재 colors 토큰을 사용해 앱 내 주요 UI 요소를 간략히 시뮬레이션.
 * useColors() 가 변경될 때마다 자동으로 리렌더된다.
 *
 * @param colors - useColors() 결과
 */
function PreviewCard({ colors }: { colors: ColorTokens }) {
  const s = previewStyles(colors);
  return (
    <View style={s.card}>
      {/* 가짜 헤더 */}
      <View style={s.fakeHeader}>
        <Text style={s.fakeHeaderTitle}>홈</Text>
        <View style={s.fakeHeaderDot} />
      </View>

      {/* 가짜 이벤트 카드 */}
      <View style={s.fakeEvent}>
        <View style={s.fakeEventDot} />
        <View style={s.fakeEventText}>
          <Text style={s.fakeEventTitle}>오늘 일정 예시</Text>
          <Text style={s.fakeEventSub}>오전 10:00 · 스페이스</Text>
        </View>
      </View>

      {/* 가짜 버튼 */}
      <View style={s.fakeButtonRow}>
        <View style={s.fakeBtnPrimary}>
          <Text style={s.fakeBtnPrimaryText}>일정 추가</Text>
        </View>
        <View style={s.fakeBtnSecondary}>
          <Text style={s.fakeBtnSecondaryText}>자세히</Text>
        </View>
      </View>

      {/* 가짜 탭바 */}
      <View style={s.fakeTabBar}>
        {(['홈', '캘린더', '플래너', '내 정보'] as const).map((tab, i) => (
          <View key={tab} style={s.fakeTab}>
            <View style={[s.fakeTabDot, i === 0 && s.fakeTabDotActive]} />
            <Text style={[s.fakeTabLabel, i === 0 && s.fakeTabLabelActive]}>{tab}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── 스타일 팩토리 ─────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safe:    { flex: 1, backgroundColor: colors.background },
    header:  {
      flexDirection: 'row',
      alignItems: 'center',
      height: 52,
      paddingHorizontal: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    back:        { width: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    content:      { padding: spacing[4], gap: spacing[1] },
    sectionLabel: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '600',
      marginBottom: spacing[1],
      marginTop: spacing[2],
    },
    sectionHelp: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginBottom: spacing[3],
    },
    // 색 모드 선택 row
    schemeRow: {
      flexDirection: 'row',
      gap: spacing[2],
      marginBottom: spacing[1],
    },
    schemeChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing[2],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    schemeChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    schemeLabel: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    // 액센트 색상 그리드
    colorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
      marginBottom: spacing[1],
    },
    colorChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorSwatch: {
      width: 16,
      height: 16,
      borderRadius: 8,
    },
    colorLabel: {
      ...textStyles.body,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing[3],
    },
  });
}

/** 미리보기 카드 전용 스타일 (colors 토큰 기반) */
function previewStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      overflow: 'hidden',
      marginBottom: spacing[4],
    },
    fakeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    fakeHeaderTitle: {
      ...textStyles.labelLg,
      color: colors.primary,
      fontWeight: '700',
    },
    fakeHeaderDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    fakeEvent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      margin: spacing[3],
      padding: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    fakeEventDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
    fakeEventText: { flex: 1 },
    fakeEventTitle: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    fakeEventSub: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    fakeButtonRow: {
      flexDirection: 'row',
      gap: spacing[2],
      marginHorizontal: spacing[3],
      marginBottom: spacing[3],
    },
    fakeBtnPrimary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing[2],
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    fakeBtnPrimaryText: {
      ...textStyles.body,
      color: colors.textInverse,
      fontWeight: '600',
    },
    fakeBtnSecondary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing[2],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    fakeBtnSecondaryText: {
      ...textStyles.body,
      color: colors.primary,
      fontWeight: '600',
    },
    fakeTabBar: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingVertical: spacing[2],
    },
    fakeTab: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    fakeTabDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.tabInactive,
    },
    fakeTabDotActive: {
      backgroundColor: colors.tabActive,
    },
    fakeTabLabel: {
      fontSize: 10,
      color: colors.tabInactive,
    },
    fakeTabLabelActive: {
      color: colors.tabActive,
      fontWeight: '700',
    },
  });
}
