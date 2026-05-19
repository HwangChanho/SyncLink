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
  Dimensions,
  StatusBar,
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
  // 화면 너비를 기준으로 페이지 단위 스크롤 — 매번 Dimensions 호출은 비싸지
  // 않지만 회전을 고려해 useEffect 로 동기화.
  const [screenWidth, setScreenWidth] = useState(() => Dimensions.get('window').width);
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setScreenWidth(window.width);
    });
    return () => sub.remove();
  }, []);

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
