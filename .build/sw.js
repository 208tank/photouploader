// Service Worker — network-first for navigations/API, cache-first for static assets
const CACHE_NAME = 'inspector-pwa-v3';

const BASE_PATH = '/photouploader';

const PRECACHE_URLS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/favicon.svg`,
  `${BASE_PATH}/acuren-logo.png`,
  `${BASE_PATH}/acuren-iso-badge.png`,
  `${BASE_PATH}/templates/acuren-r3.docx`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET, auth, and API routes
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Navigation requests — network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match(`${BASE_PATH}/`)))
    );
    return;
  }

  // Static assets — network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response?.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
