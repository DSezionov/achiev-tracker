// Service worker: офлайн-доступ до застосунку.
// Стратегія «спочатку мережа»: онлайн завжди свіжа версія з GitHub Pages,
// офлайн або якщо мережа не відповідає за NETWORK_TIMEOUT — версія з кешу.
// Запити до інших доменів (GitHub API, обкладинки) не перехоплюються.
// Після зміни списку файлів збільшити версію кешу.

const CACHE = 'achievement-tracker-v2';
const NETWORK_TIMEOUT = 3000;

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
  './js/views/stats.js',
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
  event.respondWith(networkFirst(request));
});

function fromCache(request) {
  return caches
    .match(request, { ignoreSearch: true })
    .then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined));
}

/**
 * Мережа з тайм-аутом: якщо відповідь не прийшла за NETWORK_TIMEOUT і в кеші
 * є копія — віддаємо її, а мережева відповідь усе одно оновить кеш.
 */
function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled || !response) return false;
      settled = true;
      resolve(response);
      return true;
    };

    const network = fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });

    const timer = setTimeout(() => {
      fromCache(request).then(finish);
    }, NETWORK_TIMEOUT);

    network
      .then((response) => {
        clearTimeout(timer);
        finish(response);
      })
      .catch(async () => {
        clearTimeout(timer);
        if (!finish(await fromCache(request))) finish(Response.error());
      });
  });
}
