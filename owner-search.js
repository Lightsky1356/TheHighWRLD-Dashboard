/* Owner Dashboard: Search analytics section.
 * Appends a "Search (30d)" block into #owner-stats using the same stats URL
 * the dashboard already unlocked (window.__ownerStatsURL). Re-appends if the
 * stats pane re-renders. Read-only; owner-gated server-side via /api/stats. */
(function () {
  "use strict";
  if (window.__ownerSearchMounted) return;
  window.__ownerSearchMounted = true;

  var SEC = "owner-search-sec";
  var cache = null;
  var cacheUrl = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function css() {
    if (document.getElementById("owner-search-style")) return;
    var st = document.createElement("style");
    st.id = "owner-search-style";
    st.textContent =
      ".owner-search-sec{margin-top:14px;border-top:1px solid rgba(255,255,255,.08);padding-top:12px}" +
      ".owner-search-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fbbf24;margin-bottom:8px}" +
      ".owner-search-total{font-size:11px;color:rgba(255,255,255,.6);margin-bottom:8px;font-family:monospace}" +
      ".owner-search-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "@media (max-width:700px){.owner-search-grid{grid-template-columns:1fr}}" +
      ".owner-search-col h4{font-size:10px;font-weight:700;color:rgba(255,255,255,.55);margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em}" +
      ".owner-search-row{display:flex;gap:8px;align-items:baseline;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}" +
      ".owner-search-q{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff}" +
      ".owner-search-n{font-family:monospace;color:#fbbf24;flex-shrink:0}" +
      ".owner-search-empty{font-size:11px;color:rgba(255,255,255,.4)}";
    (document.head || document.documentElement).appendChild(st);
  }

  function rows(list, fmtN) {
    if (!list || !list.length) return '<p class="owner-search-empty">None yet.</p>';
    return list.map(function (r) {
      return '<div class="owner-search-row"><span class="owner-search-q">' + esc(r.q) + '</span>' +
        '<span class="owner-search-n">' + esc(fmtN(r)) + '</span></div>';
    }).join("");
  }

  function render(box, s) {
    css();
    var old = document.getElementById(SEC);
    if (old) old.remove();
    var sec = document.createElement("div");
    sec.id = SEC;
    sec.className = "owner-search-sec";
    sec.innerHTML =
      '<div class="owner-search-title"><i class="fas fa-magnifying-glass"></i> Search (30d)</div>' +
      '<div class="owner-search-total">' + Number(s.total || 0).toLocaleString() + ' queries logged</div>' +
      '<div class="owner-search-grid"><div class="owner-search-col"><h4>Top queries</h4>' +
      rows(s.top, function (r) { return (r.n || 0) + "x"; }) + '</div>' +
      '<div class="owner-search-col"><h4>No results — content gaps</h4>' +
      rows(s.noHits, function (r) { return (r.n || 0) + "x"; }) + '</div></div>';
    box.appendChild(sec);
  }

  function tick() {
    var url = window.__ownerStatsURL || "";
    var box = document.getElementById("owner-stats");
    if (!url || !box) return;
    if (url !== cacheUrl) {
      cacheUrl = url;
      cache = null;
      fetch(url, { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function (d) {
          if (d && d.search) { cache = d.search; render(box, cache); }
        });
      return;
    }
    if (cache && !document.getElementById(SEC)) render(box, cache);
  }

  /* Thirty seconds, not three. It is a statistics page: nobody is watching the
       numbers change, and it was a request every three seconds for as long as the
       owner panel was open. */
    setInterval(tick, 30000);
  tick();
})();
