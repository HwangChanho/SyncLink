/**
 * useWebPush — register the Service Worker and a PushSubscription on web.
 *
 * Workflow on first run:
 *   1. Confirm we're on web with Notification + ServiceWorker support.
 *   2. Register /sw.js as a Service Worker.
 *   3. Ask the user for notification permission once.
 *   4. Subscribe to push via VAPID public key (EXPO_PUBLIC_VAPID_PUBLIC_KEY).
 *   5. Upsert the resulting PushSubscription into web_push_subscriptions
 *      so the server-side reminder Edge Function can fan-out later.
 *
 * Idempotent and best-effort — every step degrades gracefully if the
 * platform / permission / VAPID config isn't available.
 *
 * Sprint 19 TASK-1902.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/**
 * Convert the URL-safe base64 VAPID public key (server provides) into the
 * Uint8Array format the PushManager subscription API expects.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = (globalThis as typeof globalThis & { atob: (s: string) => string }).atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function useWebPush(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!VAPID_PUBLIC_KEY) return; // not configured — skip silently
    const win = globalThis as typeof globalThis & {
      navigator?: { serviceWorker?: ServiceWorkerContainer };
      Notification?: { requestPermission(): Promise<NotificationPermission>; permission: NotificationPermission };
    };
    if (!win.navigator?.serviceWorker || !win.Notification) return;

    let cancelled = false;

    (async () => {
      try {
        const reg = await win.navigator!.serviceWorker!.register('/sw.js');
        // Wait until the worker is active before subscribing.
        await win.navigator!.serviceWorker!.ready;

        // Permission gate. We only ask once; subsequent visits read
        // current permission and either subscribe (granted) or skip.
        let perm = win.Notification!.permission;
        if (perm === 'default') {
          perm = await win.Notification!.requestPermission();
        }
        if (perm !== 'granted') return;
        if (cancelled) return;

        // Get-or-create PushSubscription. The browser deduplicates so this
        // is safe to call on every mount.
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Upsert by (user_id, endpoint) — unique key on the table dedupes.
        // Cast to `any` for the row payload because the generated Supabase
        // types haven't been regenerated for migration 020 yet.
        await (supabase.from('web_push_subscriptions') as unknown as {
          upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<unknown>;
        }).upsert(
          {
            user_id:    user.id,
            endpoint:   json.endpoint,
            p256dh:     json.keys.p256dh,
            auth:       json.keys.auth,
            user_agent: win.navigator?.serviceWorker ? navigator.userAgent : null,
          },
          { onConflict: 'user_id,endpoint' },
        );
      } catch {
        // Subscription failure is non-critical — push just stays disabled
        // for this session.
      }
    })();

    return () => { cancelled = true; };
  }, []);
}
