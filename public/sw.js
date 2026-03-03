// FexoApp/public/sw.js

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  return self.clients.claim();
});

// 1. Handle Incoming Push (Background)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received');

  if (!event.data) return;

  // DevTools sends text, Server sends JSON. Handle both.
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    // Fallback for DevTools "Test Push" message
    data = { title: 'Lyseris AI', body: event.data.text() };
  }

  const title = data.title || 'Lyseris AI';
  const options = {
    body: data.body || 'New notification',
    icon: '/lyseris.svg', // Make sure this icon exists in public/
    badge: '/lyseris.svg',
    vibrate: [100, 50, 100],
    data: {
      url: '/app',
      taskId: data.taskId
    },
    tag: data.taskId || 'general', // Prevents duplicate notifications
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 2. Handle Click (Open App)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});