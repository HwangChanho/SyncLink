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

import { useCallback, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { sendAssistantTurn } from '@/services/assistantChatService';
import { useEventStore } from '@/stores/eventStore';

export function ImportCalendarCard() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);
  const refetchEvents = useEventStore((s) => s.fetchEvents);

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

      const turn = await sendAssistantTurn({
        text:
          '첨부한 캘린더 스크린샷의 모든 일정을 SyncLink 에 등록해줘. ' +
          '각 일정의 날짜/시간/제목을 정확히 추출해서 createEvent 도구로 순서대로 호출. ' +
          '시간이 명시되지 않은 일정은 allDay 로 처리.',
        image: {
          base64,
          mediaType: 'image/jpeg',
        },
        history: [],
      });

      if (turn.kind === 'error') {
        Alert.alert('가져오기 실패', turn.error ?? '알 수 없는 오류');
        return;
      }

      // turn.executed 가 있으면 createEvent 호출 횟수 확인.
      const createdCount = turn.executed?.filter((e: any) => e.name === 'createEvent').length ?? 0;
      Alert.alert(
        '가져오기 완료',
        createdCount > 0
          ? `${createdCount}개 일정을 추가했어요.\n\nAI: ${turn.reply ?? ''}`
          : (turn.reply ?? '인식된 일정이 없어요. 다른 사진으로 다시 시도해 보세요.'),
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

  return (
    <Pressable
      onPress={handlePick}
      style={styles.card}
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
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      flexDirection:  'row',
      alignItems:     'center',
      gap:            spacing[3],
      padding:        spacing[3],
      marginHorizontal: spacing[4],
      marginVertical: spacing[1],
      borderRadius:   radius.lg,
      borderWidth:    1,
      borderColor:    colors.border,
      backgroundColor: colors.surface,
    },
    icon: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1 },
    title: { ...textStyles.body, color: colors.textPrimary, fontWeight: '600' },
    sub:   { ...textStyles.bodySm, color: colors.textTertiary, marginTop: 2 },
  });
}
