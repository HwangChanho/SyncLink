/**
 * EditSpaceModal — owner-only modal for changing a Space's name + cover.
 *
 * UX:
 *   - Inline cover preview (tap to change via ImagePicker)
 *   - Name TextInput, max 30 chars
 *   - Save button disabled until something changes
 *   - Validates name is non-empty before save
 *
 * Why a modal instead of a sub-screen: editing a single Space's metadata
 * is a transient action; pushing a new route would clutter the navigation
 * stack. Modal keeps the user anchored on the Space detail screen.
 *
 * Sprint 19 — LEAD requested owner editing of name + image.
 */

import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { showAlert } from '@/lib/webAlert';
import * as spaceService from '@/services/spaceService';
import type { Space } from '@/types';

interface EditSpaceModalProps {
  visible: boolean;
  space:   Space;
  onClose: () => void;
  /** Called with the updated Space after a successful save. */
  onSaved: (next: Space) => void;
}

export function EditSpaceModal({ visible, space, onClose, onSaved }: EditSpaceModalProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Local draft — committed to the server only on Save. */
  const [name, setName] = useState(space.name);
  const [coverUri, setCoverUri] = useState<string | null>(space.coverImageUrl ?? null);
  /** Picked from the local image library, distinct from coverUri so we
   *  know whether to upload (vs. keep the existing public URL). */
  const [pickedLocalUri, setPickedLocalUri] = useState<string | null>(null);
  /** ImagePicker's pre-decoded base64 — bypasses the ph:// 0-byte path. */
  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Reset draft when the modal reopens for a different Space. */
  const resetIfNeeded = () => {
    if (name !== space.name || pickedLocalUri !== null) {
      setName(space.name);
      setCoverUri(space.coverImageUrl ?? null);
      setPickedLocalUri(null);
    }
  };
  if (!visible) {
    // Side-effect-free best effort sync — running it in render is OK
    // because state setters are no-ops when values match.
    resetIfNeeded();
  }

  const handlePickImage = async () => {
    // Library permission only — Camera flow can be added in a follow-up.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert(t('space.photo_permission_title'), t('space.photo_permission'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      // 16:9 fits the cover band on the Space detail screen.
      aspect: [16, 9],
      quality: 0.8,
      base64: true,
    });
    if (!res.canceled && res.assets[0]) {
      const a = res.assets[0];
      setPickedLocalUri(a.uri);
      setPickedBase64(a.base64 ?? null);
      setCoverUri(a.uri); // preview
    }
  };

  const dirty = name.trim() !== space.name || pickedLocalUri !== null;

  const handleSave = async () => {
    if (!dirty) { onClose(); return; }
    if (name.trim().length === 0) {
      showAlert(t('common.error'), t('space.need_name_message'));
      return;
    }
    setSaving(true);
    try {
      let coverUrl: string | undefined;
      if (pickedLocalUri) {
        coverUrl = await spaceService.uploadSpaceCover(space.id, pickedLocalUri, pickedBase64);
      }
      const updates: { name?: string; coverImageUrl?: string } = {};
      if (name.trim() !== space.name) updates.name = name.trim();
      if (coverUrl) updates.coverImageUrl = coverUrl;
      const next = await spaceService.updateSpace(space.id, updates);
      onSaved(next);
      onClose();
    } catch (err) {
      showAlert(
        t('common.error'),
        err instanceof Error ? err.message : t('space.save_failed_message'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12} disabled={saving}>
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('space.edit_title')}</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12} disabled={saving || !dirty}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.headerAction,
                  { color: dirty ? colors.primary : colors.textTertiary },
                ]}
              >
                {t('common.save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ─── Cover ─── */}
        <TouchableOpacity
          style={styles.coverWrap}
          onPress={() => { void handlePickImage(); }}
          activeOpacity={0.85}
          disabled={saving}
        >
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.cover} contentFit="cover" />
          ) : (
            <View style={[styles.cover, { backgroundColor: colors.primaryLight }]} />
          )}
          <View style={styles.coverBadge}>
            <Ionicons name="camera" size={18} color={colors.textInverse} />
            <Text style={[styles.coverBadgeText, { color: colors.textInverse }]}>{t('space.cover_change')}</Text>
          </View>
        </TouchableOpacity>

        {/* ─── Name ─── */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{t('space.name_field_label')}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder={t('space.name_placeholder')}
            placeholderTextColor={colors.textPlaceholder}
            maxLength={30}
            editable={!saving}
            autoFocus
          />
          <Text style={styles.fieldHint}>{name.length} / 30</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      height: 52,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    headerAction: {
      ...textStyles.labelLg,
      fontWeight: '600',
    },
    coverWrap: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: colors.surface,
      position: 'relative',
    },
    cover: {
      width: '100%',
      height: '100%',
    },
    coverBadge: {
      position: 'absolute',
      bottom: spacing[3],
      right:  spacing[3],
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1.5],
      borderRadius: radius.full,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    coverBadgeText: {
      ...textStyles.caption,
      fontWeight: '600',
    },
    field: {
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[4],
      gap: spacing[2],
    },
    fieldLabel: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    nameInput: {
      height: componentHeight.inputField,
      borderWidth: 1,
      borderColor: colors.inputFocus,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
      backgroundColor: colors.inputBackground,
      ...textStyles.body,
      color: colors.textPrimary,
    },
    fieldHint: {
      ...textStyles.caption,
      color: colors.textTertiary,
      textAlign: 'right',
    },
  });
}
