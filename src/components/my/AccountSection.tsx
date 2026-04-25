/**
 * Account section of the My tab — sign-out and account-deletion menu items.
 *
 * Both actions are destructive in different ways:
 *  - Sign-out: reversible (just log back in)
 *  - Delete account: irreversible, drops the user row + cascades
 *
 * The parent owns the actual handlers (they need to mutate auth state +
 * navigate); this component only renders the rows and surfaces the
 * "logging out" spinner state.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx.
 */

import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { makeMenuStyles } from './menuStyles';

interface AccountSectionProps {
  /** Whether a sign-out request is currently in flight (shows spinner). */
  isLoggingOut: boolean;
  /** Triggered when the user taps "Logout". */
  onLogout: () => void;
  /** Triggered when the user taps "Delete account". */
  onDeleteAccount: () => void;
}

export function AccountSection({
  isLoggingOut,
  onLogout,
  onDeleteAccount,
}: AccountSectionProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const local = makeLocal(colors);

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>{t('common.user')}</Text>
      <View style={menu.menuCard}>
        <TouchableOpacity
          style={[menu.menuItem, local.logoutItem]}
          onPress={onLogout}
          disabled={isLoggingOut}
          activeOpacity={0.7}
        >
          {isLoggingOut ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Text style={local.logoutText}>{t('auth.logout.button')}</Text>
          )}
        </TouchableOpacity>

        <View style={menu.menuDivider} />

        <TouchableOpacity
          style={[menu.menuItem, local.logoutItem]}
          onPress={onDeleteAccount}
          activeOpacity={0.7}
        >
          <Text style={local.deleteAccountText}>{t('auth.delete_account.button')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Destructive-action styling: error-coloured logout, muted delete. */
function makeLocal(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    logoutItem: {
      justifyContent: 'center',
    },
    logoutText: {
      ...textStyles.labelLg,
      color: colors.error,
    },
    deleteAccountText: {
      ...textStyles.labelLg,
      color: colors.textTertiary,
    },
  });
}
