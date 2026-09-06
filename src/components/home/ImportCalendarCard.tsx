/**
 * ImportCalendarCard — v1.2.2 홈 화면 진입점.
 *
 * 사용자가 다른 캘린더 앱의 월간/주간 스크린샷을 첨부하면 assistant-chat
 * Edge Fn 이 Claude Vision 으로 일정을 파싱해 createEvent 도구로 자동 등록.
 *
 * 흐름:
 *   1) 카드 탭 → expo-image-picker 단일 사진 선택
 *   2) base64 변환 → sendAssistantTurn (image + "이 캘린더 일정 다 등록해줘")
 *   3) 응답으로 created 수만큼 alert + eventStore 강제 refetch
 *
 * 가드:
 *   - Pro 사용자만 (Free 는 paywall — Chat 과 동일 정책)
 *   - 일 5건까지 (quota.ts 의 assistant-chat 한도 공유)
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// SDK54(expo-file-system 19)에서 readAsStringAsync/EncodingType 등 함수형 API가
// 'expo-file-system/legacy' 서브패스로 이동. 동작 동일 유지 위해 legacy 진입점 사용.
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { APP_BRAND } from '@/constants/config';
import { textStyles } from '@/constants/typography';
import { sendAssistantTurn } from '@/services/assistantChatService';
import { useEventStore } from '@/stores/eventStore';

// v1.2.9 — LEAD: "다른 캘린더 사진으로 가져오기" 카드에 X 닫기 기능 추가.
// 닫으면 영구 hidden (AsyncStorage key). 다시 보려면 설정 같은 데서 reset 필요.
const STORAGE_KEY = 'home.importCard.dismissed';

export function ImportCalendarCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const refetchEvents = useEventStore((s) => s.fetchEvents);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => setDismissed(v === '1'));
  }, []);

  const handleDismiss = useCallback(async () => {
    setDismissed(true);
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  }, []);

  const handlePick = useCallback(async () => {
    if (busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
      base64: false,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const asset = result.assets[0];
      // base64 변환 — Anthropic Vision API 가 inline base64 권장.
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // 선언 형식과 실제 바이트가 어긋나면 API 가 거부한다. ChatComposer 와 같은 방식.
      const ext = asset.uri.split('.').pop()?.toLowerCase();
      const mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
        ext === 'png'  ? 'image/png'  :
        ext === 'webp' ? 'image/webp' :
        ext === 'gif'  ? 'image/gif'  :
        'image/jpeg';

      // Edge Fn 은 messages 배열을 요구한다(비면 400 no_messages).
      const { result: turn, error } = await sendAssistantTurn({
        messages: [{
          role: 'user',
          content:
            `첨부한 캘린더 스크린샷의 모든 일정을 ${APP_BRAND} 에 등록해줘. ` +
            '각 일정의 날짜/시간/제목을 정확히 추출해서 createEvent 도구로 순서대로 호출. ' +
            '시간이 명시되지 않은 일정은 allDay 로 처리.',
        }],
        // v1.4.10 — 페이로드가 image(단수) → images(배열)로 바뀌었다.
        // 이 카드는 스크린샷 1장만 다루므로 원소 하나짜리 배열로 보낸다.
        images: [{
          base64,
          // 🔴 하드코딩하면 안 된다 — iOS 스크린샷은 기본이 PNG 라,
          //    jpeg 로 선언하면 Anthropic 이 형식 불일치로 거부한다.
          mediaType,
        }],
      });

      if (error) {
        Alert.alert('가져오기 실패', error.message);
        return;
      }
      if (!turn) {
        Alert.alert('가져오기 실패', '알 수 없는 오류가 발생했어요.');
        return;
      }

      // executed 항목은 { tool, ok, summary } 다. 실패한 호출은 세지 않는다 —
      // "N개 일정을 추가했어요" 는 실제로 등록된 수여야 한다.
      const createdCount = turn.executed.filter((e) => e.tool === 'createEvent' && e.ok).length;
      // 0건이면 성공이 아니다 — 제목까지 "완료" 로 두면 실패가 성공처럼 읽힌다.
      Alert.alert(
        createdCount > 0 ? '가져오기 완료' : '가져온 일정이 없어요',
        createdCount > 0
          ? `${createdCount}개 일정을 추가했어요.\n\n${turn.text}`
          : (turn.text || '사진에서 일정을 찾지 못했어요. 다른 사진으로 다시 시도해 보세요.'),
      );

      // 캘린더 즉시 갱신 — 현재 보이는 month range 다시 fetch.
      // (eventStore 가 명시 range 받으니 단순 호출 후 다음 진입 시 자동 동기화.)
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        await refetchEvents({ start: monthStart, end: monthEnd }, { force: true });
      } catch { /* non-fatal */ }
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '캘린더 가져오기 실패');
    } finally {
      setBusy(false);
    }
  }, [busy, refetchEvents]);

  // v1.2.9 — 닫힌 상태면 카드 자체 미렌더.
  if (dismissed) return null;

  // v1.2.9 — Pressable nested 의 propagation 이 RN 에서 안 먹히는 회귀로
  // outer wrapper 를 View 로 바꾸고 main 영역만 Pressable. X 버튼은 별도
  // Pressable 로 zIndex 가장 위에.
  return (
    <View style={styles.card}>
      <Pressable
        onPress={handlePick}
        style={styles.mainArea}
        accessibilityRole="button"
        accessibilityLabel="다른 캘린더 사진으로 일정 가져오기"
      >
        <View style={styles.icon}>
          {busy ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Ionicons name="camera-outline" size={20} color={colors.textInverse} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>
            {busy ? '일정 분석 중…' : '다른 캘린더 사진으로 가져오기'}
          </Text>
          <Text style={styles.sub}>
            {busy ? 'AI 가 사진을 읽고 있어요' : '월간 스크린샷 1장이면 끝'}
          </Text>
        </View>
      </Pressable>
      {!busy && (
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="카드 닫기"
        >
          <Ionicons name="close" size={20} color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      flexDirection:  'row',
      alignItems:     'center',
      paddingRight:   spacing[2],
      marginHorizontal: spacing[4],
      marginVertical: spacing[1],
      borderRadius:   radius.lg,
      borderWidth:    1,
      borderColor:    colors.border,
      backgroundColor: colors.surface,
    },
    mainArea: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      padding: spacing[3],
    },
    icon: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1 },
    title: { ...textStyles.body, color: colors.textPrimary, fontWeight: '600' },
    sub:   { ...textStyles.bodySm, color: colors.textTertiary, marginTop: 2 },
    closeButton: {
      width: 32, height: 32,
      alignItems: 'center', justifyContent: 'center',
      marginRight: spacing[1],
    },
  });
}
