/**
 * InviteCodeSection — Space 상세 화면의 초대 코드 영역 컴포넌트.
 *
 * 동작 규칙 (Sprint 28 LEAD 요청):
 *  1. 진입 시 코드 숨김 — "초대 코드 보기" 버튼만 노출.
 *  2. "보기" 클릭 = regenerateInviteCode() 호출 → 새 코드 생성 후 표시.
 *     (매 클릭마다 rotate — 보는 즉시 새 코드)
 *  3. 코드 표시 후 5분(300초) 타이머 → 자동 숨김.
 *     타이머 남은 시간 카운트다운 표시 ("4:59 후 사라짐").
 *  4. 코드 영역 표시 중에는 공유 버튼 및 플랫폼별 부가 액션도 함께 노출.
 *
 * Props:
 *  - spaceId      : string   — regenerateInviteCode에 넘길 Space UUID.
 *  - inviteCode   : string   — 현재 로드된 초대 코드 (초기값).
 *  - isOwner      : boolean  — 공개 여부와 무관하게 regenerate 권한 판단.
 *  - onCodeChange : (newCode: string) => void — 새 코드 생성 후 부모에게 전파.
 *  (공유 버튼 관련 핸들러는 부모에서 주입)
 *  - onShare      : () => void
 *  - onCopyLink   : (() => void) | undefined   — web 전용 (undefined이면 미노출)
 *  - onEmailInvite: (() => void) | undefined   — web 전용
 *  - onToggleQr   : (() => void) | undefined   — web 전용
 *  - isQrVisible  : boolean
 *  - qrUrl        : string
 *  - colors       : ReturnType<typeof useColors>
 *  - styles       : SpaceDetailStyles
 *  - t            : TFunction
 *  - isContactPickerAvailable: boolean — 연락처 버튼 노출 여부 (native only)
 *  - onOpenContactPicker: () => void
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { useColors } from '@/hooks/useColors';
import type { SpaceDetailStyles } from '@/components/space/spaceDetailStyles';
import * as spaceService from '@/services/spaceService';
import { showAlert } from '@/lib/webAlert';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** 코드를 표시한 후 자동 숨김까지의 시간 (초). */
const AUTO_HIDE_SECONDS = 300; // 5분

// ─── Props ────────────────────────────────────────────────────────────────────

