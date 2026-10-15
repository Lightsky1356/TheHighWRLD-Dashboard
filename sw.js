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

const VERSION = 'thw-v52';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

/* Static app-shell assets (no private data, safe to precache). Keep in sync
 * with the <head>/<body> asset references in index.html. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './security.js?v=thw-v1',
  './api.js',
  './crypto-js.min.js?v=thw-v1',
  './qrcode.min.js?v=thw-v1',
  './tracks.js?v=thw-v2',
  './browser-id3-writer.js?v=thw-v1',
  './account.js?v=thw-v3',
  './i18n.js?v=2',
  (('./script.js?v=thw-v33',
  './suggestions.js?v=thw-v1',
  './submission-rules-ui.js?v=thw-v1',
  ('./auth.js?v=thw-v3',
  './wanted-realtime.js?v=thw-v3',
  './community-realtime.js?v=thw-v3',
  './presence.js?v=thw-v2',
  './pwa.js?v=thw-v2',
  './community-realtime.css?v=thw-v1',
  './all.min.css?v=thw-v1',
  './account.css?v=thw-v1',
  ((('./player-settings.css?v=thw-v38',
  './style.css?v=thw-v29',
  './site-mode.css?v=thw-v2',
  './tailwind.css?v=thw-v1',
  './themes.css?v=thw-v1',
  './css2.css?v=thw-v1',
  './about.css?v=thw-v2',
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

  /* --- page stylesheets --- */
  './roadmap.css?v=thw-v24',
  './failed-projects.css?v=thw-v4',
  './legal-info.css?v=thw-v3',
  './simple-toast.css?v=thw-v2',
  ('./cover-preview.css?v=thw-v2',

  /* --- page scripts --- */
  './user-relations.js?v=thw-v1',
  './user-menu.js?v=thw-v3',
  './player-settings.js?v=thw-v1',
  './reports.js?v=thw-v1',
  './player-performance.js?v=thw-v3',
  './vault-discography.js?v=thw-v3',
  './global-search.js?v=thw-v2',
  './trending.js?v=thw-v3',
  './owner-search.js?v=thw-v1',
  './owner-announce.js?v=thw-v1',
  './bans.js?v=thw-v1',
  './automod-ui.js?v=thw-v1',
  './report-status.js?v=thw-v1',
  './ban-screen.js?v=thw-v1',
  './wrld-stats.js?v=thw-v7',
  './recent.js?v=thw-v5',
  './trackinfo.js?v=thw-v1',
  './profile-enhancements.js?v=thw-v31',
  './roadmap-data.js?v=thw-v25',
  './roadmap.js?v=thw-v25',
  './timeline.js?v=thw-v3',
  './gallery.js?v=thw-v3',
  './failed-projects-data.js?v=thw-v12',
  './failed-projects.js?v=thw-v12',
  './presets.js?v=thw-v1',
  './mobile-player.js?v=thw-v3',
  './follows.js?v=thw-v1',
  './privacy.js?v=thw-v1',
  './playlists-ui.js?v=thw-v3',
  './drops.js?v=thw-v1',
  './legal-info.js?v=thw-v4',
  ('./social-panel.js?v=thw-v29',
  './push-client.js?v=thw-v2',
  './simple-toast.js?v=thw-v4',
  './cover-preview.js?v=thw-v3',

  /* --- misc page assets --- */
  './Juice-WRLD.png?v=2',

  /* --- album artwork for the Vault discography --- */
  './AlbumArt/999.jpg',
  './AlbumArt/death.jpg',
  './AlbumArt/demons.jpg',
  './AlbumArt/goodbye.jpg',
  './AlbumArt/legends.jpg',
  './AlbumArt/party.jpg',
  './AlbumArt/preparty.jpg',
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
    caches.open(SHELL_CACHE).then((cache) => {
      /* Added one at a time rather than with cache.addAll(). addAll() is atomic:
         a single 404 rejects the whole batch, so one bad URL would leave the
         shell with almost nothing cached and every page would fail offline -
         which is exactly what a longer PRECACHE list makes more likely. Each
         entry is independent here, so a failure costs one asset instead of all
         of them, and the names are logged so the broken URL is visible instead
         of silent. */
      const failed = [];
      return Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            failed.push(url);
            return null;
          })
        )
      ).then(() => {
        if (failed.length) {
          console.warn('[SW] precache missed ' + failed.length + ':', failed.join(', '));
        }
      });
    }).then(() => self.skipWaiting())
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

/* =============================================================================
   WEB PUSH
   Added for background notifications. Nothing above this line knows about push:
   a device that never subscribes simply never fires these events.
   ========================================================================== */

const PUSH_TITLE = 'TheHighWRLD';

/* Only these app routes may be opened from a notification. A push payload is
   server-generated, but the browser can be tricked into relaying one, so the
   destination is validated again here rather than trusted. Anything else falls
   back to the lobby instead of navigating. */
const PUSH_ROUTES = new Set(['social:conversation', 'social:requests', 'social:friends']);

function safeTarget(raw) {
  return typeof raw === 'string' && PUSH_ROUTES.has(raw) ? raw : null;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      const text = event.data ? event.data.text() : '';
      data = { title: PUSH_TITLE, body: String(text || '').slice(0, 200) };
    } catch (__) { data = {}; }
  }

  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 60) : PUSH_TITLE;
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '';
  const target = safeTarget(data.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-96.png',
      // Same-origin only. A push payload must never be able to make the
      // notification load a remote image and leak that the device is online.
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 80) : 'thw-notification',
      renotify: false,
      vibrate: [40, 30, 40],
      timestamp: Date.now(),
      data: { target, type: data.type || '' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.target);

  // Without a target there is nothing to route to - just focus the app.
  if (!target) {
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    }));
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Already open: focus the existing tab and let the page route internally,
      // rather than opening a second copy of the app.
      for (const client of list) {
        if (client.url && client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          client.postMessage({ type: 'thw:push-click', target: target });
          return client.focus();
        }
      }
      // Cold start: open the app and hand the destination over on load.
      return self.clients.openWindow('/').then((client) => {
        if (client) {
          client.postMessage({ type: 'thw:push-click', target: target });
          return client.focus();
        }
      });
    })
  );
});

/* Tapping "clear all" should not leave stale notifications behind. */
self.addEventListener('notificationclose', () => { /* nothing to persist */ });
