/**
 * NoteSettingsScreen — 노트 설정.
 *
 * 현재 항목:
 *  1. 유튜브 썸네일 표시 토글 — 노트 본문에 유튜브 링크가 있을 때 목록에서
 *     썸네일을 보여줄지 여부 (noteSettingsStore, AsyncStorage 영속).
 *
 * Reached from the My tab → SettingsSection ("노트 설정" row).
 */

import {
  ScrollView,
  View,
  Text,
  Pressable,
  Switch,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useNoteSettingsStore } from '@/stores/noteSettingsStore';

export default function NoteSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const showYoutubeThumbnails = useNoteSettingsStore((s) => s.showYoutubeThumbnails);
  const setShowYoutubeThumbnails = useNoteSettingsStore((s) => s.setShowYoutubeThumbnails);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('note.settings_title')}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── 유튜브 썸네일 토글 ── */}
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('note.youtube_thumbnail')}</Text>
            <Text style={styles.rowDesc}>{t('note.youtube_thumbnail_desc')}</Text>
          </View>
          <Switch
            value={showYoutubeThumbnails}
            onValueChange={setShowYoutubeThumbnails}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={showYoutubeThumbnails ? colors.primary : colors.surface}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 52,
      paddingHorizontal: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    back: { width: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    content: { padding: spacing[4] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[3],
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    // Text column flexes so the Switch keeps its intrinsic size on the right.
    rowText: { flex: 1, gap: spacing[1] },
    rowLabel: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    rowDesc: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
  });
}
