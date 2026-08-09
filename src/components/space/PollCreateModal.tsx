/**
 * PollCreateModal — 투표 만들기.
 *
 * 후보는 두 종류를 한 목록에서 다룬다:
 *  - 날짜 후보: 날짜/시각을 붙인다 (확정 시 Space 공유 일정이 생성된다)
 *  - 자유 후보: 텍스트만 ("삼겹살" 등)
 * 후보 행마다 "날짜" 토글로 전환한다 — 별도 탭을 두는 것보다 섞어 쓰기 쉽다.
 *
 * 계획: docs/plans/2026-08-08-space-poll.md
 */

import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Switch,
  ActivityIndicator, Platform, StyleSheet, KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/lib/webAlert';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { CreatePollInput, CreatePollOptionInput } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: CreatePollInput) => Promise<void>;
}

interface DraftOption {
  key: string;
  label: string;
  /** null = 자유 후보, Date = 날짜 후보. */
  startsAt: Date | null;
}

/** 다음 정각(내일 오후 7시)을 기본 후보 시각으로 제안한다. */
function defaultOptionDate(index: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1 + index);
  d.setHours(19, 0, 0, 0);
  return d;
}

let seq = 0;
const newKey = () => `opt-${++seq}`;

export function PollCreateModal({ visible, onClose, onSubmit }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [title, setTitle] = useState('');
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  // 기본 2행 — 후보 1개짜리 투표는 서비스가 거부한다.
  const [options, setOptions] = useState<DraftOption[]>([
    { key: newKey(), label: '', startsAt: null },
    { key: newKey(), label: '', startsAt: null },
  ]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle('');
    setAllowMultiple(true);
    setAnonymous(false);
    setOptions([
      { key: newKey(), label: '', startsAt: null },
      { key: newKey(), label: '', startsAt: null },
    ]);
    setPickerFor(null);
  };

  const patch = (key: string, next: Partial<DraftOption>) =>
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...next } : o)));

  const filled = options.filter((o) => o.label.trim() || o.startsAt);

  const handleSubmit = async () => {
    if (!title.trim()) { showAlert(t('space.poll.need_title')); return; }
    if (filled.length < 2) { showAlert(t('space.poll.need_options')); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        allowMultiple,
        anonymous,
        // exactOptionalPropertyTypes: undefined 를 넘기는 대신 키를 생략한다.
        options: filled.map((o) => {
          const opt: CreatePollOptionInput = {};
          if (o.label.trim()) opt.label = o.label.trim();
          if (o.startsAt) opt.startsAt = o.startsAt;
          return opt;
        }),
      });
      reset();
      onClose();
    } catch (err) {
      showAlert(t('common.error'), err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const picking = options.find((o) => o.key === pickerFor);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.cancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={styles.sheetTitle}>{t('space.poll.create_title')}</Text>
            <Pressable onPress={() => { void handleSubmit(); }} disabled={submitting} hitSlop={8}>
              {submitting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={styles.submit}>{t('common.save')}</Text>}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextInput
              testID="poll-title-input"
              style={styles.input}
              placeholder={t('space.poll.title_placeholder')}
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
            />

            <Text style={styles.label}>{t('space.poll.options_label')}</Text>
            {options.map((o, idx) => (
              <View key={o.key} style={styles.optionRow}>
                {o.startsAt ? (
                  <Pressable style={styles.dateBtn} onPress={() => setPickerFor(o.key)}>
                    <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                    <Text style={styles.dateText}>
                      {o.startsAt.toLocaleString(i18n.language, {
                        month: 'short', day: 'numeric', weekday: 'short',
                        hour: 'numeric', minute: '2-digit',
                      })}
                    </Text>
                  </Pressable>
                ) : (
                  <TextInput
                    testID={`poll-option-${idx}`}
                    style={[styles.input, styles.optionInput]}
                    placeholder={t('space.poll.option_placeholder')}
                    placeholderTextColor={colors.textTertiary}
                    value={o.label}
                    onChangeText={(v) => patch(o.key, { label: v })}
                    maxLength={100}
                  />
                )}
                {/* 날짜 후보 ↔ 자유 후보 전환 */}
                <Pressable
                  onPress={() => patch(o.key, { startsAt: o.startsAt ? null : defaultOptionDate(idx) })}
                  hitSlop={6}
                  style={styles.toggleBtn}
                >
                  <Ionicons
                    name={o.startsAt ? 'text-outline' : 'calendar-outline'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {options.length > 2 && (
                  <Pressable onPress={() => setOptions((p) => p.filter((x) => x.key !== o.key))} hitSlop={6}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </Pressable>
                )}
              </View>
            ))}

            <Pressable
              testID="poll-add-option"
              style={styles.addOption}
              onPress={() => setOptions((p) => [...p, { key: newKey(), label: '', startsAt: null }])}
            >
              <Text style={styles.addOptionText}>{t('space.poll.add_option')}</Text>
            </Pressable>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('space.poll.allow_multiple')}</Text>
              <Switch value={allowMultiple} onValueChange={setAllowMultiple} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <Text style={styles.switchLabel}>{t('space.poll.anonymous_label')}</Text>
                {/* 비밀투표가 아니라는 점을 만들 때 알린다. */}
                <Text style={styles.switchHint}>{t('space.poll.anonymous_note')}</Text>
              </View>
              <Switch value={anonymous} onValueChange={setAnonymous} />
            </View>
          </ScrollView>

          {picking?.startsAt && (
            <DateTimePicker
              value={picking.startsAt}
              mode="datetime"
              onChange={(_e, date) => {
                // Android 는 선택/취소 후 picker 를 직접 닫아야 한다.
                if (Platform.OS !== 'ios') setPickerFor(null);
                if (date) patch(picking.key, { startsAt: date });
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: '88%',
    },
    sheetHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing[4], paddingVertical: spacing[3],
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    sheetTitle: { ...textStyles.body, fontWeight: '700', color: colors.textPrimary },
    cancel: { ...textStyles.body, color: colors.textSecondary },
    submit: { ...textStyles.body, color: colors.primary, fontWeight: '700' },
    body: { padding: spacing[4], gap: spacing[3] },
    label: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing[2] },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
      paddingHorizontal: spacing[3], paddingVertical: spacing[2],
      color: colors.textPrimary, ...textStyles.body,
    },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    optionInput: { flex: 1 },
    dateBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1],
      borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm,
      paddingHorizontal: spacing[3], paddingVertical: spacing[2] + 2,
    },
    dateText: { ...textStyles.body, color: colors.textPrimary },
    toggleBtn: { padding: spacing[1] },
    addOption: { alignSelf: 'flex-start', paddingVertical: spacing[1] },
    addOptionText: { ...textStyles.caption, color: colors.primary, fontWeight: '600' },
    switchRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: spacing[3], marginTop: spacing[1],
    },
    switchTextWrap: { flex: 1, gap: 2 },
    switchLabel: { ...textStyles.body, color: colors.textPrimary },
    switchHint: { ...textStyles.caption, color: colors.textTertiary },
  });
}
