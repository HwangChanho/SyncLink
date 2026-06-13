/**
 * RelativeDateSection — "상대일 일정 (기준일 + N일)" input UI (v1.3).
 *
 * Lets the user build an event from a base date (e.g. an issue/order date) plus
 * an N-day offset — "택배 3일 뒤 도착예상", "여권 발급일로부터 7일 뒤 수령".
 *
 * Ownership split:
 *  - This component owns the relative inputs: base date, offset days, label,
 *    plus a live "target date (D-day)" preview.
 *  - The PARENT form keeps the event's start/all-day in sync with the computed
 *    target (an effect that reacts to enabled/baseDate/offsetDays) and persists
 *    baseDate/offsetDays/offsetLabel on save. So when the toggle is on, the
 *    parent hides its own start/end rows.
 *
 * Reference: the lazy D-day calculation mirrors the Anniversary daysFromToday
 * pattern (see lib/relativeDate).
 */
import { useState } from 'react';
import {
  View, Text, Switch, Pressable, TextInput, StyleSheet, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { addDays, dDayBadge } from '@/lib/relativeDate';

interface Props {
  /** Whether relative-date mode is on. */
  enabled: boolean;
  /** Toggle relative-date mode. */
  onToggle: (v: boolean) => void;
  /** Current base date. null = treat as today (parent default). */
  baseDate: Date | null;
  /** Commit a new base date (always a concrete Date). */
  onChangeBaseDate: (d: Date) => void;
  /** Days after the base date. */
  offsetDays: number;
  onChangeOffsetDays: (n: number) => void;
  /** Display label (e.g. "도착예상"). '' = none. */
  offsetLabel: string;
  onChangeOffsetLabel: (s: string) => void;
}

/** Today at local midnight — default base when none picked yet. */
function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local-midnight Date → 'YYYY-MM-DD' for the web <input type="date">. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function RelativeDateSection({
  enabled, onToggle, baseDate, onChangeBaseDate,
  offsetDays, onChangeOffsetDays, offsetLabel, onChangeOffsetLabel,
}: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const [pickerOpen, setPickerOpen] = useState(false);

  // null base is shown/计算 as today; offset clamped to >= 0.
  const base = baseDate ?? todayMidnight();
  const safeOffset = Number.isFinite(offsetDays) && offsetDays >= 0 ? offsetDays : 0;
  const target = addDays(base, safeOffset);

  const presets = t('event.relative.label_presets', { returnObjects: true }) as string[];
  const baseLabel = base.toLocaleDateString(i18n.language, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const targetLabel = target.toLocaleDateString(i18n.language, {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  return (
    <View style={styles.wrap}>
      {/* Toggle header — always visible so the user can turn the mode off. */}
      <View style={styles.toggleRow}>
        <View style={styles.toggleTextCol}>
          <Text style={styles.title}>{t('event.relative.title')}</Text>
          <Text style={styles.hint}>{t('event.relative.hint')}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => {
            // Turning on with no base yet → default to today so the parent can
            // persist a concrete base_date.
            if (v && !baseDate) onChangeBaseDate(todayMidnight());
            onToggle(v);
          }}
          trackColor={{ false: colors.border, true: colors.primaryLight }}
          thumbColor={enabled ? colors.primary : colors.surface}
        />
      </View>

      {enabled && (
        <View style={styles.body}>
          {/* Base date */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('event.relative.base_date')}</Text>
            {Platform.OS === 'web' ? (
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore — JSX <input> is web-only, not in RN types
              <input
                type="date"
                value={toISODate(base)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value;
                  if (!v) return;
                  const [y, m, d] = v.split('-').map(Number);
                  if (y && m && d) onChangeBaseDate(new Date(y, m - 1, d));
                }}
                style={{ fontSize: 16, color: colors.textPrimary, background: 'transparent', border: 'none', outline: 'none' }}
              />
            ) : (
              <Pressable onPress={() => setPickerOpen(true)}>
                <Text style={styles.valueClickable}>{baseLabel}</Text>
              </Pressable>
            )}
          </View>

          {/* Offset days stepper */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('event.relative.offset_days')}</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => onChangeOffsetDays(Math.max(0, safeOffset - 1))}
                accessibilityLabel="-1"
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepValue}>
                {safeOffset}{t('event.relative.days_unit')}
              </Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => onChangeOffsetDays(safeOffset + 1)}
                accessibilityLabel="+1"
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
          </View>

          {/* Label — preset chips + free text */}
          <View style={styles.fieldColumn}>
            <Text style={styles.label}>{t('event.relative.label')}</Text>
            <View style={styles.chipRow}>
              {presets.map((p) => {
                const selected = offsetLabel === p;
                return (
                  <Pressable
                    key={p}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => onChangeOffsetLabel(selected ? '' : p)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              value={offsetLabel}
              onChangeText={onChangeOffsetLabel}
              placeholder={t('event.relative.label_placeholder')}
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          {/* Live preview: target date + D-day */}
          <View style={styles.preview}>
            <Text style={styles.previewText}>
              {t('event.relative.preview', { date: targetLabel, dday: dDayBadge(target) })}
            </Text>
          </View>
        </View>
      )}

      {/* Native base-date picker (web uses the inline <input> above). */}
      {Platform.OS !== 'web' && pickerOpen && (
        <DateTimeModal
          visible={pickerOpen}
          initialValue={base}
          allDay
          onCancel={() => setPickerOpen(false)}
          onConfirm={(d: Date) => {
            // Keep only the calendar day (drop time-of-day).
            onChangeBaseDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
            setPickerOpen(false);
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    wrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingVertical: spacing[3],
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[3],
    },
    toggleTextCol: { flex: 1 },
    title: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    hint: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[0.5],
    },
    body: {
      marginTop: spacing[3],
      gap: spacing[3],
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    fieldColumn: {
      gap: spacing[2],
    },
    label: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    valueClickable: {
      ...textStyles.body,
      color: colors.primary,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    stepBtnText: {
      ...textStyles.h4,
      color: colors.primary,
    },
    stepValue: {
      ...textStyles.body,
      color: colors.textPrimary,
      minWidth: 48,
      textAlign: 'center',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
    },
    chip: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    chipText: {
      ...textStyles.labelSm,
      color: colors.textSecondary,
    },
    chipTextSelected: {
      color: colors.primary,
    },
    input: {
      ...textStyles.body,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    preview: {
      backgroundColor: colors.primaryLight,
      borderRadius: radius.md,
      padding: spacing[3],
    },
    previewText: {
      ...textStyles.label,
      color: colors.primary,
    },
  });
}
