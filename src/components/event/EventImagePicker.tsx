/**
 * EventImagePicker — v1.1.2 일정 이미지 첨부 UI.
 *
 * 일정 생성/편집 화면에서 최대 5장의 이미지를 선택·표시·삭제할 수 있는
 * 그리드 컴포넌트. 부모는 단순히 URI 배열(로컬 또는 remote)을 상태로
 * 들고 있고, 실제 업로드/저장은 폼 submit 시 eventImageService 로 위임.
 *
 * 동작:
 *  - "+" 셀 탭 → expo-image-picker 다중 선택 (max 5 - 이미 추가된 수)
 *  - 각 셀 우상단 X 버튼 → 해당 URI 제거
 *  - read-only 모드 (상세 화면용) → 탭 비활성, 갤러리만 표시
 *
 * 부모 책임:
 *  - uris: 현재 표시할 URI 목록 (로컬 file:// + remote https:// 혼합 가능)
 *  - onChange: 사용자가 추가/삭제 했을 때 새 배열로 호출
 *  - read-only 시 onChange 생략
 */

import React, { useCallback } from 'react';
import { View, Image, Pressable, Text, StyleSheet, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { MAX_EVENT_IMAGES } from '@/services/eventImageService';

interface Props {
  /** 표시할 이미지 URI 목록 (로컬 file:// 또는 remote https:// 혼합). */
  uris: string[];
  /** 사용자가 변경했을 때 호출. read-only 시 생략. */
  onChange?: (next: string[]) => void;
  /** true 면 추가/삭제 버튼 안 보이고 탭 비활성. 상세 화면용. */
  readOnly?: boolean;
  /** 썸네일 탭 시 호출. read-only 상세 화면에서 lightbox 열기 용. */
  onImagePress?: (index: number) => void;
}

export function EventImagePicker({ uris, onChange, readOnly, onImagePress }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const canAddMore = !readOnly && uris.length < MAX_EVENT_IMAGES;

  const handleAdd = useCallback(async () => {
    if (!onChange) return;
    // 권한 요청 (iOS/Android 모두). 한 번 거절돼도 매 호출마다 시스템이
    // settings 안내를 띄우지 않으므로 사용자에게 알림.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.');
      return;
    }
    const remaining = MAX_EVENT_IMAGES - uris.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:        ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit:    remaining,
      quality:           1,       // 압축은 service 레이어에서 처리
      base64:            false,
    });
    if (result.canceled) return;
    const newUris = result.assets.map((a) => a.uri);
    onChange([...uris, ...newUris].slice(0, MAX_EVENT_IMAGES));
  }, [onChange, uris]);

  const handleRemove = useCallback((idx: number) => {
    if (!onChange) return;
    onChange(uris.filter((_, i) => i !== idx));
  }, [onChange, uris]);

  return (
    <View style={styles.grid}>
      {uris.map((uri, idx) => (
        <Pressable
          key={`${uri}-${idx}`}
          style={styles.cell}
          onPress={onImagePress ? () => onImagePress(idx) : undefined}
          disabled={!onImagePress}
          accessibilityRole={onImagePress ? 'button' : undefined}
          accessibilityLabel={onImagePress ? `이미지 ${idx + 1} 크게 보기` : undefined}
        >
          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          {!readOnly && (
            <Pressable
              onPress={() => handleRemove(idx)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`이미지 ${idx + 1} 삭제`}
              style={styles.removeBtn}
            >
              <Ionicons name="close" size={14} color={colors.textInverse} />
            </Pressable>
          )}
        </Pressable>
      ))}
      {canAddMore && (
        <Pressable
          onPress={handleAdd}
          accessibilityRole="button"
          accessibilityLabel="이미지 추가"
          style={[styles.cell, styles.addBtn]}
        >
          <Ionicons name="add" size={28} color={colors.textTertiary} />
          <Text style={styles.addText}>{uris.length}/{MAX_EVENT_IMAGES}</Text>
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
    },
    cell: {
      width: 72,
      height: 72,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      position: 'relative',
    },
    thumb: {
      width: '100%',
      height: '100%',
    },
    removeBtn: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderStyle: 'dashed',
      gap: 2,
    },
    addText: {
      fontSize: 10,
      color: colors.textTertiary,
    },
  });
}
