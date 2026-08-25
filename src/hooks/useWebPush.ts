/**
 * useWebPush — Service Worker + PushSubscription registration on web.
 *
 * Two-phase design:
 *
 *   1. **Auto, on mount** (this hook): register `/sw.js` and, *if the user
 *      has already granted notification permission*, subscribe + upsert
 *      the row into `web_push_subscriptions`.
 *      We deliberately do NOT call `Notification.requestPermission()` from
 *      the effect — modern browsers (Safari + recent Chrome) reject prompt
 *      requests that don't originate from a user gesture, so the prompt
 *      simply never appears and there's no on-screen feedback.
 *
 *   2. **On click** (`requestWebPushPermission()` below): the user taps an
 *      "알림 활성화" button which kicks off the prompt → permission grant →
 *      subscribe → DB write. This is the same code path as phase 1, just
 *      bound to a user-initiated event.
 *
 * Both phases surface diagnostic messages to the console so a failure
 * (HTTP, SW unsupported, missing VAPID, DB write rejection) is visible
 * during development.
 *
 * Sprint 19 TASK-1902.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** Public — possible outcomes of a registration attempt. */
export type WebPushRegistrationResult =
  | 'granted'         // permission granted, subscription saved
  | 'denied'          // user (or browser policy) blocked notifications
  | 'unsupported'     // not running in a browser that supports SW + Push
  | 'not-configured'  // EXPO_PUBLIC_VAPID_PUBLIC_KEY is empty
  | 'no-user'         // no Supabase session — caller should require login first
  | 'error';          // unexpected failure (logged to console)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert URL-safe base64 VAPID key into Uint8Array for PushManager.subscribe. */
// 반환 타입을 Uint8Array<ArrayBuffer> 로 좁힌다 — TS 5.7 부터 Uint8Array 는
// 버퍼 종류를 제네릭으로 갖고, PushManager.subscribe 의 applicationServerKey
// (BufferSource) 는 SharedArrayBuffer 기반을 받지 않는다.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = (globalThis as typeof globalThis & { atob: (s: string) => string }).atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface BrowserGlobals {
  navigator?: { serviceWorker?: ServiceWorkerContainer; userAgent?: string };
  Notification?: { requestPermission(): Promise<NotificationPermission>; permission: NotificationPermission };
}

function getBrowserGlobals(): BrowserGlobals | null {
  if (Platform.OS !== 'web') return null;
  const win = globalThis as typeof globalThis & BrowserGlobals;
  if (!win.navigator?.serviceWorker || !win.Notification) return null;
  return win;
}

/**
 * Register the SW + PushSubscription, then upsert the (user, endpoint)
 * row. Internal — both the auto-mount path and the user-click path call
 * this same function.
 *
 * @param shouldPrompt If true and permission === 'default', call
 *                     Notification.requestPermission(). Only set this
 *                     when invoked from a user gesture.
 */
async function registerInternal(shouldPrompt: boolean): Promise<WebPushRegistrationResult> {
  if (!VAPID_PUBLIC_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[webpush] EXPO_PUBLIC_VAPID_PUBLIC_KEY is empty — skipping');
    return 'not-configured';
  }
  const win = getBrowserGlobals();
  if (!win) return 'unsupported';

  try {
    const reg = await win.navigator!.serviceWorker!.register('/sw.js');
    await win.navigator!.serviceWorker!.ready;

    // Permission gate. Either we already have it or we're allowed to prompt.
    let perm = win.Notification!.permission;
    if (perm === 'default') {
      if (!shouldPrompt) {
        // Phase 1: silently skip — we don't want to trigger a no-gesture
        // prompt that browsers will reject.
        return 'denied';
      }
      perm = await win.Notification!.requestPermission();
    }
    if (perm !== 'granted') return 'denied';

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      // eslint-disable-next-line no-console
      console.warn('[webpush] PushSubscription missing fields', json);
      return 'error';
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // eslint-disable-next-line no-console
      console.warn('[webpush] no Supabase user — login first, then re-enable notifications');
      return 'no-user';
    }

    // Cast to `any` for the row payload because the generated Supabase
    // types haven't been regenerated for migration 020 yet.
    const { error } = await (supabase.from('web_push_subscriptions') as unknown as {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) =>
        Promise<{ error: { message: string } | null }>;
    }).upsert(
      {
        user_id:    user.id,
        endpoint:   json.endpoint,
        p256dh:     json.keys.p256dh,
        auth:       json.keys.auth,
        user_agent: win.navigator?.userAgent ?? null,
      },
      { onConflict: 'user_id,endpoint' },
    );
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[webpush] db upsert failed:', error.message);
      return 'error';
    }
    // eslint-disable-next-line no-console
    console.info('[webpush] subscription registered');
    return 'granted';
  } catch (e: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[webpush] registration error:', (e as Error)?.message ?? e);
    return 'error';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mount-time hook. Runs phase 1 only — no permission prompt.
 * Safe to call on every screen; the SW register is idempotent.
 */
export function useWebPush(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void registerInternal(/* shouldPrompt */ false);
  }, []);
}

/**
 * Phase 2 — call from a button onPress. Prompts the browser for permission
 * (allowed because the call originates from a user gesture) and writes
 * the subscription row on success.
 *
 * Returns the outcome so the caller can show an inline status message.
 */
export function requestWebPushPermission(): Promise<WebPushRegistrationResult> {
  return registerInternal(/* shouldPrompt */ true);
}

/**
 * Read the current permission state synchronously. Useful for showing the
 * "알림 활성화" button only when it would actually do something.
 */
export function getWebPushPermission(): NotificationPermission | 'unsupported' {
  const win = getBrowserGlobals();
  if (!win) return 'unsupported';
  return win.Notification!.permission;
}
