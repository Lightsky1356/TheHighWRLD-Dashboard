/* Mobile expanded player — full-screen overlay reusing the SAME audio element
 * and existing player globals (no second engine). Opens by tapping the mini
 * player (outside its buttons). All transport actions delegate to the real
 * controls: mini-play click, prev/next, setShuffle, toggleQueuePanel. */
(function () {
  "use strict";
  if (window.__mplayerMounted) return;
  window.__mplayerMounted = true;

  var OV = "mplayer-ov";
  var syncIv = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function audioEl() {
    try { return document.querySelector("audio"); } catch (e) { return null; }
  }

  function txt(id) {
    try {
      var el = document.getElementById(id);
      return el ? (el.textContent || "") : "";
    } catch (e) { return ""; }
  }

  function coverSrc() {
    try {
      var el = document.getElementById("mini-cover");
      if (el && el.src) return el.src;
    } catch (e) {}
    return "Juice-WRLD.png";
  }

  function shuffleOn() {
    try {
      var b = document.getElementById("shuffle-btn");
      return !!(b && b.classList.contains("shuffle-active"));
    } catch (e) { return false; }
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function css() {
    if (document.getElementById("mplayer-style")) return;
    var st = document.createElement("style");
    st.id = "mplayer-style";
    st.textContent =
      ".mplayer-ov{position:fixed;inset:0;z-index:10002;display:flex;flex-direction:column;background:rgba(6,3,16,.96);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);padding:max(20px,env(safe-area-inset-top)) 22px max(24px,env(safe-area-inset-bottom));overflow-y:auto;touch-action:pan-y}" +
      ".mplayer-top{display:flex;align-items:center;justify-content:space-between;color:rgba(255,255,255,.6);font-size:11px;letter-spacing:.14em;text-transform:uppercase}" +
      /* 44px is the smallest target a thumb can hit reliably */
      ".mplayer-x{background:none;border:1px solid rgba(255,255,255,.16);color:#fff;border-radius:50%;width:44px;height:44px;min-width:44px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}" +
      ".mplayer-cover{width:min(72vw,300px);aspect-ratio:1/1;border-radius:20px;object-fit:cover;margin:26px auto 18px;display:block;box-shadow:0 24px 70px rgba(0,0,0,.6);background:#1c1530}" +
      ".mplayer-title{font-size:19px;font-weight:800;color:#fff;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mplayer-artist{font-size:13px;color:rgba(255,255,255,.55);text-align:center;margin-top:4px}" +
      /* the visible bar stays thin, but the thing you actually touch is 30px tall */
      ".mplayer-prog{position:relative;height:30px;margin:14px 0 0;cursor:pointer;touch-action:none;display:flex;align-items:center}" +
      ".mplayer-prog::before{content:'';position:absolute;left:0;right:0;top:50%;height:5px;transform:translateY(-50%);border-radius:99px;background:rgba(255,255,255,.12)}" +
      ".mplayer-fill{position:absolute;left:0;top:50%;height:5px;transform:translateY(-50%);border-radius:99px;background:linear-gradient(90deg,#fcd34d,#f59e0b);width:0%}" +
      ".mplayer-thumb{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.5);opacity:0;transition:opacity .15s ease;pointer-events:none}" +
      ".mplayer-prog.scrubbing .mplayer-thumb,.mplayer-prog:hover .mplayer-thumb{opacity:1}" +
      ".mplayer-prog:focus-visible{outline:2px solid #fbbf24;outline-offset:4px;border-radius:8px}" +
      ".mplayer-times{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.5);font-family:monospace;margin-top:2px}" +
      ".mplayer-ctrl{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:20px}" +
      ".mplayer-btn{background:none;border:none;color:rgba(255,255,255,.85);font-size:22px;cursor:pointer;width:48px;height:48px;min-width:48px;border-radius:50%;display:flex;align-items:center;justify-content:center}" +
      ".mplayer-btn:active{background:rgba(255,255,255,.08)}" +
      ".mplayer-btn:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}" +
      ".mplayer-btn.on{color:#fbbf24}" +
      ".mplayer-play{width:72px;height:72px;min-width:72px;border-radius:50%;background:linear-gradient(135deg,#fcd34d,#b45309);color:#1a1005;font-size:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none}" +
      ".mplayer-play:focus-visible{outline:2px solid #fbbf24;outline-offset:3px}" +
      ".mplayer-row{display:flex;align-items:center;justify-content:center;gap:26px;margin-top:18px}" +
      /* the grab bar only shows on a touch layout, and the sheet follows the finger */
      ".mplayer-grab{display:none;width:44px;height:5px;border-radius:99px;background:rgba(255,255,255,.22);margin:-8px auto 0}" +
      "@media (pointer:coarse){.mplayer-grab{display:block}}" +
      ".mplayer-hint{text-align:center;font-size:10px;color:rgba(255,255,255,.35);margin-top:16px}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* Where the finger is, as a fraction of the bar, clamped to 0..1. Works for
     mouse and touch because it reads clientX from whichever event fired. */
  function progRatio(ev, el) {
    var r = el.getBoundingClientRect();
    if (!r.width) return 0;
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }

  function seekTo(ratio) {
    try {
      var au = audioEl();
      if (!au || !au.duration) return false;
      au.currentTime = Math.max(0, Math.min(au.duration, ratio * au.duration));
      return true;
    } catch (e) { return false; }
  }

  /* Drag the bar, or nudge it with the arrow keys. A 5px line you can only click
     is no use with a thumb, so the whole 30px strip is the target. */
  function bindScrubbing(ov) {
    var prog = ov.querySelector('[data-mp="prog"]');
    if (!prog) return;
    var au = null;
    try { au = audioEl(); } catch (e) {}

    var dragging = false;
    function move(ev) {
      if (ev.cancelable) ev.preventDefault();
      seekTo(progRatio(ev, prog));
      sync();
    }
    prog.addEventListener("pointerdown", function (ev) {
      if (!au || !au.duration) return;
      dragging = true;
      prog.classList.add("scrubbing");
      if (prog.setPointerCapture && ev.pointerId != null) {
        try { prog.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      move(ev);
    });
    prog.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      move(ev);
    });
    function end(ev) {
      if (!dragging) return;
      dragging = false;
      prog.classList.remove("scrubbing");
      if (ev && prog.releasePointerCapture && ev.pointerId != null) {
        try { prog.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
      sync();
    }
    prog.addEventListener("pointerup", end);
    prog.addEventListener("pointercancel", end);

    prog.addEventListener("keydown", function (ev) {
      var au2 = null;
      try { au2 = audioEl(); } catch (e) {}
      if (!au2 || !au2.duration) return;
      var step = ev.shiftKey ? 30 : 5;
      var cur = au2.currentTime;
      if (ev.key === "ArrowRight") { seekTo(Math.min(1, (cur + step) / au2.duration)); }
      else if (ev.key === "ArrowLeft") { seekTo(Math.max(0, (cur - step) / au2.duration)); }
      else if (ev.key === "Home") { seekTo(0); }
      else if (ev.key === "End") { seekTo(0.999); }
      else return;
      ev.preventDefault();
      sync();
    });
  }

  /* Swipe the sheet down to dismiss it. Only once it has clearly moved down, so
     it never steals a scroll or a tap. */
  function bindSwipeDown(ov) {
    var startY = null, startT = 0, moved = false;
    ov.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse") return;   /* a mouse drag should not close it */
      startY = ev.clientY;
      startT = Date.now();
      moved = false;
    }, { passive: true });
    ov.addEventListener("pointermove", function (ev) {
      if (startY == null) return;
      var dy = ev.clientY - startY;
      if (dy > 12) {
        moved = true;
        ov.style.transition = "none";
        ov.style.transform = "translateY(" + dy + "px)";
      }
    }, { passive: true });
    function finish() {
      if (startY == null) return;
      var dy = (ov.__lastY || 0) - startY;
      ov.style.transition = "transform .22s ease";
      ov.style.transform = "";
      var quick = Date.now() - startT < 260;
      if (moved && (dy > 110 || (quick && dy > 45))) { close(); return; }
      startY = null;
      setTimeout(function () { ov.style.transition = ""; }, 240);
    }
    ov.addEventListener("pointerup", function (ev) { ov.__lastY = ev.clientY; finish(); }, { passive: true });
    ov.addEventListener("pointercancel", function () {
      startY = null; moved = false;
      ov.style.transition = "transform .22s ease";
      ov.style.transform = "";
    }, { passive: true });
  }

  /* what sync() last wrote, so an idle tick does no DOM writes at all */
  var lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null };

  function sync() {
    var ov = document.getElementById(OV);
    if (!ov) { stopSync(); return; }
    try {
      var t = txt("mini-title"), a = txt("mini-artist");
      var te = ov.querySelector("[data-mp=title]"), ae = ov.querySelector("[data-mp=artist]");
      if (te && te.textContent !== t) te.textContent = t || "Nothing playing";
      if (ae && ae.textContent !== a) ae.textContent = a || "Juice WRLD";
      var cov = ov.querySelector("[data-mp=cover]");
      var src = coverSrc();
      if (cov && cov.getAttribute("src") !== src) cov.src = src;
      var au = audioEl();
      var cur = au ? au.currentTime : 0, dur = au ? (au.duration || 0) : 0;
      var pct = dur > 0 ? Math.min(100, cur / dur * 100) : 0;
      /* this runs on a timer as well as on timeupdate, so nothing is written
         unless the value actually moved - a style write invalidates layout on
         a phone whether or not anything changed */
      var rounded = Math.round(pct * 10) / 10;
      if (lastSync.pct !== rounded) {
        lastSync.pct = rounded;
        var fill = ov.querySelector("[data-mp=fill]");
        if (fill) fill.style.width = rounded + "%";
        var thumb = ov.querySelector("[data-mp=thumb]");
        if (thumb) thumb.style.left = rounded + "%";
        var prog = ov.querySelector("[data-mp=prog]");
        if (prog) prog.setAttribute("aria-valuenow", String(Math.round(rounded)));
      }
      var curTxt = fmt(cur), durTxt = fmt(dur);
      var ce = ov.querySelector("[data-mp=cur]"), de = ov.querySelector("[data-mp=dur]");
      if (ce && ce.textContent !== curTxt) ce.textContent = curTxt;
      if (de && de.textContent !== durTxt) de.textContent = durTxt;
      if (lastSync.curTxt !== curTxt || lastSync.durTxt !== durTxt) {
        lastSync.curTxt = curTxt; lastSync.durTxt = durTxt;
        var prog2 = ov.querySelector("[data-mp=prog]");
        if (prog2) prog2.setAttribute("aria-valuetext", curTxt + " of " + durTxt);
        var playing = !!(au && !au.paused);
        if (lastSync.playing !== playing) {
          lastSync.playing = playing;
          var pp = ov.querySelector("[data-mp=play]");
          if (pp) pp.innerHTML = '<i class="fas ' + (playing ? "fa-pause" : "fa-play") + '"></i>';
        }
      }
      var sh = ov.querySelector("[data-mp=shuffle]");
      if (sh) sh.classList.toggle("on", shuffleOn());
    } catch (e) {}
  }

  function stopSync() {
    if (syncIv) { clearInterval(syncIv); syncIv = null; }
  }

  function open() {
    if (document.getElementById(OV)) return;
    css();
    lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null };
    var ov = document.createElement("div");
    ov.className = "mplayer-ov";
    ov.id = OV;
    ov.innerHTML =
      '<div class="mplayer-grab" aria-hidden="true"></div>' +
      '<div class="mplayer-top"><span>Now Playing</span><button type="button" class="mplayer-x" data-mp-x aria-label="Close">×</button></div>' +
      '<img decoding="async" class="mplayer-cover" data-mp="cover" src="' + esc(coverSrc()) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
      '<div class="mplayer-title" data-mp="title">' + esc(txt("mini-title") || "Nothing playing") + "</div>" +
      '<div class="mplayer-artist" data-mp="artist">' + esc(txt("mini-artist") || "Juice WRLD") + "</div>" +
      '<div class="mplayer-prog" data-mp="prog" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="mplayer-fill" data-mp="fill"></div><div class="mplayer-thumb" data-mp="thumb"></div></div>' +
      '<div class="mplayer-times"><span data-mp="cur">0:00</span><span data-mp="dur">0:00</span></div>' +
      '<div class="mplayer-ctrl">' +
      '<button type="button" class="mplayer-btn" data-mp="shuffle" title="Shuffle" aria-label="Shuffle"><i class="fas fa-shuffle"></i></button>' +
      '<button type="button" class="mplayer-btn" data-mp="prev" title="Previous" aria-label="Previous track"><i class="fas fa-backward-step"></i></button>' +
      '<button type="button" class="mplayer-play" data-mp="play" title="Play/Pause" aria-label="Play or pause"><i class="fas fa-play"></i></button>' +
      '<button type="button" class="mplayer-btn" data-mp="next" title="Next" aria-label="Next track"><i class="fas fa-forward-step"></i></button>' +
      '<button type="button" class="mplayer-btn" data-mp="queue" title="Queue" aria-label="Queue"><i class="fas fa-list-ul"></i></button></div>' +
      '<p class="mplayer-hint">Drag the bar to seek. Swipe down to close.</p>';
    ov.addEventListener("click", function (e) {
      var x = e.target.closest ? e.target.closest("[data-mp-x]") : null;
      if (x || e.target === ov) { close(); return; }
      /* seeking is handled by pointer events in bindScrubbing - doing it here
         too would make a drag end jump to wherever the finger lifted */
      var b = e.target.closest ? e.target.closest("[data-mp]") : null;
      if (!b) return;
      var a = b.getAttribute("data-mp");
      try {
        if (a === "play") {
          var mp = document.getElementById("mini-play");
          if (mp) mp.click();
        } else if (a === "prev") {
          var pb = document.getElementById("prev-btn");
          if (pb) pb.click();
        } else if (a === "next") {
          if (typeof nextTrack === "function") nextTrack();
          else { var nb = document.getElementById("next-btn"); if (nb) nb.click(); }
        } else if (a === "shuffle") {
          if (typeof setShuffle === "function") setShuffle(!shuffleOn());
        } else if (a === "queue") {
          if (typeof toggleQueuePanel === "function") toggleQueuePanel();
        }
      } catch (err) {}
      setTimeout(sync, 120);
    });
    bindScrubbing(ov);
    bindSwipeDown(ov);
    document.body.appendChild(ov);
    stopSync();
    syncIv = setInterval(sync, 1000);
    sync();
    try {
      var au = audioEl();
      if (au) {
        au.addEventListener("timeupdate", sync);
        au.addEventListener("play", sync);
        au.addEventListener("pause", sync);
      }
    } catch (e) {}
  }

  function close() {
    stopSync();
    var ov = document.getElementById(OV);
    if (ov) ov.remove();
  }

  window.openMobilePlayer = open;
  window.closeMobilePlayer = close;

  function boot() {
    /* The mini player used to open this full-screen sheet on any click of its
       own body. It already navigates to the WRLD Player itself (script.js binds
       that handler), so the click was doing two things at once: moving you to
       the player and dropping a modal over it. Escape and the close button
       still work, and openMobilePlayer() is still exported, so anything that
       wants the sheet deliberately can still ask for it. */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById(OV)) close();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
