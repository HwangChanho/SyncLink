/**
 * AccountMergeSection — 통합 로그인 (재로그인 기반 단일계정 병합).
 *
 * 2026-06-05 재설계: 기존 LinkedAccountsSection(제공자별 OAuth identity 연동)을 대체.
 * 사용자가 A 로그인 상태에서 [통합 로그인]을 누르고 다른 내 계정 B 에 재로그인하면,
 * B 토큰을 ephemeral 클라이언트로 확보(전역 A 세션 무손상)해 서버에 A·B 두 토큰을
 * 넘긴다. 서버가 두 토큰을 검증한 뒤 단일 계정으로 병합한다.
 *
 * 플로우(단일 Modal, step 기반 — RN Modal 중첩 deadlock 회피):
 *   pick(방식 선택) → [native auth 시 Modal 닫고 진행] → confirm(미리보기/정책) → done(루프)
 *   이메일 방식은 Modal 안에서 폼 입력 → confirm.
 *
 * Calls: authService.loginSecondaryAccount / previewMergeByToken /
 *        executeMergeByToken / setActiveSession.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { spacing, radius } from '@/constants/spacing';
import * as authService from '@/services/authService';
import type {
  MergeLoginMethod,
  MergePreviewResult,
  MergeExecuteResult,
  MergeConflictPolicy,
  SecondarySession,
} from '@/services/authService';
import { useEventStore } from '@/stores/eventStore';
import { showAlert } from '@/lib/webAlert';
import { makeMenuStyles } from './menuStyles';

/** 통합 로그인에서 노출할 B 로그인 방식 버튼. */
const METHODS: { key: MergeLoginMethod; label: string; icon: keyof typeof Ionicons.glyphMap; iosOnly?: boolean }[] = [
  { key: 'google', label: 'Google 계정', icon: 'logo-google' },
  { key: 'apple',  label: 'Apple 계정',  icon: 'logo-apple', iosOnly: true },
  { key: 'kakao',  label: 'Kakao 계정',  icon: 'chatbubble-ellipses' },
  { key: 'email',  label: '이메일 계정',  icon: 'mail-outline' },
];

type Step = 'pick' | 'email' | 'confirm' | 'done';

