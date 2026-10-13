/* Recently Played — self profile block only.
 *
 * It also used to render a compact strip inside the WRLD Player. That is gone:
 * the player is for playing, and the strip pushed the playlist and join panel
 * down the page. The profile block stays, where it belongs.
 *
 * Data: /api/recent (session-authed, newest first). Consecutive duplicates
 * are collapsed client-side. Logged-out users see nothing (no persistence). */
(function () {
  "use strict";
  if (window.__recentMounted) return;
  window.__recentMounted = true;

  var WID = "ws-recent";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function getTL() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    try { if (window.trackList && window.trackList.length) return window.trackList; } catch (e2) {}
    return [];
  }

  function coverFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return (tl[i] || {}).cover || "";
    }
    return "";
  }

  function idxFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return i;
    }
    return -1;
  }

  /* D1 hands back "2026-09-25 21:00:00" (UTC, no zone) but rows can also come
     back empty or malformed, so the date is validated before it is used -
     otherwise the arithmetic below yields NaN and the row reads "NaN ago". */
  function ago(iso) {
    var raw = iso == null ? "" : String(iso).trim();
    if (!raw) return "";
    var zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    var t = Date.parse(raw.replace(" ", "T") + (zoned ? "" : "Z"));
    if (isNaN(t)) return "";
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 0) s = 0;
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : d + "d ago";
  }

  function isOtherProfile() {
    try { return /^\/profile\/.+/.test(location.pathname || ""); } catch (e) { return false; }
  }

  function css() {
    if (document.getElementById("recent-style")) return;
    var st = document.createElement("style");
    st.id = "recent-style";
    st.textContent =
      ".ws-recent-row{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:10px;padding:6px;cursor:pointer;color:#fff}" +
      ".ws-recent-row:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1)}" +
      ".ws-recent-art{width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#1c1530}" +
      ".ws-recent-tt{flex:1;min-width:0}.ws-recent-tt b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".ws-recent-tt span{font-size:10px;color:rgba(255,255,255,.5);font-family:monospace}" +
      ".ws-recent-note{font-size:11px;color:rgba(255,255,255,.45);text-align:center;padding:8px 0 2px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function dedupe(items, n) {
    var out = [], last = null;
    for (var i = 0; i < items.length && out.length < n; i++) {
      var t = String(items[i].title || "");
      if (t && t !== last) { out.push(items[i]); last = t; }
    }
    return out;
  }

  function rowHTML(r) {
    var cov = coverFor(r.title) || "Juice-WRLD.png";
    var when = ago(r.ts);
    return '<button type="button" class="ws-recent-row" data-recent-title="' + esc(r.title) + '">' +
      '<img class="ws-recent-art" src="' + esc(cov) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
      '<span class="ws-recent-tt"><b>' + esc(r.title) + '</b>' + (when ? '<span>' + esc(when) + '</span>' : "") + '</span>' +
      '<i class="fas fa-play" style="color:rgba(255,255,255,.3);font-size:10px"></i></button>';
  }

  function renderProfile(items) {
    var body = document.getElementById("profilePageBody");
    var old = document.getElementById(WID);
    /* Someone else's profile never gets this block - and if one is left over
       from your own profile it is taken away again. */
    if (isOtherProfile() || !body) { if (old) old.remove(); return; }
    if (old) old.remove();
    var list = dedupe(items, 8);
    var div = document.createElement("div");
    div.className = "pv-block";
    div.id = WID;
    div.setAttribute("data-pnl", "recent");
    var h = '<div class="pv-block-title">Recently played</div>';
    h += list.length ? list.map(rowHTML).join("") : '<p class="ws-recent-note">Nothing yet — press play and it will show up here.</p>';
    div.innerHTML = h;
    var tops = body.querySelector("#ws-tops") || body.querySelector(".pv-tops");
    var holder = (tops && tops.closest) ? (tops.closest(".pv-block") || tops) : null;
    if (holder && holder.parentNode) holder.parentNode.insertBefore(div, holder.nextSibling);
    else body.appendChild(div);
  }

  function load() {
    fetch("/api/recent?limit=20", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true) return;
        renderProfile(d.recent || []);
      });
  }

  function boot() {
    css();
    document.addEventListener("click", function (e) {
      var row = e.target.closest ? e.target.closest("[data-recent-title]") : null;
      if (!row) return;
      var idx = idxFor(row.getAttribute("data-recent-title") || "");
      if (idx < 0) return;
      try {
        if (window.selectTrackFromList) window.selectTrackFromList(idx);
        if (window.switchAppPage) window.switchAppPage("player");
      } catch (err) {}
    });
    try {
      var origP = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (origP) origP(); } catch (e) {}
        setTimeout(load, 600);
      };
    } catch (e) {}
    /* No observer on the player page any more: the strip that used to be
       re-rendered every time the WRLD Player opened is gone, and the profile
       block refreshes through profileSectionShown and the 60s poll. */
    load();
    setInterval(load, 60000);
    window.refreshRecent = load;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
