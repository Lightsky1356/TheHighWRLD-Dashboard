/* TheHighWRLD Dashboard — Service Worker (PWA).
 *
 * Caching policy (privacy + correctness aware):
 *   - Precache only the static APP SHELL: index.html, core JS/CSS, icons,
 *     manifest, favicon. These contain NO per-user private data.
 *   - API/network (auth, community, presence, profile, stats, wanted) is
 *     NEVER cached -> authentication and live data always hit the network.
 *   - AUDIO files are NEVER cached (too large, and offline-caching them would
 *     mislead users into thinking the whole library works offline).
 *   - Cover images + webfonts may be cached on-demand (cache-first) so the UI
 *     shell is fast, bounded to a small quota.
 *   - Offline: navigation falls back to the cached app shell so the app
 *     launches, but backend requests fail gracefully (app shows offline state).
 */
'use strict';

const VERSION = 'thw-v2';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

/* Static app-shell assets (no private data, safe to precache). Keep in sync
 * with the <head>/<body> asset references in index.html. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './security.js',
  './api.js',
  './crypto-js.min.js',
  './qrcode.min.js',
  './tracks.js',
  './browser-id3-writer.js',
  './account.js',
  './i18n.js',
  './script.js',
  './suggestions.js',
  './auth.js',
  './wanted-realtime.js',
  './community-realtime.js',
  './presence.js',
  './pwa.js',
  './community-realtime.css',
  './all.min.css',
  './account.css',
  './player-settings.css',
  './style.css',
  './tailwind.css',
  './themes.css',
  './css2.css',
  './fonts/0-Sora-300.woff2',
  './fonts/1-Sora-300.woff2',
  './fonts/2-Sora-400.woff2',
  './fonts/3-Sora-400.woff2',
  './fonts/4-Sora-600.woff2',
  './fonts/5-Sora-600.woff2',
  './fonts/6-Sora-700.woff2',
  './fonts/7-Sora-700.woff2',
  './fonts/8-Sora-800.woff2',
  './fonts/9-Sora-800.woff2',
  './fonts/10-Unbounded-500.woff2',
  './fonts/11-Unbounded-500.woff2',
  './fonts/12-Unbounded-500.woff2',
  './fonts/13-Unbounded-500.woff2',
  './fonts/14-Unbounded-500.woff2',
  './fonts/15-Unbounded-700.woff2',
  './fonts/16-Unbounded-700.woff2',
  './fonts/17-Unbounded-700.woff2',
  './fonts/18-Unbounded-700.woff2',
  './fonts/19-Unbounded-700.woff2',
  './fonts/20-Unbounded-900.woff2',
  './fonts/21-Unbounded-900.woff2',
  './fonts/22-Unbounded-900.woff2',
  './fonts/23-Unbounded-900.woff2',
  './fonts/24-Unbounded-900.woff2',
  './JW-Favi.png',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-fullbleed.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/* Requests that must NEVER be served from cache (privacy / correctness). */
function isSensitive(url) {
  const p = url.pathname;
  if (/\/api\//.test(p)) return true;                 // all API/auth/live data
  if (/\/Audio\//i.test(p)) return true;              // audio streams
  if (/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(p)) return true;
  if (/\.(m3u8|ts)$/i.test(p)) return true;           // HLS segments
  return false;
}
function isStaticAsset(url) {
  return /\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|eot|ico|webmanifest|json|html)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE).catch((err) => {
        // Individual asset failures (e.g. an icon missing on first deploy)
        // shouldn't prevent shell install; log and continue.
        console.warn('[SW] precache partial:', err && err.message);
        return cache;
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (Discord/CDN) -> network only

  // 1) Sensitive (API/auth/audio): network only, never cached.
  if (isSensitive(url)) {
    event.respondWith(fetch(req).catch(() => networkFallback(req, url)));
    return;
  }

  // 2) Navigation requests: try network (fresh app), else cached shell (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { updateShellCache(req, res.clone()); return res; })
        .catch(() => caches.match('./index.html').then((c) => c || Response.error()))
    );
    return;
  }

  // 3) Static assets: cache-first (on-demand runtime cache), bounded.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(req, copy);
              trimRuntimeCache(cache);
            });
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network default.
});

/* Serve the app shell as an offline fallback for sensitive network calls too,
 * so the UI stays usable and can render a friendly offline state. */
function networkFallback(req, url) {
  if (req.mode === 'navigate') {
    return caches.match('./index.html');
  }
  return Response.error();
}

function updateShellCache(req, res) {
  if (!res || !res.ok || res.status !== 200) return;
  caches.open(SHELL_CACHE).then((c) => c.put(req, res));
}

const RUNTIME_LIMIT = 40; // keep the on-demand cache small
function trimRuntimeCache(cache) {
  caches.keys().then((keys) => {
    keys.forEach((k) => {
      if (k === RUNTIME_CACHE) {
        caches.open(k).then((c) => c.keys().then((all) => {
          if (all.length > RUNTIME_LIMIT) {
            c.delete(all[0]);
          }
        }));
      }
    });
  });
}
