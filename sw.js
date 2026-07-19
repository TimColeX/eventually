/* Eventually — service worker. Offline-first cache of the app shell. */
const CACHE = 'eventually-v87';
const ASSETS = [
  './', './index.html', './styles/main.css',
  './src/dedup.js', './src/data.js', './src/api.js', './src/auth.js', './src/billing.js', './src/geo.js', './src/hostvoice.js', './src/landdata.js', './src/profile.js', './src/reminders.js', './src/monetize.js',
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
  // Never intercept cross-origin requests (Supabase API/auth, the supabase-js CDN,
  // Google fonts/OAuth). They must always hit the network so account/event data
  // is never served stale from the app-shell cache.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Never intercept the admin app (separate site) — always hit the network.
  if (new URL(e.request.url).pathname.indexOf('/admin/') !== -1) return;
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
