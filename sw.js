/* Eventually — service worker. Offline-first cache of the app shell. */
const CACHE = 'eventually-v38';
const ASSETS = [
  './', './index.html', './styles/main.css',
  './src/dedup.js', './src/data.js', './src/api.js', './src/landdata.js', './src/profile.js', './src/monetize.js',
  './src/i18n.js', './src/narrator.js', './src/music.js', './src/globe.js', './src/timeline.js',
  './src/aihost.js', './src/coordinator.js', './src/app.js',
  './manifest.webmanifest', './assets/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
