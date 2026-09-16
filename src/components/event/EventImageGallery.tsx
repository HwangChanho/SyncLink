/**
 * EventImageGallery — v1.1.3 첨부 사진 fullscreen 뷰어.
 *
 * 상세 화면에서 사진 썸네일을 누르면 모달로 열려 좌우 스와이프 + 페이지
 * 인디케이터(dots)로 여러 장 사이를 이동할 수 있다. 외부 의존성 없이
 * react-native FlatList horizontal pagingEnabled 로 구현.
 *
 * 사용:
 *   <EventImageGallery
 *     uris={['https://...', ...]}
 *     visible={lightboxIdx !== null}
 *     initialIndex={lightboxIdx ?? 0}
 *     onClose={() => setLightboxIdx(null)}
 *   />
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Image,
  FlatList,
  Pressable,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  /** 표시할 이미지 URL 목록. */
  uris: string[];
  /** Modal 표시 여부. */
  visible: boolean;
  /** 처음 펼쳤을 때 보일 이미지 index. */
  initialIndex: number;
  /** 닫기 콜백. */
  onClose: () => void;
}

export function EventImageGallery({ uris, visible, initialIndex, onClose }: Props) {
  /**
   * 화면 너비 = 한 페이지의 폭(pagingEnabled).
   * 🔴 2026-09-16: 직접 `Dimensions.addEventListener('change')` 를 구독하던 것을
   *    RN 표준 훅으로 바꿨다. 하는 일은 같고(구독·해제를 RN 이 관리) 코드가 9줄 줄었다.
   */
  const { width: screenWidth } = useWindowDimensions();
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);

  // visible 이 true 로 바뀔 때 initialIndex 로 자동 scroll.
  useEffect(() => {
    if (!visible) return;
    setCurrentIdx(initialIndex);
    // FlatList 가 mount 된 직후엔 scrollToIndex 가 실패할 수 있어 microtask 지연.
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: initialIndex, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [visible, initialIndex]);

  /**
   * 폭이 바뀌면(iPhone Duo 펼침/접힘, iPad Split View, 회전) 보던 사진으로 다시 맞춘다.
   * 🔴 없으면: getItemLayout·pagingEnabled 가 폭의 배수로 끊는데 기존 오프셋이 옛 폭 기준이라
   *    **사진 두 장 사이에 걸친 채로 남는다.** 폭만 갱신해서는 부족하다.
   * scrollToIndex 대신 scrollToOffset 을 쓴다 — getItemLayout 이 있어 위치가 정확하고,
   * 인덱스 측정 실패(onScrollToIndexFailed)가 날 여지가 없다.
   */
  const lastWidthRef = useRef(screenWidth);
  useEffect(() => {
    if (lastWidthRef.current === screenWidth) return; // 폭과 무관한 리렌더는 건드리지 않는다
    lastWidthRef.current = screenWidth;
    if (!visible) return;                             // 닫혀 있으면 열릴 때 어차피 다시 맞춘다
    listRef.current?.scrollToOffset({ offset: currentIdx * screenWidth, animated: false });
  }, [screenWidth, visible, currentIdx]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    if (idx !== currentIdx) setCurrentIdx(idx);
  }, [currentIdx, screenWidth]);

  const renderItem: ListRenderItem<string> = useCallback(({ item }) => (
    <View style={[styles.page, { width: screenWidth }]}>
      <Image
        source={{ uri: item }}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  ), [screenWidth]);

  // FlatList getItemLayout — pagingEnabled + scrollToIndex 안정화.
  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({
      length: screenWidth,
      offset: screenWidth * index,
      index,
    }),
    [screenWidth],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={uris}
          keyExtractor={(uri, idx) => `${idx}-${uri}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          onScroll={onScroll}
          scrollEventThrottle={16}
          initialScrollIndex={initialIndex}
        />

        {/* 닫기 버튼 — 우상단 */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="갤러리 닫기"
          hitSlop={12}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </Pressable>

        {/* 페이지 인디케이터 — 하단 dots. 2장 이상일 때만 표시 */}
        {uris.length > 1 && (
          <View style={styles.dotsRow}>
            {uris.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === currentIdx ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,        // status bar + 약간 여유
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsRow: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
