/* Batch 27 - this square is drawn at 30 pixels, so it takes the 64px thumbnail instead of the full-size cover. */
function _smallCoverTimeline(src) {
  var t = (typeof window !== "undefined" && window._coverThumb) ? window._coverThumb(src, "64") : null;
  return t || src;
}
/* Timeline / Era Explorer — lives inside The Vault (hub page).
 * Groups the vault trackList by era tag + year (metadata only — no links to
 * anything but the on-site player). Era nodes are collapsed accordions; track
 * rows build on first expand so the DOM stays small. */
(function () {
  "use strict";
  if (window.__timelineMounted) return;
  window.__timelineMounted = true;

  var SEC = "era-explorer";

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

  function eraOf(t) {
    try {
      var m = String((t || {}).tag || "").match(/\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }

  function yearOf(t) {
    var y = parseInt(t && t.year, 10);
    return isNaN(y) ? 0 : y;
  }

  function css() {
    if (document.getElementById("timeline-style")) return;
    var st = document.createElement("style");
    st.id = "timeline-style";
    st.textContent =
      ".era-sec{max-width:56rem;margin:0 auto;width:100%;padding:0 1rem 2rem}" +
      ".era-head{text-align:center;margin-bottom:14px}" +
      ".era-title{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;background:linear-gradient(90deg,#67e8f9,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}" +
      ".era-sub{font-size:11px;color:rgba(255,255,255,.45);font-style:italic;margin-top:4px}" +
      ".era-rail{position:relative;margin-left:8px;padding-left:22px;border-left:1px solid rgba(255,255,255,.1)}" +
      ".era-node{position:relative;margin-bottom:10px}" +
      ".era-node::before{content:'';position:absolute;left:-27px;top:16px;width:9px;height:9px;border-radius:50%;background:#0d0a18;border:2px solid #67e8f9}" +
      ".era-btn{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03);border-radius:13px;padding:11px 13px;cursor:pointer;color:#fff}" +
      ".era-btn:hover{border-color:rgba(103,232,249,.4)}" +
      ".era-code{font-family:monospace;font-size:12px;font-weight:800;color:#67e8f9;flex-shrink:0}" +
      ".era-meta{flex:1;min-width:0;font-size:11px;color:rgba(255,255,255,.55)}" +
      ".era-cnt{font-size:10px;font-family:monospace;color:rgba(255,255,255,.45);flex-shrink:0}" +
      ".era-chev{color:rgba(255,255,255,.4);font-size:11px;transition:transform .15s ease}" +
      ".era-node.open .era-chev{transform:rotate(90deg)}" +
      ".era-years{margin:8px 0 4px 2px}" +
      ".era-year{font-size:10px;font-weight:800;letter-spacing:.1em;color:rgba(255,255,255,.4);margin:8px 0 4px}" +
      ".era-peak{color:#67e8f9;letter-spacing:.02em}" +
      ".era-track{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:9px;padding:5px 6px;cursor:pointer;color:#fff}" +
      ".era-track:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1)}" +
      ".era-art{width:30px;height:30px;border-radius:7px;object-fit:cover;flex-shrink:0;background:#1c1530}" +
      ".era-tt{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".era-more{font-size:11px;color:#67e8f9;background:none;border:none;cursor:pointer;padding:6px 2px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function buildModel() {
    var tl = getTL();
    var eras = {}, i, t;
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      var era = eraOf(t);
      if (!eras[era]) eras[era] = { code: era, tracks: [], minY: 9999, maxY: 0 };
      eras[era].tracks.push({ idx: i, title: t.title || "", year: yearOf(t), cover: t.cover || "" });
      if (t.year) {
        if (t.year < eras[era].minY) eras[era].minY = t.year;
        if (t.year > eras[era].maxY) eras[era].maxY = t.year;
      }
    }
    var arr = Object.keys(eras).map(function (k) { return eras[k]; });
    arr.forEach(function (e) {
      e.tracks.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      if (e.minY === 9999) e.minY = 0;
    });
    arr.sort(function (a, b) { return (a.minY || 9999) - (b.minY || 9999); });
    return arr;
  }

  function span(e) {
    if (!e.minY) return e.tracks.length + " tracks";
    return e.minY + (e.maxY && e.maxY !== e.minY ? "–" + e.maxY : "") + " · " + e.tracks.length + " tracks";
  }

  function renderYears(e) {
    var byYear = {}, order = [], i;
    e.tracks.forEach(function (t) {
      var y = t.year || "Unknown";
      if (!byYear[y]) { byYear[y] = []; order.push(y); }
      byYear[y].push(t);
    });
    var peakY = null, peakN = 0;
    order.forEach(function (y) {
      if (y !== "Unknown" && byYear[y].length > peakN) { peakN = byYear[y].length; peakY = y; }
    });
    order.sort(function (a, b) { return (Number(b) || 0) - (Number(a) || 0); });
    var h = "";
    order.forEach(function (y) {
      h += '<div class="era-year">' + esc(String(y)) + (y === peakY ? ' <span class="era-peak">· peak year</span>' : "") + "</div>";
      byYear[y].slice(0, 8).forEach(function (t) {
        h += '<button type="button" class="era-track" data-era-idx="' + t.idx + '">' +
          '<img decoding="async" class="era-art" src="' + esc(_smallCoverTimeline(t.cover || "Juice-WRLD.png")) + '" alt="" loading="lazy" onerror="this.onerror=function(){this.onerror=null;this.src=\'Juice-WRLD.png\'};this.src=\'' + esc(t.cover || "Juice-WRLD.png").replace(/'/g, "&#39;") + '\'">' +
          '<span class="era-tt">' + esc(t.title) + '</span>' +
          '<i class="fas fa-play" style="color:rgba(255,255,255,.3);font-size:10px"></i></button>';
      });
    });
    return h;
  }

  function mount(model) {
    if (document.getElementById(SEC)) return;
    var hub = document.getElementById("page-section-hub");
    if (!hub) return;
    var head = hub.querySelector(".text-center");
    if (!head) return;
    css();
    var sec = document.createElement("section");
    sec.id = SEC;
    sec.className = "era-sec";
    var h = '<div class="era-head"><div class="era-title"><i class="fas fa-timeline"></i> Era Explorer</div>' +
      '<p class="era-sub">Walk the vault era by era — tap to expand, play anything.</p></div><div class="era-rail">';
    model.forEach(function (e, i) {
      h += '<div class="era-node" data-era="' + i + '">' +
        '<button type="button" class="era-btn"><span class="era-code">' + esc(e.code) + "</span>" +
        '<span class="era-meta">' + esc(span(e)) + '</span>' +
        '<span class="era-cnt">' + e.tracks.length + '</span>' +
        '<i class="fas fa-chevron-right era-chev"></i></button>' +
        '<div class="era-years" hidden></div></div>';
    });
    sec.innerHTML = h + "</div>";
    /* Anchor changed from "immediately after the page header" to "immediately after
       the Biography / Discography panel".

       Era Explorer was being wedged between the header and the bio panel, so on a
       phone you scrolled past eleven collapsed era nodes before seeing anything
       else. The static HTML already has Biography/Discography as the first
       content block - this insertion was the only thing pushing it down.

       Deliberately NOT moving the bio wrapper in index.html instead: the Vault's
       accent colours are positional via #community-updates > div:nth-of-type(N),
       and #era-explorer is a <section> rather than a <div>, so relocating it here
       cannot renumber a single one of them. */
    var host = head.parentNode;
    var bio = host.querySelector(".mb-6.max-w-3xl.mx-auto");
    host.insertBefore(sec, bio ? bio.nextSibling : head.nextSibling);
    sec._model = model;
    sec.addEventListener("click", function (ev) {
      var play = ev.target.closest ? ev.target.closest("[data-era-idx]") : null;
      if (play) {
        var idx = Number(play.getAttribute("data-era-idx"));
        if (!isNaN(idx) && idx >= 0) {
          try {
            if (window.selectTrackFromList) window.selectTrackFromList(idx);
            if (window.switchAppPage) window.switchAppPage("player");
          } catch (err) {}
        }
        return;
      }
      var btn = ev.target.closest ? ev.target.closest(".era-btn") : null;
      if (!btn) return;
      var node = btn.closest ? btn.closest(".era-node") : null;
      if (!node) return;
      var box = node.querySelector(".era-years");
      var open = node.classList.toggle("open");
      if (open && box && !box.hasAttribute("data-built")) {
        box.setAttribute("data-built", "1");
        box.innerHTML = renderYears(sec._model[Number(node.getAttribute("data-era"))]);
      }
      if (box) box.hidden = !open;
    });
  }

  var built = false;
  function boot() {
    if (built) return;
    var hub = document.getElementById("page-section-hub");
    if (!hub || !getTL().length) return;
    var go = function () {
      if (built) return;
      built = true;
      mount(buildModel());
    };
    if (hub.classList.contains("active")) { go(); return; }
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (hub.classList.contains("active")) {
          try { mo.disconnect(); mo = null; } catch (e) {}
          go();
        }
      });
      mo.observe(hub, { attributes: true, attributeFilter: ["class"] });
      setTimeout(function () { 
        if (!built && hub.classList.contains("active")) { 
          try { if (mo) mo.disconnect(); } catch (e) {}
          go(); 
        } 
      }, 4000);
    } else {
      go();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setInterval(function () { if (!built) boot(); }, 15000);
})();
