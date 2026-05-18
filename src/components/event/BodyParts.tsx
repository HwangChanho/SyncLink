/**
 * BodyParts — v1.1 운동 일정 등록 silhouette picker.
 *
 * A stylised front-view human silhouette built from SVG paths. The user
 * taps a region to toggle which body part they trained. Cardio doesn't
 * map onto a body region cleanly so it sits below the silhouette as a
 * standalone chip; "back" similarly lives in the chip row because a
 * front-view drawing can't disambiguate front-of-shoulder from back.
 *
 * Read-only mode is used by the event detail screen — taps are
 * disabled and selected regions stay highlighted for review.
 *
 * Plan: docs/plans/2026-05-17-workout-event-type.md
 */

import { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { WorkoutPartDb } from '@/types';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { WORKOUT_RESERVED_COLOR } from '@/components/event/ColorPicker';

// v1.1.2 — SVG path 합성을 폐기하고 실제 인체 일러스트 PNG (magnific.com
// 무료 자산, attribution: docs/CREDITS.md) 위에 절대 위치 hit area 로
// 부위별 탭을 받는 구조. tintColor 로 라이트/다크 모드 자동 적용.
const BODY_IMAGE = require('../../../assets/anatomy/body-front-alpha.png');

/**
 * 부위별 hit area 좌표 (이미지 비율 기준 0-1).
 * 이미지 크기: 511×740 (1:1.448). 영역은 시각적으로 가까운 신체부위에
 * 맞춰 측정. 토글 결과는 같은 영역 위 빨강 반투명 overlay 로 시각화.
 */
const HIT_AREAS: Record<Exclude<WorkoutPartDb, 'back' | 'cardio'>, { top: number; left: number; width: number; height: number }> = {
  shoulders: { top: 0.13, left: 0.22, width: 0.56, height: 0.08 },
  chest:     { top: 0.21, left: 0.30, width: 0.40, height: 0.13 },
  arms:      { top: 0.18, left: 0.00, width: 1.00, height: 0.44 }, // 좌+우 팔 영역 통합 (중앙 부분은 chest/core 우선)
  core:      { top: 0.34, left: 0.34, width: 0.32, height: 0.18 },
  legs:      { top: 0.52, left: 0.20, width: 0.60, height: 0.45 },
};

/** Body parts the silhouette renders as tappable regions on the canvas. */
const SILHOUETTE_PARTS: WorkoutPartDb[] = ['chest', 'shoulders', 'arms', 'core', 'legs'];
/** Parts that live as chips below the silhouette (no clean front-view shape). */
const CHIP_PARTS: WorkoutPartDb[] = ['back', 'cardio'];

const PART_LABELS_KO: Record<WorkoutPartDb, string> = {
  chest:     '가슴',
  back:      '등',
  shoulders: '어깨',
  arms:      '팔',
  legs:      '하체',
  core:      '코어',
  cardio:    '유산소',
};

export interface BodyPartsProps {
  selected: WorkoutPartDb[];
  /** Tap handler. omit (or pass readOnly) to disable interaction. */
  onToggle?: (part: WorkoutPartDb) => void;
  readOnly?: boolean;
}

/**
 * 인체 일러스트 PNG (alpha) + 절대 위치 hit area. tintColor 로 라이트/다크
 * 모드 자동 색 적용. 선택된 부위는 위에 빨강 반투명 overlay.
 */
export function BodyParts({ selected, onToggle, readOnly }: BodyPartsProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const isSelected = useCallback(
    (part: WorkoutPartDb) => selected.includes(part),
    [selected],
  );
  const handleTap = useCallback(
    (part: WorkoutPartDb) => {
      if (readOnly || !onToggle) return;
      onToggle(part);
    },
    [onToggle, readOnly],
  );

  return (
    <View style={styles.container}>
      <View style={styles.imageWrap}>
        {/* 인체 silhouette — tintColor 로 다크/라이트 모드 자동 색 적용.
            alpha PNG 이라 배경은 자동 투명. */}
        <Image
          source={BODY_IMAGE}
          style={[styles.bodyImage, { tintColor: colors.textPrimary }]}
          resizeMode="contain"
        />

        {/* 각 부위 hit area + 활성 시 빨강 overlay (WORKOUT_RESERVED_COLOR).
            % 좌표 → flex 컨테이너에 절대 위치로 변환. */}
        {(Object.entries(HIT_AREAS) as Array<[Exclude<WorkoutPartDb, 'back' | 'cardio'>, typeof HIT_AREAS['chest']]>).map(
          ([part, rect]) => {
            const active = isSelected(part);
            return (
              <Pressable
                key={part}
                onPress={() => handleTap(part)}
                disabled={readOnly}
                style={[
                  styles.hitArea,
                  {
                    top:    `${rect.top * 100}%`,
                    left:   `${rect.left * 100}%`,
                    width:  `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  },
                  active && { backgroundColor: WORKOUT_RESERVED_COLOR + '55' },
                ]}
              />
            );
          },
        )}
      </View>

      {/* Chip row for back + cardio. Same accent colour as silhouette
          selection so the visual language stays consistent. */}
      <View style={styles.chipRow}>
        {CHIP_PARTS.map((part) => {
          const active = isSelected(part);
          return (
            <Pressable
              key={part}
              onPress={() => handleTap(part)}
              disabled={readOnly}
              style={[
                styles.chip,
                active && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Text style={[styles.chipText, active && { color: colors.textInverse }]}>
                {PART_LABELS_KO[part]}
              </Text>
            </Pressable>
          );
        })}
        {/* Silhouette parts also need a label row for accessibility / when
            taps on the SVG are visually ambiguous. Keep it compact. */}
        {SILHOUETTE_PARTS.map((part) => {
          if (!isSelected(part)) return null;
          return (
            <View key={`badge-${part}`} style={styles.activeBadge}>
              <Text style={[styles.chipText, { color: colors.textInverse, fontSize: 11 }]}>
                {PART_LABELS_KO[part]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      gap: spacing[2],
      alignItems: 'center',
    },
    imageWrap: {
      width: '100%',
      maxWidth: 220,
      aspectRatio: 511 / 740,
      position: 'relative',
    },
    bodyImage: {
      width: '100%',
      height: '100%',
    },
    hitArea: {
      position: 'absolute',
      borderRadius: radius.md,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
      justifyContent: 'center',
    },
    chip: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipText: {
      ...(textStyles.labelSm as object),
      color: colors.textPrimary,
    },
    activeBadge: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      borderWidth: 1,
      borderColor: colors.primary,
    },
  });
}
