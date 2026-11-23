/* TheHighWRLD Dashboard â€” Service Worker (PWA).
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

const VERSION = 'thw-v566';

/* The shell cache is NOT versioned, and that stays deliberate (the site hit
 * the plan's daily request limit once already; precaching the whole shell on
 * every deployment is what did it). What was not deliberate - and is now
 * fixed - is that the precache stored ANY response, so one HTML error page
 * fetched during a bad window got cached under a JS filename and poisoned
 * that device forever. Only 200s are stored now. */
const SHELL_CACHE = 'thw-shell';
const RUNTIME_CACHE = 'thw-runtime';

/* Static app-shell assets (no private data, safe to precache). Keep in sync
 * with the <head>/<body> asset references in index.html. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest?v=2',
  './security.js?v=thw-v2',
  './api.js',
  './crypto-js.min.js?v=thw-v2',
  './qrcode.min.js?v=thw-v2',
  './toast.js?v=thw-v1',
  './tracks.js?v=thw-v19',
  './browser-id3-writer.js?v=thw-v3',
  './bootstrap-client.js?v=thw-v3',
  './account.js?v=thw-v107',
  './stats-page.js?v=thw-v1',
  './effects.js?v=thw-v2',
  './theme-drift.js?v=thw-v9',
  './i18n.js?v=11',
  './script.js?v=thw-v114',
  './suggestions.js?v=thw-v3',
  './submission-rules-ui.js?v=thw-v2',
  './auth.js?v=thw-v19',
  './wanted-realtime.js?v=thw-v5',
  './presence.js?v=thw-v14',
  './api-side.js?v=thw-v1',
  './pwa.js?v=thw-v11',
  './electron-playback.js?v=thw-v1',
  './song-comments.js?v=thw-v11',
  './era-page.js?v=thw-v9',


  './context-menu.js?v=thw-v4',
  './leaderboard.js?v=thw-v2',
  './desktop-player.js?v=thw-v24',
  './queue-side.js?v=thw-v5',
  './comment-markers.js?v=thw-v1',
  './vault-pull.js?v=thw-v1',
  './deck.js?v=thw-v16',
  './command-palette.js?v=thw-v4',
  './updates-page.js?v=thw-v2',
  './tracker.js?v=thw-v3',
  './song-page.js?v=thw-v8',
  './all.min.css?v=thw-v2',
  './account.css?v=thw-v26',
  './account-shared.css?v=thw-v6',
  './player-settings.css?v=thw-v215',
  './style.css?v=thw-v55',
  './site-mode.css?v=thw-v3',
  './tailwind.css?v=thw-v2',
  './themes.css?v=thw-v23',
  './css2.css?v=thw-v2',
  './about.css?v=thw-v4',
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
  './roadmap.css?v=thw-v25',
  './failed-projects.css?v=thw-v5',
  './legal-info.css?v=thw-v5',
  './simple-toast.css?v=thw-v4',
  './ban-screen.css?v=thw-v1',
  './cover-preview.css?v=thw-v5',

  /* --- page scripts --- */
  './user-relations.js?v=thw-v2',
  './user-menu.js?v=thw-v7',
  './player-settings.js?v=thw-v21',
  './profile.js?v=thw-v64',
  './profile.css?v=thw-v32',
  './cover-pref.js?v=thw-v4',
  './assets/settings-era/JUTE.webp',
  './assets/settings-era/AFF.webp',
  './assets/settings-era/HIH.webp',
  './assets/settings-era/JW999.webp',
  './assets/settings-era/BDM.webp',
  './assets/settings-era/ND.webp',
  './assets/settings-era/GBGR.webp',
  './assets/settings-era/WOD.webp',
  './assets/settings-era/DRFL.webp',
  './assets/settings-era/OUT.webp',
  './assets/settings-era/POST.webp',
  './reports.js?v=thw-v5',
  './owner-vault-sync.js?v=thw-v4',
  './owner-live.js?v=thw-v2',
  './player-performance.js?v=thw-v13',
    './queue-ui.js?v=thw-v21',
  './vault-discography.js?v=thw-v4',
  './global-search.js?v=thw-v6',
  './about-tabs.js?v=thw-v6',
  './trending.js?v=thw-v8',
  './owner-search.js?v=thw-v3',
  './owner-announce.js?v=thw-v3',
  './bans.js?v=thw-v3',
  './automod-ui.js?v=thw-v3',
  './report-status.js?v=thw-v2',
  './ban-screen.js?v=thw-v4',
  './wrld-stats.js?v=thw-v10',
  './recent.js?v=thw-v11',
  './trackinfo.js?v=thw-v3',
  './profile-enhancements.js?v=thw-v40',
  './roadmap-data.js?v=thw-v28',
  './roadmap.js?v=thw-v26',
  './timeline.js?v=thw-v6',
  './wrldlog.css?v=thw-v3',
  './wrldlog-data.js?v=thw-v10',
  './wrldlog.js?v=thw-v8',
  './gallery.js?v=thw-v11',
  './failed-projects-data.js?v=thw-v13',
  './failed-projects.js?v=thw-v13',
  './community-themes.js?v=thw-v5',
  './community-themes.css?v=thw-v2',
  /* The seasonal holiday art for the panels - precached so the picture is on
     the glass the moment its ⓘ is clicked. Files are tiny SVGs. */
  './holiday-art/newyear.jpg',
  './holiday-art/valentines.jpg',
  './holiday-art/stpatricks.jpg',
  './holiday-art/easter.jpg',
  './holiday-art/july4.jpg',
  './holiday-art/halloween.jpg',
  './holiday-art/thanksgiving.jpg',
  './holiday-art/christmas.jpg',
  './presets.js?v=thw-v3',
  './mobile-player.js?v=thw-v59',
  './follows.js?v=thw-v3',
  './privacy.js?v=thw-v4',
  './playlists-ui.js?v=thw-v15',
  './drops.js?v=thw-v4',
  './legal-info.js?v=thw-v6',
  './grammar-check.js?v=thw-v2',
  './emoji-data.js?v=thw-v1',
  './social-panel.js?v=thw-v70',
  './push-client.js?v=thw-v31',
  './simple-toast.js?v=thw-v5',
  './catalogue-watch.js?v=thw-v2',
  './scroll-lock-sync.js?v=thw-v1',
  './cover-preview.js?v=thw-v7',

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
  './cover-artists.js?v=thw-v95',
  './credits-wall.js?v=thw-v17',
  './credits-wall.css?v=thw-v12',
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

