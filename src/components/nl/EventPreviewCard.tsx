/**
 * EventPreviewCard
 *
 * Displays the structured event parsed from a natural-language input.
 * Uncertain fields (confidence ≠ 'high') are highlighted with an orange
 * border and a "?" badge so the user knows to double-check them.
 *
 * Used by NLInputBar after a successful parse, before the user confirms.
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NLParseResult, Confidence } from '@/types';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  result: NLParseResult;
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

export function EventPreviewCard({ result }: Props) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { parsed, confidence, source } = result;

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
      {/* Header: title + source badge */}
      <View style={styles.header}>
        <Text style={styles.titleText} numberOfLines={1}>
          {parsed.title?.value ?? t('event.untitled')}
        </Text>
        <SourceBadge source={source} confidence={confidence} />
      </View>

      {/* Fields */}
      <View style={styles.fields}>
        {parsed.startAt && (
          <FieldRow
            label="시작"
            value={
              parsed.allDay?.value
                ? `${parsed.startAt.value.toLocaleDateString('ko-KR')} (${t('time.all_day')})`
                : formatDateTime(parsed.startAt.value)
            }
            uncertain={isUncertain(parsed.startAt.confidence)}
          />
        )}
        {parsed.endAt && !parsed.allDay?.value && (
          <FieldRow
            label="종료"
            value={formatDateTime(parsed.endAt.value)}
            uncertain={isUncertain(parsed.endAt.confidence)}
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
  });
}
