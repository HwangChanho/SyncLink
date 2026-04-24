/**
 * ReminderPicker — UI for adding / removing per-event reminders.
 *
 * Features:
 *  - Displays currently selected reminder offsets as dismissible chips.
 *  - "리마인더 추가" button opens a modal with preset options (5 / 10 / 30 / 60 min,
 *    1 day) plus a "직접 입력" free-text field.
 *  - Tapping the × on a chip removes that reminder.
 *  - Works on iOS, Android, and Web (uses Modal instead of ActionSheet).
 *
 * Usage (uncontrolled minutes list — the parent owns state):
 *  ```tsx
 *  const [reminderMinutes, setReminderMinutes] = useState<number[]>([30]);
 *  <ReminderPicker
 *    minutesList={reminderMinutes}
 *    onAdd={(min) => setReminderMinutes(prev => [...prev, min])}
 *    onRemove={(min) => setReminderMinutes(prev => prev.filter(m => m !== min))}
 *  />
 *  ```
 *
 * Limitations:
 *  - Does not perform DB writes itself; callers commit changes on event save.
 */

import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { REMINDER_PRESETS, presetLabel } from '@/services/reminderService';

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * Props for ReminderPicker.
 *
 * @param minutesList - Currently selected reminder offsets (minutes before event start)
 * @param onAdd       - Called when the user selects a new offset from the sheet
 * @param onRemove    - Called when the user taps × on an existing chip
 */
