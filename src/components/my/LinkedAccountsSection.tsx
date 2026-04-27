/**
 * Linked accounts section — multi-provider OAuth identity linking.
 *
 * TASK-002 / ADR-010 (Sprint 21).
 *
 * Lets the user attach additional sign-in methods (Google/Kakao/Apple) to
 * the same Supabase user, so future logins via any linked provider resolve
 * to the existing account (no duplicate user creation).
 *
 * Calls authService.linkProvider / getLinkedProviders / unlinkProvider.
 * Errors are surfaced via Alert; the row stays loading until the OAuth
 * round-trip resolves.
 */

import { useState, useEffect, useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { spacing, radius } from '@/constants/spacing';
import * as authService from '@/services/authService';
import { makeMenuStyles } from './menuStyles';

type Provider = 'google' | 'kakao' | 'apple';
const PROVIDERS: { key: Provider; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'google', label: 'Google', icon: 'logo-google' },
  { key: 'kakao',  label: 'Kakao',  icon: 'chatbubble-ellipses' },
  { key: 'apple',  label: 'Apple',  icon: 'logo-apple' },
];

export function LinkedAccountsSection() {
  const { t } = useTranslation();
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const local = makeLocal(colors);

  const [linked, setLinked] = useState<string[]>([]);
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const providers = await authService.getLinkedProviders();
      setLinked(providers);
      setBootError(null);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : '연결된 계정을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleToggle = useCallback(async (provider: Provider) => {
    if (loadingProvider !== null) return;
    const isLinked = linked.includes(provider);
    setLoadingProvider(provider);
    try {
      if (isLinked) {
        if (linked.length <= 1) {
          Alert.alert('해제 불가', '마지막 로그인 방법은 해제할 수 없습니다');
          return;
        }
        await authService.unlinkProvider(provider);
      } else {
        await authService.linkProvider(provider);
      }
      await refresh();
    } catch (err) {
      Alert.alert('실패', err instanceof Error ? err.message : '잠시 후 다시 시도해주세요');
    } finally {
      setLoadingProvider(null);
    }
  }, [linked, loadingProvider, refresh]);

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>{t('my.linked_accounts.title') /* fallback: "연결된 로그인" */}</Text>
      {bootError !== null && (
        <Text style={local.errorText}>{bootError}</Text>
      )}
      <View style={menu.menuCard}>
        {PROVIDERS.map((p, i) => {
          const isLinked = linked.includes(p.key);
          const isLoading = loadingProvider === p.key;
          return (
            <View key={p.key}>
              <TouchableOpacity
                style={menu.menuItem}
                onPress={() => void handleToggle(p.key)}
                disabled={loadingProvider !== null}
                accessibilityLabel={`${p.label} ${isLinked ? '연결 해제' : '연결'}`}
              >
                <View style={local.row}>
                  <Ionicons name={p.icon} size={20} color={colors.textSecondary} />
                  <Text style={[menu.menuItemText, local.rowText]}>{p.label}</Text>
                </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : isLinked ? (
                <View style={local.linkedBadge}>
                  <Text style={local.linkedBadgeText}>연결됨</Text>
                </View>
              ) : (
                <Text style={local.linkLabel}>연결</Text>
              )}
              </TouchableOpacity>
              {i < PROVIDERS.length - 1 && <View style={menu.menuDivider} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeLocal(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    errorText: {
      ...textStyles.caption,
      color: colors.error,
      marginTop: spacing[1],
      marginHorizontal: spacing[4],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    rowText: {
      flex: 1,
    },
    linkedBadge: {
      paddingHorizontal: spacing[2],
      paddingVertical:   spacing[1] / 2,
      backgroundColor:   'rgba(108,99,255,0.1)',
      borderRadius:      radius.sm,
    },
    linkedBadgeText: {
      ...textStyles.caption,
      color: colors.primary,
    },
    linkLabel: {
      ...textStyles.label,
      color: colors.primary,
    },
  });
}
