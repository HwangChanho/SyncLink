/**
 * SupportScreen — 앱 안에서 버그를 제보하거나 문의를 넣는 화면.
 *
 * 종전에는 "개발자에게 문의" 가 `mailto:` 를 열었다. 웹에서 브라우저가 막으면
 * 아무 일도 일어나지 않았고(사용자는 보낸 줄 안다), 메일 앱이 없는 기기엔 경로가
 * 아예 없었다. 이제 여기서 받아 서버에 저장하고 관리자 메일로 알린다.
 *
 * My 탭 → 서비스 정보 → "버그 제보 · 문의" 에서 진입.
 */

import { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { showAlert } from '@/lib/webAlert';
import { useAuthStore } from '@/stores/authStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import {
  submitSupport,
  SUPPORT_MSG_MAX,
  SUPPORT_MSG_MIN,
  type SupportKind,
} from '@/services/supportService';

export default function SupportScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const user = useAuthStore((s) => s.user);
  const plan = useSubscriptionStore((s) => s.plan);

  const [kind, setKind] = useState<SupportKind>('bug');
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = message.trim();
  const canSubmit = trimmed.length >= SUPPORT_MSG_MIN && !sending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      // 계정 정보는 서비스가 아니라 여기서 넘긴다 — 서비스는 스토어에 의존하지 않는다.
      await submitSupport(
        // exactOptionalPropertyTypes 라 undefined 를 넘길 수 없다 — 키를 통째로 뺀다.
        { kind, message: trimmed, ...(user ? {} : { replyEmail }) },
        { plan, pushEnabled: user?.push_enabled ? 'on' : 'off' },
      );

      // 🔴 RN 의 Alert 은 웹에서 완전한 no-op 다. 반드시 showAlert 을 쓸 것.
      // common.confirm 은 '최종 확인'(파괴적 동작 재확인용)이라 여기엔 맞지 않는다.
      showAlert(t('support.thanks_title'), t('support.thanks_body'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
      setMessage('');
      setReplyEmail('');
    } catch (e) {
      // 서비스가 i18n 키를 담아 던진다. 모르는 키면 일반 실패 문구로 떨어진다.
      const key = (e as Error).message;
      const msg = key.startsWith('support.') ? t(key) : t('support.error_failed');
      showAlert(t('support.error_title'), msg);
    } finally {
      setSending(false);
    }
  };

  const KINDS: { value: SupportKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'bug', label: t('support.kind_bug'), icon: 'bug-outline' },
    { value: 'inquiry', label: t('support.kind_inquiry'), icon: 'chatbubble-ellipses-outline' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('support.title')}</Text>
        <View style={styles.back} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>{t('support.intro')}</Text>

          {/* 종류 선택 */}
          <View style={styles.kindRow}>
            {KINDS.map((k) => {
              const active = kind === k.value;
              return (
                <Pressable
                  key={k.value}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => setKind(k.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={k.icon}
                    size={18}
                    color={active ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.kindText, active && styles.kindTextActive]}>{k.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 본문 */}
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder={
              kind === 'bug' ? t('support.placeholder_bug') : t('support.placeholder_inquiry')
            }
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            maxLength={SUPPORT_MSG_MAX}
            editable={!sending}
          />
          <Text style={styles.counter}>
            {trimmed.length} / {SUPPORT_MSG_MAX}
          </Text>

          {/* 비로그인 사용자만 회신 주소를 묻는다 — 로그인 상태면 계정 메일을 쓴다. */}
          {!user && (
            <>
              <Text style={styles.label}>{t('support.reply_email_label')}</Text>
              <TextInput
                style={styles.emailInput}
                value={replyEmail}
                onChangeText={setReplyEmail}
                placeholder={t('support.reply_email_placeholder')}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!sending}
              />
            </>
          )}

          <Text style={styles.note}>{t('support.diagnostics_note')}</Text>

          <Pressable
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {sending
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitText}>{t('support.submit')}</Text>}
          </Pressable>
        </ScrollView>
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
    },
    back: { width: 32, alignItems: 'flex-start' },
    headerTitle: { ...textStyles.labelLg, color: colors.textPrimary },
    content: { padding: spacing[4], paddingBottom: spacing[6] * 2 },
    intro: { ...textStyles.body, color: colors.textSecondary, marginBottom: spacing[4] },
    kindRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
    kindChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    kindChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
    kindText: { ...textStyles.body, color: colors.textSecondary },
    kindTextActive: { color: colors.primary, fontWeight: '600' },
    input: {
      minHeight: 160,
      padding: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      ...textStyles.body,
    },
    counter: {
      ...textStyles.caption,
      color: colors.textTertiary,
      textAlign: 'right',
      marginTop: 4,
    },
    label: { ...textStyles.bodySm, color: colors.textPrimary, marginTop: spacing[4], marginBottom: 6 },
    emailInput: {
      padding: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      ...textStyles.body,
    },
    note: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[4],
      lineHeight: 18,
    },
    submit: {
      marginTop: spacing[4],
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
    },
    submitDisabled: { opacity: 0.45 },
    submitText: { ...textStyles.body, color: '#fff', fontWeight: '600' },
  });
}
