/**
 * Service Worker — handles incoming web push notifications.
 *
 * Registered from useWebPush() on the web only. The send-web-push Edge
 * Function delivers payloads of the form { title, body, url? } and we
 * forward them to the browser's notification UI; clicking opens the
 * deep-linked URL when one is provided.
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'SyncLink', body: event.data.text() }; }
  const title = payload.title ?? 'SyncLink';
  const options = {
    body: payload.body ?? '',
    icon: '/favicon.ico',
    data: payload,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
