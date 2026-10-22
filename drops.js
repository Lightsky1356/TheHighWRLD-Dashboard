/* Contests & drops — Lobby widget with live countdowns.
 * GET /api/drops (public). Owner create form appears inside #owner-panel
 * when unlocked (code reused from localStorage.ownerCode). */
(function () {
  "use strict";
  if (window.__dropsMounted) return;
  window.__dropsMounted = true;

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

  function idxFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return i;
    }
    return -1;
  }

  function css() {
    if (document.getElementById("drops-style")) return;
    var st = document.createElement("style");
    st.id = "drops-style";
    st.textContent =
      ".drops-sec{max-width:72rem;margin:0 auto;width:100%;padding:0 1rem 1.5rem}" +
      ".drops-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}" +
      ".drops-title{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;background:linear-gradient(90deg,#f0abfc,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent;display:flex;align-items:center;gap:8px}" +
      ".drop-card{border:1px solid rgba(240,171,252,.25);background:linear-gradient(180deg,rgba(192,38,211,.12),rgba(192,38,211,.03));border-radius:14px;padding:14px;margin-bottom:10px}" +
      ".drop-card.live{border-color:rgba(52,211,153,.5);background:linear-gradient(180deg,rgba(52,211,153,.12),rgba(52,211,153,.03))}" +
      ".drop-name{font-size:14px;font-weight:800;color:#fff;display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".drop-badge{font-size:9px;font-weight:800;letter-spacing:.1em;padding:2px 8px;border-radius:9999px;text-transform:uppercase}" +
      ".drop-badge.live{background:rgba(52,211,153,.2);color:#34d399}" +
      ".drop-badge.soon{background:rgba(240,171,252,.15);color:#f0abfc}" +
      ".drop-desc{font-size:12px;color:rgba(255,255,255,.65);margin:6px 0}" +
      ".drop-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}" +
      ".drop-cd{font-family:monospace;font-size:13px;font-weight:800;color:#f0abfc}" +
      ".drop-btn{border:1px solid rgba(240,171,252,.4);background:rgba(240,171,252,.1);color:#f0abfc;border-radius:9999px;padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer}" +
      ".drop-btn:hover{background:rgba(240,171,252,.22);color:#fff}" +
      ".drop-btn.play{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.12);color:#34d399}" +
      ".drops-empty{font-size:11px;color:rgba(255,255,255,.45);padding:6px 2px}" +
      ".drop-rsvp{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.08);color:#34d399;border-radius:9999px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer}" +
      ".drop-rsvp:hover{background:rgba(52,211,153,.2);color:#fff}" +
      ".drop-rsvp.in{border-color:rgba(251,191,36,.5);background:rgba(251,191,36,.1);color:#fbbf24}" +
      ".drop-count{font-size:10px;color:rgba(255,255,255,.5);font-family:monospace}" +
      ".drop-form{margin-top:12px;border:1px dashed rgba(255,255,255,.2);border-radius:12px;padding:12px}" +
      ".drop-form h4{font-size:11px;color:#fbbf24;margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em}" +
      ".drop-form input,.drop-form textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-size:12px;padding:8px;margin-bottom:8px;outline:none}" +
      ".drop-form-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function cdText(ms) {
    if (ms <= 0) return "LIVE";
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var p = function (n) { return String(n).padStart(2, "0"); };
    return (d > 0 ? d + "d " : "") + p(h) + ":" + p(m) + ":" + p(ss);
  }

  function cardHTML(d, live) {
    var h = '<div class="drop-card' + (live ? " live" : "") + '" data-drop-card="' + d.id + '">' +
      '<div class="drop-name">' + esc(d.title) +
      '<span class="drop-badge ' + (live ? "live" : "soon") + '">' + (live ? "Live now" : "Upcoming") + "</span></div>";
    if (d.description) h += '<p class="drop-desc">' + esc(d.description) + "</p>";
    h += '<div class="drop-meta">';
    if (!live) h += '<span class="drop-cd" data-drop-cd="' + esc(d.starts_at) + '">…</span>';
    if (d.track_title) h += '<span style="font-size:11px;color:rgba(255,255,255,.55)"><i class="fas fa-music"></i> ' + esc(d.track_title) + "</span>";
    if (live && d.track_title) {
      h += '<button type="button" class="drop-btn play" data-drop-play="' + esc(d.track_title) + '"><i class="fas fa-play"></i> Play now</button>';
    } else if (!live) {
      h += '<button type="button" class="drop-btn" data-drop-notify="' + d.id + '"><i class="fas fa-bell"></i> Notify me</button>';
    }
    var rc = Number(d.rsvp_count) || 0;
    h += '<button type="button" class="drop-rsvp' + (d.rsvped ? " in" : "") + '" data-drop-rsvp="' + d.id + '" data-rsvped="' + (d.rsvped ? "1" : "") + '">' +
      '<i class="fas fa-ticket"></i> ' + (d.rsvped ? "Going" : "Join") +
      ' <span class="drop-count">' + rc + "</span></button>";
    return h + "</div></div>";
  }

  function tickCountdowns(sec) {
    var now = Date.now();
    sec.querySelectorAll("[data-drop-cd]").forEach(function (el) {
      var t = new Date(String(el.getAttribute("data-drop-cd")).replace(" ", "T") + "Z").getTime();
      el.textContent = isNaN(t) ? "" : cdText(t - now);
    });
  }

  function mount(items) {
    var sec = document.getElementById("drops-sec");
    if (sec) return sec;
    css();
    sec = document.createElement("section");
    sec.id = "drops-sec";
    sec.className = "drops-sec";
    var h = '<div class="drops-head"><span class="drops-title"><i class="fas fa-gift"></i> Drops &amp; Events</span></div><div id="drops-list"></div>';
    sec.innerHTML = h;
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
    sec.addEventListener("click", function (e) {
      var pl = e.target.closest ? e.target.closest("[data-drop-play]") : null;
      if (pl) {
        var idx = idxFor(pl.getAttribute("data-drop-play"));
        if (idx >= 0) {
          try {
            if (window.selectTrackFromList) window.selectTrackFromList(idx);
            if (window.switchAppPage) window.switchAppPage("player");
          } catch (err) {}
        }
        return;
      }
      var nb = e.target.closest ? e.target.closest("[data-drop-notify]") : null;
      if (nb) {
        try {
          var arr = JSON.parse(localStorage.getItem("drop_notifs") || "[]");
          var id = nb.getAttribute("data-drop-notify");
          if (arr.indexOf(id) < 0) arr.push(id);
          localStorage.setItem("drop_notifs", JSON.stringify(arr));
          nb.innerHTML = '<i class="fas fa-check"></i> You\'re in';
          if (window.toast) window.toast("We'll shout when this drops", "success");
        } catch (err) {}
        return;
      }
      var rv = e.target.closest ? e.target.closest("[data-drop-rsvp]") : null;
      if (rv) {
        var rid = Number(rv.getAttribute("data-drop-rsvp")) || 0;
        var isIn = rv.getAttribute("data-rsvped") === "1";
        fetch("/api/drops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: isIn ? "unrsvp" : "rsvp", id: rid })
        }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
          .then(function (dd) {
            if (dd && dd.ok) {
              rv.setAttribute("data-rsvped", dd.rsvped ? "1" : "");
              rv.classList.toggle("in", !!dd.rsvped);
              rv.innerHTML = '<i class="fas fa-ticket"></i> ' + (dd.rsvped ? "Going" : "Join") +
                ' <span class="drop-count">' + (dd.rsvp_count || 0) + "</span>";
              if (window.toast && dd.rsvped) window.toast("You're on the list", "success");
            } else if (window.toast) window.toast("Sign in to join", "error");
          });
        return;
      }
    });
    fill(sec, items);
    setInterval(function () { tickCountdowns(sec); }, 1000);
    tickCountdowns(sec);
    return sec;
  }

  function fill(sec, d) {
    var list = sec.querySelector("#drops-list");
    if (!list) return;
    var h = "";
    (d.live || []).forEach(function (x) { h += cardHTML(x, true); });
    (d.upcoming || []).forEach(function (x) { h += cardHTML(x, false); });
    if (!h) h = '<p class="drops-empty">No drops scheduled — check back soon.</p>';
    list.innerHTML = h;
    tickCountdowns(sec);
  }

  function ownerForm() {
    if (document.getElementById("drop-create")) return;
    var panel = document.getElementById("owner-panel");
    if (!panel) return;
    var code = "";
    try { code = localStorage.getItem("ownerCode") || ""; } catch (e) {}
    if (!code && !window.__ownerStatsURL) return;
    css();
    var f = document.createElement("div");
    f.className = "drop-form";
    f.id = "drop-create";
    f.innerHTML = "<h4>Schedule a drop</h4>" +
      '<input id="drop-f-title" maxlength="120" placeholder="Drop title">' +
      '<textarea id="drop-f-desc" rows="2" maxlength="500" placeholder="Description (optional)"></textarea>' +
      '<input id="drop-f-track" maxlength="140" placeholder="Track title (optional — enables Play now)">' +
      '<div class="drop-form-row"><input id="drop-f-start" type="datetime-local"><input id="drop-f-end" type="datetime-local"></div>' +
      '<button type="button" class="drop-btn" id="drop-f-go"><i class="fas fa-plus"></i> Create drop</button>';
    panel.appendChild(f);
    document.getElementById("drop-f-go").addEventListener("click", function () {
      var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
      var iso = function (v) { try { return v ? new Date(v).toISOString() : ""; } catch (e) { return ""; } };
      var c = "";
      try { c = localStorage.getItem("ownerCode") || ""; } catch (e) {}
      fetch("/api/drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: c, title: g("drop-f-title"), description: g("drop-f-desc"),
          track_title: g("drop-f-track"), starts_at: iso(g("drop-f-start")), ends_at: iso(g("drop-f-end"))
        })
      }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
        .then(function (d) {
          if (d && d.ok) {
            if (window.toast) window.toast("Drop scheduled", "success");
            boot(true);
          } else if (window.toast) window.toast("Could not create drop", "error");
        });
    });
  }

  function boot(refresh) {
    /* The drops come with the bootstrap, when it has been fetched - one
       request carrying several answers rather than one request each. */
    try {
      var boot = window.THWBootstrap && window.THWBootstrap.from("drops");
      if (boot && (boot.live || boot.upcoming || boot.past)) {
        var sec = mount(boot);
        if (refresh) fill(sec, boot);
        ownerForm();
        return;
      }
    } catch (e) {}
    fetch("/api/drops", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true) return;
        var sec = mount(d);
        if (refresh) fill(sec, d);
      });
    ownerForm();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { boot(); });
  else boot();
  setInterval(ownerForm, 10000);
})();
