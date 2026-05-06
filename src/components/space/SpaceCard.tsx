/**
 * SpaceCard — 한 Space 의 카드 행. spaces 탭과 (이전) my 탭 모두에서 사용.
 */

import { TouchableOpacity, View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { SpaceSummary } from '@/types';

interface Props {
  space: SpaceSummary;
  onPress: () => void;
}

export function SpaceCard({ space, onPress }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const typeLabel = space.type === 'couple'
    ? t('space.types.couple')
    : t('space.types.group');

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.icon}>
        {space.coverImageUrl ? (
          <Image source={{ uri: space.coverImageUrl }} style={styles.image} />
        ) : (
          <Text style={styles.emoji}>{space.type === 'couple' ? '💑' : '👥'}</Text>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{space.name}</Text>
        <Text style={styles.meta}>{typeLabel} · {space.memberCount}명</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      flexDirection:    'row',
      alignItems:       'center',
      backgroundColor:  colors.surface,
      borderRadius:     radius.lg,
      padding:          spacing[3],
      marginBottom:     spacing[2],
    },
    icon: {
      width:            48,
      height:           48,
      borderRadius:     24,
      backgroundColor:  colors.backgroundAlt,
      alignItems:       'center',
      justifyContent:   'center',
      marginRight:      spacing[3],
      overflow:         'hidden',
    },
    image: {
      width:  '100%',
      height: '100%',
    },
    emoji: {
      fontSize: 24,
    },
    info: {
      flex: 1,
    },
    name: {
      ...textStyles.body,
      color:      colors.textPrimary,
      fontWeight: '600',
    },
    meta: {
      ...textStyles.caption,
      color:      colors.textSecondary,
      marginTop:  2,
    },
    chevron: {
      ...textStyles.h3,
      color:        colors.textSecondary,
      paddingLeft:  spacing[2],
    },
  });
}
