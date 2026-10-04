/* WRLD Stats — merged into the native profile header.
 * Extends the profile's own .cmp-qstats row with Streak + Rank cells and
 * upgrades/adds the Top-plays block with cover-art rows. Self profile only
 * (/api/mystats is session-scoped). No duplicate stat cards. */
(function () {
  "use strict";
  if (window.__wrldStatsMounted) return;
  window.__wrldStatsMounted = true;

  var MARK = "data-ws-x";
  var cache = null;

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

  /* "" = own profile; otherwise the /profile/<key> slug being viewed. */
  function profileKey() {
    try {
      var m = (location.pathname || "").match(/^\/profile\/(.+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return "";
  }

  function css() {
    if (document.getElementById("wrld-stats-style")) return;
    var st = document.createElement("style");
    st.id = "wrld-stats-style";
    st.textContent =
      ".ws-top{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:10px;padding:6px;cursor:pointer;color:#fff}" +
      ".ws-top:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1)}" +
      ".ws-rank{font-family:monospace;font-size:10px;font-weight:800;color:#fbbf24;width:22px;flex-shrink:0}" +
      ".ws-art{width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#1c1530}" +
      ".ws-tt{flex:1;min-width:0}.ws-tt b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".ws-tt span{font-size:10px;color:rgba(255,255,255,.5);font-family:monospace}" +
      ".ws-an-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#fff;margin:18px 2px 10px}" +
      ".ws-an-title i{color:rgba(255,255,255,.6);font-size:12px}" +
      ".ws-an-range{margin-left:auto;font-size:10px;color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:3px 9px}" +
      ".ws-card2{background:#0d0a18;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:16px 14px 12px}" +
      ".ws-svg{display:block;width:100%;height:auto}" +
      ".ws-max{fill:rgba(255,255,255,.45);font-size:11px;font-family:monospace}" +
      ".ws-ticks text{fill:rgba(255,255,255,.4);font-size:10px}" +
      ".ws-peak-top{display:flex;justify-content:space-between;margin-bottom:12px}" +
      ".ws-peak-k{display:block;font-size:9px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px}" +
      ".ws-peak-top b{font-size:17px;color:#fff}" +
      ".ws-hbars{display:flex;align-items:flex-end;gap:4px;height:110px}" +
      ".ws-hbar{flex:1;min-width:0;border-radius:5px 5px 2px 2px;background:rgba(139,92,246,.45)}" +
      ".ws-hbar.peak{background:#a78bfa}" +
      ".ws-hlbl{display:flex;justify-content:space-between;margin-top:6px}" +
      ".ws-hlbl span{font-size:9px;color:rgba(255,255,255,.4)}" +
      ".ws-mbars{display:flex;align-items:flex-end;gap:5px;height:80px}" +
      ".ws-mcol{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end}" +
      ".ws-mbar{width:100%;border-radius:4px 4px 2px 2px;background:rgba(52,211,153,.45)}" +
      ".ws-mcol span{font-size:8px;color:rgba(255,255,255,.4)}";
    (document.head || document.documentElement).appendChild(st);
  }

  function rowHTML(r) {
    var cov = coverFor(r.title) || "Juice-WRLD.png";
    return '<button type="button" class="ws-top" data-ws-title="' + esc(r.title) + '">' +
      '<span class="ws-rank">#' + r.rank + '</span>' +
      '<img class="ws-art" src="' + esc(cov) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
      '<span class="ws-tt"><b>' + esc(r.title) + '</b><span>' + Number(r.plays || 0) + ' plays</span></span>' +
      '<i class="fas fa-play" style="color:rgba(255,255,255,.3);font-size:10px"></i></button>';
  }

  function apply(d) {
    var body = document.getElementById("profilePageBody");
    if (!body || !d || d.hidden) return;
    css();
    var qstats = body.querySelector(".cmp-qstats");
    if (qstats && !qstats.hasAttribute(MARK)) {
      qstats.setAttribute(MARK, "1");
      var div = '<div class="cmp-qdiv"></div>';
      qstats.insertAdjacentHTML("beforeend",
        div + '<div class="cmp-qstat"><b>' + Number(d.streak || 0) + 'd</b><span>Streak</span></div>');
    }
    /* Everything below used to be injected after .cmp-qstats, which put it
       inside the header card. The header is meant to stay compact, so these
       are appended to the page itself and laid out by CSS order instead. */
    var top = (d.top || []).slice(0, 5);
    var oldTop = document.getElementById("ws-topplays");
    if (oldTop) oldTop.remove();
    var rows = top.map(rowHTML).join("");
    var tops = body.querySelector(".pv-tops");
    if (tops) {
      /* another member's profile already ships a Top plays card - fill it */
      if (!tops.hasAttribute(MARK)) { tops.setAttribute(MARK, "1"); tops.innerHTML = rows; }
    } else if (rows) {
      var block = document.createElement("div");
      block.className = "pv-block";
      block.id = "ws-topplays";
      block.setAttribute("data-pnl", "top-plays");
      block.innerHTML = '<div class="pv-block-title">Top plays</div><div class="pv-tops" id="ws-tops" ' + MARK + '="1">' + rows + "</div>";
      body.appendChild(block);
    }
    /* Listening Activity + Peak Hours as their own cards. Rebuilt fresh on
       every apply so profile switches never show stale charts. */
    var old = document.getElementById("ws-panels");
    if (old) old.parentNode.removeChild(old);
    ["ws-activity", "ws-peak", "ws-year"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.parentNode.removeChild(n);
    });
    [
      ["ws-activity", "activity", activityHTML(d)],
      ["ws-peak", "peak", peakHTML(d)],
      ["ws-year", "year", monthHTML(d)],
    ].forEach(function (pair) {
      if (!pair[2]) return;
      var host = document.createElement("div");
      host.className = "ws-block";
      host.id = pair[0];
      host.setAttribute("data-pnl", pair[1]);
      host.innerHTML = pair[2];
      body.appendChild(host);
    });
  }

  function last30() {
    var out = [];
    var now = new Date();
    for (var i = 29; i >= 0; i--) {
      var dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  }

  function dayLabel(iso) {
    try {
      var dt = new Date(iso + "T00:00:00Z");
      var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return M[dt.getUTCMonth()] + " " + dt.getUTCDate();
    } catch (e) { return ""; }
  }

  function fmtHour(h) {
    return (((h + 11) % 12) + 1) + (h < 12 ? "AM" : "PM");
  }

  function activityHTML(d) {
    var days = last30();
    var map = {};
    ((d && d.activity30) || []).forEach(function (r) { map[r.day] = Number(r.n) || 0; });
    var vals = days.map(function (day) { return map[day] || 0; });
    var max = 1, i;
    for (i = 0; i < vals.length; i++) max = Math.max(max, vals[i]);
    var W = 600, H = 150, n = vals.length;
    var pts = vals.map(function (v, k) {
      return [k / (n - 1) * W, H - 12 - (v / max) * (H - 34)];
    });
    var line = pts.map(function (p, k) { return (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = line + " L" + W + " " + (H - 12) + " L0 " + (H - 12) + " Z";
    var ticks = "";
    for (i = 0; i < 6; i++) {
      var k = Math.round(i * (n - 1) / 5);
      ticks += '<text x="' + (k / (n - 1) * W).toFixed(0) + '" y="' + (H + 2) + '" text-anchor="middle">' + esc(dayLabel(days[k])) + "</text>";
    }
    return '<div class="ws-an-title"><i class="fas fa-wave-square"></i> Listening Activity' +
      '<span class="ws-an-range">30 days</span></div>' +
      '<div class="ws-card2"><svg viewBox="0 0 ' + W + " " + (H + 18) + '" preserveAspectRatio="none" class="ws-svg">' +
      "<defs><linearGradient id=\"ws-grad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
      '<stop offset="0" stop-color="#a78bfa" stop-opacity=".55"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      '<text x="4" y="14" class="ws-max">' + max + "</text>" +
      '<path d="' + esc(area) + '" fill="url(#ws-grad)"/>' +
      '<path d="' + esc(line) + '" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<g class="ws-ticks">' + ticks + "</g></svg></div>";
  }

  function monthHTML(d) {
    var raw = (d && d.by_month) || [];
    if (!raw.length) return "";
    var map = {};
    raw.forEach(function (r) { map[r.m] = Number(r.n) || 0; });
    var now = new Date();
    var months = [];
    for (var i = 11; i >= 0; i--) {
      var dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(dt.toISOString().slice(0, 7));
    }
    var M = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    var max = 1, k;
    var vals = months.map(function (m) { max = Math.max(max, map[m] || 0); return map[m] || 0; });
    var bars = "";
    for (k = 0; k < 12; k++) {
      var pct = Math.max(4, Math.round(vals[k] / max * 100));
      var mi = (now.getUTCMonth() - (11 - k) + 24) % 12;
      bars += '<div class="ws-mcol"><div class="ws-mbar" style="height:' + pct + '%" title="' + esc(months[k]) + ": " + vals[k] + ' plays"></div><span>' + M[mi] + "</span></div>";
    }
    return '<div class="ws-an-title"><i class="far fa-calendar"></i> This year</div>' +
      '<div class="ws-card2"><div class="ws-mbars">' + bars + "</div></div>";
  }

  function peakHTML(d) {
    var hrs = ((d && d.hours) || []).slice(0, 24);
    while (hrs.length < 24) hrs.push(0);
    var total = 0, peak = 0, i;
    for (i = 0; i < 24; i++) { total += Number(hrs[i]) || 0; if (hrs[i] > hrs[peak]) peak = i; }
    var max = Math.max.apply(null, hrs.concat([1]));
    var bars = "";
    for (i = 0; i < 24; i++) {
      var pct = Math.max(4, Math.round((Number(hrs[i]) || 0) / max * 100));
      bars += '<div class="ws-hbar' + (i === peak && total > 0 ? " peak" : "") + '" style="height:' + pct + '%" title="' + esc(fmtHour(i)) + ": " + hrs[i] + ' plays"></div>';
    }
    var lbl = "";
    for (i = 0; i < 24; i += 2) lbl += "<span>" + esc(fmtHour(i)) + "</span>";
    return '<div class="ws-an-title"><i class="far fa-clock"></i> Peak Listening Hours</div>' +
      '<div class="ws-card2"><div class="ws-peak-top"><div><span class="ws-peak-k">Peak hour</span><b>' +
      esc(total > 0 ? fmtHour(peak) : "—") + '</b></div><div style="text-align:right"><span class="ws-peak-k">Tracked plays</span><b>' +
      Number(total).toLocaleString() + "</b></div></div>" +
      '<div class="ws-hbars">' + bars + '</div><div class="ws-hlbl">' + lbl + "</div></div>";
  }

  function applied() {
    var body = document.getElementById("profilePageBody");
    if (!body) return false;
    var q = body.querySelector(".cmp-qstats");
    return !!(q && q.hasAttribute(MARK));
  }

  function load() {
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    var key = profileKey();
    if (cache && cache.key === key) { apply(cache.d); return; }
    if (!key) {
      fetch("/api/mystats", { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; })
        .then(function (d) {
          if (!d || d.ok !== true) return;
          cache = { key: "", d: { streak: d.streak, activity30: d.activity30 || [], hours: d.hours || [], top: (d.top || []).slice(0, 5) } };
          apply(cache.d);
        });
      return;
    }
    /* Wanted Vault passes a numeric Discord id (openProfile(did, true)); search
       passes a site uid/username. Discord ids are 15-25 digits, so order the
       lookup accordingly — a wrong-first ?user=<discordId> returns ok:true
       but empty, which would shadow the real profile. */
    var numeric = /^\d{15,25}$/.test(key);
    var first = numeric ? "discord" : "user";
    var second = numeric ? "user" : "discord";
    function getP(which) {
      return fetch("/api/profile?" + which + "=" + encodeURIComponent(key), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; });
    }
    function gotProfile(d) {
      if (!d || d.ok !== true) return false;
      if (d.visibility && d.visibility.stats === false) {
        cache = { key: key, d: { hidden: true, top: [] } };
        return true;
      }
      var top = ((d.topPlays || []).slice(0, 5)).map(function (t, i) {
        return { title: t.track_id || "", plays: t.n || 0, rank: i + 1 };
      });
      cache = { key: key, d: { streak: d.streak, activity30: d.activity30 || [], hours: d.hours || [], top: top } };
      apply(cache.d);
      return true;
    }
    getP(first).then(function (d) {
      if (gotProfile(d)) return;
      getP(second).then(function (d2) { gotProfile(d2); });
    });
  }

  function boot() {
    document.addEventListener("click", function (e) {
      var row = e.target.closest ? e.target.closest("[data-ws-title]") : null;
      if (!row) return;
      var idx = idxFor(row.getAttribute("data-ws-title") || "");
      if (idx < 0) return;
      try {
        if (window.selectTrackFromList) window.selectTrackFromList(idx);
        if (window.switchAppPage) window.switchAppPage("player");
      } catch (err) {}
    });
    try {
      var orig = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (orig) orig(); } catch (e) {}
        setTimeout(load, 500);
      };
    } catch (e) {}
    var body = document.getElementById("profilePageBody");
    var statsObserver = null;
    var statsLoaded = false;
    // Use targeted attribute observation like other scripts to avoid childList mutation risks
    var profileSection = document.getElementById("page-section-profile");
    if (profileSection && window.MutationObserver) {
      statsObserver = new MutationObserver(function () {
        if (!statsLoaded && profileSection.classList.contains("active") && !applied()) {
          statsLoaded = true;
          load();
          try { if (statsObserver) { statsObserver.disconnect(); statsObserver = null; } } catch (e) {}
        }
      });
      statsObserver.observe(profileSection, { attributes: true, attributeFilter: ["class"] });
    }
    window.refreshWrldStats = function () { cache = null; load(); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
