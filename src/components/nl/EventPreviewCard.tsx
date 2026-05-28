/**
 * EventPreviewCard
 *
 * Displays the structured event parsed from a natural-language input.
 * Uncertain fields (confidence ≠ 'high') are highlighted with an orange
 * border and a "?" badge so the user knows to double-check them.
 *
 * Used by NLInputBar after a successful parse, before the user confirms.
 */

import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NLParseResult, Confidence, SpaceSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { ColorPicker, WORKOUT_RESERVED_COLOR, RUNNING_RESERVED_COLOR } from '@/components/event/ColorPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  result: NLParseResult;
  /**
   * v1.2.9 — 미리보기에서 선택한 색상 (null = auto/default).
   * 운동/러닝 같이 reserved color 가 강제되는 케이스에는 picker 미노출.
   */
  selectedColor?: string | null;
  /** Color 변경 콜백. 미제공이면 picker 자체 비노출. */
  onColorChange?: (color: string | null) => void;
  /** v1.2.9 — 사용자의 스페이스 목록 (NLInputBar 가 마운트 시 load). 0개 면 picker 숨김. */
  spaces?: SpaceSummary[];
  /** 현재 선택된 스페이스 id 배열. */
  selectedSpaceIds?: string[];
  /** 스페이스 선택 변경 콜백. */
  onSpacesChange?: (ids: string[]) => void;
}

// v1.2.9 — title 에 reserved kind 가 보이면 색상이 시스템 고정이라 picker 숨김.
// 워크아웃/러닝은 createEvent 가 WORKOUT_RESERVED_COLOR / RUNNING_RESERVED_COLOR 로 강제.
const RESERVED_KIND_RE = /운동|헬스|gym|workout|러닝|running|달리기|마라톤|조깅/i;
function isReservedKindTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  return RESERVED_KIND_RE.test(title);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Date to a human-readable Korean date+time string.
 * e.g. "2026-04-21 오후 3:00"
 */
function formatDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  const h  = date.getHours();
  const mi = String(date.getMinutes()).padStart(2, '0');
  const period = h < 12 ? '오전' : '오후';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${y}-${mo}-${d} ${period} ${displayH}:${mi}`;
}

/** Returns true when a field should show an uncertainty indicator. */
const isUncertain = (conf: Confidence | undefined): boolean =>
  conf === 'medium' || conf === 'low';

// ─── Sub-component: a single labeled field row ────────────────────────────────

interface FieldRowProps {
  label: string;
  value: string;
  uncertain: boolean;
}

function FieldRow({ label, value, uncertain }: FieldRowProps) {
  // Each sub-component calls useColors() directly so it reacts to theme changes
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View style={[styles.fieldRow, uncertain && styles.fieldRowUncertain]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueWrapper}>
        <Text style={styles.fieldValue} numberOfLines={1}>{value}</Text>
        {uncertain && (
          <Ionicons
            name="help-circle-outline"
            size={14}
            color={colors.warning}
            style={styles.uncertainIcon}
          />
        )}
      </View>
    </View>
  );
}

// ─── AI source badge ──────────────────────────────────────────────────────────

interface BadgeProps {
  source: NLParseResult['source'];
  confidence: Confidence;
}

function SourceBadge({ source, confidence }: BadgeProps) {
  // Each sub-component calls useColors() directly so it reacts to theme changes
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  if (source === 'ai') {
    return (
      <View style={styles.aiBadge}>
        <Ionicons name="sparkles" size={11} color={colors.primary} />
        <Text style={styles.aiBadgeText}>{t('common.preview')} AI</Text>
      </View>
    );
  }
  if (confidence === 'medium') {
    return (
      <View style={styles.warningBadge}>
        <Ionicons name="warning-outline" size={11} color={colors.warning} />
        <Text style={styles.warningBadgeText}>{t('common.warning')}</Text>
      </View>
    );
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EventPreviewCard({
  result,
  selectedColor,
  onColorChange,
  spaces,
  selectedSpaceIds,
  onSpacesChange,
}: Props) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { parsed, confidence, source } = result;

  // v1.2.9 — 헤더에 노출할 effective color.
  //   1) reserved kind (운동/러닝) → RESERVED 색 고정.
  //   2) 사용자가 picker 에서 선택 → selectedColor.
  //   3) 둘 다 아니면 테마 primary (default).
  const isReserved = isReservedKindTitle(parsed.title?.value);
  const headerDotColor = isReserved
    ? (/(러닝|running|달리기|마라톤|조깅)/i.test(parsed.title?.value ?? '')
        ? RUNNING_RESERVED_COLOR
        : WORKOUT_RESERVED_COLOR)
    : (selectedColor ?? colors.primary);

  // Repeat type label mapping using i18n.
  // v1.2.8 — custom_weekly = 다중 요일 (예: 평일 = 월·화·수·목·금).
  // weeklyDays 값을 한국어 요일 약자로 노출.
  const dowAbbr = ['일', '월', '화', '수', '목', '금', '토'];
  const weeklyDaysLabel = parsed.weeklyDays?.value
    ? parsed.weeklyDays.value
        .filter((n) => n >= 0 && n <= 6)
        .sort()
        .map((n) => dowAbbr[n])
        .join('·')
    : null;
  const repeatLabels: Record<string, string> = {
    daily:   t('time.daily'),
    weekly:  t('time.weekly'),
    monthly: t('time.monthly'),
    yearly:  t('time.annual'),
    custom_weekly: weeklyDaysLabel
      ? t('time.weekly_custom', { defaultValue: '매주' }) + ' ' + weeklyDaysLabel
      : t('time.weekly_custom', { defaultValue: '매주 특정 요일' }),
  };

  return (
    <View style={styles.card}>
      {/* Header: color dot + title + source badge.
          v1.2.9 — ColorPicker 선택 시 dot 색이 즉시 sync. */}
      <View style={styles.header}>
        <View style={[styles.colorDot, { backgroundColor: headerDotColor }]} />
        <Text style={styles.titleText} numberOfLines={1}>
          {parsed.title?.value ?? t('event.untitled')}
        </Text>
        <SourceBadge source={source} confidence={confidence} />
      </View>

      {/* Fields */}
      <View style={styles.fields}>
        {/* v1.2.9 — LEAD: "시간 노출되는 부분에서는 색상 빼주고".
            시간 칸은 confidence 와 무관하게 plain neutral 로 표시.
            (uncertain 신호는 헤더 SourceBadge "확인 필요" 칩으로 충분.) */}
        {parsed.startAt && (
          <FieldRow
            label="시작"
            value={
              parsed.allDay?.value
                ? `${parsed.startAt.value.toLocaleDateString('ko-KR')} (${t('time.all_day')})`
                : formatDateTime(parsed.startAt.value)
            }
            uncertain={false}
          />
        )}
        {parsed.endAt && !parsed.allDay?.value && (
          <FieldRow
            label="종료"
            value={formatDateTime(parsed.endAt.value)}
            uncertain={false}
          />
        )}
        {parsed.location && (
          <FieldRow
            label="장소"
            value={parsed.location.value}
            uncertain={isUncertain(parsed.location.confidence)}
          />
        )}
        {parsed.repeatType && parsed.repeatType.value !== 'none' && (
          <FieldRow
            label="반복"
            value={repeatLabels[parsed.repeatType.value] ?? parsed.repeatType.value}
            uncertain={isUncertain(parsed.repeatType.confidence)}
          />
        )}
      </View>

      {/* v1.2.9 — 색상 선택. 운동/러닝 reserved kind 는 시스템 고정 색이라 picker 숨김.
          onColorChange 콜백이 전달된 경우에만 노출 (caller 가 선택 색상을 처리). */}
      {onColorChange && !isReservedKindTitle(parsed.title?.value) && (
        <View style={styles.colorSection}>
          <Text style={styles.colorLabel}>색상</Text>
          <ColorPicker value={selectedColor ?? null} onChange={onColorChange} />
        </View>
      )}

      {/* v1.2.9 — 스페이스 공유 선택. spaces 가 비어있으면 섹션 자체 숨김.
          기본은 비공개 (selectedSpaceIds = []). 사용자가 칩을 토글해 멀티 선택. */}
      {onSpacesChange && spaces && spaces.length > 0 && (
        <View style={styles.colorSection}>
          <Text style={styles.colorLabel}>공유 스페이스 ({selectedSpaceIds?.length === 0 ? '비공개' : `${selectedSpaceIds?.length ?? 0}개`})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {spaces.map((sp) => {
              const isSel = (selectedSpaceIds ?? []).includes(sp.id);
              return (
                <Pressable
                  key={sp.id}
                  onPress={() => {
                    const ids = selectedSpaceIds ?? [];
                    const next = isSel ? ids.filter((x) => x !== sp.id) : [...ids, sp.id];
                    onSpacesChange(next);
                  }}
                  style={[
                    styles.spaceChip,
                    isSel && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                >
                  <Text style={[styles.spaceChipText, isSel && { color: colors.textInverse }]} numberOfLines={1}>
                    {sp.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3],
    gap: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  titleText: {
    ...(textStyles.body as object),
    color: colors.textPrimary,
    flex: 1,
    fontWeight: '600',
  },
  fields: {
    gap: spacing[1],
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.sm,
  },
  fieldRowUncertain: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: `${colors.warning}12`,  // 7% opacity tint
  },
  fieldLabel: {
    ...(textStyles.caption as object),
    color: colors.textSecondary,
    width: 32,
  },
  fieldValueWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    gap: spacing[1],
  },
  fieldValue: {
    ...(textStyles.bodySm as object),
    color: colors.textPrimary,
    flexShrink: 1,
  },
  uncertainIcon: {
    flexShrink: 0,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: `${colors.primary}15`,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  aiBadgeText: {
    ...(textStyles.caption as object),
    color: colors.primary,
    fontSize: 10,
  },
  warningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: `${colors.warning}15`,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  warningBadgeText: {
    ...(textStyles.caption as object),
    color: colors.warning,
    fontSize: 10,
  },
  colorSection: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing[1],
  },
  colorLabel: {
    ...(textStyles.caption as object),
    color: colors.textSecondary,
  },
  chipRow: {
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  spaceChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    maxWidth: 160,
  },
  spaceChipText: {
    ...(textStyles.caption as object),
    color: colors.textPrimary,
    fontSize: 12,
  },
  });
}
