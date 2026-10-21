// Feeder Island service worker (P7.8). Generated at build time from client/pwa/sw.template.js by
// the plugin in vite.config.js, which fills in the file list and a version derived from it.
//   - App shell and every built chunk are precached, so the whole client (the field survey in
//     particular) opens with no network. Hashed file names mean a cached file never goes stale.
//   - Page loads try the network first and fall back to the cached index.html when offline.
//   - /api is never cached: designs, sessions and sync always go to the server.
//   - Google Fonts are cached as they are used (stale-while-revalidate); offline without them the
//     page falls back to system fonts.
// A new version waits until the page asks it to take over (the "Reload" banner), so an open page
// never has its lazily loaded chunks swapped out underneath it.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `fi-shell-${VERSION}`;
const RUNTIME = 'fi-runtime-fonts';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fi-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', { cacheName: SHELL })));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req, { cacheName: SHELL }).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(RUNTIME).then((cache) => cache.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    })));
  }
});
