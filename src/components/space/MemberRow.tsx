import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import type { SpaceMember } from '@/types';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface MemberRowProps {
  member: SpaceMember;
  isCurrentUser: boolean;
  canRemove: boolean;
  onRemove: () => void;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

/** Single member row with avatar, name, role badge, and optional remove button. */
export function MemberRow({
  member,
  isCurrentUser,
  canRemove,
  onRemove,
  colors: _colors,
  styles,
}: MemberRowProps) {
  return (
    <View style={styles.memberRow}>
      {/* Color dot + avatar */}
      <View style={[styles.memberAvatar, { borderColor: member.color }]}>
        {member.avatarUrl ? (
          <Image source={{ uri: member.avatarUrl }} style={styles.memberAvatarImage} />
        ) : (
          <Text style={styles.memberAvatarInitial}>
            {member.nickname.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>

      {/* Name + role */}
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {member.nickname}
          {isCurrentUser && <Text style={styles.meTag}> (나)</Text>}
        </Text>
        {member.role === 'owner' && (
          <View style={styles.ownerBadge}>
            <Text style={styles.ownerBadgeText}>관리자</Text>
          </View>
        )}
      </View>

      {/* Remove button (owner only, not self) */}
      {canRemove && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.removeMemberText}>내보내기</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
