/**
 * SpaceCard — 한 Space 의 카드 행. spaces 탭과 (이전) my 탭 모두에서 사용.
 *
 * v1.2.1 — unread 메시지 badge 지원 (우상단 빨강 동그라미 + 숫자).
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
  /** v1.2.1 — 안 본 메시지 수. 0 / undefined 면 badge 숨김. */
  unreadCount?: number;
}

export function SpaceCard({ space, onPress, unreadCount = 0 }: Props) {
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
      {unreadCount > 0 && (
        <View style={styles.badge} accessibilityLabel={`안 읽은 메시지 ${unreadCount}개`}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
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
    badge: {
      minWidth:        20,
      height:          20,
      borderRadius:    10,
      paddingHorizontal: 6,
      backgroundColor: '#EF4444',
      alignItems:      'center',
      justifyContent:  'center',
      marginRight:     spacing[2],
    },
    badgeText: {
      ...textStyles.caption,
      color:      '#FFFFFF',
      fontWeight: '700',
      fontSize:   11,
      lineHeight: 13,
    },
    chevron: {
      ...textStyles.h3,
      color:        colors.textSecondary,
      paddingLeft:  spacing[2],
    },
  });
}
