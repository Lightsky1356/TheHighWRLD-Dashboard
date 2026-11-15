/* ==========================================================================
   SONGS — every track in the vault as a searchable, sortable table.
   ========================================================================== */
(function () {
  "use strict";

  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|BDM|SoundCloud)\)/i;
  var ERA_LABELS = {
    "GB&GR": "Goodbye & Good Riddance",
    WOD: "WRLD ON DRUGS",
    DRFL: "Death Race for Love",
    JW3: "Legends Never Die",
    POST: "Posthumous",
    OUT: "Outsiders",
    AF: "Afflictions",
    BDM: "BINGEDRINKINGMUSIC",
    SOUNDCLOUD: "SoundCloud",
  };
  var state = { sort: "title", dir: 1, filter: "all", query: "" };

  function tl() { try { if (typeof trackList !== "undefined" && trackList) return trackList; } catch (_) {} return []; }
  function fmtTime(sec) { sec = Math.max(0, Math.floor(Number(sec) || 0)); var m = Math.floor(sec / 60); return m + ":" + String(sec % 60).padStart(2, "0"); }
  function eraOf(t) {
    var m = String(t.tag || "").match(ERA_RE);
    if (!m) return "";
    var k = m[1].toUpperCase();
    return ERA_LABELS[k] || k;
  }
  function categoryLabel(c) { return ({ leaks: "Leaked", sessions: "Sessions", halloween: "Halloween" })[String(c || "").toLowerCase()] || String(c || ""); }
  function bigCover(src) { try { if (window._coverThumb) { var t = window._coverThumb(src || "Juice-WRLD.png", "128"); if (t) return t; } } catch (_) {} return src || "Juice-WRLD.png"; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

  function openSong(title) {
    try { if (window.__thwResolveSong) window.__thwResolveSong(title); } catch (_) {}
    try { window.openSongPage && window.openSongPage(title); } catch (_) {}
  }

  function matches(t) {
    if (state.filter !== "all" && String(t.category || "").toLowerCase() !== state.filter) return false;
    if (!state.query) return true;
    var q = state.query;
    var hay = [t.title, t.tag, t.producer, t.artist, t.year, eraOf(t), categoryLabel(t.category)]
      .map(function (s) { return String(s || "").toLowerCase(); }).join(" ");
    return hay.indexOf(q) >= 0;
  }

  function render() {
    var list = tl();
    var tbody = document.getElementById("songs-tbody");
    var empty = document.getElementById("songs-empty");
    if (!tbody) return;
    var rows = [];
    for (var i = 0; i < list.length; i++) rows.push({ t: list[i], i: i });
    rows = rows.filter(function (o) { return matches(o.t); });
    rows.sort(function (a, b) {
      var va, vb;
      switch (state.sort) {
        case "era": va = eraOf(a.t).toLowerCase(); vb = eraOf(b.t).toLowerCase(); break;
        case "category": va = String(a.t.category || "").toLowerCase(); vb = String(b.t.category || "").toLowerCase(); break;
        case "duration": va = Number(a.t.duration) || 0; vb = Number(b.t.duration) || 0; break;
        case "title": default: va = String(a.t.title || "").toLowerCase(); vb = String(b.t.title || "").toLowerCase();
      }
      if (va < vb) return -1 * state.dir;
      if (va > vb) return 1 * state.dir;
      return 0;
    });
    if (!rows.length) {
      tbody.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    tbody.innerHTML = rows.map(function (o) {
      var t = o.t;
      var cover = bigCover(t.cover);
      return '<tr class="songs-row" data-index="' + o.i + '" role="row" tabindex="0">' +
        '<td class="td-cover"><img class="songs-row-cover" src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'"></td>' +
        '<td class="td-title"><span class="songs-row-title">' + esc(t.title) + '</span>' +
          (t.producer ? '<span class="songs-row-sub">' + esc(t.producer) + (t.year ? ' · ' + esc(t.year) : '') + '</span>' : '') +
        '</td>' +
        '<td class="td-era">' + esc(eraOf(t)) + '</td>' +
        '<td class="td-category">' + esc(categoryLabel(t.category)) + '</td>' +
        '<td class="td-duration">' + fmtTime(t.duration) + '</td>' +
      '</tr>';
    }).join("");
  }

  function wireFilters() {
    var filters = document.getElementById("songs-filters");
    if (!filters) return;
    var categories = ["all", "leaks", "sessions", "halloween"];
    filters.innerHTML = categories.map(function (c) {
      var label = c === "all" ? "All" : ({ leaks: "Leaked", sessions: "Sessions", halloween: "Halloween" })[c];
      return '<button type="button" class="songs-filter is-active" data-filter="' + esc(c) + '" aria-pressed="true">' + esc(label) + '</button>';
    }).join("");
    filters.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".songs-filter") : null;
      if (!btn) return;
      state.filter = btn.getAttribute("data-filter") || "all";
      filters.querySelectorAll(".songs-filter").forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      render();
    });
  }

  function wireSort() {
    var table = document.querySelector(".songs-table");
    if (!table) return;
    table.addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest("th[data-sort]") : null;
      if (!th) return;
      var key = th.getAttribute("data-sort");
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = 1; }
      table.querySelectorAll("th[data-sort]").forEach(function (t) {
        t.classList.toggle("is-sorted-asc", t.getAttribute("data-sort") === state.sort && state.dir === 1);
        t.classList.toggle("is-sorted-desc", t.getAttribute("data-sort") === state.sort && state.dir === -1);
      });
      render();
    });
  }

  function wireSearch() {
    var input = document.getElementById("songs-search");
    if (!input) return;
    var debounce = null;
    input.addEventListener("input", function () {
      var v = input.value || "";
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(function () {
        state.query = v.trim().toLowerCase();
        render();
      }, 120);
    });
  }

  function wireRows() {
    var tbody = document.getElementById("songs-tbody");
    if (!tbody) return;
    function openRow(tr) {
      if (!tr) return;
      var idx = parseInt(tr.getAttribute("data-index"), 10);
      var list = tl();
      if (isNaN(idx) || !list[idx]) return;
      openSong(list[idx].title);
    }
    tbody.addEventListener("click", function (e) {
      var tr = e.target.closest ? e.target.closest(".songs-row") : null;
      openRow(tr);
    });
    tbody.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var tr = e.target.closest ? e.target.closest(".songs-row") : null;
      if (!tr) return;
      e.preventDefault();
      openRow(tr);
    });
  }

  function mount() {
    wireFilters();
    wireSort();
    wireSearch();
    wireRows();
    render();
  }

  window.renderSongsPage = mount;
  document.addEventListener("keydown", function (e) {
    if (e.key === "/") {
      var input = document.getElementById("songs-search");
      var active = document.activeElement;
      var name = active && active.tagName === "INPUT" && (active.type === "text" || active.type === "search" || active.type === "email" || active.type === "password");
      if (!name) { e.preventDefault(); if (input) input.focus(); }
    }
  });
})();
