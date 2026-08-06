/**
 * BodyParts — v1.1 운동 일정 등록 silhouette picker.
 *
 * 인체 silhouette PNG 를 MaskedView 의 mask 로 사용해, 부위별 색상이
 * silhouette 모양 안에서만 보이도록 clip 한다. 시각적으로는 "사람의
 * 해당 부위가 정확히 색칠된 것" 처럼 보인다.
 *
 * Layer 구조 (위로 갈수록 상위):
 *   1) MaskedView (mask = silhouette PNG)
 *      ├── base color layer (회색 — silhouette 전체 base)
 *      └── 활성 부위별 color overlay (운동 예약 색상)
 *   2) Hit detection layer (절대 위치 Pressable — 투명, MaskedView 밖)
 *
 * Pressable 을 MaskedView 안에 두면 mask 밖 영역의 tap 이 무시되므로
 * 별도 absolute layer 로 분리해 silhouette 외부 hit area 까지 포함한다.
 *
 * v1.1.2 image: magnific.com 무료 자산 (attribution: docs/CREDITS.md).
 * Plan: docs/plans/2026-05-17-workout-event-type.md
 */

import { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { useColors } from '@/hooks/useColors';
import type { WorkoutPartDb } from '@/types';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { WORKOUT_RESERVED_COLOR } from '@/components/event/ColorPicker';

// 누끼 처리 + alpha trim 된 silhouette PNG (268×632).
const BODY_IMAGE = require('../../../assets/anatomy/body-silhouette.png');

// ─── Hit area 좌표 ─────────────────────────────────────────────────────────────
// 좌표는 0–1 비율, silhouette PNG 기준.

interface HitRect {
  part: Exclude<WorkoutPartDb, 'back' | 'cardio'>;
  top: number;
  left: number;
  width: number;
  height: number;
  // 부위 모양 표현용 borderRadius. 'pill' = 양 끝 둥근 캡슐, 'oval' = 타원,
  // 'circle' = 완전 원형, 숫자 = 픽셀 단위 둥근 모서리.
  shape?: 'pill' | 'oval' | 'circle' | number;
}

const HIT_AREAS: HitRect[] = [
  // 어깨 (좌) — 작은 원
  { part: 'shoulders', top: 0.15, left: 0.16, width: 0.20, height: 0.05, shape: 'circle' },
  // 어깨 (우) — 같은 part 키 → 한 번 탭으로 양쪽 동시 활성
  { part: 'shoulders', top: 0.15, left: 0.64, width: 0.20, height: 0.05, shape: 'circle' },
  // 승모 — 양 어깨 사이, 목 아래 중앙 (좁고 작게)
  { part: 'trapezius', top: 0.12, left: 0.42, width: 0.16, height: 0.06, shape: 'oval' },
  // 가슴 — 가로 타원 (좌우 폭 살짝 축소해 silhouette 윤곽에 fit)
  { part: 'chest',     top: 0.20, left: 0.30, width: 0.40, height: 0.12, shape: 'oval' },
  // 팔 (좌) — 세로 캡슐
  { part: 'arms',      top: 0.18, left: 0.08, width: 0.18, height: 0.32, shape: 'pill' },
  // 팔 (우)
  { part: 'arms',      top: 0.18, left: 0.74, width: 0.18, height: 0.32, shape: 'pill' },
  // 코어 — 세로 타원 (복부)
  { part: 'core',      top: 0.31, left: 0.34, width: 0.32, height: 0.19, shape: 'oval' },
  // 허벅지 — 골반 아래 (다리 위쪽), 좌우 폭 살짝 축소
  { part: 'thighs',    top: 0.52, left: 0.30, width: 0.40, height: 0.18, shape: 'pill' },
  // 종아리 — 무릎 아래 (다리 아래쪽), 폭 더 좁게
  { part: 'calves',    top: 0.72, left: 0.34, width: 0.32, height: 0.16, shape: 'pill' },
];

// chip row 는 모든 부위를 노출 — silhouette 위에 표현 어려운 등/유산소 외에도
// 어깨/가슴/팔/코어/하체 까지 같이 보여 사용자가 silhouette 탭과 chip 탭 양쪽
// 어느 쪽으로든 토글 가능. 양쪽 UI 모두 동일 onToggle 로 selected 배열 변경.
const ALL_CHIP_PARTS: WorkoutPartDb[] = [
  // legs 는 backward-compat 용으로 enum 에 남아있지만 UI 에는 노출하지 않고
  // 신규 등록은 thighs/calves 로 분리 저장. 옛 'legs' 데이터는 detail 화면에서만 표시.
  'shoulders', 'trapezius', 'chest', 'arms', 'core', 'thighs', 'calves', 'back', 'cardio',
];

const PART_LABELS_KO: Record<WorkoutPartDb, string> = {
  chest:     '가슴',
  back:      '등',
  shoulders: '어깨',
  arms:      '팔',
  legs:      '하체',
  core:      '코어',
  cardio:    '유산소',
  trapezius: '승모',
  thighs:    '허벅지',
  calves:    '종아리',
};

export interface BodyPartsProps {
  selected: WorkoutPartDb[];
  onToggle?: (part: WorkoutPartDb) => void;
  readOnly?: boolean;
}

/**
 * shape 키워드를 borderRadius style 로 변환.
 *  - 'pill'   = 양 끝이 완전 둥근 캡슐 (width/2 또는 height/2)
 *  - 'oval'   = 타원 (50% — RN 은 borderRadius 에 % 미지원이라 큰 값으로 근사)
 *  - 'circle' = 완전 원형 (같은 방식)
 *  - number   = 픽셀 단위 borderRadius
 *  - undefined = 직각 사각형
 */
function shapeStyle(shape: HitRect['shape']): { borderRadius?: number } {
  if (typeof shape === 'number') return { borderRadius: shape };
  if (shape === 'pill' || shape === 'oval' || shape === 'circle') {
    // RN borderRadius 는 픽셀만 받으므로 충분히 큰 값을 줘서 효과적으로 50% 처럼 보이게.
    // 부위 박스 width/height 가 최대 ~80px 정도라 999 면 항상 max-rounded.
    return { borderRadius: 999 };
  }
  return {};
}

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
        {/* 시각 layer — silhouette PNG 를 mask 로 사용. base 회색 + 활성
            부위 color overlay 가 silhouette 모양 안에서만 보임. */}
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <Image
              source={BODY_IMAGE}
              style={styles.maskImage}
              resizeMode="contain"
            />
          }
        >
          {/* base: silhouette 전체 회색 */}
          <View style={[styles.baseLayer, { backgroundColor: colors.textTertiary }]} />

          {/* 활성 부위 color overlay — shape 에 따라 모양 (원/캡슐/타원).
              MaskedView 가 silhouette 밖은 자동 clip 하므로 borderRadius 가
              silhouette 윤곽과 결합돼 부위 형태가 더 자연스러워 보임. */}
          {/* Every overlay stays mounted and toggles opacity instead of being added and
              removed. Unmounting a child does not reliably make MaskedView re-composite,
              so deselecting a part left it still coloured on the silhouette even though
              the chip below had already turned off. */}
          {HIT_AREAS.map((rect, idx) => (
            <View
              key={`fill-${idx}`}
              pointerEvents="none"
              style={[
                styles.fillArea,
                shapeStyle(rect.shape),
                {
                  top:    `${rect.top * 100}%`,
                  left:   `${rect.left * 100}%`,
                  width:  `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  opacity: isSelected(rect.part) ? 1 : 0,
                },
              ]}
            />
          ))}
        </MaskedView>

        {/* Hit detection layer — 투명 Pressable, MaskedView 밖에 두어 mask
            외부 tap 도 정상 감지. visual feedback 은 위 MaskedView 가 처리. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {HIT_AREAS.map((rect, idx) => (
            <Pressable
              key={`hit-${rect.part}-${idx}`}
              onPress={() => handleTap(rect.part)}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityLabel={`${PART_LABELS_KO[rect.part]} 부위 선택`}
              accessibilityState={{ selected: isSelected(rect.part) }}
              style={{
                position: 'absolute',
                top:    `${rect.top * 100}%`,
                left:   `${rect.left * 100}%`,
                width:  `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            />
          ))}
        </View>
      </View>

      {/* 모든 부위 chip — 기본 노출 + 클릭으로 활성/비활성 토글.
          silhouette 위 hit area 와 동일 onToggle 호출 → 양쪽 어디서 눌러도
          selected 배열 동기화. */}
      <View style={styles.chipRow}>
        {ALL_CHIP_PARTS.map((part) => {
          const active = isSelected(part);
          return (
            <Pressable
              key={part}
              onPress={() => handleTap(part)}
              disabled={readOnly}
              style={[
                styles.chip,
                active && { backgroundColor: WORKOUT_RESERVED_COLOR, borderColor: WORKOUT_RESERVED_COLOR },
              ]}
            >
              <Text style={[styles.chipText, active && { color: colors.textInverse }]}>
                {PART_LABELS_KO[part]}
              </Text>
            </Pressable>
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
      width: 160,
      height: 160 * (632 / 268),
      position: 'relative',
    },
    maskImage: {
      width: '100%',
      height: '100%',
      // mask 는 alpha 채널만 사용 — tint 가 mask 모양에 영향 주지 않음.
      backgroundColor: 'transparent',
    },
    baseLayer: {
      ...StyleSheet.absoluteFillObject,
    },
    fillArea: {
      position: 'absolute',
      backgroundColor: WORKOUT_RESERVED_COLOR,
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
  });
}
