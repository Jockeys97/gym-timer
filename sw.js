'use strict';

const CACHE_NAME = 'timer-palestra-v4';
const PRECACHE = [
  './',
  './index.html',
  './styles.css?v=4',
  './app.js?v=4',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  try {
    if (['pause', 'resume', 'stop'].includes(action)) {
      event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        if (list.length) {
          list.forEach((client) => client.postMessage({ type: 'timer-action', action }));
        } else {
          return self.clients.openWindow('./');
        }
      }).catch(() => {}));
      if (action === 'stop') notification.close();
      return;
    }
    if (!['running', 'paused'].includes(notification.data?.state)) notification.close();
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('./');
    }).catch(() => {}));
  } catch { /* Notification interactions are optional. */ }
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('timer-palestra-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate';
  const networkFirst = navigation || /\.(html|css|js|json)$/i.test(url.pathname);
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    async function refresh() {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') {
        event.waitUntil(cache.put(event.request, response.clone()));
      }
      return response;
    }
    if (networkFirst) {
      try {
        return await refresh();
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (navigation) {
          const page = await cache.match('./index.html');
          if (page) return page;
        }
        throw error;
      }
    }
    return (await cache.match(event.request)) || refresh();
  }));
});