/* Fill the shell cache.
 *
 * This does NOT run during the install. It runs once the worker is already
 * active and controlling the page.
 *
 * The precache is 120 assets - every stylesheet, every script, 25 font files and
 * 12 album-art photos - and fetching all of them took 112 SECONDS when measured.
 * That is longer than a browser will keep an install alive, so the worker was
 * killed before it ever activated, and a worker that is not active does not
 * receive a push event. That is the whole reason "the server accepted it, this
 * device did not get it".
 *
 * The old code had a second, quieter bug on top of that. It handed .then() an
 * ARRAY of promises:
 *
 *     Array.from({ length: 6 }, next).then(...)
 *
 * and .then() on an array resolves immediately, because an array is not a
 * thenable. So the install finished before a single asset had been cached, and
 * the precache was still running when the worker was terminated - the shell
 * cache ended up with nothing in it. The chains are collected and awaited here
 * instead, so the shell genuinely fills.
 *
 * Nothing about the app shell being available offline changes: the same list is
 * precached, just after the worker is live rather than before it. */
/* The page tells the worker when it is up.
 *
 * On a first visit the worker takes control while the page is still asking
 * for the very assets the worker is about to fetch for its own cache - and
 * they were competing for the same handful of connections, which is how a
 * first visit took so long. So the page says when it is up, and the worker
 * waits for that before it starts.
 *
 * If the page never says - an old one, or one that was already up - the wait
 * ends anyway after a few seconds, so the cache is still filled. */
