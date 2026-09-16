/* TheHighWRLD user relations — block/mute identity cache.
   One-shot loading: at most a single GET /api/users/me per page load (kept in
   sessionStorage with a 5-minute TTL). ZERO polling, ZERO MutationObserver,
   no repeated D1 queries. Renderers call the synchronous getters after the
   module has been refreshed; content authored by a blocked user is hidden
   client-side only for this viewer (blocking is personal). */
(function () {
  'use strict';

  var CACHE = null;          // { signedIn, linked, blocked:[], muted:[] }
  var LOADED_AT = 0;
  var PROMISE = null;
  var TTL = 5 * 60 * 1000;
  var CHANGERS = [];
  var LAST_SNAPSHOT = '';
  var LAST_FETCH_AT = 0;

  function storageKey() { return 'thw_relations_v1'; }

  function parseCached() {
    try {
      var raw = sessionStorage.getItem(storageKey());
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.at || Date.now() - d.at > TTL) return null;
      return d.d;
    } catch (e) { return null; }
  }

  function saveCache() {
    try {
      var s = JSON.stringify({ at: Date.now(), d: CACHE });
      LAST_SNAPSHOT = s;
      sessionStorage.setItem(storageKey(), s);
    } catch (e) {}
  }

  function empty() { return { signedIn: false, linked: false, blocked: [], muted: [] }; }

  function fetchFresh(force) {
    if (!force) {
      var fromCache = parseCached();
      if (fromCache) {
        CACHE = fromCache;
        LOADED_AT = Date.now();
        return Promise.resolve(CACHE);
      }
    }
    LAST_FETCH_AT = Date.now();
    return fetch('/api/users/me', { cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        CACHE = {
          signedIn: !!(d && d.ok && d.signedIn),
          linked: !!(d && d.ok && d.linked),
          blocked: (d && d.ok && d.blocked) || [],
          muted: (d && d.ok && d.muted) || [],
        };
        LOADED_AT = Date.now();
        saveCache();
        return CACHE;
      })
      .catch(function () {
        CACHE = empty();
        return CACHE;
      });
  }

  function refresh() {
    if (PROMISE) return PROMISE;
    PROMISE = fetchFresh().then(function (c) {
      PROMISE = null;
      return c;
    }, function (c) {
      PROMISE = null;
      return c || empty();
    });
    return PROMISE;
  }

  function sync() {
    if (CACHE) return CACHE;
    CACHE = parseCached() || empty();
    return CACHE;
  }

  function index(list) {
    var byUid = {}, byDiscord = {};
    (list || []).forEach(function (p) {
      if (p && p.uid) byUid[String(p.uid)] = true;
      if (p && p.discordId) byDiscord[String(p.discordId)] = true;
    });
    return { byUid: byUid, byDiscord: byDiscord };
  }

  function fireChange() {
    for (var i = 0; i < CHANGERS.length; i++) {
      try { CHANGERS[i](); } catch (e) {}
    }
  }

  async function mutate(method, uid) {
    var path = '/api/users/' + encodeURIComponent(String(uid)) + '/' + (method === 'block' || method === 'unblock' ? 'block' : 'mute');
    var http = (method === 'block' || method === 'mute') ? 'POST' : 'DELETE';
    var r = await fetch(path, { method: http, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    var d = await r.json().catch(function () { return {}; });
    await fetchFresh(true);
    fireChange();
    return { status: r.status, ok: r.ok && d && d.ok, data: d };
  }

  /* Cross-tab + refocus freshness:
     - `storage` fires in OTHER tabs when one writes the cache. Compare against
       our own snapshot to skip self-originated values (no ping-pong).
     - focus/visibilitychange re-sync after returning to the tab (debounced). */
  function onForeground() {
    var now = Date.now();
    if (PROMISE || now - LAST_FETCH_AT < 3000) return;
    PROMISE = fetchFresh(true).then(function (c) {
      PROMISE = null;
      return c;
    }, function (c) {
      PROMISE = null;
      return c || empty();
    });
  }
  document.addEventListener('storage', function (ev) {
    if (!ev || ev.key !== storageKey() || ev.newValue === LAST_SNAPSHOT) return;
    onForeground();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) onForeground();
  });
  window.addEventListener('focus', onForeground);

  window.userRelations = {
    refresh: refresh,
    ready: refresh,
    sync: sync,
    signedIn: function () { return !!sync().signedIn; },
    linked: function () { return !!sync().linked; },
    blockedUid: function (uid) { if (!uid) return false; return !!index(sync().blocked).byUid[String(uid)]; },
    blockedDiscord: function (id) { if (!id) return false; return !!index(sync().blocked).byDiscord[String(id)]; },
    mutedUid: function (uid) { if (!uid) return false; return !!index(sync().muted).byUid[String(uid)]; },
    mutedDiscord: function (id) { if (!id) return false; return !!index(sync().muted).byDiscord[String(id)]; },
    uidForDiscord: function (id) {
      if (!id) return '';
      var b = sync().blocked || [], m = sync().muted || [];
      for (var i = 0; i < b.length; i++) if (String(b[i].discordId) === String(id)) return b[i].uid;
      for (var j = 0; j < m.length; j++) if (String(m[j].discordId) === String(id)) return m[j].uid;
      return '';
    },
    block: function (uid) { return mutate('block', uid); },
    unblock: function (uid) { return mutate('unblock', uid); },
    mute: function (uid) { return mutate('mute', uid); },
    unmute: function (uid) { return mutate('unmute', uid); },
    onChange: function (fn) { if (typeof fn === 'function') CHANGERS.push(fn); },
  };

  try { LAST_SNAPSHOT = sessionStorage.getItem(storageKey()) || ''; } catch (e) {}
})();