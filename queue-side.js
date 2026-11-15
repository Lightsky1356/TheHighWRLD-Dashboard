/* Queue — the desktop side panel
 *
 * The WRLD Deck and the WRLD Player's queue buttons open this: a drawer
 * pinned to the right of the screen, the way juicewrld.io's queue sits
 * against the edge of the page.
 *
 *   Now playing   the track, the era and type line, the bars, the heart
 *   Up next       the count, a Clear button, and the list — grips to drag
 *                 the order around, a cover, the duration, an x to bin it
 *   The footer    how many songs are left, and how long they take
 *
 * The phone keeps its own full-screen queue page; this file does not lay
 * anything out for it. On a phone the buttons fall through to whatever the
 * dropdown used to do.
 *
 * Everything here drives the same globals the rest of the site drives —
 * trackQueue, addToQueue/removeFromQueue/clearQueue, selectTrackFromList,
 * isFavorite/toggleFavorite — so the side panel and the player's own
 * machinery agree on one queue.
 */
(function () {
  "use strict";
  if (window.__queueSideMounted) return;
  window.__queueSideMounted = true;

  var OUTSIDE = "qs-open";
  var el = null;
  var syncIv = null;
  var dragQi = -1;
  var lastDropRow = null;

  function notify(text) {
    try { if (typeof showToastSimple === "function") { showToastSimple(text, { type: "info" }); return; } } catch (e) {}
    try { if (typeof toast === "function") toast(text, "info", 2200); } catch (e) {}
  }

  function isDesktop() {
    try { return window.matchMedia("(min-width:768px)").matches; } catch (e) { return true; }
  }
  function qa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function q(root, sel) { return root.querySelector(sel); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }
  function audioEl() { try { return document.querySelector("audio"); } catch (e) { return null; } }
  function currentIndex() { try { if (typeof currentTrackIndex === "number") return currentTrackIndex; } catch (e) {} return -1; }
  function currentTrack() {
    var i = currentIndex();
    try { if (i >= 0 && typeof trackList !== "undefined" && trackList[i]) return trackList[i]; } catch (e) {}
    return null;
  }
  function trackAt(qi) { try { return (typeof trackList !== "undefined") ? trackList[qi] || null : null; } catch (e) { return null; } }
  /* The rows carry queue positions, not track indices — resolve a position
     through trackQueue first, or the toast names whatever happens to sit at
     the same index of the flat track list. */
  function queuedTrackAt(pos) {
    try {
      if (typeof trackQueue === "undefined" || !trackQueue) return null;
      if (pos < 0 || pos >= trackQueue.length) return null;
      var idx = trackQueue[pos];
      if (idx == null || idx < 0) return null;
      return trackAt(idx);
    } catch (e) { return null; }
  }
  function queueSlice() { try { if (typeof trackQueue !== "undefined" && trackQueue) return trackQueue.slice(); } catch (e) {} return []; }

  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;
  var ERA_NAME = {
    "GB&GR": "Goodbye & Good Riddance", "WOD": "WRLD ON DRUGS", "DRFL": "Death Race For Love",
    "JW3": "Legends Never Die", "POST": "Posthumous", "OUT": "Outsiders", "AF": "Afflictions",
    "ND": "Nothing's Different", "BDM": "BINGEDRINKINGMUSIC", "SOUNDCLOUD": "SoundCloud",
  };
  function eraCodeOf(t) {
    try { var m = String((t || {}).tag || "").match(ERA_RE); if (m) return m[1].toUpperCase(); } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }
  function catLabel(t) {
    var c = String((t || {}).category || "");
    return c === "leaks" ? "Leaked" : c === "sessions" ? "Sessions" : c === "halloween" ? "Halloween" : "";
  }
  function eraLine(t) {
    var bits = [];
    var cat = catLabel(t);
    if (cat) bits.push(cat);
    bits.push(ERA_NAME[eraCodeOf(t)] || "Other");
    return bits.join(" · ");
  }
  function coverThumb(src, tier) {
    try { if (window._coverThumb) { var t = window._coverThumb(src || "Juice-WRLD.png", tier || "64"); if (t) return t; } } catch (e) {}
    return src || "Juice-WRLD.png";
  }
  function coverOf(t) { return t && t.cover ? String(t.cover) : "Juice-WRLD.png"; }

  /* ---- the stylesheet ---- */
  function css() {
    if (document.getElementById("queue-side-style")) return;
    var st = document.createElement("style");
    st.id = "queue-side-style";
    st.textContent =
      "#queue-side{position:fixed;top:0;right:0;bottom:0;z-index:10400;width:min(380px,94vw);display:flex;flex-direction:column;background-image:linear-gradient(157deg, rgba(31,27,49,.97) 0%, rgba(16,14,30,.98) 42%, rgba(24,20,39,.97) 100%);background-color:#151225;border-left:1px solid rgba(255,255,255,.17);box-shadow:-24px 0 70px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.13), inset 0 0 60px rgba(120,110,255,.05);color:#fff;font-family:inherit;transform:translateX(103%);transition:transform .3s cubic-bezier(.25,.8,.3,1)}" +
      "#queue-side.is-open{transform:translateX(0)}" +

      /* the header */
      ".qs-top{display:flex;align-items:center;justify-content:space-between;padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0}" +
      ".qs-title{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em;color:#fff}" +
      ".qs-top-icons{display:flex;align-items:center;gap:4px}" +
      ".qs-icon{background:none;border:none;color:rgba(255,255,255,.55);width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;transition:color .15s ease,background .15s ease}" +
      ".qs-icon:hover{color:#fff;background:rgba(255,255,255,.07)}" +
      ".qs-icon.on{color:#e879f9}" +
      ".qs-close{background:none;border:1px solid rgba(255,255,255,.13);color:rgba(255,255,255,.8);width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;margin-left:4px;transition:color .15s ease,background .15s ease}" +
      ".qs-close:hover{color:#fff;background:rgba(255,255,255,.09)}" +

      /* now playing */
      ".qs-np{display:flex;align-items:center;gap:13px;padding:15px 16px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0}" +
      ".qs-np-cover{width:56px;height:56px;border-radius:11px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".qs-np-meta{flex:1;min-width:0}" +
      ".qs-np-title{margin:0;font-size:14.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".qs-np-sub{margin:3px 0 0;font-size:10.5px;color:rgba(255,255,255,.42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".qs-np-right{display:flex;align-items:center;gap:10px;flex-shrink:0}" +
      ".qs-eq{display:flex;align-items:flex-end;gap:2.5px;height:18px}" +
      ".qs-eq span{width:3.5px;border-radius:2px;background:#c084fc;height:30%;transform-origin:bottom}" +
      ".qs-eq.on span{animation:qseq 0.9s ease-in-out infinite}" +
      ".qs-eq span:nth-child(2){animation-delay:.18s}" +
      ".qs-eq span:nth-child(3){animation-delay:.38s}" +
      ".qs-eq span:nth-child(4){animation-delay:.29s}" +
      "@keyframes qseq{0%,100%{height:22%}50%{height:100%}}" +
      ".qs-np-dur{font-size:11.5px;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums}" +
      ".qs-np-fav{background:none;border:none;color:rgba(255,255,255,.6);width:36px;height:44px;min-width:36px;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}" +
      ".qs-np-fav.on{color:#fb7185}" +
      ".qs-np-fav:hover{color:#fff}" +

      /* up next header */
      ".qs-upnext{display:flex;align-items:center;justify-content:space-between;padding:13px 18px 9px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0}" +
      ".qs-upnext-title{margin:0;font-size:13px;font-weight:800;letter-spacing:.04em;color:rgba(255,255,255,.72);text-transform:uppercase}" +
      ".qs-upnext-count{color:#e879f9;font-variant-numeric:tabular-nums;margin-left:7px}" +
      ".qs-clear{background:none;border:none;color:rgba(255,255,255,.8);font-size:12px;font-weight:700;cursor:pointer;padding:6px 10px;border-radius:8px;transition:color .15s ease}" +
      ".qs-clear:hover{color:#fff}" +
      ".qs-clear:disabled{color:rgba(255,255,255,.25);cursor:default}" +

      /* the list */
      ".qs-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 8px}" +
      ".qs-row{display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:13px;border:1px solid transparent;cursor:pointer;position:relative;content-visibility:auto;contain-intrinsic-size:auto 60px}" +
      ".qs-row:hover{background:rgba(255,255,255,.05)}" +
      ".qs-row.is-dragging{opacity:.35}" +
      ".qs-row.drop-above{border-top-color:#e879f9}" +
      ".qs-row.drop-below{border-bottom-color:#e879f9}" +
      ".qs-grip{background:none;border:none;color:rgba(255,255,255,.3);width:24px;min-width:24px;height:44px;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:grab;border-radius:8px}" +
      ".qs-grip:hover{color:#fff}" +
      ".qs-grip:active{cursor:grabbing}" +
      ".qs-row-cover{width:46px;height:46px;border-radius:9px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".qs-row-meta{flex:1;min-width:0}" +
      ".qs-row-title{margin:0;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".qs-row-sub{margin:3px 0 0;font-size:10px;color:rgba(255,255,255,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".qs-row-dur{font-size:11px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;flex-shrink:0;min-width:34px;text-align:right}" +
      ".qs-row-x{background:none;border:none;color:rgba(255,255,255,.32);width:32px;height:44px;min-width:32px;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;border-radius:8px}" +
      ".qs-row-x:hover{color:#fff;background:rgba(255,255,255,.06)}" +

      /* the footer */
      ".qs-foot{padding:12px 18px max(14px,env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.07);flex-shrink:0;text-align:center}" +
      ".qs-foot-line{font-size:11px;color:rgba(255,255,255,.38);font-variant-numeric:tabular-nums}" +

      /* empty state */
      ".qs-empty{text-align:center;color:rgba(255,255,255,.4);font-size:13px;line-height:1.75;padding:44px 26px}" +
      ".qs-empty i{display:block;font-size:26px;margin-bottom:12px;color:rgba(255,255,255,.22)}" +
      ".qs-empty b{color:#fff}" +

      /* short windows lose the footer */
      "@media (max-height:640px){.qs-foot{display:none}.qs-np-cover{width:48px;height:48px}}" +

      /* phones: this panel is desktop-only */
      "@media (max-width:767px){#queue-side{display:none!important}}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- the panel ---- */
  function build() {
    css();
    var pane = document.getElementById("queue-side");
    if (pane) { el = pane; return pane; }
    pane = document.createElement("aside");
    pane.id = "queue-side";
    pane.setAttribute("role", "dialog");
    pane.setAttribute("aria-modal", "false");
    pane.setAttribute("aria-label", "Queue");
    pane.innerHTML =
      '<header class="qs-top">' +
        '<h2 class="qs-title">Queue</h2>' +
        '<div class="qs-top-icons">' +
          '<button type="button" class="qs-icon" data-qs="shuffle" title="Shuffle" aria-label="Shuffle" aria-pressed="false"><i class="fas fa-shuffle" aria-hidden="true"></i></button>' +
          '<button type="button" class="qs-icon" data-qs="repeat" title="Repeat" aria-label="Repeat" aria-pressed="false"><i class="fas fa-repeat" aria-hidden="true"></i></button>' +
          '<button type="button" class="qs-close" data-qs="close" aria-label="Close the queue"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
        '</div>' +
      '</header>' +
      '<div class="qs-np">' +
        '<img decoding="async" class="qs-np-cover" data-qs="np-cover" src="Juice-WRLD.png" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<div class="qs-np-meta">' +
          '<p class="qs-np-title" data-qs="np-title">Nothing playing</p>' +
          '<p class="qs-np-sub" data-qs="np-sub"></p>' +
        '</div>' +
        '<div class="qs-np-right">' +
          '<span class="qs-eq" data-qs="np-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
          '<span class="qs-np-dur" data-qs="np-duration"></span>' +
          '<button type="button" class="qs-np-fav" data-qs="np-fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="qs-upnext">' +
        '<h3 class="qs-upnext-title">Up next<span class="qs-upnext-count" data-qs="count"></span></h3>' +
        '<button type="button" class="qs-clear" data-qs="clear">Clear</button>' +
      '</div>' +
      '<div class="qs-list" data-qs="list" role="list"></div>' +
      '<footer class="qs-foot"><p class="qs-foot-line" data-qs="foot"></p></footer>';

    (document.body || document.documentElement).appendChild(pane);
    el = pane;
    bind(pane);
    return pane;
  }

  /* ---- rendering ---- */
  var lastSignature = "";
  function signature() {
    var qList = queueSlice();
    var t = currentTrack();
    var dur = "";
    try { var au = audioEl(); dur = au && isFinite(au.duration) ? String(Math.round(au.duration)) : ""; } catch (e) {}
    return currentIndex() + "|" + qList.join(",") + "|" + (t && t.title ? t.title : "") + "|" + dur;
  }

  function render() {
    if (!el) return;
    var sig = signature();
    if (sig === lastSignature) return;
    lastSignature = sig;

    var t = currentTrack();
    var cover = coverOf(t);

    /* now playing */
    var npCover = q(el, "[data-qs='np-cover']");
    if (npCover) {
      if (npCover.getAttribute("src") !== cover) npCover.src = cover;
    }
    var npTitle = q(el, "[data-qs='np-title']");
    if (npTitle) npTitle.textContent = t && t.title ? String(t.title) : "Nothing playing";
    var npSub = q(el, "[data-qs='np-sub']");
    if (npSub) npSub.textContent = t ? eraLine(t) : "";
    var npDur = q(el, "[data-qs='np-duration']");
    var au = audioEl();
    if (npDur) {
      var dv = (au && isFinite(au.duration)) ? au.duration : (t && Number(t.duration)) || 0;
      npDur.textContent = dv > 0 ? fmt(dv) : "";
    }
    var npFav = q(el, "[data-qs='np-fav']");
    if (npFav) {
      var on = false;
      try { if (currentIndex() >= 0 && typeof isFavorite === "function") on = !!isFavorite(currentIndex()); } catch (e) {}
      npFav.classList.toggle("on", on);
      npFav.setAttribute("aria-pressed", on ? "true" : "false");
      npFav.innerHTML = '<i class="' + (on ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i>';
    }
    var eq = q(el, "[data-qs='np-eq']");
    if (eq) {
      var playing = false;
      try { if (typeof isPlaying !== "undefined") playing = !!isPlaying; } catch (e) {}
      if (!playing && au) playing = !au.paused;
      eq.classList.toggle("on", playing);
    }

    /* shuffle/repeat icons */
    qa(el, "[data-qs='shuffle']").forEach(function (b) {
      var on2 = false; try { on2 = typeof shuffleMode !== "undefined" && shuffleMode === 1; } catch (e) {}
      b.classList.toggle("on", on2);
      b.setAttribute("aria-pressed", on2 ? "true" : "false");
    });
    qa(el, "[data-qs='repeat']").forEach(function (b) {
      var on3 = false; try { on3 = typeof repeatMode !== "undefined" && repeatMode !== 0; } catch (e) {}
      b.classList.toggle("on", on3);
      b.setAttribute("aria-pressed", on3 ? "true" : "false");
    });

    /* up next */
    var qList = queueSlice();
    var count = q(el, "[data-qs='count']");
    if (count) count.textContent = qList.length ? String(qList.length) : "";
    var clear = q(el, "[data-qs='clear']");
    if (clear) clear.disabled = !qList.length;

    var listEl = q(el, "[data-qs='list']");
    var foot = q(el, "[data-qs='foot']");
    var total = 0;
    if (listEl) {
      var savedScroll = listEl.scrollTop;
      listEl.textContent = "";
      if (!qList.length) {
        listEl.innerHTML = '<div class="qs-empty"><i class="fas fa-compact-disc"></i><b>Nothing up next</b><br>Add songs from the vault, any song page, or the drawer —<br>they line up here.</div>';
      } else {
        for (var i = 0; i < qList.length; i++) {
          (function (qi, trackIdx) {
            var t2 = trackAt(trackIdx);
            var row = document.createElement("div");
            row.className = "qs-row";
            row.setAttribute("data-qi", String(qi));
            row.setAttribute("role", "listitem");
            row.setAttribute("aria-label", "Play " + ((t2 && t2.title) || "track " + (trackIdx + 1)));
            row.innerHTML =
              '<button type="button" class="qs-grip" draggable="true" tabindex="-1" aria-label="Drag to reorder"><i class="fas fa-grip-vertical" aria-hidden="true"></i></button>' +
              '<img decoding="async" class="qs-row-cover" loading="lazy" src="' + esc(coverThumb(coverOf(t2), "64")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
              '<div class="qs-row-meta">' +
                '<p class="qs-row-title">' + esc((t2 && t2.title) || "Track " + (trackIdx + 1)) + '</p>' +
                '<p class="qs-row-sub">' + esc(t2 ? eraLine(t2) : "") + '</p>' +
              '</div>' +
              '<span class="qs-row-dur">' + esc(fmt((t2 && Number(t2.duration)) || 0)) + '</span>' +
              '<button type="button" class="qs-row-x" data-remove="' + qi + '" aria-label="Remove from the queue"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
            total += (t2 && Number(t2.duration)) || 0;
            listEl.appendChild(row);
          })(i, qList[i]);
        }
      }
      listEl.scrollTop = savedScroll;
    }
    if (foot) {
      if (qList.length) {
        foot.textContent = qList.length + (qList.length === 1 ? " song" : " songs") + " · " + fmt(total) + " left";
      } else {
        foot.textContent = "Nothing queued";
      }
    }
    try { if (typeof updateQueueBadge === "function") updateQueueBadge(); } catch (e) {}
  }

  /* ---- the interactions ---- */
  function bind(pane) {
    pane.addEventListener("click", function (e) {
      var grip = e.target.closest ? e.target.closest(".qs-grip") : null;
      var rm = e.target.closest ? e.target.closest("[data-remove]") : null;
      var row = e.target.closest ? e.target.closest(".qs-row") : null;
      var actEl = e.target.closest ? e.target.closest("[data-qs]") : null;

      if (rm) {
        e.stopPropagation();
        var qi = Number(rm.getAttribute("data-remove"));
        try { if (typeof removeFromQueue === "function") removeFromQueue(qi); } catch (err) {}
        render();
        return;
      }
      if (grip) return; /* the grip drags, it does not play */
      if (row) {
        var trackIdx = Number(row.getAttribute("data-qi"));
        var qList = queueSlice();
        var target = qList[trackIdx];
        try { if (typeof removeFromQueue === "function") removeFromQueue(trackIdx); } catch (err) {}
        try { if (typeof selectTrackFromList === "function") selectTrackFromList(target); } catch (err) {}
        render();
        return;
      }
      if (!actEl) return;
      var a = actEl.getAttribute("data-qs");
      if (a === "close") { closePanel(); return; }
      if (a === "clear") {
        try { if (typeof clearQueue === "function") clearQueue(); } catch (err) {}
        render();
        return;
      }
      if (a === "np-fav") {
        try { if (typeof toggleFavorite === "function" && currentIndex() >= 0) toggleFavorite(currentIndex()); } catch (err) {}
        if (typeof updateFavBtn === "function") { try { updateFavBtn(); } catch (err) {} }
        lastSignature = "";
        render();
        return;
      }
      if (a === "shuffle") {
        try { if (typeof setShuffle === "function") setShuffle((typeof shuffleMode !== "undefined" && shuffleMode) ? 0 : 1); } catch (err) {}
        lastSignature = "";
        render();
        return;
      }
      if (a === "repeat") {
        try { if (typeof setRepeat === "function") { var m = (typeof repeatMode !== "undefined" ? repeatMode : 0); setRepeat(m + 1); } } catch (err) {}
        lastSignature = "";
        render();
        return;
      }
    });

    /* drag to reorder — from the grip only */
    pane.addEventListener("dragstart", function (e) {
      var grip = e.target.closest ? e.target.closest(".qs-grip") : null;
      if (!grip) { e.preventDefault(); return; }
      var row = grip.closest(".qs-row");
      if (!row) return;
      dragQi = Number(row.getAttribute("data-qi"));
      lastDropRow = null;
      row.classList.add("is-dragging");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragQi));
        e.dataTransfer.setDragImage(row, 60, 24);
      } catch (err) {}
    });
    pane.addEventListener("dragover", function (e) {
      var row = e.target.closest ? e.target.closest(".qs-row") : null;
      if (dragQi < 0 || !row) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
      /* Only restyle when the target row or its above/below half changed —
         touching all 285 rows on every mousemove is what makes dragging stutter. */
      var rect = row.getBoundingClientRect();
      var below = (e.clientY - rect.top) > rect.height / 2;
      var cls = below ? "drop-below" : "drop-above";
      if (lastDropRow === row && row.classList.contains(cls)) return;
      if (lastDropRow && lastDropRow !== row) lastDropRow.classList.remove("drop-above", "drop-below");
      row.classList.remove("drop-above", "drop-below");
      row.classList.add(cls);
      lastDropRow = row;
    });
    pane.addEventListener("drop", function (e) {
      var row = e.target.closest ? e.target.closest(".qs-row") : null;
      if (dragQi < 0 || !row) return;
      e.preventDefault();
      var from = dragQi;
      var targetQi = Number(row.getAttribute("data-qi"));
      if (from === targetQi) { dragQi = -1; return; }
      var rect = row.getBoundingClientRect();
      var below = (e.clientY - rect.top) > rect.height / 2;
      var moved = queuedTrackAt(from);
      var movedTitle = (moved && moved.title) ? moved.title : "track";
      var neighbour = queuedTrackAt(targetQi);
      var neighbourTitle = (neighbour && neighbour.title) ? neighbour.title : "track";
      /* Compute the absolute insert position. If we are dragging an
         earlier row to before a later row, subtract one after removing
         the original - one splice total, one commit, no rebuilds. */
      var insertAt = below ? targetQi + 1 : targetQi;
      if (targetQi > from) insertAt -= 1;
      try { if (window.moveQueueItemTo) window.moveQueueItemTo(from, insertAt); } catch (err) {}
      lastSignature = "";
      render();
      notify("Moved " + movedTitle + " " + (below ? "below" : "above") + " " + neighbourTitle);
    });
    pane.addEventListener("dragend", function () {
      dragQi = -1;
      lastDropRow = null;
      qa(pane, ".qs-row").forEach(function (r) { r.classList.remove("is-dragging", "drop-above", "drop-below"); });
    });
  }

  /* ---- open / close ---- */
  function openPanel() {
    if (!isDesktop()) {
      var orig = window.__toggleQueuePanelOriginal;
      if (orig) orig();
      return;
    }
    var pane = build();
    var opened = !pane.classList.contains("is-open");
    var dd = document.getElementById("queue-dropdown");
    if (dd) dd.classList.add("hidden");
    pane.classList.toggle("is-open", opened);
    if (opened) {
      lastSignature = "";
      render();
      stopSync();
      syncIv = setInterval(render, 1000);
    } else {
      stopSync();
    }
  }
  function closePanel() {
    if (!el) return;
    el.classList.remove("is-open");
    stopSync();
  }
  function stopSync() { if (syncIv) { clearInterval(syncIv); syncIv = null; } }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var pane = document.getElementById("queue-side");
    if (pane && pane.classList.contains("is-open")) { e.preventDefault(); closePanel(); }
  });

  /* take over the queue button on desktop, keep the old dropdown on phones */
  var original = window.toggleQueuePanel;
  window.__toggleQueuePanelOriginal = original;
  window.toggleQueuePanel = openPanel;
})();