/* The page tells the worker when it is up. Registered HERE, at the top level,
   because the worker only gets the page-ready message if the listener is in
   place the moment the worker is evaluated - a listener attached later can
   miss it entirely (which is the console warning the browser flags). */
var pageReadyResolve = null;
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'thw:page-ready' && pageReadyResolve) {
    pageReadyResolve();
  }
});

function waitForThePage() {
  return new Promise(function (resolve) {
    var said = false;
    function go() { if (said) return; said = true; pageReadyResolve = null; resolve(); }
    pageReadyResolve = go;
    setTimeout(go, 8000);
  });
}
function precacheShell() {
  return caches.open(SHELL_CACHE).then((cache) => {
    /* Added one at a time rather than with cache.addAll(). addAll() is atomic:
       a single 404 rejects the whole batch, so one bad URL would leave the
       shell with almost nothing cached and every page would fail offline -
       which is exactly what a longer PRECACHE list makes more likely. Each
       entry is independent here, so a failure costs one asset instead of all
       of them, and the names are logged so the broken URL is visible instead
       of silent. */
    const failed = [];

    /* Concurrency is capped at 6 rather than firing every entry at once.
     *
     * PRECACHE.map + Promise.all issues all of them in the same tick, so a
     * page load opens ~113 simultaneous connections. Against a CDN that is
     * unremarkable. Against `wrangler pages dev` - one node process on one
     * port - it saturates the server, and the page's OWN asset requests queue
     * behind them and come back 502.
     *
     * The service worker does not invent those errors, it relays them: a cache
     * miss falls through to fetch() and hands back whatever the server said.
     * The symptom therefore pointed at the stylesheets, when the cause was
     * the precache storm happening alongside them. The page rendered with no
     * CSS at all and nothing in the markup was wrong.
     *
     * Batching keeps the install quick while leaving the server room to
     * answer the page that triggered it. */
    const CONCURRENCY = 6;
    let cursor = 0;
    const next = function () {
      if (cursor >= PRECACHE.length) return Promise.resolve();
      const url = PRECACHE[cursor++];
      /* Only fetch what is not already cached.
       *
       * The shell cache is not versioned and every asset in it carries its own
       * token, so an unchanged asset is already cached and already correct.
       * Re-fetching all 120 of them on every deployment was 120 requests every
       * time the app was opened, which on a bundled Pages project is 120
       * requests against the plan's daily limit - the limit the site reached,
       * and the reason it stopped serving.
       *
       * A changed asset has a new URL, so it misses the cache and is fetched.
       * A deployment that changes one file now costs one request, not 120. */
      return cache
        .match(url)
        .then(function (hit) {
          /* An entry WITH a token refreshes itself. The token moves when the
             content moves - that is what the token is for, and what
             check-tokens.mjs enforces - so a changed asset has a new URL and
             misses the cache, while an unchanged one is still correct where it
             sits.
           *
           * An entry WITHOUT a token never changes URL, so it cannot refresh
           * itself and has to be fetched again. That is 42 artwork, font and
           * icon files, and they are fetched when the worker activates - which
           * is only after a deployment, not on every opening of the app.
           *
           * Between them, a deployment now costs 42 requests instead of 120,
           * and nothing can go stale. */
          if (hit && url.indexOf("?v=") !== -1) return null;
          /* cache.add() stores ANY response - an HTML 504 page fetched during a
             bad window would be cached under the JS filename and poison this
             device's shell forever. Only 200s are kept. */
          return fetch(new Request(url, { cache: 'reload' }))
            .then(function (res) {
              if (!res || !res.ok || res.redirected) { failed.push(url); return; }
              return cache.put(url, res);
            })
            .catch(function () {
              failed.push(url);
            });
        })
        .then(next);
    };

    /* Collected and awaited, not handed to .then() as an array. */
    const chains = [];
    for (let i = 0; i < Math.min(CONCURRENCY, PRECACHE.length); i++) chains.push(next());
    return Promise.all(chains).then(() => {
      if (failed.length) {
        console.warn('[SW] precache missed ' + failed.length + ':', failed.join(', '));
      }
      /* The index.html shell is the ONE entry this app cannot work offline
         without, and it is the one entry network flakiness has dropped most
         often. One extra attempt, without the reload request mode - if a
         200 comes back it is stored; if it does not, the navigation path
         refreshes it anyway on the user's next page load. */
      return caches.open(SHELL_CACHE)
        .then(function (c) {
          return c.match('./index.html').then(function (hit) {
            if (hit) return;
            return fetch('./index.html').then(function (res) {
              if (res && res.ok) return c.put('./index.html', res);
            }).catch(function () {});
          });
        })
        .then(function () {
          if (failed.length) console.warn('[SW] precache missed ' + failed.length + ' (retried the shell)');
        });
    });
  });
}

