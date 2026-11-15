/* ==========================================================================
   THE TRACKER — the vault index.

   juicewrld.io lists 1,277 songs and 2,622 versions; the vault only holds
   what we actually know about - 294 songs, computed live, nothing invented.
   Every filter, count and row traces back to trackList and nothing else.

   Rows are buttons: clicking one plays the song, like the era rows.
   ========================================================================== */
(function () {
  "use strict";

  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;
  var ERA_LABELS = {
    GBGR: "Goodbye & Good Riddance", "GB&GR": "Goodbye & Good Riddance",
    WOD: "WRLD ON DRUGS", DRFL: "Death Race for Love",
    JW3: "Legends Never Die", POST: "Posthumous", OUT: "Outsiders",
    AF: "Afflictions", ND: "NOTHING'S DIFFERENT </3",
    BDM: "BINGEDRINKINGMUSIC", SOUNDCLOUD: "SoundCloud",
  };
  var CATS = ["leaks", "sessions", "halloween", "released"];
  var CAT_LABEL = { leaks: "Leaks", sessions: "Sessions", halloween: "Halloween", released: "Released" };

  var state = { query: "", cat: "all", sort: "year-desc" };

  function tl() {
    try { if (typeof trackList !== "undefined" && Array.isArray(trackList)) return trackList; } catch (e) {}
    return [];
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function eraOf(t) {
    var m = String((t || {}).tag || "").match(ERA_RE);
    if (!m) return (t && t.category === "halloween") ? "POST" : "Other";
    var k = m[1].toUpperCase();
    return ERA_LABELS[k] || k;
  }
  function catLabel(t) { return CAT_LABEL[String((t || {}).category || "").toLowerCase()] || ""; }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function fmtMinutes(min) {
    var h = Math.floor(min / 60);
    return h + "h" + String(min % 60).padStart(2, "0");
  }
  function fmtDuration(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += Number(list[i].duration) || 0;
    return fmtMinutes(Math.round(total / 60));
  }
  function coverThumb(src) {
    try { if (typeof window._coverThumb === "function") return window._coverThumb(src || "Juice-WRLD.png", "64") || src; } catch (e) {}
    return src || "Juice-WRLD.png";
  }
  function baseTitle(s) { return String(s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

  function haystack(t) {
    return [t.title, t.tag, t.artist, t.producer, t.year, eraOf(t), catLabel(t)]
      .join(" ").toLowerCase();
  }

  function counts(list) {
    var out = { all: list.length, leaks: 0, sessions: 0, halloween: 0, released: 0 };
    for (var i = 0; i < list.length; i++) {
      var c = String(list[i].category || "").toLowerCase();
      if (out[c] != null) out[c]++;
    }
    return out;
  }

  function filtered(list) {
    var q = state.query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (state.cat !== "all" && String(t.category || "").toLowerCase() !== state.cat) continue;
      if (q) {
        if (haystack(t).indexOf(q) === -1) continue;
      }
      out.push({ t: t, i: i });
    }
    switch (state.sort) {
      case "year-asc": out.sort(function (a, b) { return String(a.t.year || "").localeCompare(String(b.t.year || "")); }); break;
      case "title": out.sort(function (a, b) { return String(a.t.title || "").localeCompare(String(b.t.title || "")); }); break;
      case "duration": out.sort(function (a, b) { return (Number(b.t.duration) || 0) - (Number(a.t.duration) || 0); }); break;
      case "year-desc":
      default:
        out.sort(function (a, b) {
          var d = String(b.t.year || "").localeCompare(String(a.t.year || ""));
          if (d !== 0) return d;
          return String(a.t.title || "").localeCompare(String(b.t.title || ""));
        });
    }
    return out;
  }

  function rowHTML(t) {
    return '<img decoding="async" loading="lazy" class="era-row-cover" src="' + esc(coverThumb(t.cover)) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
      '<span class="era-row-meta"><span class="era-row-title">' + esc(t.title) + '</span>' +
        '<span class="era-row-sub">' + esc(ERA_LABELS[eraOf(t)] || eraOf(t)) + (t.year ? " · " + esc(t.year) : "") + " · " + esc(t.producer || "Unknown producer") + '</span>' +
      '</span>' +
      '<span class="tracker-badge tracker-badge--' + esc(String(t.category || "other").toLowerCase()) + '">' + esc(catLabel(t) || "Other") + '</span>' +
      '<span class="era-row-len">' + fmtTime(t.duration) + '</span>' +
      '<span class="era-row-play"><i class="fas fa-play" aria-hidden="true"></i></span>';
  }

  function renderFilters(cl) {
    var host = document.getElementById("tracker-filters");
    if (!host) return;
    var html = "";
    var defs = [["all", "All"], ["leaks", "Leaks"], ["sessions", "Sessions"], ["halloween", "Halloween"], ["released", "Released"]];
    for (var i = 0; i < defs.length; i++) {
      var key = defs[i][0], label = defs[i][1];
      if (key !== "all" && !cl[key]) continue; // skip categories that do not exist in the data
      var on = state.cat === key;
      html += '<button type="button" class="tracker-chip" data-cat="' + key + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        esc(label) + '<span class="tracker-chip-n">' + (cl[key] != null ? cl[key] : 0) + '</span></button>';
    }
    host.innerHTML = html;
  }

  function renderSummary() {
    var el = document.getElementById("tracker-summary");
    if (!el) return;
    var list = tl();
    var distinct = {};
    for (var i = 0; i < list.length; i++) distinct[baseTitle(list[i].title)] = true;
    var cl = counts(list);
    var parts = [
      tl().length + " songs",
      Object.keys(distinct).length + " distinct takes",
      fmtDuration(list) + " of audio"
    ];
    if (cl.leaks) parts.push(cl.leaks + " leaked");
    if (cl.sessions) parts.push(cl.sessions + " sessions");
    if (cl.halloween) parts.push(cl.halloween + " halloween");
    el.textContent = parts.join(" · ");
  }

  function renderHead(list) {
    var sub = document.getElementById("tracker-sub");
    var erasEl = document.getElementById("tracker-eras");
    var eraSet = {};
    for (var i = 0; i < list.length; i++) eraSet[eraOf(list[i])] = true;
    var eraCount = Object.keys(eraSet).length;
    if (sub) sub.textContent = list.length + " songs · " + eraCount + " eras · every version by era · computed live from the vault";
    if (erasEl) erasEl.innerHTML = list.length + ' songs <span>in</span> ' + eraCount + ' eras';
  }

  function renderList() {
    var host = document.getElementById("tracker-list");
    if (!host) return;
    var list = tl();
    var cl = counts(list);
    var rows = filtered(list);
    var html = "";
    if (!rows.length) {
      html = '<div class="tracker-empty"><p class="tracker-empty-title">Nothing in the vault matches “' + esc(state.query || state.cat) + '”</p>' +
        '<button type="button" class="tracker-clear" id="tracker-clear">Clear search &amp; filters</button></div>';
      host.innerHTML = html;
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      html += '<button type="button" class="era-row tracker-row" data-idx="' + rows[i].i + '">' + rowHTML(rows[i].t) + "</button>";
    }
    host.innerHTML = html;
  }

  function render() {
    var list = tl();
    var cl = counts(list);
    renderHead(list);
    renderFilters(cl);
    renderSummary();
    renderList();
    var countEl = document.getElementById("tracker-count");
    if (countEl) countEl.textContent = tl().length + " songs · computed live from the vault";
  }

  function playIndex(idx) {
    var i = Number(idx);
    if (Number.isFinite(i) && window.selectTrackFromList) window.selectTrackFromList(i);
    if (window.showDeckPlayer) window.showDeckPlayer();
    setTimeout(function () { try { if (window.showDeckPlayer) window.showDeckPlayer(); } catch (e2) {} }, 700);
  }

  function wire() {
    var search = document.getElementById("tracker-search");
    var sort = document.getElementById("tracker-sort");
    var filters = document.getElementById("tracker-filters");
    var listEl = document.getElementById("tracker-list");
    var shuffleBtn = document.getElementById("tracker-shuffle");
    var playBtn = document.getElementById("tracker-playall");
    var helpBtn = document.getElementById("tracker-help");

    function trackerActive() {
      var p = document.getElementById("page-section-tracker");
      return p && p.classList.contains("active");
    }
    function isField(t) {
      if (!t) return false;
      var tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
    }
    if (shuffleBtn) {
      shuffleBtn.addEventListener("click", function () {
        var rows = filtered(tl());
        if (!rows.length) return;
        playIndex(rows[Math.floor(Math.random() * rows.length)].i);
      });
    }
    if (playBtn) {
      playBtn.addEventListener("click", function () {
        var rows = filtered(tl());
        if (!rows.length) return;
        playIndex(rows[0].i);
      });
    }
    if (helpBtn) {
      helpBtn.addEventListener("click", function () {
        try { if (typeof window.toggleShortcuts === "function") window.toggleShortcuts(); } catch (e) {}
      });
    }
    if (!window.__thwTrackerSlashWired) {
      window.__thwTrackerSlashWired = true;
      document.addEventListener("keydown", function (e) {
        if (e.key === "/" && trackerActive() && !isField(e.target)) {
          e.preventDefault();
          if (search) search.focus();
        }
      });
    }

    if (search) {
      search.addEventListener("input", function () {
        state.query = search.value || "";
        renderList();
      });
    }
    if (sort) {
      sort.addEventListener("change", function () {
        state.sort = sort.value || "year-desc";
        renderList();
      });
    }
    if (filters) {
      filters.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-cat]") : null;
        if (!btn) return;
        state.cat = btn.getAttribute("data-cat") || "all";
        render();
      });
    }
    if (listEl) {
      listEl.addEventListener("click", function (e) {
        var clear = e.target && e.target.closest ? e.target.closest("#tracker-clear") : null;
        if (clear) {
          state.query = ""; state.cat = "all";
          var s = document.getElementById("tracker-search");
          if (s) s.value = "";
          var sorter = document.getElementById("tracker-sort");
          if (sorter) sorter.value = "year-desc";
          state.sort = "year-desc";
          render();
          return;
        }
        var row = e.target && e.target.closest ? e.target.closest(".tracker-row") : null;
        if (row) {
          var idx = Number(row.getAttribute("data-idx"));
          if (Number.isFinite(idx) && window.selectTrackFromList) window.selectTrackFromList(idx);
          if (window.showDeckPlayer) window.showDeckPlayer();
          setTimeout(function () { try { if (window.showDeckPlayer) window.showDeckPlayer(); } catch (e2) {} }, 700);
        }
      });
    }
  }

  window.renderTrackerPage = function () {
    wire();
    render();
  };
})();
