/**
 * Space chat — v1.2.0 메신저 화면.
 *
 * 같은 Space 멤버 끼리 텍스트 + 이미지 메시지를 실시간으로 주고받는다.
 * Realtime channel 하나 (space-messages:{space_id}) 로 INSERT/DELETE 이벤트
 * 받아 inverted FlatList 에 즉시 반영.
 *
 * 이미지 첨부: ImagePicker → 압축(1024px JPEG 0.8) → space-images bucket → DB row.
 * 메시지 삭제: 자기 메시지 long-press → 삭제 confirm.
 *
 * 진입: Space 상세 화면 헤더의 "채팅" 버튼 → router.push(`/space/{id}/chat`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, Image,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { useAuthStore } from '@/stores/authStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  listMessages, sendTextMessage, sendImageMessage, deleteMessage,
  subscribeToSpace, type SpaceMessage,
} from '@/services/spaceMessageService';

export default function SpaceChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const styles = makeStyles(colors);
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── 초기 hydrate ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    listMessages(id).then((rows) => {
      if (!cancelled) {
        setMessages(rows);
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        Alert.alert('오류', err?.message ?? '메시지 로드 실패');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  // ── Realtime 구독 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeToSpace(
      id,
      (msg) => {
        // 본인이 직접 INSERT 한 메시지는 sendText 가 이미 state 에 반영했으므로
        // dedupe.
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
      },
      (deletedId) => {
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
      },
    );
    return unsubscribe;
  }, [id]);

  // ── 텍스트 전송 ────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!id || !composer.trim() || sending) return;
    setSending(true);
    const body = composer;
    setComposer('');
    try {
      const msg = await sendTextMessage(id, body);
      // 본인 메시지는 Realtime 이벤트가 도착하기 전에 미리 반영 → 부드러운 UX.
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
    } catch (err) {
      Alert.alert('전송 실패', err instanceof Error ? err.message : '알 수 없는 오류');
      setComposer(body);
    } finally {
      setSending(false);
    }
  }, [id, composer, sending]);

  // ── 이미지 전송 ────────────────────────────────────────────────────────
  const handlePickImage = useCallback(async () => {
    if (!id || sending) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    setSending(true);
    try {
      const msg = await sendImageMessage(id, result.assets[0].uri);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
    } catch (err) {
      Alert.alert('업로드 실패', err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setSending(false);
    }
  }, [id, sending]);

  // ── 메시지 삭제 ────────────────────────────────────────────────────────
  const handleLongPress = useCallback((msg: SpaceMessage) => {
    if (msg.senderId !== myId) return;
    Alert.alert(
      '메시지 삭제',
      '이 메시지를 삭제하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive', onPress: async () => {
            try {
              await deleteMessage(msg.id);
              setMessages((prev) => prev.filter((m) => m.id !== msg.id));
            } catch (err) {
              Alert.alert('삭제 실패', err instanceof Error ? err.message : '알 수 없는 오류');
            }
          },
        },
      ],
    );
  }, [myId]);

  // ── Render ──────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: SpaceMessage }) => {
    const mine = item.senderId === myId;
    return (
      <Pressable
        onLongPress={() => handleLongPress(item)}
        style={[styles.row, mine ? styles.rowMine : styles.rowOther]}
      >
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {item.body && (
            <Text style={[styles.bodyText, mine ? styles.bodyMine : styles.bodyOther]}>
              {item.body}
            </Text>
          )}
          {item.imageUrl && (
            <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" />
          )}
        </View>
        <Text style={styles.time}>
          {item.createdAt.toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Pressable>
    );
  }, [myId, handleLongPress, styles]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>채팅</Text>
        <View style={styles.back} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={56}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.listContent}
          />
        )}

        <View style={styles.composer}>
          <Pressable
            onPress={handlePickImage}
            disabled={sending}
            style={styles.iconBtn}
            accessibilityLabel="사진 첨부"
          >
            <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
          </Pressable>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder="메시지 입력…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={styles.input}
          />
          <Pressable
            onPress={handleSend}
            disabled={!composer.trim() || sending}
            style={[
              styles.sendBtn,
              (!composer.trim() || sending) && { opacity: 0.4 },
            ]}
          >
            <Ionicons name="send" size={20} color={colors.textInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { ...textStyles.h3, color: colors.textPrimary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    listContent: { padding: spacing[3], gap: spacing[2] },
    row: { gap: 2, maxWidth: '85%' },
    rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    rowOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
    bubble: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.lg,
    },
    bubbleMine: { backgroundColor: colors.primary },
    bubbleOther: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    bodyText: { ...textStyles.body },
    bodyMine: { color: colors.textInverse },
    bodyOther: { color: colors.textPrimary },
    image: {
      width: 200,
      height: 200,
      borderRadius: radius.md,
      marginTop: spacing[1],
    },
    time: { ...textStyles.caption, color: colors.textTertiary },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing[2],
      paddingHorizontal: spacing[2],
      paddingTop: spacing[2],
      // home indicator 영역 + 약간 여유. SafeAreaView edges='bottom' 이 이미
      // safe area inset 만큼 padding 주지만, 위쪽 추가 여유로 입력란이 눌릴
      // 때 더 자연스러움.
      paddingBottom: spacing[3],
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    iconBtn: { padding: spacing[2] },
    input: {
      flex: 1,
      maxHeight: 100,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.backgroundAlt,
      color: colors.textPrimary,
      fontSize: 15,
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
