/* ==========================================================================
   STATS — the numbers behind the vault.
   Everything on this page is computed from trackList at runtime. No invented
   figures — every bar, count and percentage traces back to the catalogue.
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

  function tl() { try { if (typeof trackList !== "undefined" && Array.isArray(trackList)) return trackList; } catch (e) {} return []; }
  function baseTitle(s) { return String(s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); }
  function fmtMinutes(min) { if (min >= 60) { var h = Math.floor(min / 60); return h + "h" + String(min % 60).padStart(2, "0"); } return min + "m"; }
  function eraOf(t) {
    var m = String(t.tag || "").match(ERA_RE);
    if (!m) return "Unknown";
    var k = m[1].toUpperCase();
    return ERA_LABELS[k] || k;
  }
  function categoryLabel(c) {
    return ({ leaks: "Leaked", sessions: "Sessions", halloween: "Halloween", released: "Released" })[c] || String(c || "Other");
  }

  function render() {
    var list = tl();
    if (!list.length) return;

    var total = list.length;
    var totalDur = 0;
    var byEra = {};
    var byCat = {};
    var byProd = {};
    var versions = {}; // base title → count

    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      totalDur += Number(t.duration) || 0;
      var era = eraOf(t);
      byEra[era] = (byEra[era] || 0) + 1;
      var cat = String(t.category || "unknown").toLowerCase();
      byCat[cat] = (byCat[cat] || 0) + 1;
      var p = String(t.producer || "Unknown").trim();
      byProd[p] = (byProd[p] || 0) + 1;
      var base = baseTitle(t.title);
      versions[base] = (versions[base] || 0) + 1;
    }

    var totalMin = Math.round(totalDur / 60);
    var distinctSongs = Object.keys(versions).length;

    /* fill the hero numbers */
    setText("st-songs", String(total));
    setText("st-minutes", fmtMinutes(totalMin));
    setText("st-distinct", String(distinctSongs));
    setText("st-producers", String(Object.keys(byProd).length));

    /* versions panel — only songs with >1 version, or "all unique" note */
    var multi = Object.entries(versions)
      .filter(function (kv) { return kv[1] > 1; })
      .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
    var vHtml;
    if (multi.length) {
      vHtml = multi.slice(0, 8).map(function (kv) {
        return '<div class="st-row"><span class="st-row-name">' + esc(kv[0]) + '</span><span class="st-row-val">' + kv[1] + ' versions</span></div>';
      }).join("");
    } else {
      vHtml = '<p class="st-empty">Every song in the vault is distinct — no duplicate takes tracked yet.</p>';
    }
    setHtml("st-versions", vHtml);

    /* categories panel */
    var orderedCats = Object.entries(byCat).sort(function (a, b) { return b[1] - a[1]; });
    setHtml("st-cats", orderedCats.map(function (kv) {
      var pct = Math.round((kv[1] / total) * 100);
      return '<div class="st-bar-row"><span class="st-bar-label">' + esc(categoryLabel(kv[0])) + '</span><span class="st-bar-track"><span class="st-bar-fill" style="width:' + pct + '%"></span></span><span class="st-bar-val">' + kv[1] + ' · ' + pct + '%</span></div>';
    }).join(""));

    /* eras panel */
    var eraEntries = Object.entries(byEra).sort(function (a, b) { return b[1] - a[1]; });
    var maxEra = eraEntries.length ? eraEntries[0][1] : 1;
    setHtml("st-eras", eraEntries.map(function (kv) {
      var pct = Math.round((kv[1] / maxEra) * 100);
      return '<div class="st-bar-row"><span class="st-bar-label">' + esc(kv[0]) + '</span><span class="st-bar-track"><span class="st-bar-fill st-bar-fill--era" style="width:' + pct + '%"></span></span><span class="st-bar-val">' + kv[1] + '</span></div>';
    }).join(""));

    /* top producers panel */
    var prodEntries = Object.entries(byProd)
      .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
      .slice(0, 12);
    var maxProd = prodEntries.length ? prodEntries[0][1] : 1;
    setHtml("st-producers-list", prodEntries.map(function (kv) {
      var pct = Math.round((kv[1] / maxProd) * 100);
      return '<div class="st-bar-row"><span class="st-bar-label">' + esc(kv[0]) + '</span><span class="st-bar-track"><span class="st-bar-fill st-bar-fill--prod" style="width:' + pct + '%"></span></span><span class="st-bar-val">' + kv[1] + '</span></div>';
    }).join(""));
  }

  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function setHtml(id, v) { var el = document.getElementById(id); if (el) el.innerHTML = v; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  window.renderStatsPage = render;
})();
