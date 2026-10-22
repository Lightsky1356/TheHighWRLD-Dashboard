/* Trending in the WRLD + Surprise shuffle.
 * Fetches /api/trending (D1 listens aggregate) and docks a cover-art strip
 * under the WRLD Player playlist (#playlist-panel). Clicking a card plays
 * that vault track; the dice button calls the global spinTrack(). */
(function () {
  "use strict";
  if (window.__trendingMounted) return;
  window.__trendingMounted = true;

  var LIMIT = 8;
  var FALLBACK_COVER = "Juice-WRLD.png";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* tracks.js declares `const trackList` (lexical global, NOT window.trackList),
     so resolve it without the window. prefix. */
  function getTL() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    try { if (window.trackList && window.trackList.length) return window.trackList; } catch (e2) {}
    return [];
  }

  function findTrack(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    if (!tl.length || !low) return { idx: -1, cover: "" };
    var i, t;
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      if (String(t.title || "").trim().toLowerCase() === low) return { idx: i, cover: t.cover || "" };
    }
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      var tag = String(t.tag || "").toLowerCase();
      if (tag && (tag.indexOf(low) >= 0 || low.indexOf(String(t.title || "").trim().toLowerCase()) >= 0)) {
        return { idx: i, cover: t.cover || "" };
      }
    }
    return { idx: -1, cover: "" };
  }

  function playTitle(title) {
    var hit = findTrack(title);
    if (hit.idx < 0) return false;
    try {
      if (window.selectTrackFromList) window.selectTrackFromList(hit.idx);
      if (window.switchAppPage) window.switchAppPage("player");
      return true;
    } catch (e) { return false; }
  }

  function injectCSS() {
    if (document.getElementById("trending-style")) return;
    var st = document.createElement("style");
    st.id = "trending-style";
    st.textContent =
      ".trending-sec{max-width:72rem;margin:0 auto;width:100%;padding:0 1rem 2rem}" +
      ".trending-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}" +
      ".trending-title{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;background:linear-gradient(90deg,#fcd34d,#f59e0b);-webkit-background-clip:text;background-clip:text;color:transparent;display:flex;align-items:center;gap:8px}" +
      ".trending-range{margin-left:auto;font-size:10px;color:rgba(255,255,255,.4);font-family:monospace}" +
      ".trending-shuffle{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.1);color:#fbbf24;border-radius:9999px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;transition:background .15s ease,color .15s ease}" +
      ".trending-shuffle:hover{background:rgba(251,191,36,.22);color:#fff}" +
      ".trending-row{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 10px;scroll-snap-type:x mandatory;scrollbar-width:thin}" +
      ".trending-card{position:relative;flex:0 0 auto;width:152px;text-align:left;border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border-radius:14px;padding:0;cursor:pointer;color:#fff;overflow:hidden;scroll-snap-align:start;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}" +
      ".trending-card:hover{transform:translateY(-3px);border-color:rgba(251,191,36,.5);box-shadow:0 10px 28px rgba(0,0,0,.45)}" +
      ".trending-cover{position:relative;display:block;width:100%;aspect-ratio:1/1;background:#1c1530;overflow:hidden}" +
      ".trending-cover img{width:100%;height:100%;object-fit:cover;display:block}" +
      ".trending-play-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);opacity:0;transition:opacity .15s ease}" +
      ".trending-card:hover .trending-play-ov{opacity:1}" +
      ".trending-play-ov span{width:42px;height:42px;border-radius:50%;background:rgba(251,191,36,.92);color:#1a1005;display:flex;align-items:center;justify-content:center;font-size:15px}" +
      ".trending-rank{position:absolute;top:8px;left:8px;min-width:24px;height:24px;padding:0 6px;border-radius:8px;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fbbf24;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:monospace}" +
      ".trending-rank.r1{background:linear-gradient(135deg,#fcd34d,#b45309);color:#1a1005}" +
      ".trending-meta{display:block;padding:9px 10px 11px}" +
      ".trending-name{display:block;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".trending-plays{display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,.5);font-family:monospace;margin-top:4px}" +
      ".trending-empty{font-size:11px;color:rgba(255,255,255,.45);padding:6px 2px}" +
      ".trending-skel{flex:0 0 auto;width:152px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.06)}" +
      ".trending-skel-cover{width:100%;aspect-ratio:1/1;background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:trending-shimmer 1.2s infinite}" +
      ".trending-skel-line{height:10px;margin:9px 10px 0;border-radius:5px;background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:trending-shimmer 1.2s infinite}" +
      ".trending-skel-line.short{margin:6px 10px 11px;width:55%}" +
      "@keyframes trending-shimmer{to{background-position:-200% 0}}";
    (document.head || document.documentElement).appendChild(st);
  }

  function headHTML(days, total) {
    return '<div class="trending-head"><span class="trending-title"><i class="fas fa-fire"></i> Trending in the WRLD</span>' +
      '<button type="button" class="trending-shuffle" id="trending-shuffle"><i class="fas fa-shuffle"></i> Surprise me</button>' +
      '<span class="trending-range">last ' + days + 'd &middot; ' + Number(total || 0).toLocaleString() + ' plays</span></div>';
  }

  function skelHTML() {
    var h = "";
    for (var i = 0; i < LIMIT; i++) {
      h += '<div class="trending-skel"><div class="trending-skel-cover"></div><div class="trending-skel-line"></div><div class="trending-skel-line short"></div></div>';
    }
    return h;
  }

  function cardHTML(t) {
    var hit = findTrack(t.title);
    var cover = hit.cover || FALLBACK_COVER;
    var rk = t.rank === 1 ? "trending-rank r1" : "trending-rank";
    return '<button type="button" class="trending-card" data-trending-title="' + esc(t.title) + '">' +
      '<span class="trending-cover"><img decoding="async" src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + FALLBACK_COVER + '\'">' +
      '<span class="trending-play-ov"><span><i class="fas fa-play"></i></span></span>' +
      '<span class="' + rk + '">#' + t.rank + '</span></span>' +
      '<span class="trending-meta"><span class="trending-name">' + esc(t.title) + '</span>' +
      '<span class="trending-plays"><i class="fas fa-headphones"></i> ' + Number(t.plays || 0).toLocaleString() + ' plays</span></span></button>';
  }

  function shell() {
    var sec = document.getElementById("trending-sec");
    if (sec) return sec;
    injectCSS();
    sec = document.createElement("section");
    sec.id = "trending-sec";
    sec.className = "trending-sec";
    sec.innerHTML = headHTML(7, 0) + '<div class="trending-row" id="trending-row">' + skelHTML() + '</div>';
    /* Dock under the WRLD Player playlist; fall back to the Lobby. */
    var plist = document.getElementById("playlist-panel");
    if (plist && plist.parentNode) {
      plist.parentNode.insertBefore(sec, plist.nextSibling);
    } else {
      var anchor = document.getElementById("daily-track");
      if (anchor) {
        var host = anchor.closest ? anchor.closest("section") : null;
        if (host && host.parentNode) host.parentNode.insertBefore(sec, host.nextSibling);
        else if (anchor.parentNode) anchor.parentNode.appendChild(sec);
        else document.body.appendChild(sec);
      } else {
        var home = document.getElementById("page-section-home");
        if (home) home.appendChild(sec);
        else document.body.appendChild(sec);
      }
    }
    sec.addEventListener("click", function (e) {
      var sh = e.target.closest("#trending-shuffle");
      if (sh) {
        try { if (window.spinTrack) window.spinTrack(); } catch (err) {}
        return;
      }
      var card = e.target.closest("[data-trending-title]");
      if (card) playTitle(card.getAttribute("data-trending-title"));
    });
    return sec;
  }

  function fill(items, days, total) {
    var sec = shell();
    var head = sec.querySelector(".trending-head");
    if (head) head.outerHTML = headHTML(days, total);
    var row = sec.querySelector("#trending-row");
    if (!row) return;
    if (!items.length) {
      row.innerHTML = '<p class="trending-empty">No plays logged yet this week — be the first.</p>';
      return;
    }
    row.innerHTML = items.map(cardHTML).join("");
  }

  function boot() {
    shell();
    /* The trending tracks come with the bootstrap, when it has been
       * fetched - one request carrying several answers rather than one
       * request each. */
    /* The trending tracks come with the bootstrap - one request carrying
       several answers rather than one request each. */
    var take = window.THWBootstrap && window.THWBootstrap.take;
    var ask = function () {
      return fetch("/api/trending?days=7&limit=" + LIMIT, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d && d.ok ? d : null; });
    };
    (take ? take("trending", ask) : ask()).then(function (d) {
      /* The answer is read the same way whichever it came from.
       *
       * It used to insist on an "ok" and throw the whole section away
       * without it - so a shape that was one field different took the
       * trending strip off the page with nothing to show for it. A bare
       * list is understood, and only an outright failure removes the
       * section. */
      var payload = Array.isArray(d) ? { ok: true, trending: d, days: 7, total_listens: 0 } : d;
      if (!payload || payload.ok === false) {
        var sec = document.getElementById("trending-sec");
        if (sec) sec.remove();
        return;
      }
      fill(payload.trending || [], payload.days || 7, payload.total_listens || 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
