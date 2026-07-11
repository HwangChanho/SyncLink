/**
 * Notification service — adapter over Expo Notifications.
 *
 * Handles:
 *  - Push token registration (TASK-303)
 *  - Local notification scheduling
 *  - Remote notification handling (from Supabase Edge Functions)
 *  - Per-type notification settings
 *
 * Notification types:
 *  - event_reminder: X minutes before an event starts
 *  - partner_change: when a space member modifies a shared event
 *  - space_invite: when a user receives a space invitation
 *  - smart_reminder: AI-generated context-aware reminder (Pro only)
 *
 * Platform notes:
 *  - Physical device required for push tokens (simulator/emulator returns null)
 *  - Web is not supported for push notifications (skipped gracefully)
 */

import { Platform } from 'react-native';
import * as ExpoNotifications from 'expo-notifications';
import type { NotificationSettings } from '@/types';
import { supabase } from '@/lib/supabase';

// ─── Token types ──────────────────────────────────────────────────────────────

/** Expo push token and its platform info. */
export interface PushTokenInfo {
  token: string;
  platform: 'ios' | 'android';
}

// ─── Local notification ───────────────────────────────────────────────────────

/** A locally scheduled notification. */
export interface LocalNotification {
  id: string;
  title: string;
  body: string;
  scheduledFor: Date;
  data?: Record<string, unknown>;
}

// ─── Notification behavior ────────────────────────────────────────────────────