self.addEventListener('install', (event) => {
  /* Activate immediately.
   *
   * The precache is deliberately NOT awaited here. This install exists to get
   * the worker live, and a live worker is what receives push events. Waiting on
   * 120 assets meant the install ran past the point where the browser would
   * keep it, so the worker never activated at all - and a worker that never
   * activates can never get a notification, however willing the push service
   * is.
   *
   * The shell is filled in by precacheShell() once the worker is active. */
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== TRACE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
    /* Announce this worker on activate, so the panel can tell "this worker is live
       and no push has arrived" apart from "an older worker is running". Those two
       look identical from the panel otherwise, because both show no push line, and
       that ambiguity is exactly what stalled this. A push overwrites the entry
       with kind: 'push'. */
    .then(() => writeTrace({ at: Date.now(), kind: 'ready', version: VERSION, error: null }))
    /* The shell is filled in AFTER the worker has taken control of the page, so
       the app is usable - and push-capable - straight away rather than after
       120 assets have been fetched. */
    .then(() => waitForThePage())
    .then(() => precacheShell())
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

const PUSH_TITLE = 'TheHighWRLD Dashboard';

/* Only these app routes may be opened from a notification. A push payload is
   server-generated, but the browser can be tricked into relaying one, so the
   destination is validated again here rather than trusted. Anything else falls
   back to the lobby instead of navigating. */
const PUSH_ROUTES = new Set([
  'social:conversation', 'social:requests', 'social:friends',
  // Page routes, named the same way the nav buttons name them. A notification
  // about a community reply opens the community page; one about a ban opens
  // settings. Without these, safeTarget dropped the target and every community
  // notification just focused the app wherever it happened to be.
  'community', 'suggestions', 'hub', 'profile', 'account', 'home',
  // Comment replies open the song page the comment was left on.
  'song', 'wanted'
]);

function safeTarget(raw) {
  return typeof raw === 'string' && PUSH_ROUTES.has(raw) ? raw : null;
}

/* Observation point for the push chain: one cache entry, overwritten per push,
   holding what arrived and anything that threw. Not the subscription, not user
   data - the payload is this app's own notification content. */
const TRACE_CACHE = 'thw-push-trace';
const TRACE_URL = '/__thw_push_trace';

/* How many events to keep.
 *
 * One slot is not enough. The entry is overwritten by every event, so it can
 * only ever describe the most recent one - and a push that arrived while the
 * app was open is erased by the next 'ready' entry, leaving no trace of it at
 * all. That is exactly the question being asked here ("did any of the three
 * pushes I sent get through?"), and a single slot cannot answer it: it can
 * report the last event and nothing about the ones before it.
 *
 * So the trace keeps a short history, newest last, and the panel reads it. */
const TRACE_MAX = 12;

function writeTrace(entry) {
  /* Every entry carries the worker's version, not just the 'ready' one. The
   * last event is usually a push, and a push entry without a version would
   * leave the panel unable to say which build produced it - which is the one
   * thing the panel exists to say. */
  if (!entry.version) entry.version = VERSION;
  return caches.open(TRACE_CACHE).then(function (c) {
    return c.match(TRACE_URL).then(function (prev) {
      return prev ? prev.json() : null;
    }).catch(function () { return null; }).then(function (prev) {
      var history = (prev && prev.history && prev.history.length) ? prev.history : [];
      history.push(entry);
      while (history.length > TRACE_MAX) history.shift();
      var record = {
        at: entry.at,
        kind: entry.kind,
        title: entry.title || '',
        body: entry.body || '',
        error: entry.error || null,
        version: entry.version || '',
        history: history,
      };
      return c.put(TRACE_URL, new Response(JSON.stringify(record), {
        headers: { 'Content-Type': 'application/json' }
      }));
    });
  }).catch(function () {});
}
self.addEventListener('push', (event) => {
  let data = {};
  /* A payload-less push: the service woke the worker with no data at all.
     Recorded, because it is the sharpest diagnostic there is - it does not
     depend on the subscription's keys, so a payload-less push that arrives
     while an encrypted one does not points straight at the keys. */
  let bare = false;
  try {
    if (event.data) {
      data = event.data.json();
    } else {
      bare = true;
    }
  } catch (_) {
    try {
      const text = event.data ? event.data.text() : '';
      data = { title: PUSH_TITLE, body: String(text || '').slice(0, 200) };
    } catch (__) { data = {}; }
  }

  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 60) : PUSH_TITLE;
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '';
  const target = safeTarget(data.url);

  /* The trace is the only way the panel can tell "the push never arrived" from
   * "the push arrived and could not be shown" - the server can only see that
   * the push service accepted the payload.
   *
   * It has to be inside waitUntil to be worth anything. Written on its own it
   * was a floating promise: the browser is free to terminate the worker the
   * moment the event handler returns, and the cache write often lost that race.
   * The trace then kept its earlier "ready" entry, and the panel said no push
   * had arrived - whether or not one had. A signal that can report the opposite
   * of the truth is worse than no signal.
   *
   * So it is awaited first, and the notification is shown only once the trace
   * has landed. If showing it throws, the error is recorded against the same
   * 'push' entry, so the two cases stay distinguishable. */
  event.waitUntil(
    writeTrace({ at: Date.now(), kind: 'push', title: title, body: body, error: null, bare: bare })
      .then(function () {
        return self.registration.showNotification(title, {
          body,
          icon: './icons/icon-192.png',
          badge: './icons/icon-96.png',
          // Same-origin only. A push payload must never be able to make the
          // notification load a remote image and leak that the device is online.
          //
          // The tag is never empty. The spec says showNotification throws a
          // TypeError when renotify is true and the tag is the empty string,
          // and renotify is on below because a notification that replaces an
          // earlier one should still buzz. An empty tag from a crafted payload
          // would therefore take the whole notification down with it, so the
          // fallback is used for an empty string as well as for a missing one.
          tag: (typeof data.tag === 'string' && data.tag)
            ? data.tag.slice(0, 80)
            : 'thw-notification',
          /* Renotify so a notification that REPLACES an earlier one still makes a
             sound and a buzz, the way a phone does. Without it a second reply
             arriving while the first is still on screen is silent. */
          renotify: true,
          /* Grouped by kind, the way a phone groups a conversation. A notification
             the device does not support grouping simply ignores this. */
          threadId: typeof data.threadId === 'string' ? data.threadId.slice(0, 60) : undefined,
          /* Not a silent push: it must appear on the lock screen with a sound. */
          silent: false,
          vibrate: [40, 30, 40],
          timestamp: Date.now(),
          data: { target, type: data.type || '' },
        }).catch(function (err) {
          /* It reached the worker and could not be shown. Record that against
             the same 'push' entry so the panel can say which it was. */
          return writeTrace({
            at: Date.now(), kind: 'push', title: title, body: body,
            error: String((err && err.message) || err),
          });
        });
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
