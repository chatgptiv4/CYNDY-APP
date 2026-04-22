/* ============================================================
   CYNDY EDUCATIONAL PATHWAYS — SERVICE WORKER (Workbox-style)
   Strategies: NetworkFirst for API, CacheFirst for assets
   ============================================================ */

const CACHE_NAME     = 'cyndy-v1';
const OFFLINE_URL    = '/offline.html';
const STATIC_ASSETS  = [
  '/',
  '/index.html',
  '/apply.html',
  '/status.html',
  '/offline.html',
  '/unauthorized.html',
  '/css/main.css',
  '/css/landing.css',
  '/css/portal.css',
  '/css/dashboard.css',
  '/js/config.js',
  '/js/auth.js',
  '/assets/logo.svg',
  '/manifest.json',
];

// ─── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ─── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── FETCH STRATEGY ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin Supabase/CDN requests
  if (request.method !== 'GET') return;
  if (url.hostname !== location.hostname) {
    // Network-only for external (Supabase, fonts, CDN)
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // HTML navigation → NetworkFirst, fallback to offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets → CacheFirst
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
        return res;
      });
    })
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'Cyndy Educational Pathways';
  const options = {
    body:    data.body    || 'You have a new notification.',
    icon:    '/assets/icon-192.png',
    badge:   '/assets/icon-192.png',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