export function AccountMergeSection() {
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const styles = makeStyles(colors);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);

  // 이메일 방식 입력값.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // B 로그인 결과 + 미리보기 + 충돌 정책 + 마지막 실행 결과.
  const [bSession, setBSession] = useState<SecondarySession | null>(null);
  const [preview, setPreview] = useState<MergePreviewResult | null>(null);
  const [policy, setPolicy] = useState<MergeConflictPolicy>('keep_both');
  const [lastResult, setLastResult] = useState<MergeExecuteResult | null>(null);

  /** 플로우를 처음(방식 선택)부터 연다. */
  const open = useCallback(() => {
    setStep('pick');
    setEmail('');
    setPassword('');
    setBSession(null);
    setPreview(null);
    setPolicy('keep_both');
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    if (busy) return; // 진행 중에는 닫기 차단(중간 상태 방지).
    setVisible(false);
  }, [busy]);

  /**
   * B 로그인 → 미리보기 → confirm 단계로 이동.
   * native(Google/Apple/Kakao)는 native auth UI 와 RN Modal 겹침을 피해 Modal 을
   * 잠시 닫고 진행한 뒤, 성공 시 confirm 단계로 다시 연다.
   */
  const startMerge = useCallback(async (method: MergeLoginMethod, creds?: { email: string; password: string }) => {
    const isNative = method !== 'email';
    if (isNative) setVisible(false);
    setBusy(true);
    // 어느 단계에서 실패했는지 사용자에게 명확히 알리기 위해 phase 를 추적한다.
    let phase: 'login' | 'preview' = 'login';
    try {
      const b = await authService.loginSecondaryAccount(method, creds);
      phase = 'preview';
      const pv = await authService.previewMergeByToken(b.accessToken);
      setBSession(b);
      setPreview(pv);
      setPolicy('keep_both');
      setStep('confirm');
      setVisible(true);
    } catch (err) {
      const e = err as Error & { sameAccount?: boolean };
      // 'cancelled' 는 사용자가 로그인 창을 닫은 것 → 조용히 이전 단계로.
      if (e.message !== 'cancelled') {
        const msg = e.message ?? '';
        const isNetwork = /network request failed|network error|fetch failed|timeout/i.test(msg);
        if (e.sameAccount) {
          showAlert('이미 같은 계정', '현재 계정과 동일한 계정이라 통합할 수 없어요.');
        } else if (isNetwork) {
          // "Network request failed" 를 그대로 노출하지 않고 단계 + 재시도 안내로.
          showAlert(
            '네트워크 오류',
            `${phase === 'login' ? '계정 로그인' : '통합 정보 조회'} 중 연결이 끊겼어요. 인터넷 연결을 확인하고 다시 시도해주세요.`,
          );
        } else {
          showAlert(
            phase === 'login' ? '통합 로그인 실패' : '통합 정보 조회 실패',
            msg || '잠시 후 다시 시도해주세요.',
          );
        }
      }
      setStep(method === 'email' ? 'email' : 'pick');
      setVisible(true);
    } finally {
      setBusy(false);
    }
  }, []);

  /** 확인 단계 → 실제 병합 실행 + 세션/캐시 정리 → done. */
  const confirmMerge = useCallback(async () => {
    if (!bSession || !preview) return;
    setBusy(true);
    try {
      const res = await authService.executeMergeByToken(bSession.accessToken, policy);

      // 캘린더/홈 일정 캐시를 비워 다음 화면 포커스에서 병합 데이터로 재조회.
      useEventStore.setState({ eventsByDate: {} });

      // primary 가 현재 세션이 아니면(=A 가 흡수/삭제됨) primary(B) 세션으로 전환.
      // setActiveSession → onAuthStateChange(SIGNED_IN) → 유저 재하이드레이션.
      if (!res.primaryIsCurrent) {
        await authService.setActiveSession(bSession.accessToken, bSession.refreshToken);
      }

      setLastResult(res);
      setStep('done');
    } catch (err) {
      showAlert('통합 실패', (err as Error).message || '잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }, [bSession, preview, policy]);

  // ─── 렌더 ────────────────────────────────────────────────────────────────────

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>통합 로그인</Text>
      <View style={menu.menuCard}>
        <TouchableOpacity style={menu.menuItem} onPress={open} accessibilityRole="button">
          <View style={styles.rowLeading}>
            <Ionicons name="git-merge-outline" size={20} color={colors.primary} />
            <Text style={[menu.menuItemText, styles.shrink]}>다른 내 계정과 통합</Text>
          </View>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.helper}>
        다른 방법(Google·Apple·Kakao·이메일)으로 만든 내 계정에 로그인하면 두 계정의 데이터를
        하나로 합쳐, 이후 어느 방법으로 로그인해도 같은 데이터를 볼 수 있어요.
      </Text>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            {step === 'pick' && renderPick()}
            {step === 'email' && renderEmail()}
            {step === 'confirm' && renderConfirm()}
            {step === 'done' && renderDone()}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  // ── step: 방식 선택 ──
  function renderPick() {
    return (
      <>
        <Text style={styles.title}>통합할 계정에 로그인</Text>
        <Text style={styles.subtitle}>합칠 다른 내 계정의 로그인 방법을 선택하세요.</Text>
        <View style={styles.methodList}>
          {METHODS.filter((m) => !(m.iosOnly && Platform.OS !== 'ios')).map((m) => (
            <TouchableOpacity
              key={m.key}
              style={styles.methodBtn}
              onPress={() => (m.key === 'email' ? setStep('email') : void startMerge(m.key))}
              disabled={busy}
              accessibilityRole="button"
            >
              <Ionicons name={m.icon} size={20} color={colors.textSecondary} />
              <Text style={styles.methodLabel}>{m.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
        {busy && <ActivityIndicator style={styles.busy} color={colors.primary} />}
      </>
    );
  }

  // ── step: 이메일 폼 ──
  function renderEmail() {
    const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;
    return (
      <>
        <Text style={styles.title}>이메일 계정으로 로그인</Text>
        <Text style={styles.subtitle}>통합할 다른 내 계정의 이메일/비밀번호를 입력하세요.</Text>
        <TextInput
          style={styles.input}
          placeholder="이메일"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          // 통합 로그인 흐름에서 iOS "암호 저장?" 시스템 다이얼로그가 시트와 겹쳐
          // 멈추는 것을 막는다(B 계정 비번을 키체인에 저장 제안할 이유도 없음).
          textContentType="oneTimeCode"
          autoComplete="off"
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />
        <Pressable
          style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
          onPress={() => void startMerge('email', { email, password })}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>로그인</Text>
          )}
        </Pressable>
        <Pressable style={styles.textBtn} onPress={() => !busy && setStep('pick')}>
          <Text style={styles.textBtnLabel}>뒤로</Text>
        </Pressable>
      </>
    );
  }

  // ── step: 미리보기/확인 ──
  function renderConfirm() {
    if (!preview) return null;
    const hasData =
      preview.secondary_events > 0 || preview.secondary_todos > 0 || preview.secondary_cats > 0;
    const bothPro = preview.primary_plan === 'pro' && preview.secondary_plan === 'pro';
    const absorbCurrent = !preview.primaryIsCurrent; // 현재 계정(A)이 흡수됨

    return (
      <>
        <Text style={styles.title}>통합 확인</Text>
        <Text style={styles.subtitle}>
          통합할 계정: <Text style={styles.bold}>{preview.secondary_email || '(이메일 없음)'}</Text>
        </Text>

        {!hasData ? (
          <Text style={styles.note}>이 계정에는 옮길 데이터가 없어요. 그래도 로그인 방법은 통합돼요.</Text>
        ) : (
          <View style={styles.statRow}>
            <Stat label="일정" value={preview.secondary_events} colors={colors} />
            <Stat label="할일" value={preview.secondary_todos} colors={colors} />
            <Stat label="카테고리" value={preview.secondary_cats} colors={colors} />
          </View>
        )}

        {/* 충돌(겹치는 일정) 정책 선택 */}
        {preview.conflicts > 0 && (
          <View style={styles.policyBox}>
            <Text style={styles.note}>
              같은 시간·제목의 일정이 {preview.conflicts}개 겹쳐요. 어떻게 할까요?
            </Text>
            <View style={styles.policyRow}>
              <PolicyChip
                active={policy === 'keep_both'}
                label="둘 다 유지"
                onPress={() => setPolicy('keep_both')}
                colors={colors}
              />
              <PolicyChip
                active={policy === 'dedupe'}
                label="중복 제거"
                onPress={() => setPolicy('dedupe')}
                colors={colors}
              />
            </View>
          </View>
        )}

        {absorbCurrent && (
          <Text style={styles.warn}>
            현재 계정 대신 {preview.primary_plan === 'pro' ? 'Pro ' : ''}계정({preview.primary_email})이
            유지돼요. 통합 후 그 계정으로 전환됩니다.
          </Text>
        )}
        {bothPro && (
          <Text style={styles.warn}>두 계정 모두 Pro 예요. 스토어에서 중복 구독이 없는지 확인해주세요.</Text>
        )}

        <Pressable style={styles.primaryBtn} onPress={() => void confirmMerge()} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>통합하기</Text>
          )}
        </Pressable>
        <Pressable style={styles.textBtn} onPress={() => !busy && setStep('pick')}>
          <Text style={styles.textBtnLabel}>취소</Text>
        </Pressable>
      </>
    );
  }

  // ── step: 완료 (루프) ──
  function renderDone() {
    const moved = lastResult?.moved_events ?? 0;
    const dedup = lastResult?.deduped ?? 0;
    return (
      <>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={28} color={colors.textInverse} />
        </View>
        <Text style={styles.title}>통합 완료</Text>
        <Text style={styles.subtitle}>
          계정이 하나로 합쳐졌어요{moved > 0 ? ` · 일정 ${moved}개 이전` : ''}
          {dedup > 0 ? ` · 중복 ${dedup}개 정리` : ''}.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={open}>
          <Text style={styles.primaryBtnText}>다른 계정 더 통합</Text>
        </Pressable>
        <Pressable style={styles.textBtn} onPress={() => setVisible(false)}>
          <Text style={styles.textBtnLabel}>완료</Text>
        </Pressable>
      </>
    );
  }
}

// ─── 작은 표시용 컴포넌트 ────────────────────────────────────────────────────────

function Stat({ label, value, colors }: { label: string; value: number; colors: ColorTokens }) {
  const s = makeStyles(colors);
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function PolicyChip({
  active,
  label,
  onPress,
  colors,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  colors: ColorTokens;
}) {
  const s = makeStyles(colors);
  return (
    <TouchableOpacity style={[s.chip, active && s.chipActive]} onPress={onPress} accessibilityRole="button">
      <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    rowLeading: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    shrink: { flexShrink: 1 },
    helper: {
      ...textStyles.caption,
      color: colors.textTertiary,
      paddingHorizontal: spacing[1],
      lineHeight: 17,
    },

    // Bottom sheet
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing[6],
      paddingTop: spacing[3],
      paddingBottom: spacing[8],
      gap: spacing[3],
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[2],
    },
    title: { ...textStyles.h3, color: colors.textPrimary },
    subtitle: { ...textStyles.body, color: colors.textSecondary },
    bold: { fontWeight: '700', color: colors.textPrimary },
    note: { ...textStyles.caption, color: colors.textSecondary, lineHeight: 18 },
    warn: { ...textStyles.caption, color: colors.warning, lineHeight: 18 },
    busy: { marginTop: spacing[2] },

    // Method list
    methodList: { gap: spacing[2], marginTop: spacing[1] },
    methodBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      paddingVertical: spacing[4],
      paddingHorizontal: spacing[4],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    methodLabel: { ...textStyles.labelLg, color: colors.textPrimary, flex: 1 },

    // Email inputs
    input: {
      ...textStyles.body,
      color: colors.textPrimary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      backgroundColor: colors.surface,
    },

    // Buttons
    primaryBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing[4],
      marginTop: spacing[2],
    },
    primaryBtnText: { ...textStyles.labelLg, color: colors.textInverse },
    btnDisabled: { opacity: 0.5 },
    textBtn: { alignItems: 'center', paddingVertical: spacing[2] },
    textBtnLabel: { ...textStyles.body, color: colors.textSecondary },

    // Stats
    statRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
    stat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statValue: { ...textStyles.h3, color: colors.primary },
    statLabel: { ...textStyles.caption, color: colors.textSecondary },

    // Policy chips
    policyBox: { gap: spacing[2], marginTop: spacing[1] },
    policyRow: { flexDirection: 'row', gap: spacing[2] },
    chip: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipLabel: { ...textStyles.label, color: colors.textSecondary },
    chipLabelActive: { color: colors.textInverse, fontWeight: '700' },

    // Success
    successIcon: {
      alignSelf: 'center',
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
