/**
 * NLTryItDemo — interactive "try it yourself" block embedded in onboarding
 * page 2 (natural-language event creation).
 *
 * The user taps a suggestion chip or types their own sentence; we run the
 * LOCAL parser (`parseLocally`) and show the extracted title/date/time as a
 * mini preview — the "aha" moment of the app's core feature, before login.
 *
 * Sandbox by design:
 *  - No account, no network, no AI call, nothing saved. `parseLocally` is a
 *    pure function (729-line rule parser), so this costs nothing and works
 *    for guests — unlike the real NLInputBar which requires sign-in.
 *  - Low-confidence results are shown as-is (no AI fallback here); a parse
 *    with no usable date/title shows a gentle retry hint instead.
 *
 * 2026-08-05 interactive-onboarding plan.
 */

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { parseLocally } from '@/lib/nlParser';
import type { NLParseResult } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pre-resolved i18n time tokens needed to format the preview line. */
interface TimeTokens {
  weekDays: string[];
  am: string;
  pm: string;
  allDay: string;
}

/**
 * Formats a parsed start date for the mini preview, e.g. "8/12 (수) · 오후 3:00".
 * Tokens are resolved by the caller so this stays a plain pure function.
 */
function formatPreviewDateTime(date: Date, isAllDay: boolean, tokens: TimeTokens): string {
  const day = `${date.getMonth() + 1}/${date.getDate()} (${tokens.weekDays[date.getDay()] ?? ''})`;
  if (isAllDay) return `${day} · ${tokens.allDay}`;

  const h = date.getHours();
  const period = h < 12 ? tokens.am : tokens.pm;
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${day} · ${period} ${displayH}:${mi}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NLTryItDemo() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // parseLocally is Korean-only (모든 date/time 패턴이 한국어 정규식). In other
  // locales a "tomorrow 3pm meeting" chip would visibly fail, which is worse
  // than no demo — so the sandbox renders only for Korean UI. (The real app
  // covers other languages via the AI fallback, which this sandbox never calls.)
  const isKorean = i18n.language.startsWith('ko');

  /** Localized example sentences rendered as one-tap chips. */
  const suggestions = t('onboarding.try_chips', { returnObjects: true }) as unknown as string[];

  /** Time tokens for the preview formatter, resolved once per render/locale. */
  const timeTokens: TimeTokens = {
    weekDays: t('time.week_days', { returnObjects: true }) as unknown as string[],
    am: t('time.am'),
    pm: t('time.pm'),
    allDay: t('time.all_day'),
  };

  const [text, setText] = useState('');
  /** Last parse result — null until the user tries something. */
  const [result, setResult] = useState<NLParseResult | null>(null);

  /** Parse `input` locally and surface the result (chip tap or keyboard submit). */
  const runDemo = useCallback((input: string) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    Keyboard.dismiss();
    setText(trimmed);
    setResult(parseLocally(trimmed));
  }, []);

  // A parse is "presentable" when we at least extracted a start date — the
  // headline capability being demonstrated. Title falls back to the raw text.
  const startAt = result?.parsed.startAt?.value;
  const parsedOk = startAt !== undefined;
  const title =
    result?.parsed.title?.value ?? result?.rawInput ?? '';

  // Non-Korean UI: keep onboarding page 2 as plain copy (see isKorean note).
  if (!isKorean) return null;

  return (
    <View style={styles.container}>

      {/* Suggestion chips — primary interaction (typing is optional) */}
      <View style={styles.chipRow}>
        {suggestions.map((chip) => (
          <TouchableOpacity
            key={chip}
            style={styles.chip}
            onPress={() => runDemo(chip)}
            accessibilityRole="button"
            accessibilityLabel={chip}
            testID="onboarding-try-chip"
          >
            <Text style={styles.chipText}>{chip}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Free-form input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t('onboarding.try_placeholder')}
          placeholderTextColor={colors.textPlaceholder}
          value={text}
          onChangeText={setText}
          returnKeyType="done"
          onSubmitEditing={() => runDemo(text)}
          accessibilityLabel={t('onboarding.try_placeholder')}
          testID="onboarding-try-input"
        />
        <TouchableOpacity
          style={styles.parseBtn}
          onPress={() => runDemo(text)}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.try_parse')}
          testID="onboarding-try-parse"
        >
          <Ionicons name="arrow-forward" size={18} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {/* Result preview — success shows the extracted fields, failure a retry hint */}
      {result !== null && (
        parsedOk ? (
          <View style={styles.previewCard} testID="onboarding-try-preview">
            <View style={styles.previewHeader}>
              <Ionicons name="sparkles" size={14} color={colors.primary} />
              <Text style={styles.previewHeaderText}>{t('onboarding.try_result')}</Text>
            </View>
            <Text style={styles.previewTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.previewWhen}>
              {formatPreviewDateTime(startAt, result.parsed.allDay?.value === true, timeTokens)}
            </Text>
          </View>
        ) : (
          <Text style={styles.failText} testID="onboarding-try-fail">
            {t('onboarding.try_fail')}
          </Text>
        )
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      width: '100%',
      gap: spacing[3],
    },

    // Suggestion chips
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing[2],
    },
    chip: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    chipText: {
      ...textStyles.bodySm,
      color: colors.primary,
    },

    // Input row
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    input: {
      flex: 1,
      height: 44,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: radius.lg,
      paddingHorizontal: spacing[4],
      ...textStyles.bodySm,
      color: colors.textPrimary,
    },
    parseBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Result preview
    previewCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: radius.lg,
      padding: spacing[4],
      gap: spacing[1],
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
    },
    previewHeaderText: {
      ...textStyles.caption,
      color: colors.primary,
      fontWeight: '600',
    },
    previewTitle: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    previewWhen: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
    },
    failText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });
}
