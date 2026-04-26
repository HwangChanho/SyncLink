/**
 * ContactPickerModal — pick OS contacts to invite to a Space.
 *
 * Flow:
 *   1. Open the modal → request contacts permission (cached).
 *   2. Show search-filtered list of contacts with phone/email channel.
 *   3. User taps contacts → builds an invite message including the
 *      Space name + invite code + deep link.
 *   4. Hands off to the OS share sheet (native) or `mailto:` /
 *      clipboard (web fallback) so the user can route the invite to
 *      KakaoTalk / Slack / SMS / email — whatever fits the contact.
 *
 * The modal is intentionally "list + share", not "list + auto-add as
 * member". Each invite has to be redeemed by the recipient via the
 * existing /space/join flow — we don't synthesise members on someone
 * else's behalf.
 *
 * Sprint 20.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { showAlert } from '@/lib/webAlert';
import {
  buildInviteMessage,
  getContacts,
  searchContacts,
  requestContactsPermission,
  type ContactRow,
  type ContactPermissionResult,
} from '@/services/contactService';

interface ContactPickerModalProps {
  visible:    boolean;
  spaceName:  string;
  inviteCode: string;
  onClose:    () => void;
}

export function ContactPickerModal({ visible, spaceName, inviteCode, onClose }: ContactPickerModalProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [perm,         setPerm]         = useState<ContactPermissionResult | null>(null);
  const [contacts,     setContacts]     = useState<ContactRow[] | null>(null);
  const [query,        setQuery]        = useState('');
  const [busyId,       setBusyId]       = useState<string | null>(null);

  // Lazy-load contacts only after the modal is opened to avoid asking
  // for permission on app startup.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const p = await requestContactsPermission();
      if (cancelled) return;
      setPerm(p);
      if (p === 'granted') {
        const list = await getContacts();
        if (!cancelled) setContacts(list);
      } else {
        setContacts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  /** Reset search field when modal closes so reopen feels fresh. */
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(
    () => (contacts ? searchContacts(contacts, query) : []),
    [contacts, query],
  );

  const handleInvite = async (c: ContactRow) => {
    const message = buildInviteMessage(spaceName, inviteCode, c.name);
    setBusyId(c.id);
    try {
      if (Platform.OS === 'web') {
        // Try Web Share, fall back to clipboard.
        const nav = (globalThis as typeof globalThis & {
          navigator?: { share?: (d: { text: string }) => Promise<void>; clipboard?: { writeText: (s: string) => Promise<void> } };
        }).navigator;
        if (nav?.share) {
          try { await nav.share({ text: message }); } catch { /* cancelled */ }
        } else if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(message);
          showAlert('복사됨', `${c.name}님에게 보낼 초대 메시지가 클립보드에 복사되었습니다.`);
        } else {
          showAlert('초대 메시지', message);
        }
      } else {
        await Share.share({ message, title: `${spaceName} 초대` });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.safe, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>
              {t('common.close')}
            </Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>연락처에서 초대</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Permission / loading / empty states */}
        {perm === null && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {perm === 'unsupported' && (
          <View style={styles.center}>
            <Text style={styles.helpText}>이 브라우저는 연락처 접근을 지원하지 않습니다. 초대 코드를 직접 공유해 주세요.</Text>
          </View>
        )}

        {(perm === 'denied' || perm === 'restricted') && (
          <View style={styles.center}>
            <Ionicons name="lock-closed" size={32} color={colors.textTertiary} />
            <Text style={styles.helpText}>
              연락처 접근이 차단되어 있습니다.{'\n'}
              설정 → SyncLink → 연락처 → 허용으로 변경하면 친구를 검색해 초대할 수 있어요.
            </Text>
          </View>
        )}

        {perm === 'granted' && contacts === null && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {perm === 'granted' && contacts !== null && (
          <>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="이름, 전화번호, 이메일로 검색"
                placeholderTextColor={colors.textPlaceholder}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            {filtered.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.helpText}>
                  {contacts.length === 0
                    ? '연락처에 전화번호나 이메일이 있는 항목이 없어요.'
                    : '검색 결과가 없습니다.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: spacing[8] }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => { void handleInvite(item); }}
                    activeOpacity={0.7}
                    disabled={busyId !== null}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarInitial}>{item.initial}</Text>
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowChannel} numberOfLines={1}>
                        {item.phone ?? item.email}
                      </Text>
                    </View>
                    {busyId === item.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="paper-plane-outline" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      height: 52,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    headerAction: {
      ...textStyles.labelLg,
      fontWeight: '600',
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing[6],
      gap: spacing[3],
    },
    helpText: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      marginHorizontal: spacing[4],
      marginVertical: spacing[3],
      height: componentHeight.inputField,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
    },
    searchInput: {
      flex: 1,
      ...textStyles.body,
      color: colors.textPrimary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: {
      ...textStyles.labelLg,
      color: colors.primary,
      fontWeight: '700',
    },
    rowInfo: { flex: 1, gap: 2 },
    rowName: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    rowChannel: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: spacing[4] + 36 + spacing[3],
    },
  });
}