// Configure how notifications appear when the app is in the foreground.
// Skipped on web because expo-notifications is stubbed out in the web
// bundle (see metro.config.js) — calling setNotificationHandler on the
// empty stub would throw at module load and crash the entire web app.
if (Platform.OS !== 'web') {
  ExpoNotifications.setNotificationHandler({
    // SDK 53 (expo-notifications 0.31) split the deprecated `shouldShowAlert`
    // into `shouldShowBanner` (heads-up banner) + `shouldShowList` (notification
    // center). Keep `shouldShowAlert` for backward compat with older runtimes.
    handleNotification: async () => ({
      shouldShowAlert:  true,
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Request notification permissions from the OS.
 *
 * Must be called before registering for push notifications.
 * On iOS, shows the system permission dialog on first call.
 * On Android 13+, shows a runtime permission dialog.
 *
 * @returns true if permission granted, false otherwise
 */
export async function requestPermission(): Promise<boolean> {
  // Web does not support Expo push notifications
  if (Platform.OS === 'web') return false;

  const { status: existingStatus } = await ExpoNotifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await ExpoNotifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Request notification permissions and register the device push token.
 * Called on first launch after login. Persists the token to the users table
 * so the smart-reminder Edge Function can send push notifications.
 *
 * @returns PushTokenInfo if permission granted and token obtained, null otherwise
 */
export async function registerPushToken(): Promise<PushTokenInfo | null> {
  // Only iOS and Android support Expo push tokens
  if (Platform.OS === 'web') return null;

  const granted = await requestPermission();
  if (!granted) return null;

  try {
    // getExpoPushTokenAsync requires the app's Expo project ID
    const tokenData = await ExpoNotifications.getExpoPushTokenAsync();
    const token     = tokenData.data;
    const platform  = Platform.OS as 'ios' | 'android';

    // Persist token to users table so smart-reminder Edge Function can use it
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js v2 type workaround
      await (supabase as any).from('users').update({ push_token: token }).eq('id', user.id);
    }

    return { token, platform };
  } catch (err) {
    // Non-critical — log and return null so callers degrade gracefully
    console.warn('[notificationService] Failed to get push token:', err);
    return null;
  }
}

/**
 * Schedule a local notification for an event reminder.
 *
 * @param eventId - UUID of the event (stored in data for lookup on tap)
 * @param title - Notification title (event title)
 * @param body - Notification body (time, location)
 * @param triggerAt - When to fire the notification
 * @returns Notification ID (for cancellation)
 */
export async function scheduleEventReminder(
  eventId: string,
  title: string,
  body: string,
  triggerAt: Date,
): Promise<string> {
  if (Platform.OS === 'web') return '';
  const id = await ExpoNotifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data:  { eventId, type: 'event_reminder' },
      sound: true,
    },
    trigger: {
      type: ExpoNotifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
    },
  });
  return id;
}

/**
 * Cancel a previously scheduled local notification.
 *
 * @param notificationId - ID returned from scheduleEventReminder
 */
export async function cancelNotification(notificationId: string): Promise<void> {
  await ExpoNotifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * Cancel all scheduled local notifications for a specific event.
 * Called when an event is deleted or its time changes.
 *
 * @param eventId - UUID of the event
 */
export async function cancelEventReminders(eventId: string): Promise<void> {
  const scheduled = await ExpoNotifications.getAllScheduledNotificationsAsync();
  const toCancel  = scheduled.filter(n => n.content.data?.['eventId'] === eventId);
  await Promise.all(
    toCancel.map(n => ExpoNotifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

/**
 * Set up the global notification handler for foreground and background events.
 * Called once in the root layout (_layout.tsx).
 *
 * @param onNotificationReceived - Callback for foreground notifications
 * @param onNotificationTapped - Callback for when user taps a notification
 * @returns Cleanup function to remove handlers
 */
export function setupNotificationHandlers(
  onNotificationReceived: (notification: LocalNotification) => void,
  onNotificationTapped: (notification: LocalNotification) => void,
): () => void {
  // Web has no native notification listeners — return a no-op cleanup.
  if (Platform.OS === 'web') return () => {};

  /** Maps an Expo Notification to the internal LocalNotification shape. */
  const toLocal = (n: ExpoNotifications.Notification): LocalNotification => ({
    id:           n.request.identifier,
    title:        n.request.content.title ?? '',
    body:         n.request.content.body  ?? '',
    scheduledFor: new Date(n.date),
    data:         (n.request.content.data as Record<string, unknown>) ?? {},
  });

  const receivedSub = ExpoNotifications.addNotificationReceivedListener(n => {
    onNotificationReceived(toLocal(n));
  });

  const tappedSub = ExpoNotifications.addNotificationResponseReceivedListener(r => {
    onNotificationTapped(toLocal(r.notification));
  });

  return () => {
    receivedSub.remove();
    tappedSub.remove();
  };
}

/**
 * Schedule a generic local notification (not tied to a specific event).
 * Use scheduleEventReminder() for event-specific reminders.
 *
 * @param params.title   - Notification title
 * @param params.body    - Notification body
 * @param params.trigger - When to fire the notification
 * @param params.data    - Optional payload (accessible when user taps)
 * @returns Notification ID (for cancellation via cancelNotification)
 */
export async function scheduleLocalNotification(params: {
  title: string;
  body: string;
  trigger: Date;
  data?: Record<string, unknown>;
}): Promise<string> {
  const id = await ExpoNotifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body:  params.body,
      data:  params.data ?? {},
      sound: true,
    },
    trigger: {
      type: ExpoNotifications.SchedulableTriggerInputTypes.DATE,
      date: params.trigger,
    },
  });
  return id;
}

/**
 * Initialize push notifications for the current session.
 *
 * Should be called once after the user authenticates.
 * Steps:
 *  1. Request OS permission
 *  2. Get Expo push token and persist to the users table
 *
 * The foreground handler is configured at module load time (top of file).
 * Response routing (tap → navigate) is wired in _layout.tsx via setupNotificationHandlers.
 *
 * @returns Promise that resolves when initialization is complete (non-throwing)
 */
export async function initializeNotifications(): Promise<void> {
  // Web has no expo-notifications runtime; web push will be handled by
  // a separate Service Worker integration (Sprint 17 TASK-1701).
  if (Platform.OS === 'web') return;
  try {
    await registerPushToken();
  } catch (err) {
    // Non-critical — log but don't crash the app
    console.warn('[notificationService] initializeNotifications failed:', err);
  }
}

/**
 * Update notification settings for the current user.
 * Persists to both AsyncStorage (local) and the users table (remote).
 *
 * @param settings - New notification preferences
 */
export async function updateNotificationSettings(_settings: NotificationSettings): Promise<void> {
  // TODO: persist to AsyncStorage + supabase users table (TASK-future)
  throw new Error('Not implemented: updateNotificationSettings');
}

/**
 * Get the current notification settings for the user.
 *
 * @returns NotificationSettings (defaults to all-enabled if not set)
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  // TODO: read from AsyncStorage + supabase users table (TASK-future)
  throw new Error('Not implemented: getNotificationSettings');
}
