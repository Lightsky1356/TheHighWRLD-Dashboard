/* WRLD Player — "Your listening" panel.
 * Everything shown here comes from /api/profile: real play counts, real top
 * tracks and the real recent-activity list. Nothing is fabricated, and a
 * signed-out visitor gets a plain sign-in prompt instead of fake numbers.
 */
(function () {
  "use strict";
  if (window.__thwPlayerInsights) return;
  window.__thwPlayerInsights = true;

  var loaded = false;
  var hostId = "playerInsightsBody";

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(n) { return (Number(n) || 0).toLocaleString(); }
  function duration(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? (h + "h " + m + "m") : (m + "m");
  }
  function ago(ts) {
    var ms = Date.now() - Date.parse(String(ts || ""));
    if (!isFinite(ms) || ms < 0) return "";
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }
  function indexOfTitle(title) {
    var list = (typeof trackList !== "undefined" && trackList) ? trackList : [];
    var want = String(title || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String((list[i] && list[i].title) || "").toLowerCase() === want) return i;
    }
    return -1;
  }
  function play(idx) {
    if (idx < 0) return;
    if (typeof window.selectTrackFromList === "function") {
      window.selectTrackFromList(idx);
      return;
    }
    if (typeof window.showToastSimple === "function") window.showToastSimple("Player is still loading", "info");
  }

  function gate() {
    return '<div class="pi-gate"><i class="fas fa-user-circle" aria-hidden="true"></i>' +
      '<b>Sign in to see your listening</b>' +
      '<span>Your plays, top tracks and recent history follow your account.</span>' +
      '<button type="button" class="pi-signin" id="piSignIn">Sign in <i class="fas fa-arrow-right" aria-hidden="true"></i></button></div>';
  }

  function render(d) {
    var host = el(hostId);
    if (!host) return;
    if (!d || d.ok === false || !d.stats) { host.innerHTML = gate(); bindGate(); return; }
    var s = d.stats;
    var html = '<div class="pi-stats">' +
      '<div class="pi-stat"><b>' + fmt(s.plays) + '</b><span>Plays</span></div>' +
      '<div class="pi-stat"><b>' + esc(duration(s.seconds)) + '</b><span>Listened</span></div>' +
      '<div class="pi-stat"><b>' + fmt(s.favorites) + '</b><span>Favourites</span></div>' +
      '<div class="pi-stat"><b>' + fmt(d.streak) + '</b><span>Day streak</span></div>' +
      '</div>';

    var top = (d.topPlays || []).slice(0, 5);
    if (top.length) {
      html += '<div class="pi-block"><h3><i class="fas fa-fire" aria-hidden="true"></i>Most played</h3><div class="pi-tracks">';
      top.forEach(function (t) {
        var idx = indexOfTitle(t.track_id);
        var rec = idx >= 0 ? (typeof trackList !== "undefined" ? trackList[idx] : null) : null;
        var cover = rec && rec.cover ? rec.cover : "AlbumArt/999.jpg";
        html += '<button type="button" class="pi-track" data-idx="' + idx + '"' + (idx < 0 ? " disabled" : "") + '>' +
          '<img src="' + esc(cover) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'">' +
          '<span class="pi-track-copy"><b>' + esc(t.track_id) + '</b><small>' + fmt(t.n) + ' plays</small></span>' +
          '<i class="fas fa-play" aria-hidden="true"></i></button>';
      });
      html += '</div></div>';
    }

    var recent = (d.activity || []).filter(function (a) { return a && a.type === "listen"; }).slice(0, 4);
    if (recent.length) {
      html += '<div class="pi-block"><h3><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>Recently played</h3><div class="pi-recent">';
      recent.forEach(function (a) {
        html += '<div class="pi-recent-row"><i class="fas fa-music" aria-hidden="true"></i>' +
          '<span>' + esc(String(a.label || "").replace(/^You played\s*/, "")) + '</span>' +
          '<time>' + esc(ago(a.ts)) + '</time></div>';
      });
      html += '</div></div>';
    }
    if (!top.length && !recent.length) {
      html += '<p class="pi-empty">Play a few songs and your listening will show up here.</p>';
    }
    host.innerHTML = html;
    host.querySelectorAll(".pi-track").forEach(function (b) {
      b.addEventListener("click", function () { play(parseInt(b.getAttribute("data-idx"), 10)); });
    });
  }

  function bindGate() {
    var b = el("piSignIn");
    if (b) b.addEventListener("click", function () {
      if (window.showAuthPage) window.showAuthPage("login");
    });
  }

  function load() {
    if (loaded) return;
    loaded = true;
    fetch("/api/profile", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        var host = el(hostId);
        if (host) { host.innerHTML = gate(); bindGate(); }
      });
  }

  function boot() {
    var section = el("page-section-player");
    if (section && section.classList.contains("active")) { load(); return; }
    /* The player can be opened later; load once when it becomes active. */
    var tries = 0;
    var iv = setInterval(function () {
      if (section && section.classList.contains("active")) { clearInterval(iv); load(); }
      else if (++tries > 150) clearInterval(iv);
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
