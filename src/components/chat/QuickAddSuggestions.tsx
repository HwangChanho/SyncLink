/**
 * QuickAddSuggestions — quick event-registration chips on the AI assistant
 * empty state (rendered below the "내 일정에서 무엇을 알아볼까요?" greeting).
 *
 * Two groups:
 *   1. 자주 쓰는 일정 — the user's most frequently registered past events
 *      (personalized; hidden for guests / empty history). Prefills the real
 *      title + categoryId + location from that past event.
 *   2. 빠른 등록 — predefined category templates (회의/약속/…). Prefills the
 *      label as the title + a best-fit system category (업무/개인).
 *
 * Tapping a chip routes to the create form with prefill params, reusing the
 * existing event/create prefill mechanism (v1.2.8) — same shape NLInputBar
 * uses, so the form lands with fields already filled.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getFrequentEventTemplates,
  type EventAutocompleteSuggestion,
} from '@/services/eventService';
import { getBuiltinCategoryMap } from '@/services/categoryService';
import { QUICK_ADD_TEMPLATES, type BuiltinSystemCategory } from '@/constants/eventTemplates';

export function QuickAddSuggestions() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { t } = useTranslation();

  const [frequent, setFrequent] = useState<EventAutocompleteSuggestion[]>([]);
  const [categoryMap, setCategoryMap] =
    useState<Partial<Record<BuiltinSystemCategory, string>>>({});

  // Load personalized history + system-category ids once on mount. Failures are
  // non-fatal: the category templates still render (title-only prefill), and a
  // guest simply sees no personalized section.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [freq, catMap] = await Promise.all([
          getFrequentEventTemplates(6),
          getBuiltinCategoryMap(),
        ]);
        if (cancelled) return;
        setFrequent(freq);
        setCategoryMap(catMap);
      } catch {
        // Guest / network error — leave defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Route to the create form with prefilled fields (empty values omitted). */
  const openCreate = (params: Record<string, string>) => {
    router.push({ pathname: '/event/create', params });
  };

  // Literal-key lookups keep this type-safe under typed i18n resources
  // (a dynamic `t(`nl.quickAdd.${key}`)` would not narrow).
  const categoryLabels: Record<string, string> = {
    meeting:     t('nl.quickAdd.meeting'),
    deadline:    t('nl.quickAdd.deadline'),
    appointment: t('nl.quickAdd.appointment'),
    meal:        t('nl.quickAdd.meal'),
    workout:     t('nl.quickAdd.workout'),
    hospital:    t('nl.quickAdd.hospital'),
    travel:      t('nl.quickAdd.travel'),
    date:        t('nl.quickAdd.date'),
  };

  return (
    <View style={styles.wrap}>
      {/* 1. Personalized — frequent past events */}
      {frequent.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('nl.quickAdd.frequent_title')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollRow}
          >
            {frequent.map((s) => (
              <Pressable
                key={s.id}
                style={styles.chip}
                onPress={() =>
                  openCreate({
                    title: s.title,
                    ...(s.categoryId ? { categoryId: s.categoryId } : {}),
                    ...(s.location ? { location: s.location } : {}),
                  })
                }
              >
                <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.chipText} numberOfLines={1}>
                  {s.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 2. Predefined category templates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('nl.quickAdd.category_title')}</Text>
        <View style={styles.gridRow}>
          {QUICK_ADD_TEMPLATES.map((tpl) => {
            const label = categoryLabels[tpl.key] ?? tpl.key;
            const categoryId = categoryMap[tpl.builtin];
            return (
              <Pressable
                key={tpl.key}
                style={styles.chip}
                onPress={() =>
                  openCreate({
                    title: label,
                    ...(categoryId ? { categoryId } : {}),
                  })
                }
              >
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={styles.chipText}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { alignSelf: 'stretch', gap: spacing[4], marginTop: spacing[5] },
    section: { gap: spacing[2] },
    sectionTitle: { ...(textStyles.labelSm as object), color: colors.textTertiary },
    scrollRow: { gap: spacing[2], paddingRight: spacing[2] },
    gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 220,
    },
    chipText: { ...(textStyles.bodySm as object), color: colors.textPrimary },
  });
}
