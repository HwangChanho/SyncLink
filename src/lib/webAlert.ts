/**
 * webAlert — cross-platform alert helper.
 *
 * React Native's `Alert.alert` works on web but shows a native-feeling dialog
 * on iOS/Android via the OS alert system. On web it falls back to the browser's
 * built-in `window.alert` which blocks the event loop and has inconsistent styling.
 *
 * This module re-exports Alert.alert as-is for native, and on web uses
 * `window.alert` / `window.confirm` with a consistent API so that error messages
 * always surface to the user regardless of platform.
 *
 * Usage (drop-in replacement for Alert.alert):
 *   import { showAlert } from '@/lib/webAlert';
 *   showAlert('오류', '저장에 실패했습니다.');
 */

import { Alert, Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A button entry matching React Native's AlertButton shape (subset). */
export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Show a cross-platform alert dialog.
 *
 * On native: delegates to `Alert.alert` (OS dialog).
 * On web:
 *  - 0 or 1 buttons → `window.alert(message)` then calls onPress if provided.
 *  - 2 buttons where one is 'cancel' → `window.confirm(message)`:
 *      OK  → calls the non-cancel button's onPress.
 *      Cancel → calls the cancel button's onPress.
 *  - 3+ buttons → falls back to `Alert.alert` (RN handles it via window.alert).
 *
 * @param title   - Dialog title text
 * @param message - Body message text (optional)
 * @param buttons - Action buttons (optional, default: single OK button)
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
): void {
  if (Platform.OS !== 'web') {
    // Native — use the standard React Native Alert API
    Alert.alert(title, message, buttons);
    return;
  }

  // Web path
  const displayText = message ? `${title}\n\n${message}` : title;
  const btns = buttons ?? [{ text: 'OK' }];

  if (btns.length <= 1) {
    // Simple acknowledgment dialog
    window.alert(displayText);
    btns[0]?.onPress?.();
    return;
  }

  if (btns.length === 2) {
    // Two-button pattern: find cancel vs. confirm
    const cancelBtn  = btns.find(b => b.style === 'cancel');
    const confirmBtn = btns.find(b => b.style !== 'cancel');

    const confirmed = window.confirm(displayText);
    if (confirmed) {
      confirmBtn?.onPress?.();
    } else {
      cancelBtn?.onPress?.();
    }
    return;
  }

  // 3+ buttons — fall back to RN Alert (renders as window.alert on web)
  Alert.alert(title, message, buttons);
}