export interface ReminderPickerProps {
  minutesList: number[];
  onAdd:    (minutes: number) => void;
  onRemove: (minutes: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ReminderPicker component.
 *
 * Renders a row of chips for current reminders plus an "Add" button.
 * Opens a modal to let the user pick a preset or enter a custom value.
 */
export function ReminderPicker({
  minutesList,
  onAdd,
  onRemove,
}: ReminderPickerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Whether the add-reminder modal is open. */
  const [modalVisible, setModalVisible] = useState(false);

  /** Toggle between 분 (minutes) and 시간 (hours) for the custom input. */
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours'>('minutes');

  /** Raw text from the custom number input. */
  const [customValue, setCustomValue] = useState('');

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Add a preset reminder offset and close the modal.
   *
   * @param minutes - Preset minutes value (from REMINDER_PRESETS)
   */
  function handleSelectPreset(minutes: number) {
    // Prevent duplicate offsets
    if (!minutesList.includes(minutes)) {
      onAdd(minutes);
    }
    setModalVisible(false);
    setCustomValue('');
  }

  /**
   * Validate and submit the custom minutes input.
   * Converts hours → minutes when the unit is 'hours'.
   */
  function handleAddCustom() {
    const raw = parseInt(customValue.trim(), 10);
    if (!raw || raw <= 0) return; // ignore invalid / empty input

    const minutes = customUnit === 'hours' ? raw * 60 : raw;
    if (!minutesList.includes(minutes)) {
      onAdd(minutes);
    }
    setModalVisible(false);
    setCustomValue('');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Row label + chip list */}
      <View style={styles.chipsRow}>
        {minutesList.length === 0 ? (
          // Placeholder text when no reminders are set
          <Text style={styles.emptyText}>{t('reminder.none')}</Text>
        ) : (
          minutesList.map((min) => (
            <View key={min} style={styles.chip}>
              <Text style={styles.chipLabel}>{presetLabel(min, t)}</Text>
              {/* Remove button */}
              <Pressable
                onPress={() => onRemove(min)}
                hitSlop={8}
                accessibilityLabel={`${presetLabel(min, t)} 리마인더 삭제`}
              >
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* Add button */}
      <Pressable
        style={styles.addButton}
        onPress={() => setModalVisible(true)}
        accessibilityLabel={t('reminder.add')}
      >
        <Ionicons name="add" size={16} color={colors.primary} />
        <Text style={styles.addText}>{t('reminder.add')}</Text>
      </Pressable>

      {/* ── Add-reminder modal ─────────────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        {/* Semi-transparent backdrop */}
        <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)} />

        {/* Sheet content */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrapper}
        >
          <View style={styles.sheet}>
            {/* Handle bar */}
            <View style={styles.handle} />

            {/* Title */}
            <Text style={styles.sheetTitle}>{t('reminder.add')}</Text>

            {/* Preset options */}
            <ScrollView style={styles.presetList} bounces={false}>
              {REMINDER_PRESETS.map((preset) => {
                const alreadyAdded = minutesList.includes(preset);
                return (
                  <Pressable
                    key={preset}
                    style={[
                      styles.presetRow,
                      alreadyAdded && styles.presetRowDisabled,
                    ]}
                    onPress={() => handleSelectPreset(preset)}
                    disabled={alreadyAdded}
                    accessibilityLabel={presetLabel(preset, t)}
                  >
                    <Text
                      style={[
                        styles.presetLabel,
                        alreadyAdded && styles.presetLabelDisabled,
                      ]}
                    >
                      {presetLabel(preset, t)}
                    </Text>
                    {alreadyAdded && (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Custom input section */}
            <View style={styles.customSection}>
              <Text style={styles.customLabel}>{t('reminder.custom')}</Text>
              <View style={styles.customRow}>
                {/* Number input */}
                <TextInput
                  style={styles.customInput}
                  value={customValue}
                  onChangeText={setCustomValue}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleAddCustom}
                />

                {/* Unit toggle: 분 / 시간 */}
                <View style={styles.unitToggle}>
                  <Pressable
                    style={[
                      styles.unitButton,
                      customUnit === 'minutes' && styles.unitButtonActive,
                    ]}
                    onPress={() => setCustomUnit('minutes')}
                  >
                    <Text
                      style={[
                        styles.unitText,
                        customUnit === 'minutes' && styles.unitTextActive,
                      ]}
                    >
                      {t('reminder.unit_minutes')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.unitButton,
                      customUnit === 'hours' && styles.unitButtonActive,
                    ]}
                    onPress={() => setCustomUnit('hours')}
                  >
                    <Text
                      style={[
                        styles.unitText,
                        customUnit === 'hours' && styles.unitTextActive,
                      ]}
                    >
                      {t('reminder.unit_hours')}
                    </Text>
                  </Pressable>
                </View>

                {/* Confirm button */}
                <Pressable
                  style={[
                    styles.customConfirm,
                    !customValue.trim() && styles.customConfirmDisabled,
                  ]}
                  onPress={handleAddCustom}
                  disabled={!customValue.trim()}
                >
                  <Text style={styles.customConfirmText}>{t('common.add')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    // ── Outer container ──────────────────────────────────────────────────────
    container: {
      gap: spacing[2],
    },

    // ── Chip row ─────────────────────────────────────────────────────────────
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    chipLabel: {
      ...textStyles.labelSm,
      color: colors.primary,
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      fontStyle: 'italic',
    },

    // ── Add button ───────────────────────────────────────────────────────────
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      alignSelf: 'flex-start',
      paddingVertical: spacing[1],
    },
    addText: {
      ...textStyles.labelSm,
      color: colors.primary,
    },

    // ── Modal backdrop ───────────────────────────────────────────────────────
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },

    // ── Bottom sheet ─────────────────────────────────────────────────────────
    sheetWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingBottom: spacing[10],
      paddingHorizontal: spacing[5],
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginTop: spacing[3],
      marginBottom: spacing[2],
    },
    sheetTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: spacing[4],
    },

    // ── Preset list ───────────────────────────────────────────────────────────
    presetList: {
      maxHeight: 220,
    },
    presetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    presetRowDisabled: {
      opacity: 0.5,
    },
    presetLabel: {
      ...textStyles.body,
      color: colors.textPrimary,
    },
    presetLabelDisabled: {
      color: colors.textSecondary,
    },

    // ── Custom input ──────────────────────────────────────────────────────────
    customSection: {
      marginTop: spacing[5],
      gap: spacing[3],
    },
    customLabel: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    customInput: {
      flex: 1,
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
      ...textStyles.body,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
    },
    unitToggle: {
      flexDirection: 'row',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    unitButton: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    unitButtonActive: {
      backgroundColor: colors.primaryLight,
    },
    unitText: {
      ...textStyles.labelSm,
      color: colors.textSecondary,
    },
    unitTextActive: {
      color: colors.primary,
    },
    customConfirm: {
      height: 44,
      paddingHorizontal: spacing[4],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    customConfirmDisabled: {
      opacity: 0.4,
    },
    customConfirmText: {
      ...textStyles.label,
      color: '#FFFFFF',
    },
  });
}
