import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface SectionCardProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

/** Reusable card section with optional header action. */
export function SectionCard({
  title,
  action,
  children,
  colors: _colors,
  styles,
}: SectionCardProps) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}
