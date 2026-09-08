/* Eventually — service worker. Offline-first cache of the app shell.
 *
 * UPDATE MODEL (read before changing anything here):
 *
 * The app has no build step, so assets live at stable paths (src/app.js, never
 * src/app.a83f21.js). That means the ONLY thing separating one release from the
 * next is CACHE below. A given cache holds one internally-consistent set of
 * files, and a release flips to a new cache atomically.
 *
 * Because of that, every same-origin shell request is served cache-FIRST. Going
 * network-first for navigations would be worse, not better: the browser would
 * fetch a NEW index.html and then load the OLD src/app.js still sitting in this
 * version's cache — a mixed build, which is exactly how you get a blank screen.
 *
 * So this worker never mixes versions. It installs quietly into a new cache and
 * WAITS. It does not call skipWaiting() on its own; the page decides when the
 * swap is safe (see the update block in src/app.js) and sends SKIP_WAITING.
 * On activation the old caches are dropped and the page reloads once, so the
 * user lands on a complete new build rather than half of one.
 *
 * Bump CACHE with `node tools/bump-version.js` — it also writes version.json
 * and index.html's build stamp, which is what lets a running app notice a
 * deploy at all. Bumping this constant by hand leaves those two behind.
 */
const CACHE = 'eventually-v156';
const ASSETS = [
  './', './index.html', './styles/main.css',
  './src/dedup.js', './src/data.js', './src/api.js', './src/auth.js', './src/billing.js', './src/subscriptions.js', './src/signature.js', './src/geo.js', './src/hostvoice.js', './src/landdata.js', './src/profile.js', './src/reminders.js', './src/monetize.js',
  './src/i18n.js', './src/narrator.js', './src/music.js', './src/globe.js', './src/timeline.js',
  './src/aihost.js', './src/tour.js', './src/updates.js', './src/coordinator.js', './src/app.js',
  './manifest.webmanifest', './assets/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // cache:'reload' bypasses the HTTP cache for every precache request. GitHub
      // Pages serves these with max-age=600, so without this a worker installing
      // within ten minutes of a deploy would happily fill its brand-new cache with
      // the PREVIOUS build's files — a new version that ships old code.
      c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))
    ).then(() => self.clients.matchAll({ type: 'window' })).then((clients) => {
      // Normally we wait and let the page choose the moment (see the header note).
      // But with no window open there is nobody to disrupt and nobody to ask, so
      // waiting would just postpone the new build to the launch after next. This
      // also carries the one-time upgrade from builds that predate the page-side
      // update logic, which can't send SKIP_WAITING at all.
      if (!clients.length) return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// The page sends this once it has decided a reload won't interrupt anything.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Never intercept cross-origin requests (Supabase API/auth, the supabase-js CDN,
  // Google fonts/OAuth). They must always hit the network so account/event data
  // is never served stale from the app-shell cache.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // Never intercept the admin app (separate site) — always hit the network.
  if (new URL(e.request.url).pathname.indexOf('/admin/') !== -1) return;
  const p = new URL(e.request.url).pathname;
  // version.json is the deploy beacon: the running app compares it against its own
  // build stamp. Caching it would defeat the entire point, so it stays network-only.
  if (p.indexOf('version.json') !== -1) return;
  // Never intercept the generated SEO pages. This cache is cache-FIRST with no
  // revalidation, so a cached city page would be served forever — showing last week's
  // events to returning visitors. These are rebuilt daily, so they must stay live.
  if (p.indexOf('/events/') !== -1 || p.indexOf('/browse/') !== -1 || p.indexOf('sitemap.xml') !== -1) return;
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
