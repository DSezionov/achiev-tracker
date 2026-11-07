// Service worker: офлайн-доступ до застосунку.
// Стратегія «спочатку мережа»: онлайн завжди свіжа версія з GitHub Pages,
// офлайн — остання збережена в кеші. Запити до інших доменів (GitHub API,
// обкладинки) не перехоплюються.
// Після зміни списку файлів збільшити версію кешу.

const CACHE = 'achievement-tracker-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/utils.js',
  './js/ui.js',
  './js/import.js',
  './js/sync-gist.js',
  './js/views/home.js',
  './js/views/game.js',
  './js/views/editor.js',
  './js/views/settings.js',
  './data/example.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});
