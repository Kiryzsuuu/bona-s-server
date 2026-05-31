// Bonah Server Service Worker

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', (e) => {
  if (!e.data) return;

  let data;
  try { data = e.data.json(); } catch { data = { title: 'Bonah Server', body: e.data.text() }; }

  const options = {
    body: data.body || '',
    icon: data.icon || '/image%20(7).png',
    badge: '/image%20(7).png',
    tag: data.tag || 'bonah-message',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: [
      { action: 'open', title: 'Buka' },
      { action: 'dismiss', title: 'Tutup' }
    ]
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'Bonah Server', options)
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const url = (e.notification.data && e.notification.data.url) ? e.notification.data.url : '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'notification-click', url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
