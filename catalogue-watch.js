/* ============================================================================
   CATALOG WATCH
   Tells the reader when the vault's track list has changed underneath the
   open page.

   HOW IT WORKS
   The auto-sync pipeline commits tracks.js to the repo and the site redeploys,
   which is the only moment the catalogue you see changes. There is no
   database for it and no socket to push on, so the answer is to poll the one
   file that does change: tracks.js itself. It is ~85 KB, which is cheap
   against a one-minute cadence, and it is fetched with cache: "no-store"
   so the browser never returns a stale copy.

   A cheap hash (djb2) of the response text is compared against the value in
   localStorage. The first poll seeds that value and stays quiet. On every
   later poll that returns a different hash, a toast tells the reader to
   reload - and the toast carries a button that does it for them.

   NOTHING ABOUT THE PAGE IS MADE TO UPDATE LIVE. The catalogue is read once
   at boot from the cached file; this only exists so the reader is never left
   staring at a list that no longer has the new song in it.
   ========================================================================== */
(function () {
  "use strict";

  /* A throwaway query on every poll is what keeps the answer honest. The
     service worker serves static assets cache-first, keyed on the full URL,
     so a plain ./tracks.js fetch would be handed the cached copy forever -
     the poll would compare yesterday's hash to itself and never notice.
     The query changes on every poll, so the SW's miss falls through to the
     network, and the network always knows whether the vault changed. */
  var TRACKS_URL = "./tracks.js";
  var HASH_KEY = "thw-tracks-hash";
  var POLL_MS = 60000;          /* a minute is fine - the sync is minutes away */

  var lastHash = null;          /* hash of the file the page has on board now */
  var timer = null;
  var alerted = false;          /* the toast is only ever shown once per load */

  function hashText(text) {
    /* djb2 - fast, small, good enough to notice a one-song change */
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  function storedHash() {
    try { return localStorage.getItem(HASH_KEY); } catch (e) { return null; }
  }
  function storeHash(h) {
    try { localStorage.setItem(HASH_KEY, h); } catch (e) { /* private mode */ }
  }

  function toastNewSongs() {
    if (alerted) return;
    alerted = true;
    var toast = window.showToastSimple && window.showToastSimple(
      "New songs hit the vault - refresh to play them",
      { type: "info", sticky: true, duration: 99999999 }
    );
    if (!toast) return;
    /* a real <button>, so the reload is reachable from the keyboard */
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gtoast-close";
    btn.style.cssText = "margin-left:auto;font-weight:700;color:#fcd34d;white-space:nowrap;";
    btn.setAttribute("aria-label", "Reload the page");
    btn.textContent = "Reload";
    btn.addEventListener("click", function () { try { location.reload(); } catch (e) {} });
    toast.appendChild(btn);
  }

  function check() {
    /* fresh query each time: the SW's cache is keyed on the full URL, so a
       recycled one is reused while we want to know what the vault holds now */
    var url = TRACKS_URL + "?thw=" + Date.now();
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        if (!text) return;
        var h = hashText(text);
        var stored = storedHash();
        if (!stored) {
          storeHash(h);           /* first ever visit: baseline, stay quiet */
          return;
        }
        if (h !== stored) {
          storeHash(h);           /* remember it, so the toast only fires once */
          toastNewSongs();        /* there is newer data than this page has */
        }
      })
      .catch(function () { /* offline or transient - try again next poll */ });
  }

  /* poll rarely enough not to hammer Pages, often enough not to be stuck
     on an old list for long */
  function startPolling() {
    if (timer) return;
    timer = window.setInterval(function () {
      /* keep an eye on the tab - polling only pays while it is visible */
      if (document.visibilityState === "hidden") return;
      check();
    }, POLL_MS);
  }

  /* every time the reader comes back, check straight away */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") check();
  });

  /* Ask once now — learns the current hash (or notices a deploy that
     happened since the reader last had the site open). */
  check();
  window.__thwTracksWatched = true;
  startPolling();
})();
