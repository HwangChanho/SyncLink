import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface AnniversaryAddModalProps {
  visible: boolean;
  title: string;
  year: string;
  month: string;
  day: string;
  repeatYearly: boolean;
  isSaving: boolean;
  onChangeTitle: (v: string) => void;
  onChangeYear: (v: string) => void;
  onChangeMonth: (v: string) => void;
  onChangeDay: (v: string) => void;
  onToggleRepeatYearly: (v: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

/**
 * Modal for adding a new anniversary.
 *
 * Date is entered as three separate numeric fields (year / month / day)
 * to avoid any extra date-picker package dependency.
 */
export function AnniversaryAddModal({
  visible,
  title,
  year,
  month,
  day,
  repeatYearly,
  isSaving,
  onChangeTitle,
  onChangeYear,
  onChangeMonth,
  onChangeDay,
  onToggleRepeatYearly,
  onSave,
  onClose,
  colors,
  styles,
}: AnniversaryAddModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Dimmed backdrop — tap to close */}
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Sheet content — KeyboardAvoidingView lifts it above keyboard */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalSheetWrapper}
        pointerEvents="box-none"
      >
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('anniversary.title_placeholder')}</Text>
            <TouchableOpacity onPress={onClose} disabled={isSaving}>
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>

          {/* Title input */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>{t('anniversary.title_placeholder')}</Text>
            <TextInput
              style={styles.modalInput}
              value={title}
              onChangeText={onChangeTitle}
              placeholder={t('anniversary.title_placeholder')}
              placeholderTextColor={colors.textPlaceholder}
              maxLength={30}
              autoFocus
            />
          </View>

          {/* Date input — 3 fields in a row */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>날짜</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={[styles.modalInput, styles.dateInputYear]}
                value={year}
                onChangeText={onChangeYear}
                placeholder="2024"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.modalInput, styles.dateInputMonthDay]}
                value={month}
                onChangeText={onChangeMonth}
                placeholder="MM"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.modalInput, styles.dateInputMonthDay]}
                value={day}
                onChangeText={onChangeDay}
                placeholder="DD"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          {/* Repeat yearly toggle */}
          <View style={styles.modalToggleRow}>
            <Text style={styles.modalFieldLabel}>{t('time.annual')}</Text>
            <Switch
              value={repeatYearly}
              onValueChange={onToggleRepeatYearly}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.modalSaveButton, isSaving && styles.modalSaveButtonDisabled]}
            onPress={onSave}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.modalSaveButtonText}>{t('common.save')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
