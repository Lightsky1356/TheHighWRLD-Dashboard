/* Track information panel extras — appended inside #info-panel.
 * Shows metadata the base panel lacks: global plays/favorites (live counts),
 * duration, category, favorite toggle, add-to-queue, share link, and track index.
 * Missing fields are hidden, never faked. Era / Year / Producer(s) are not
 * repeated here - the panel itself renders them.
 * Refreshes when the panel opens or the track changes. */
(function () {
  "use strict";
  if (window.__trackinfoMounted) return;
  window.__trackinfoMounted = true;

  var BOX = "trackinfo-extra";
  var lastKey = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function getTL() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    return [];
  }

  function curIdx() {
    try { if (typeof currentTrackIndex !== "undefined" && currentTrackIndex >= 0) return currentTrackIndex; } catch (e) {}
    return -1;
  }

  function fmtDur(sec) {
    sec = Math.round(Number(sec) || 0);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function eraOf(t) {
    try {
      var m = String((t || {}).tag || "").match(/\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return "";
  }

  function css() {
    if (document.getElementById("trackinfo-style")) return;
    var st = document.createElement("style");
    st.id = "trackinfo-style";
    st.textContent =
      ".ti-x{display:block}" +
      ".ti-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0}" +
      ".ti-cell{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:9px 11px;min-width:0}" +
      ".ti-cell span{display:block;font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.38);margin-bottom:3px}" +
      ".ti-cell b{display:block;font-size:14px;font-weight:700;color:#fff;line-height:1.25;overflow-wrap:anywhere}" +
      ".ti-actions{display:flex;gap:10px;margin-top:14px}" +
      ".ti-btn{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:rgba(255,255,255,.9);border-radius:12px;padding:11px 10px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .2s,border-color .2s,color .2s,transform .2s}" +
      ".ti-btn i{font-size:11px}" +
      ".ti-btn:hover{background:rgba(34,211,238,.12);border-color:rgba(34,211,238,.4);color:#67e8f9;transform:translateY(-1px)}" +
      ".ti-btn.primary{background:linear-gradient(135deg,rgba(34,211,238,.18),rgba(168,85,247,.18));border-color:rgba(34,211,238,.35);color:#e0f2fe}" +
      ".ti-btn.on{border-color:rgba(244,114,182,.45);color:#f9a8d4;background:rgba(244,114,182,.12)}" +
      "@media (max-width:767px){" +
      ".ti-grid{grid-template-columns:1fr 1fr;gap:8px}" +
      ".ti-cell{padding:8px 10px;border-radius:11px}" +
      ".ti-actions{gap:8px}" +
      ".ti-btn{padding:12px 6px;font-size:11px;gap:5px;border-radius:11px}" +
      "}";
    (document.head || document.documentElement).appendChild(st);
  }

  function isFav(idx) {
    try { if (typeof isFavorite === "function") return !!isFavorite(idx); } catch (e) {}
    return null;
  }

  /* Share link for a track — reused by the stats action and the panel footer button. */
  function shareUrl(t) {
    return location.origin + location.pathname + "#track=" + encodeURIComponent((t && t.title) || "");
  }

  function doShare(t, btn) {
    var done = function () {
      if (window.toast) window.toast("Link copied", "success");
      else if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Copied';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl(t)).then(done, done);
    else done();
  }

  /* Alt names arrive as one comma-separated string: split into chips (presentation only).
     Rebuild whenever the chips are not currently in the DOM - script.js rewrites this
     element on track change / panel re-open, which wipes the chips. */
  function chipsAlt() {
    var el = document.getElementById("info-altnames");
    if (!el) return;
    if (el.querySelector(".info-chip")) return;
    var raw = String(el.textContent || "").replace(/\s+/g, " ").trim();
    el.setAttribute("data-chips-src", raw);
    if (!raw || raw === "N/A") { el.classList.add("ti-na"); return; }
    var parts = raw.split(/\s*,\s*/).filter(Boolean).slice(0, 24);
    el.classList.remove("ti-na");
    el.textContent = "";
    for (var i = 0; i < parts.length; i++) {
      var s = document.createElement("span");
      s.className = "info-chip";
      s.textContent = parts[i];
      el.appendChild(s);
    }
  }

  function render(idx, counts) {
    var panel = document.getElementById("info-panel");
    if (!panel) return;
    var old = document.getElementById(BOX);
    if (old) old.remove();
    var tl = getTL();
    var t = tl[idx] || {};
    if (!t.title) return;
    css();
    var fav = isFav(idx);
    var cells = "";
    var add = function (k, v) {
      if (v === null || v === undefined || v === "") return;
      cells += '<div class="ti-cell"><span>' + esc(k) + "</span><b>" + esc(String(v)) + "</b></div>";
    };
    /* Era / Year / Producer(s) already live in the panel's hero + Details rows, so
       only the extra counters belong here (no duplicated fields). */
    add("Plays", Number(counts && counts.plays != null ? counts.plays : 0).toLocaleString());
    add("Favorited", counts && counts.favs != null ? Number(counts.favs).toLocaleString() + "x" : null);
    if (t.duration) add("Length", fmtDur(t.duration));
    if (t.category) add("Category", String(t.category).charAt(0).toUpperCase() + String(t.category).slice(1));
    add("Track #", String(idx + 1));
    var box = document.createElement("div");
    box.id = BOX;
    box.className = "ti-x";
    box.innerHTML = '<div class="ti-grid">' + cells + "</div>" +
      '<div class="ti-actions">' +
      (fav !== null ? '<button type="button" class="ti-btn primary' + (fav ? " on" : "") + '" data-ti="fav"><i class="fas fa-heart"></i> ' + (fav ? "Favorited" : "Favorite") + "</button>" : "") +
      '<button type="button" class="ti-btn" data-ti="queue"><i class="fas fa-list-ul"></i> Queue</button>' +
      '<button type="button" class="ti-btn" data-ti="share"><i class="fas fa-share-nodes"></i> Share</button>' +
      '<button type="button" class="ti-btn" data-ti="send"><i class="fas fa-paper-plane"></i> Send</button></div>';
    (document.getElementById("info-stats-slot") || panel).appendChild(box);
    chipsAlt();
    box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-ti]") : null;
      if (!b) return;
      var a = b.getAttribute("data-ti");
      try {
        if (a === "fav" && typeof toggleFavorite === "function") { toggleFavorite(idx); setTimeout(function () { refresh(idx); }, 150); }
        else if (a === "queue" && typeof addToQueue === "function") {
          addToQueue(idx);
          if (window.toast) window.toast("Added to queue", "success");
          else b.innerHTML = '<i class="fas fa-check"></i> Queued';
        }
        else if (a === "share") doShare(t, b);
        /* Send it into a chat. The panel owns the picker - who to send it to
           and the send itself - because it already knows the friends and the
           conversations, and this panel only knows the track. */
        else if (a === "send") {
          if (window.THWSocial && typeof window.THWSocial.shareTrack === "function") window.THWSocial.shareTrack(t);
          else if (window.toast) window.toast("Friends & Messages is still loading - try again in a moment.", "warn");
        }
      } catch (err) {}
    });
  }

  function refresh(idx) {
    if (idx == null || idx < 0) idx = curIdx();
    if (idx < 0) return;
    var tl = getTL();
    var t = tl[idx] || {};
    var key = String(t.title || "") + "#" + idx;
    var panel = document.getElementById("info-panel");
    var open = panel && !panel.classList.contains("hidden");
    if (key === lastKey && document.getElementById(BOX)) return;
    lastKey = key;
    render(idx, null);
    if (!t.title) return;
    fetch("/api/trackplay?title=" + encodeURIComponent(t.title), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) {
        if (!d || d.ok !== true) return;
        if (open) render(idx, d);
      });
  }

  /* Whenever the panel rewrites its own fields (track change, re-open), refresh the
     extras + alt-name chips straight away instead of waiting for the poll. Same
     handlers, same single /api/trackplay call per change - no new observers.
     Installed lazily: script.js defines refreshInfoPanel and may run after us. */
  function hookRefresh() {
    try {
      if (typeof refreshInfoPanel === "function" && !refreshInfoPanel.__tiWrapped) {
        var orig = refreshInfoPanel;
        var wrapped = function () {
          var out = orig.apply(this, arguments);
          try {
            var p = document.getElementById("info-panel");
            if (p && !p.classList.contains("hidden")) {
              chipsAlt();   /* the panel just rewrote the alt-names text */
              refresh();
            }
          } catch (e) {}
          return out;
        };
        wrapped.__tiWrapped = true;
        refreshInfoPanel = wrapped;
      }
    } catch (e) {}
  }

  function boot() {
    var panel = document.getElementById("info-panel");
    hookRefresh();
    /* footer share button: reuses the same share path as the stats action
       (the old inline onclick pointed at an undefined shareTrack()) */
    var shareBtn = document.getElementById("info-share-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var i = curIdx();
        var tl = getTL();
        doShare(tl[i] || {}, shareBtn);
      });
    }
    if (panel && window.MutationObserver) {
      new MutationObserver(function () {
        hookRefresh();
        if (!panel.classList.contains("hidden")) refresh();
        else lastKey = "";
      }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
    setInterval(function () {
      var p = document.getElementById("info-panel");
      if (p && !p.classList.contains("hidden")) refresh();
    }, 5000);
    window.refreshTrackInfo = function () { lastKey = ""; refresh(); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