interface InviteCodeSectionProps {
  /** Space UUID — regenerateInviteCode 호출에 사용. */
  spaceId: string;
  /** 부모가 보유한 현재 초대 코드. 재생성 시 onCodeChange로 갱신된다. */
  inviteCode: string;
  /** true이면 "보기" 버튼 클릭 시 regenerate 실행. false이면 비노출. */
  isOwner: boolean;
  /** 새 코드 생성 완료 시 부모 state를 갱신하기 위한 콜백. */
  onCodeChange: (newCode: string) => void;
  /** OS 공유 시트 / 클립보드 공유 핸들러. */
  onShare: () => void;
  /** Web 전용: 초대 링크 복사. undefined 시 버튼 미노출. */
  onCopyLink?: () => void;
  /** Web 전용: 이메일 초대. undefined 시 버튼 미노출. */
  onEmailInvite?: () => void;
  /** Web 전용: QR 코드 토글. undefined 시 버튼 미노출. */
  onToggleQr?: () => void;
  /** Web QR 패널 가시성 — 부모가 관리. */
  isQrVisible: boolean;
  /** QR 이미지 URL — qrserver.com 등. */
  qrUrl: string;
  /** 연락처 버튼 노출 여부 (native only). */
  isContactPickerAvailable: boolean;
  /** 연락처 버튼 클릭 핸들러. */
  onOpenContactPicker: () => void;
  /** 현재 테마 색상 토큰. */
  colors: ReturnType<typeof useColors>;
  /** 공유 스타일시트 (부모에서 makeSpaceDetailStyles로 생성). */
  styles: SpaceDetailStyles;
  /** 커플 스페이스 여부 (capacity_hint 노출 조건). */
  isCoupleSpace: boolean;
  /** 현재 멤버 수 (capacity_hint에 사용). */
  memberCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * 초대 코드 섹션 UI.
 *
 * 내부 상태:
 *  - isVisible : 코드 표시 여부 (진입 시 false)
 *  - countdown : 남은 초 (isVisible=true일 때 매초 감소)
 *  - isRegenerating : 재생성 중 로딩 표시
 */
export function InviteCodeSection({
  spaceId,
  inviteCode,
  isOwner,
  onCodeChange,
  onShare,
  onCopyLink,
  onEmailInvite,
  onToggleQr,
  isQrVisible,
  qrUrl,
  isContactPickerAvailable,
  onOpenContactPicker,
  colors,
  styles,
  isCoupleSpace,
  memberCount,
}: InviteCodeSectionProps) {
  const { t } = useTranslation();

  /** 코드가 화면에 표시 중인지 여부. */
  const [isVisible, setIsVisible] = useState(false);
  /** 카운트다운 남은 초 (AUTO_HIDE_SECONDS → 0). */
  const [countdown, setCountdown] = useState(AUTO_HIDE_SECONDS);
  /** 재생성 API 호출 중 로딩 상태. */
  const [isRegenerating, setIsRegenerating] = useState(false);

  // 카운트다운 타이머 ref — clearInterval 용.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 타이머를 정리(clear)하는 헬퍼.
   * isVisible=false 로 바뀔 때와 컴포넌트 언마운트 시 사용.
   */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * 코드를 숨기고 타이머를 초기화한다.
   * 타이머 만료 시 및 수동 숨김 시 호출.
   */
  const hideCode = useCallback(() => {
    clearTimer();
    setIsVisible(false);
    setCountdown(AUTO_HIDE_SECONDS);
  }, [clearTimer]);

  /**
   * 코드를 표시하고 5분 카운트다운 타이머를 시작한다.
   * 이미 타이머가 돌고 있다면 리셋 후 재시작.
   *
   * @param secondsOverride - 타이머 시작 값 (기본 AUTO_HIDE_SECONDS).
   */
  const showCode = useCallback((secondsOverride: number = AUTO_HIDE_SECONDS) => {
    clearTimer();
    setCountdown(secondsOverride);
    setIsVisible(true);

    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // 타이머 만료 → 코드 숨김
          clearTimer();
          setIsVisible(false);
          return AUTO_HIDE_SECONDS; // 카운트 리셋
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer]);

  // 언마운트 시 타이머 정리.
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  /**
   * "초대 코드 보기" 버튼 클릭 핸들러.
   *
   * isOwner인 경우: regenerateInviteCode() 호출 → 새 코드로 표시.
   * 비오너인 경우: 현재 코드 그대로 표시 (조회 전용).
   * → 기획 요청: "보기" = "재생성" (owner에 한해). 비오너는 현재 코드 표시.
   */
  const handleShow = useCallback(async () => {
    if (isRegenerating) return;

    if (!isOwner) {
      // 비오너: 재생성 없이 현재 코드 표시
      showCode();
      return;
    }

    // 오너: 재생성 후 표시
    setIsRegenerating(true);
    try {
      const newCode = await spaceService.regenerateInviteCode(spaceId);
      onCodeChange(newCode);
      showCode();
    } catch (err) {
      showAlert(
        t('common.error'),
        err instanceof Error ? err.message : t('space.regen_failed'),
      );
    } finally {
      setIsRegenerating(false);
    }
  }, [isOwner, isRegenerating, spaceId, onCodeChange, showCode, t]);

  // ─── 카운트다운 포맷 헬퍼 ─────────────────────────────────────────────────

  /**
   * 초(second)를 "M:SS" 형식 문자열로 변환.
   * 예) 299 → "4:59", 60 → "1:00", 5 → "0:05"
   */
  const formatCountdown = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View>
      {/* ── 숨김 상태: "초대 코드 보기" 버튼만 표시 ─────────────────────── */}
      {!isVisible && (
        <TouchableOpacity
          testID="space-invite-show"
          style={styles.showInviteButton}
          onPress={() => void handleShow()}
          disabled={isRegenerating}
          activeOpacity={0.7}
          accessibilityLabel={t('space.invite_show')}
        >
          {isRegenerating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="eye-outline" size={16} color={colors.primary} />
              <Text style={styles.showInviteButtonText}>
                {t('space.invite_show')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* ── 표시 상태: 코드 + 공유 버튼 + 카운트다운 ───────────────────── */}
      {isVisible && (
        <>
          {/* 코드 행 */}
          <View style={styles.inviteCodeRow} testID="space-invite-code">
            <Text style={styles.inviteCode}>{inviteCode}</Text>
            <View style={styles.inviteActions}>
              <TouchableOpacity
                style={styles.shareButton}
                onPress={onShare}
                activeOpacity={0.7}
              >
                <Text style={styles.shareButtonText}>{t('space.invite_share_button')}</Text>
              </TouchableOpacity>
              {isContactPickerAvailable && (
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={onOpenContactPicker}
                  activeOpacity={0.7}
                  accessibilityLabel={t('contact.title')}
                >
                  <Ionicons name="people" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Web 전용 초대 액션 (IDEA-014) */}
          {Platform.OS === 'web' && (onCopyLink || onEmailInvite || onToggleQr) && (
            <View style={styles.webInviteContainer}>
              {onCopyLink && (
                <TouchableOpacity
                  testID="space-invite-link"
                  style={[styles.webInviteButton, styles.webInviteButtonPrimary]}
                  onPress={onCopyLink}
                  activeOpacity={0.8}
                  accessibilityLabel={t('space.invite_link_copy')}
                >
                  <Ionicons name="link-outline" size={16} color={styles.webInviteButtonTextPrimary.color} />
                  <Text style={styles.webInviteButtonTextPrimary}>{t('space.invite_link_copy')}</Text>
                </TouchableOpacity>
              )}
              {onEmailInvite && (
                <TouchableOpacity
                  testID="space-invite-email"
                  style={styles.webInviteButton}
                  onPress={onEmailInvite}
                  activeOpacity={0.8}
                  accessibilityLabel={t('space.invite_email')}
                >
                  <Ionicons name="mail-outline" size={16} color={styles.webInviteButtonText.color} />
                  <Text style={styles.webInviteButtonText}>{t('space.invite_email')}</Text>
                </TouchableOpacity>
              )}
              {onToggleQr && (
                <TouchableOpacity
                  testID="space-invite-qr"
                  style={styles.webInviteButton}
                  onPress={onToggleQr}
                  activeOpacity={0.8}
                  accessibilityLabel={t('space.invite_qr')}
                >
                  <Ionicons name={isQrVisible ? 'qr-code' : 'qr-code-outline'} size={16} color={styles.webInviteButtonText.color} />
                  <Text style={styles.webInviteButtonText}>{t('space.invite_qr')}</Text>
                </TouchableOpacity>
              )}
              {isQrVisible && (
                <View style={styles.webQrWrapper}>
                  <Image
                    source={{ uri: qrUrl }}
                    style={{ width: 200, height: 200 }}
                    contentFit="contain"
                    accessibilityLabel="QR code for space invite"
                  />
                  <Text style={styles.webQrHint}>{qrUrl}</Text>
                </View>
              )}
            </View>
          )}

          {/* 카운트다운 힌트 + 숨기기 버튼 */}
          <View style={styles.inviteCodeTimerRow}>
            <Text style={styles.inviteCodeTimerText}>
              {t('space.invite_hide_in', { time: formatCountdown(countdown) })}
            </Text>
            <TouchableOpacity
              onPress={hideCode}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.inviteCodeHideText}>{t('space.invite_hide')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 커플 스페이스 정원 힌트 — 항상 표시 */}
      {isCoupleSpace && (
        <Text style={styles.capacityHint}>
          {t('space.capacity_hint', { current: memberCount })}
          {memberCount >= 2 ? t('space.capacity_full_suffix') : ''}
        </Text>
      )}
    </View>
  );
}
