// Service Worker — FreewayChina PWA
const CACHE = 'fw-v1';

// Minimal offline cache for the client pages
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(['/client.html', '/dashboard.html', '/style.css'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch {}

  const title   = payload.title || 'FreewayChina';
  const body    = payload.body  || '';
  const url     = payload.url   || '/dashboard.html';
  const tag     = payload.tag   || 'fw-push';

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    '/icon-192.png',
      badge:   '/icon-72.png',
      tag,
      renotify: true,
      vibrate: [200, 100, 200],
      data:    { url },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/dashboard.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
