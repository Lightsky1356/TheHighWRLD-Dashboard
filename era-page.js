/* Era pages — the vault's record of every chapter, one page per era.
 *
 * JUICE WRLD's discography is defined by his eras, and TheHighWRLD's vault
 * is filed by them too. Each era gets a page: the hero with the era's
 * numbers, the most played songs of it, the full list, prev/next nav.
 *
 * Routing runs through the one chain everything else uses:
 *   - /era                      the chooser
 *   - /era/<slug>               the era detail page
 *
 * Two rules keep this file simple and freeze-proof:
 *
 *   1. NOTHING inside this file calls window.switchAppPage. The switch only
 *      toggles classes; rendering is driven by the switch rather than the
 *      other way around. The renderer must therefore be idempotent and
 *      quiet - it writes into #page-section-era and lets the switch turn
 *      it on or off.
 *   2. The route is whatever the address bar says it is, re-read on every
 *      entry. There is no separate "current era" state to drift.
 *
 * Rendering is wired up by watching the switch itself (the same pattern
 * the leaderboard uses), so every entry point - the nav pill, the footer,
 * the vault cards, the credits panels, the context menu - renders the
 * exact same way. Cold loads are handled by the switch too, which means
 * no special-casing of the boot path remains.
 */
(function () {
  "use strict";
  if (window.__eraPageMounted) return;
  window.__eraPageMounted = true;

  var ERAS = [
    { code: "SOUNDCLOUD", slug: "soundcloud", name: "SoundCloud era",         sub: "The tapes before the vault", art: null },
    { code: "AF",         slug: "af",         name: "affliction",             sub: "The very first recordings",  art: null },
    { code: "BDM",        slug: "bdm",        name: "BINGEDRINKINGMUSIC",     sub: "2017",                       art: null },
    { code: "ND",         slug: "nd",         name: "NOTHING'S DIFFERENT </3", sub: "Late 2017",               art: null },
    { code: "GB&GR",      slug: "gbgr",       name: "Goodbye & Good Riddance", sub: "Dec 2017 – May 2018",        art: "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/Covers/GB%26GR.png" },
    { code: "WOD",        slug: "wod",        name: "WRLD ON DRUGS",          sub: "2018",                       art: "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/Covers/WOD.png" },
    { code: "DRFL",       slug: "drfl",       name: "Death Race For Love",    sub: "Oct 2018 – Mar 2019",        art: "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/Covers/DRFL.png" },
    { code: "JW3",        slug: "jw3",        name: "Legends Never Die",      sub: "2019–2020",                  art: null },
    { code: "OUT",        slug: "out",        name: "Outsiders",              sub: "2019–2020",                  art: null },
    { code: "POST",       slug: "post",       name: "Posthumous",             sub: "Dec 2019 – present",         art: null },
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function tl() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    return [];
  }
  function eraOf(t) {
    try {
      var m = String((t || {}).tag || "").match(/\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }
  function catLabel(t) {
    var c = String((t || {}).category || "");
    return c === "leaks" ? "Leaks" : c === "sessions" ? "Sessions" : c === "halloween" ? "Halloween" : "";
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function baseTitle(title) {
    return String(title == null ? "" : title).split("(")[0].trim().toLowerCase();
  }
  function coverThumb(src, tier) {
    try { if (typeof window._coverThumb === "function") return window._coverThumb(src || "Juice-WRLD.png", tier || "320") || src; } catch (e) {}
    return src || "Juice-WRLD.png";
  }
  function eraIndices(code) {
    var list = tl();
    var out = [];
    for (var i = 0; i < list.length; i++) if (eraOf(list[i]) === code) out.push(i);
    return out;
  }
  function eraCounts(code) {
    var list = tl();
    var idxs = eraIndices(code);
    var sec = 0, leak = 0, halloween = 0, dur = 0;
    idxs.forEach(function (i) {
      var c = list[i].category;
      if (c === "sessions") sec++;
      else if (c === "leaks") leak++;
      else if (c === "halloween") halloween++;
      dur += Number(list[i].duration) || 0;
    });
    return { total: idxs.length, sessions: sec, leaks: leak, halloween: halloween, duration: dur };
  }
  function eraYears(code) {
    var list = tl();
    var idxs = eraIndices(code);
    var min = 9999, max = -1;
    idxs.forEach(function (i) {
      var y = parseInt(list[i].year, 10);
      if (isNaN(y) || !y) return;
      if (y < min) min = y;
      if (y > max) max = y;
    });
    if (max < min) return "";
    return String(min) + (min !== max ? "–" + max : "");
  }
  function pickEraArt(code) {
    var def = null;
    for (var i = 0; i < ERAS.length; i++) if (ERAS[i].code === code) { def = ERAS[i]; break; }
    if (!def) return "";
    if (def.art) return def.art;
    var idxs = eraIndices(code);
    if (!idxs.length) return "";
    var list = tl();
    return list[idxs[0]].cover || "";
  }
  function eraDef(key) {
    var k = String(key || "").toLowerCase();
    for (var i = 0; i < ERAS.length; i++) {
      var e = ERAS[i];
      if (e.code.toLowerCase() === k || e.slug === k) return e;
    }
    return null;
  }
  function parseRoute() {
    var p = String(location.pathname || "").replace(/\/+$/, "");
    var m = /^\/era(?:\/([^\/]+))?$/i.exec(p);
    if (!m) return null;
    return { slug: m[1] ? decodeURIComponent(m[1]).toLowerCase() : "" };
  }
  function pushRoute(slug) {
    try {
      var want = slug ? "/era/" + encodeURIComponent(slug) : "/era";
      if (location.pathname !== want && history.pushState) history.pushState({ era: slug || "" }, "", want);
    } catch (e) {}
  }
  function sectionTitle(t) { return document.title = t; }

  /* shuffle-era: pick a random opener, fill the queue with distinct random era songs */
  function playEra(era, shuffle) {
    var idxs = eraIndices(era.code);
    if (!idxs.length) return;
    var order = idxs.slice();
    if (shuffle === false) order.sort(function (a, b) {
      var list = tl();
      var ya = parseInt(list[a].year, 10) || 0, yb = parseInt(list[b].year, 10) || 0;
      return ya - yb;
    });
    else {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
    }
    try { if (typeof clearQueue === "function") window.clearQueue(); else if (typeof trackQueue !== "undefined" && trackQueue.length) trackQueue.length = 0; } catch (e) {}
    var first = order[0];
    if (window.selectTrackFromList) window.selectTrackFromList(first);
    if (typeof addToQueue === "function") {
      for (var k = 1; k < order.length && k <= 14; k++) addToQueue(order[k]);
    }
    try { if (typeof showToast === "function") showToast(era.name + " is on air", "success", 2400); } catch (e) {}
  }

  var TRENDING_CACHE_KEY = "thwTrendingCache";
  var TRENDING_CACHE_AT = "thwTrendingCacheAt";
  function loadTrending(cb) {
    var now = Date.now();
    try {
      var at = Number(sessionStorage.getItem(TRENDING_CACHE_AT) || 0);
      var cached = JSON.parse(sessionStorage.getItem(TRENDING_CACHE_KEY) || "[]");
      if (at && now - at < 5 * 60 * 1000 && Array.isArray(cached)) { cb(cached); return; }
    } catch (e) {}
    fetch("/api/trending?days=365&limit=300", { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        var list = (data && data.trending) || [];
        try {
          sessionStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify(list));
          sessionStorage.setItem(TRENDING_CACHE_AT, String(now));
        } catch (e) {}
        cb(list);
      })
      .catch(function () { cb(null); });
  }

  function heroArt(def) {
    return coverThumb(pickEraArt(def.code), "640");
  }

  function openEra(pane, def) {
    sectionTitle(def.name + " - TheHighWRLD Dashboard");

    var counts = eraCounts(def.code);
    var years = eraYears(def.code);
    var list = tl();

    var pos = -1;
    for (var i = 0; i < ERAS.length; i++) if (ERAS[i].code === def.code) { pos = i; break; }
    var prev = null, next = null;
    for (var p = pos - 1; p >= 0 && !prev; p--) if (eraIndices(ERAS[p].code).length) prev = ERAS[p];
    for (var n = pos + 1; n < ERAS.length && !next; n++) if (eraIndices(ERAS[n].code).length) next = ERAS[n];

    var heroTiles = [
      { n: counts.total, l: "Songs" },
      { n: counts.sessions, l: "Sessions" },
      { n: counts.leaks, l: "Leaks" },
    ];
    if (counts.halloween) heroTiles.push({ n: counts.halloween, l: "Halloween" });

    pane.innerHTML =
      '<div class="era-page">' +
        '<div class="era-toolbar"><button class="era-back" id="era-back" type="button"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>The Vault</span></button></div>' +
        '<header class="era-hero">' +
          '<div class="era-hero-artwrap"><img class="era-hero-art" id="era-hero-art" src="' + esc(heroArt(def)) + '" alt="" decoding="async" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'"></div>' +
          '<div class="era-hero-body">' +
            '<div class="era-chips">' +
              '<span class="era-chip era-chip-code"><i class="fas fa-circle" aria-hidden="true"></i>' + esc(def.code) + ' era</span>' +
              (years ? '<span class="era-chip"><i class="fas fa-calendar" aria-hidden="true"></i>' + esc(years) + '</span>' : '') +
            '</div>' +
            '<h1 class="era-hero-title">' + esc(def.name) + '</h1>' +
            '<p class="era-hero-sub">' + esc(def.sub) + '</p>' +
            '<p class="era-hero-count">' + counts.total + ' songs · ' + fmtTime(counts.duration) + ' total</p>' +
            '<div class="era-stat-grid">' +
              heroTiles.map(function (s) { return '<div class="era-stat"><b>' + s.n + '</b><span>' + esc(s.l) + '</span></div>'; }).join("") +
            '</div>' +
            '<div class="era-actions">' +
              '<button class="era-btn era-btn-primary" id="era-play" type="button"><i class="fas fa-play" aria-hidden="true"></i><span>Play era</span></button>' +
              '<button class="era-btn era-btn-ghost" id="era-shuffle" type="button"><i class="fas fa-shuffle" aria-hidden="true"></i><span>Shuffle</span></button>' +
              '<button class="era-btn era-btn-ghost" id="era-in-vault" type="button"><span>In the vault</span><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
            '</div>' +
            '<div class="era-prevnext">' +
              (prev ? '<button class="era-pn era-pn-prev" id="era-prev" type="button"><i class="fas fa-chevron-left" aria-hidden="true"></i><span class="era-pn-stack"><small>Previous</small><strong>' + esc(prev.name) + '</strong></span></button>' : '<span></span>') +
              (next ? '<button class="era-pn era-pn-next" id="era-next" type="button"><span class="era-pn-stack"><small>Next</small><strong>' + esc(next.name) + '</strong></span><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' : '<span></span>') +
            '</div>' +
          '</div>' +
        '</header>' +

        '<section class="era-section">' +
          '<div class="era-section-head"><h2><i class="fas fa-chart-simple" aria-hidden="true"></i> Most played in the era</h2><span class="era-section-count">all time</span></div>' +
          '<ol class="era-most-list" id="era-most-list"></ol>' +
        '</section>' +

        '<section class="era-section">' +
          '<div class="era-section-head"><h2><i class="fas fa-compact-disc" aria-hidden="true"></i> Every song from the era</h2><span class="era-section-count">' + counts.total + ' songs</span></div>' +
          '<div class="era-list" id="era-list"></div>' +
        '</section>' +
      '</div>';

    document.getElementById("era-back").addEventListener("click", function () {
      if (window.switchAppPage) window.switchAppPage("hub");
      if (window.__thwGoTo) window.__thwGoTo("/vault");
    });
    document.getElementById("era-play").addEventListener("click", function () { playEra(def, false); });
    document.getElementById("era-shuffle").addEventListener("click", function () { playEra(def, true); });
    document.getElementById("era-in-vault").addEventListener("click", function () {
      if (window.switchAppPage) window.switchAppPage("hub");
      if (window.__thwGoTo) window.__thwGoTo("/vault");
    });
    var prevBtn = document.getElementById("era-prev");
    if (prevBtn) prevBtn.addEventListener("click", function () { window.openEraPage(prev.slug); });
    var nextBtn = document.getElementById("era-next");
    if (nextBtn) nextBtn.addEventListener("click", function () { window.openEraPage(next.slug); });

    /* the full list, years newest first */
    var idxs = eraIndices(def.code);
    var sorted = idxs.slice().sort(function (a, b) {
      var ya = parseInt(list[a].year, 10) || 0, yb = parseInt(list[b].year, 10) || 0;
      if (ya !== yb) return yb - ya;
      return String(list[a].title).localeCompare(String(list[b].title));
    });
    var listEl = document.getElementById("era-list");
    sorted.forEach(function (i) {
      var t = list[i];
      var row = document.createElement("button");
      row.type = "button";
      row.className = "era-row";
      row.innerHTML =
        '<img decoding="async" loading="lazy" class="era-row-cover" src="' + esc(coverThumb(t.cover, "64")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<span class="era-row-meta"><span class="era-row-title">' + esc(t.title) + '</span>' +
          '<span class="era-row-sub">' + esc(catLabel(t)) + (t.year ? " · " + esc(t.year) : "") + '</span>' +
        '</span>' +
        '<span class="era-row-len">' + fmtTime(t.duration) + '</span>' +
        '<span class="era-row-play"><i class="fas fa-play" aria-hidden="true"></i></span>';
      row.addEventListener("click", function () { if (window.selectTrackFromList) window.selectTrackFromList(i); });
      listEl.appendChild(row);
    });

    /* most played */
    var most = document.getElementById("era-most-list");
    loadTrending(function (data) {
      if (!data) { most.innerHTML = '<li class="era-most-empty">Plays are not being counted right now.</li>'; return; }
      var lookup = {};
      data.forEach(function (t) { lookup[String(t.title)] = t; });
      var counted = [];
      eraIndices(def.code).forEach(function (i) {
        var t = list[i];
        var hit = lookup[String(t.title)];
        if (hit) counted.push({ idx: i, plays: Number(hit.plays) || 0, title: t.title, cover: t.cover, category: t.category, year: t.year });
      });
      counted.sort(function (a, b) { return b.plays - a.plays; });
      var top = counted.slice(0, 8);
      if (!top.length) { most.innerHTML = '<li class="era-most-empty">No plays counted for this era yet.</li>'; return; }
      most.textContent = "";
      top.forEach(function (c, k) {
        var li = document.createElement("li");
        li.className = "era-most-row";
        var play = document.createElement("button");
        play.type = "button";
        play.className = "era-most-btn";
        play.innerHTML =
          '<span class="era-most-rank">' + (k + 1) + '</span>' +
          '<img decoding="async" loading="lazy" class="era-row-cover" src="' + esc(coverThumb(c.cover, "64")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<span class="era-row-meta"><span class="era-row-title">' + esc(c.title) + '</span>' +
            '<span class="era-row-sub">' + esc(catLabel(list[c.idx])) + (c.year ? " · " + esc(c.year) : "") + '</span>' +
          '</span>' +
          '<span class="era-most-plays"><b>' + c.plays + '</b><small>plays</small></span>';
        play.addEventListener("click", function () { if (window.selectTrackFromList) window.selectTrackFromList(c.idx); });
        li.appendChild(play);
        most.appendChild(li);
      });
    });
  }

  function renderChoose(pane) {
    sectionTitle("The Eras - TheHighWRLD Dashboard");
    var list = tl();
    var html = "";
    ERAS.forEach(function (era) {
      var idxs = eraIndices(era.code);
      if (!idxs.length) return;
      var sec = 0, leak = 0;
      idxs.forEach(function (i) {
        var c = list[i].category;
        if (c === "sessions") sec++;
        else if (c === "leaks") leak++;
      });
      html +=
        '<button type="button" class="era-card" data-era-open="' + esc(era.slug) + '">' +
          '<img decoding="async" loading="lazy" class="era-card-art" src="' + esc(coverThumb(pickEraArt(era.code), "320")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<span class="era-card-code">' + esc(era.code) + '</span>' +
          '<span class="era-card-name">' + esc(era.name) + '</span>' +
          '<span class="era-card-count">' + idxs.length + ' songs · ' + sec + ' sessions · ' + leak + ' leaks</span>' +
        '</button>';
    });

    pane.innerHTML =
      '<div class="era-page">' +
        '<div class="era-toolbar"><button class="era-back" id="era-back" type="button"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>The Vault</span></button></div>' +
        '<header class="era-chooser-hero"><h1>Every era, one page</h1><p>The chapters the vault is filed under — each with its own page, its numbers, and the most played in it.</p></header>' +
        '<div class="era-chooser-grid">' + html + '</div>' +
      '</div>';

    document.getElementById("era-back").addEventListener("click", function () {
      if (window.switchAppPage) window.switchAppPage("hub");
      if (window.__thwGoTo) window.__thwGoTo("/vault");
    });
    pane.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest("[data-era-open]") : null;
      if (card) window.openEraPage(card.getAttribute("data-era-open"));
    });
  }

  function renderRoute() {
    var pane = document.getElementById("page-section-era");
    if (!pane) return;
    var route = parseRoute();
    if (!route || !route.slug) return renderChoose(pane);
    var def = eraDef(route.slug);
    if (!def) return renderChoose(pane);
    openEra(pane, def);
  }

  window.openEraPage = function (code) {
    var def = eraDef(code);
    pushRoute(def ? def.slug : "");
    var pane = document.getElementById("page-section-era");
    if (!pane) return;
    /* Switch into the section without re-calling the switch's own listener
       (it does nothing beyond flipping classes here anyway). */
    if (window.switchAppPage) {
      var eraSection = document.getElementById("page-section-era");
      if (eraSection && !eraSection.classList.contains("active")) window.switchAppPage("era");
    }
    if (!def) { renderChoose(pane); return; }
    openEra(pane, def);
  };

  window.__thwResolveEra = function (code) {
    window.openEraPage(code || "");
  };

  /* Wake the page when the switch flips to it. Same pattern the leaderboard
     uses: install once, run after the base switch so classes are already set,
     guard the input so calling render twice in one flip is safe. */
  (function wrap() {
    if (typeof window.switchAppPage !== "function" || window.__eraSwitchWrapped) return;
    window.__eraSwitchWrapped = true;
    var orig = window.switchAppPage;
    window.switchAppPage = function (page) {
      var out = orig.apply(this, arguments);
      if (page === "era") {
        /* Fill here: the pane exists in static HTML and may hold last
           visit's content; re-render to match the current route. */
        try { renderRoute(); } catch (e) { /* never break the switch */ }
      }
      return out;
    };
  })();

  /* Boot: if we are already standing on /era, the boot path flips to this
     section via switchAppPage("era"), which runs the wrap and renders it.
     This catches the edge where the section starts already active (the
     static home page ships 'active' in its markup). */
  if (/^\/era\/?$/i.test(location.pathname || "")) {
    var pane = document.getElementById("page-section-era");
    if (pane && pane.classList.contains("active") && !pane.innerHTML.trim()) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderRoute);
      else renderRoute();
    }
  }

  /* Popstate: the address bar changes without a switch call in some flows;
     re-render to match. */
  window.addEventListener("popstate", function () {
    var r = parseRoute();
    if (r) renderRoute();
  });
})();
