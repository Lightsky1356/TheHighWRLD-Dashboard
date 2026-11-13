/* Mobile player — the full-screen sheet
 *
 * The Spotify-style sheet that opens from the WRLD Deck on a phone (or any
 * pointer:coarse full-width layout). It carries the same track the rest of
 * the page carries, so there is no second engine and no second audio
 * element: every action delegates to the real controls (deck-play's click
 * handler, nextTrack/prevBtn, setShuffle/setRepeat, addToQueue).
 *
 * Three views live behind one transport row, switched by the two buttons in
 * the bottom bar — exactly where Spotify puts them:
 *
 *   now       the big cover, title, version pill, category chips and the
 *             heart/queue/share row.
 *   queue     the now-playing card, the Up next list with remove buttons,
 *             and "Open full queue" which closes the sheet and opens the
 *             site's queue panel.
 *   comments  the comment box ("Comment at 0:29") and the song's thread,
 *             posted to the same /api/song-comments the player uses.
 *
 * The background is painted from the cover's accent colour every time the
 * track changes, the way the deck's own background moves with the cover.
 * Swipe down or the chevron-down button closes the sheet.
 */
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

  function currentIndex() {
    try { if (typeof currentTrackIndex === "number") return currentTrackIndex; } catch (e) {}
    return -1;
  }

  function currentTrack() {
    var i = currentIndex();
    try { if (i >= 0 && typeof trackList !== "undefined" && trackList[i]) return trackList[i]; } catch (e) {}
    return null;
  }

  function currentTitle() {
    var t = currentTrack();
    if (t && t.title) return String(t.title);
    try {
      var el = document.getElementById("deck-title");
      var txt = el ? String(el.textContent || "").trim() : "";
      if (txt) return txt;
    } catch (e) {}
    return "Nothing playing";
  }

  function currentArtist() {
    var t = currentTrack();
    if (t && t.artist) return String(t.artist);
    try {
      var el = document.getElementById("deck-artist");
      var txt = el ? String(el.textContent || "").trim() : "";
      if (txt) return txt;
    } catch (e) {}
    return "Juice WRLD";
  }

  function coverOf() {
    var t = currentTrack();
    if (t && t.cover) return String(t.cover);
    try {
      var el = document.getElementById("deck-cover");
      if (el && el.getAttribute("src")) return el.getAttribute("src");
    } catch (e) {}
    return "Juice-WRLD.png";
  }

  function coverThumb(cover, tier) {
    try {
      if (window._coverThumb) {
        var t = window._coverThumb(cover, tier || "64");
        if (t) return t;
      }
    } catch (e) {}
    return cover;
  }

  function playing() {
    var au = audioEl();
    try {
      if (typeof isPlaying !== "undefined") return !!isPlaying;
    } catch (e) {}
    return !!(au && !au.paused);
  }

  function shuffleOn() {
    try {
      if (typeof shuffleMode !== "undefined") return shuffleMode === 1;
    } catch (e) {}
    try {
      var b = document.getElementById("shuffle-btn");
      return !!(b && b.classList.contains("shuffle-active"));
    } catch (e) { return false; }
  }

  function repeatOn() {
    try {
      if (typeof repeatMode !== "undefined") return repeatMode !== 0;
    } catch (e) {}
    return false;
  }

  function isFav() {
    var i = currentIndex();
    try {
      if (i >= 0 && typeof isFavorite === "function") return !!isFavorite(i);
    } catch (e) {}
    return false;
  }

  function toggleFav() {
    var i = currentIndex();
    try {
      if (i >= 0 && typeof toggleFavorite === "function") toggleFavorite(i);
    } catch (e) {}
    sync(true);
  }

  function addQueue() {
    var i = currentIndex();
    try {
      if (i >= 0 && typeof addToQueue === "function") {
        addToQueue(i);
        toast("Added to the queue", "success");
        return;
      }
    } catch (e) {}
    toast("The queue is not ready yet", "error");
  }

  function toast(text, kind) {
    try { if (typeof showToast === "function") { showToast(text, kind || "info", 2200); return; } } catch (e) {}
    try { if (window.showToastSimple) { window.showToastSimple(text, kind || "info", 2200); } } catch (e) {}
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function songPageSlugOf(title) {
    try {
      if (window.songPageSlug) return window.songPageSlug(title);
    } catch (e) {}
    return String(title == null ? "" : title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* The versions of this song - for the pill under the title. */
  function versionCount(t) {
    try {
      if (typeof trackList === "undefined" || !trackList) return 1;
      var base = String(t && t.title || "").split("(")[0].trim().toLowerCase();
      if (!base) return 1;
      var n = 0;
      for (var i = 0; i < trackList.length; i++) {
        if (String((trackList[i] || {}).title || "").split("(")[0].trim().toLowerCase() === base) n++;
      }
      return Math.max(1, n);
    } catch (e) { return 1; }
  }

  function signedIn() {
    try { if (typeof window.__thwAuthSignedIn === "boolean") return window.__thwAuthSignedIn; } catch (e) {}
    var wrap = document.getElementById("nav-account-wrap") || document.getElementById("mbn-account-wrap");
    if (wrap && wrap.style.display !== "none") return true;
    var avatar = document.getElementById("navAvatarInner") || document.getElementById("mbnAvatarInner");
    return !!(avatar && avatar.querySelector && avatar.querySelector("img"));
  }

  function myAvatarHTML() {
    try {
      var holder = document.getElementById("navAvatarInner") || document.getElementById("mbnAvatarInner");
      var img = holder && holder.querySelector ? holder.querySelector("img") : null;
      if (img && img.src) return '<img decoding="async" src="' + esc(img.src) + '" alt="">';
    } catch (e) {}
    return '<i class="fas fa-user" aria-hidden="true"></i>';
  }

  /* ------------------------------------------------------------------ */
  /* the stylesheet                                                      */
  /* ------------------------------------------------------------------ */
  function css() {
    if (document.getElementById("mplayer-style")) return;
    var st = document.createElement("style");
    st.id = "mplayer-style";
    st.textContent =
      ".mp2{position:fixed;inset:0;z-index:10002;display:flex;flex-direction:column;overflow:hidden;color:#fff;font-family:inherit;background:#0d0a08;-webkit-tap-highlight-color:transparent}" +
      ".mp2[hidden]{display:none}" +
      ".mp2-bg{position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,#1a1512 0%,#110d0b 58%,#0c0908 100%);transition:background .6s ease}" +
      ".mp2-vignette{position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,rgba(9,6,5,.42) 0%,rgba(9,6,5,0) 16%,rgba(9,6,5,.12) 55%,rgba(9,6,5,.68) 100%);pointer-events:none}" +

      /* the grab bar - only a thumb can see it */
      ".mp2-grab{position:relative;z-index:2;display:none;width:44px;height:5px;border-radius:99px;background:rgba(255,255,255,.24);margin:max(10px,env(safe-area-inset-top)) auto -4px}" +
      "@media (pointer:coarse){.mp2-grab{display:block}}" +

      /* top bar */
      ".mp2-top{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 18px 6px;min-height:52px}" +
      ".mp2-x,.mp2-more{background:none;border:none;color:rgba(255,255,255,.72);width:44px;height:44px;min-width:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px}" +
      ".mp2-x:active,.mp2-more:active{background:rgba(255,255,255,.09)}" +
      ".mp2-context{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.55);font-weight:700}" +

      /* the three views */
      ".mp2-body{position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;padding:0 22px;overflow:hidden}" +
      ".mp2-view{display:none;flex:1;min-height:0;width:100%;flex-direction:column;align-items:center;overflow-y:auto;overscroll-behavior:contain}" +
      ".mp2-view.is-active{display:flex}" +

      /* now */
      ".mp2-cover{width:min(100%,340px);aspect-ratio:1/1;object-fit:cover;border-radius:16px;background:#1c1530;box-shadow:0 26px 60px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.08) inset;margin-top:6px}" +
      ".mp2-title{margin:16px 0 0;font-size:clamp(20px,5.6vw,24px);line-height:1.16;font-weight:800;letter-spacing:-.01em;text-align:center;max-width:100%}" +
      ".mp2-artist{margin:5px 0 0;font-size:15px;color:rgba(255,255,255,.6);text-align:center}" +
      ".mp2-pill{margin-top:14px;display:inline-flex;align-items:center;gap:9px;max-width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 15px;font-size:12px;font-weight:600;color:rgba(255,255,255,.85);cursor:pointer}" +
      ".mp2-pill i{font-size:10px;opacity:.75}" +
      ".mp2-pill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}" +
      ".mp2-chiprow{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:center}" +
      ".mp2-chip{font-size:10.5px;font-weight:700;letter-spacing:.02em;border-radius:8px;padding:4px 10px}" +
      ".chip-cat-leaks{background:rgba(251,191,36,.13);color:#fcd34d;border:1px solid rgba(251,191,36,.28)}" +
      ".chip-cat-sessions{background:rgba(34,211,238,.12);color:#67e8f9;border:1px solid rgba(34,211,238,.25)}" +
      ".chip-cat-halloween{background:rgba(192,132,252,.13);color:#d8b4fe;border:1px solid rgba(192,132,252,.3)}" +
      ".chip-year{background:rgba(255,255,255,.08);color:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.08)}" +

      /* the action row: heart + add to queue on the left, share on the right */
      ".mp2-actions{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:auto;padding:4px 2px 6px}" +
      ".mp2-actions-left{display:flex;align-items:center;gap:14px}" +
      ".mp2-act{background:none;border:none;color:rgba(255,255,255,.78);width:44px;height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer}" +
      ".mp2-act:active{transform:scale(.88)}" +
      ".mp2-act.is-on{color:#fb7185}" +

      /* queue */
      ".mp2-nowcard{display:flex;align-items:center;gap:12px;width:100%;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:10px 12px;margin-top:8px}" +
      ".mp2-card-cover{width:54px;height:54px;border-radius:10px;object-fit:cover;background:#1c1530}" +
      ".mp2-card-meta{flex:1;min-width:0}" +
      ".mp2-card-title{font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-card-artist{font-size:12px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-eq{display:flex;align-items:flex-end;gap:2.5px;height:18px;margin-right:4px}" +
      ".mp2-eq span{width:3px;border-radius:2px;background:#c084fc;height:35%;transform-origin:bottom}" +
      ".mp2-nowcard.is-playing .mp2-eq span{animation:mp2eq .9s ease-in-out infinite}" +
      ".mp2-eq span:nth-child(2){animation-delay:.22s}" +
      ".mp2-eq span:nth-child(3){animation-delay:.1s}" +
      ".mp2-eq span:nth-child(4){animation-delay:.34s}" +
      "@keyframes mp2eq{0%,100%{height:22%}50%{height:100%}}" +
      ".mp2-card-fav{background:none;border:none;color:rgba(255,255,255,.78);width:44px;height:44px;min-width:44px;font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-card-fav.is-on{color:#fb7185}" +
      ".mp2-section{align-self:flex-start;margin:16px 2px 8px;font-size:16px;font-weight:800;letter-spacing:.01em}" +
      ".mp2-queuelist{width:100%;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 1px}" +
      ".mp2-qrow{display:flex;align-items:center;gap:11px;padding:7px 4px;border-radius:12px}" +
      ".mp2-qrow:active{background:rgba(255,255,255,.06)}" +
      ".mp2-qrow-cover{width:46px;height:46px;border-radius:9px;object-fit:cover;background:#1c1530}" +
      ".mp2-qrow-meta{flex:1;min-width:0}" +
      ".mp2-qrow-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-qrow-sub{font-size:10.5px;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-qrow-remove{background:none;border:none;color:rgba(255,255,255,.5);width:38px;height:44px;min-width:38px;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-qrow-remove:active{color:#fff}" +
      ".mp2-qempty{text-align:center;color:rgba(255,255,255,.4);font-size:12.5px;padding:26px 10px}" +
      ".mp2-openqueue{margin:10px 0 6px;width:100%;border-radius:13px;padding:13px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.11);color:#fff;font-size:13.5px;font-weight:700;cursor:pointer}" +
      ".mp2-openqueue:active{background:rgba(255,255,255,.14)}" +

      /* comments */
      ".mp2-compose{display:flex;align-items:center;gap:10px;width:100%;margin-top:10px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:5px 6px 5px 6px}" +
      ".mp2-compose-avatar{width:34px;height:34px;min-width:34px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:13px}" +
      ".mp2-compose-avatar img{width:100%;height:100%;object-fit:cover}" +
      ".mp2-compose-input{flex:1;min-width:0;background:transparent;border:none;outline:none;color:#fff;font-size:13.5px;font-family:inherit}" +
      ".mp2-compose-input::placeholder{color:rgba(255,255,255,.42)}" +
      ".mp2-compose-send{background:none;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.8);width:34px;height:34px;min-width:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px}" +
      ".mp2-compose-send:disabled{opacity:.35;cursor:default}" +
      ".mp2-comments-note{align-self:flex-start;margin:8px 2px 0;font-size:10.5px;color:rgba(255,255,255,.45);min-height:13px}" +
      ".mp2-comments{width:100%;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;margin-top:6px;padding:0 1px}" +
      ".mp2-comments .song-comments-empty{text-align:center;color:rgba(255,255,255,.42);font-size:13px;padding:30px 10px}" +
      ".mp2-mini{display:flex;align-items:center;gap:10px;width:100%;padding:8px 2px 6px;border-top:1px solid rgba(255,255,255,.08);margin-top:6px}" +
      ".mp2-mini-cover{width:48px;height:48px;border-radius:9px;object-fit:cover;background:#1c1530}" +
      ".mp2-mini-meta{flex:1;min-width:0}" +
      ".mp2-mini-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-mini-artist{font-size:11.5px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-mini-fav{background:none;border:none;color:rgba(255,255,255,.78);width:44px;height:44px;min-width:44px;font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-mini-fav.is-on{color:#fb7185}" +

      /* progress */
      ".mp2-scrub{position:relative;z-index:1;height:32px;margin:4px 22px 0;cursor:pointer;touch-action:none;display:flex;align-items:center}" +
      ".mp2-scrub-line{position:absolute;left:0;right:0;top:50%;height:4px;transform:translateY(-50%);border-radius:99px;background:rgba(255,255,255,.18)}" +
      ".mp2-fill{position:absolute;left:0;top:50%;height:4px;transform:translateY(-50%);border-radius:99px;background:linear-gradient(90deg,#c084fc,#e879f9);width:0%}" +
      ".mp2-knob{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);left:0%}" +
      ".mp2-scrub:focus-visible{outline:2px solid #e879f9;outline-offset:3px;border-radius:8px}" +
      ".mp2-times{position:relative;z-index:1;display:flex;justify-content:space-between;padding:0 22px;font-size:10px;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums}" +

      /* transport */
      ".mp2-transport{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 0 2px}" +
      ".mp2-tbtn{background:none;border:none;color:rgba(255,255,255,.65);width:48px;height:48px;min-width:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px}" +
      ".mp2-tbtn:active{background:rgba(255,255,255,.08)}" +
      ".mp2-tbtn.on{color:#e879f9}" +
      ".mp2-play{width:64px;height:64px;min-width:64px;border-radius:50%;background:#fff;color:#120c07;font-size:21px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-play:active{transform:scale(.94)}" +

      /* bottom bar */
      ".mp2-bottom{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:6px 28px max(10px,env(safe-area-inset-bottom))}" +
      ".mp2-vbtn{position:relative;background:none;border:none;color:rgba(255,255,255,.6);width:48px;height:46px;min-width:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px}" +
      ".mp2-vbtn.on{color:#e879f9;background:rgba(232,121,249,.14)}" +
      ".mp2-vbtn.on::after{content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#e879f9}" +

      /* the "more" sheet */
      ".mp2-sheet-scrim{position:absolute;inset:0;z-index:4;background:rgba(0,0,0,.45)}" +
      ".mp2-sheet{position:absolute;left:14px;right:14px;bottom:96px;z-index:5;background:rgba(30,24,20,.97);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:8px;box-shadow:0 18px 50px rgba(0,0,0,.5)}" +
      ".mp2-sheet button{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:none;border:none;color:rgba(255,255,255,.88);font-size:13.5px;font-weight:600;padding:12px 12px;border-radius:12px;cursor:pointer;font-family:inherit}" +
      ".mp2-sheet button:active{background:rgba(255,255,255,.08)}" +
      ".mp2-sheet button i{width:20px;color:rgba(255,255,255,.55);font-size:15px}" +
      ".mp2-sheet[hidden],.mp2-sheet-scrim[hidden]{display:none}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* helpers that touch the DOM                                         */
  /* ------------------------------------------------------------------ */
  function q(ov, sel) { return ov.querySelector(sel); }
  function qa(ov, sel) { return Array.prototype.slice.call(ov.querySelectorAll(sel)); }

  function toAlpha(color, a) {
    var c = String(color || "").trim();
    var m = c.match(/^hsl\(([^)]+)\)$/i);
    if (m) return "hsla(" + m[1] + "," + a + ")";
    m = c.match(/^rgb\(([^)]+)\)$/i);
    if (m) return "rgba(" + m[1] + "," + a + ")";
    return c;
  }

  /* Paint the background from the cover's accent, the same way the deck's own
     background moves with the cover. */
  var lastBgCover = null;
  function paintBackground(ov) {
    var cover = coverOf();
    if (cover === lastBgCover) return;
    lastBgCover = cover;
    var gradient = null;
    try {
      if (typeof getCoverGradientValue === "function") gradient = getCoverGradientValue(cover);
    } catch (e) {}
    var cols = gradient ? (gradient.match(/hsl\([^)]+\)|rgb\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || []) : [];
    var c1 = cols[0] || "hsl(266,60%,58%)";
    var c2 = cols[1] || "hsl(20,72%,30%)";
    var bg = ov.querySelector(".mp2-bg");
    if (!bg) return;
    bg.style.background =
      "radial-gradient(130% 62% at 50% -12%, " + toAlpha(c1, 0.78) + " 0%, transparent 62%)," +
      "radial-gradient(105% 55% at 88% 26%, " + toAlpha(c2, 0.42) + " 0%, transparent 55%)," +
      "radial-gradient(85% 55% at 6% 52%, " + toAlpha(c2, 0.3) + " 0%, transparent 58%)," +
      "linear-gradient(180deg,#1a1512 0%,#110d0b 58%,#0c0908 100%)";
  }

  /* ---- the comments thread ---- */
  function loadComments(ov) {
    var box = q(ov, "[data-mp='comments']");
    var title = currentTitle();
    if (!box) return;
    if (!title || title === "Nothing playing") {
      box.innerHTML = '<p class="song-comments-empty">Play a song to see its comments.</p>';
      return;
    }
    if (window.SongComments && typeof window.SongComments.renderThreadInto === "function") {
      window.SongComments.renderThreadInto(box, title);
    } else {
      box.innerHTML = '<p class="song-comments-empty">The comments could not be loaded.</p>';
    }
  }

  function postComment(ov) {
    var input = q(ov, "[data-mp='comment-input']");
    var note = q(ov, "[data-mp='comments-note']");
    var title = currentTitle();
    if (!input) return;
    var text = String(input.value || "").trim();
    if (!text) { if (note) note.textContent = "Write something first."; return; }
    if (title === "Nothing playing") { if (note) note.textContent = "Play a song first."; return; }
    if (!signedIn()) { if (note) note.textContent = "Sign in to comment."; return; }

    var au = audioEl();
    var at = au && isFinite(au.currentTime) ? Math.max(0, Math.round(au.currentTime)) : 0;
    if (note) note.textContent = "";

    fetch("/api/song-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ track: title, body: text, parentId: 0, atSeconds: at, atLabel: fmt(at) }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || data.error || "The comment could not be saved");
        return data;
      });
    }).then(function () {
      input.value = "";
      if (note) note.textContent = "";
      loadComments(ov);
    }).catch(function (err) {
      if (note) note.textContent = err && err.message ? err.message : "The comment could not be saved.";
    });
  }

  var lastPlaceholder = "", lastNote = "", lastAvatar = "";
  function paintComposeState(ov) {
    var can = signedIn();
    var input = q(ov, "[data-mp='comment-input']");
    var send = q(ov, "[data-mp='comment-send']");
    var note = q(ov, "[data-mp='comments-note']");
    var au = audioEl();
    var at = au && isFinite(au.currentTime) ? Math.round(au.currentTime) : 0;
    if (input) {
      input.disabled = !can;
      var ph = can ? "Comment at " + fmt(at) : "Sign in to comment";
      if (ph !== lastPlaceholder) { lastPlaceholder = ph; input.placeholder = ph; }
    }
    if (send) send.disabled = !can;
    if (note) {
      var msg = can ? "" : "Sign in to comment on this song.";
      if (msg !== lastNote) { lastNote = msg; if (!can || note.textContent) note.textContent = msg; }
    }
    var avatar = q(ov, "[data-mp='avatar']");
    if (avatar) {
      var html = myAvatarHTML();
      if (html !== lastAvatar) { lastAvatar = html; avatar.innerHTML = html; }
    }
  }

  /* ---- the queue view ---- */
  var lastQueueSig = "";
  function paintQueue(ov, force) {
    var list = q(ov, "[data-mp='queue-list']");
    if (!list) return;

    var queue = [];
    try { if (typeof trackQueue !== "undefined" && trackQueue) queue = trackQueue.slice(); } catch (e) {}

    var sig = currentIndex() + "|" + queue.join(",");
    if (!force && sig === lastQueueSig) {
      /* only the heart can move; leave the rows alone */
      return;
    }
    lastQueueSig = sig;

    list.textContent = "";
    if (!queue.length) {
      var empty = document.createElement("p");
      empty.className = "mp2-qempty";
      empty.textContent = "Nothing is lined up after this song.";
      list.appendChild(empty);
      return;
    }

    for (var i = 0; i < queue.length; i++) {
      (function (qi, idx) {
        var t = null;
        try { t = (typeof trackList !== "undefined" && trackList) ? trackList[idx] : null; } catch (e) {}
        var row = document.createElement("div");
        row.className = "mp2-qrow";
        var cover = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
        var cat = t && t.category ? String(t.category) : "";
        var catLabel = cat === "leaks" ? "Leaks" : cat === "sessions" ? "Sessions" : cat === "halloween" ? "Halloween" : "";
        row.innerHTML =
          '<img decoding="async" class="mp2-qrow-cover" loading="lazy" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'" src="' + esc(coverThumb(cover, "64")) + '">' +
          '<div class="mp2-qrow-meta"><p class="mp2-qrow-title">' + esc((t && t.title) || "Track " + (idx + 1)) + '</p>' +
          '<p class="mp2-qrow-sub">' + esc(((t && t.artist) || "Juice WRLD") + (catLabel ? " · " + catLabel : "")) + '</p></div>' +
          '<button type="button" class="mp2-qrow-remove" data-mp="remove-' + qi + '" aria-label="Remove from the queue"><i class="fas fa-xmark"></i></button>';
        row.querySelector(".mp2-qrow-remove").addEventListener("click", function () {
          try {
            if (typeof removeFromQueue === "function") removeFromQueue(qi);
            else queue.splice(qi, 1);
          } catch (e) {}
          lastQueueSig = "";
          paintQueue(ov);
          toast("Removed from the queue", "info");
        });
        list.appendChild(row);
      })(i, queue[i]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* views                                                              */
  /* ------------------------------------------------------------------ */
  var currentView = "now";

  function switchView(ov, name) {
    currentView = name;
    qa(ov, ".mp2-view").forEach(function (v) {
      v.classList.toggle("is-active", v.getAttribute("data-view") === name);
    });
    qa(ov, ".mp2-vbtn").forEach(function (b) {
      var target = b.getAttribute("data-mp") === "view-comments" ? "comments" : "queue";
      var on = target === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (name === "comments") { paintComposeState(ov); loadComments(ov); }
    if (name === "queue") paintQueue(ov, true);
  }

  function toggleView(ov, name) {
    switchView(ov, currentView === name ? "now" : name);
  }

  /* ------------------------------------------------------------------ */
  /* sync                                                               */
  /* ------------------------------------------------------------------ */
  var lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null, title: null, artist: null, cover: null, fav: null };

  function sync(force) {
    var ov = document.getElementById(OV);
    if (!ov) { stopSync(); return; }

    var t = currentTitle(), a = currentArtist(), cover = coverOf();

    paintBackground(ov);

    /* the now view + both mini rows */
    qa(ov, "[data-mp='title'],[data-mp='title2'],[data-mp='title3']").forEach(function (el) {
      if (el.textContent !== t) el.textContent = t;
    });
    qa(ov, "[data-mp='artist'],[data-mp='artist2'],[data-mp='artist3']").forEach(function (el) {
      if (el.textContent !== a) el.textContent = a;
    });
    qa(ov, "[data-mp='cover'],[data-mp='card-cover'],[data-mp='mini-cover']").forEach(function (img) {
      if (img.getAttribute("src") !== cover) img.setAttribute("src", cover);
    });

    /* the version pill */
    var pill = q(ov, "[data-mp='pill']");
    var track = currentTrack();
    var tag = track && track.tag ? String(track.tag) : "";
    if (pill) {
      if (!tag) { pill.style.display = "none"; }
      else {
        pill.style.display = "";
        var span = pill.querySelector("[data-mp='tag']");
        var versions = versionCount(track);
        var text = tag.length > 40 ? tag.slice(0, 40) + "…" : tag;
        var label = text + (versions > 1 ? " · " + versions + " versions" : "");
        if (span && span.textContent !== label) span.textContent = label;
      }
    }

    /* chips: the category and the year */
    var chipCat = q(ov, "[data-mp='chip-cat']");
    if (chipCat && track) {
      var cat = String(track.category || "");
      var map = { leaks: ["Leaked", "chip-cat-leaks"], sessions: ["Sessions", "chip-cat-sessions"], halloween: ["Halloween", "chip-cat-halloween"] };
      var m = map[cat];
      var label = m ? m[0] : "";
      chipCat.textContent = label;
      chipCat.className = "mp2-chip" + (m ? " " + m[1] : " chip-year");
      chipCat.style.display = label ? "" : "none";
    } else if (chipCat) chipCat.style.display = "none";

    var chipYear = q(ov, "[data-mp='chip-year']");
    if (chipYear && track && track.year) {
      chipYear.textContent = String(track.year);
      chipYear.style.display = "";
    } else if (chipYear) chipYear.style.display = "none";

    /* hearts */
    var fav = isFav();
    qa(ov, "[data-mp='fav'],[data-mp='fav2'],[data-mp='fav3']").forEach(function (el) {
      el.classList.toggle("is-on", fav);
      var icon = el.querySelector("i");
      if (icon) icon.className = (fav ? "fas" : "far") + " fa-heart";
      el.setAttribute("aria-pressed", fav ? "true" : "false");
    });

    /* progress */
    var au = audioEl();
    var cur = au ? au.currentTime : 0;
    var dur = au ? (au.duration || 0) : 0;
    if (!isFinite(dur) || dur <= 0) dur = 0;
    var pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    var rounded = Math.round(pct * 10) / 10;
    if (force || lastSync.pct !== rounded) {
      lastSync.pct = rounded;
      var fill = q(ov, "[data-mp='fill']");
      if (fill) fill.style.width = rounded + "%";
      var knob = q(ov, "[data-mp='thumb']");
      if (knob) knob.style.left = rounded + "%";
      var prog = q(ov, "[data-mp='prog']");
      if (prog) prog.setAttribute("aria-valuenow", String(Math.round(rounded)));
    }
    var curTxt = fmt(cur), durTxt = fmt(dur);
    var ce = q(ov, "[data-mp='cur']"), de = q(ov, "[data-mp='dur']");
    if (ce && ce.textContent !== curTxt) ce.textContent = curTxt;
    if (de && de.textContent !== durTxt) de.textContent = durTxt;
    var progText = curTxt + " of " + durTxt;
    var prog = q(ov, "[data-mp='prog']");
    if (prog && prog.getAttribute("aria-valuetext") !== progText) prog.setAttribute("aria-valuetext", progText);

    /* play/pause + the equalizer bars */
    var isPlaying = playing();
    if (force || lastSync.playing !== isPlaying) {
      lastSync.playing = isPlaying;
      var pp = q(ov, "[data-mp='play']");
      if (pp) pp.innerHTML = '<i class="fas ' + (isPlaying ? "fa-pause" : "fa-play") + '"></i>';
      var card = q(ov, ".mp2-nowcard");
      if (card) card.classList.toggle("is-playing", isPlaying);
    }

    var sh = q(ov, "[data-mp='shuffle']");
    if (sh) {
      var shOn = shuffleOn();
      sh.classList.toggle("on", shOn);
      sh.setAttribute("aria-pressed", shOn ? "true" : "false");
    }
    var rp = q(ov, "[data-mp='repeat']");
    if (rp) {
      var rpOn = repeatOn();
      rp.classList.toggle("on", rpOn);
      rp.setAttribute("aria-pressed", rpOn ? "true" : "false");
    }

    /* the song changed under an open view: refresh it */
    if (force || lastSync.title !== t) {
      lastSync.title = t;
      lastQueueSig = "";
      if (currentView === "comments") { paintComposeState(ov); loadComments(ov); }
      if (currentView === "queue") paintQueue(ov, true);
    }
    if (currentView === "comments") paintComposeState(ov);
  }

  function stopSync() {
    if (syncIv) { clearInterval(syncIv); syncIv = null; }
  }

  /* ------------------------------------------------------------------ */
  /* the scrubbing, the same deal as the old one                        */
  /* ------------------------------------------------------------------ */
  function progRatio(ev, el) {
    var r = el.getBoundingClientRect();
    if (!r.width) return 0;
    var clientX = ev.clientX != null ? ev.clientX
      : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }

  function seekTo(ratio) {
    try {
      var au = audioEl();
      if (!au || !au.duration) return false;
      au.currentTime = Math.max(0, Math.min(au.duration, ratio * au.duration));
      return true;
    } catch (e) { return false; }
  }

  function bindScrubbing(ov) {
    var prog = ov.querySelector("[data-mp='prog']");
    if (!prog) return;
    var au = null;
    try { au = audioEl(); } catch (e) {}

    var dragging = false;
    function move(ev) {
      if (ev.cancelable) ev.preventDefault();
      seekTo(progRatio(ev, prog));
      sync(true);
    }
    prog.addEventListener("pointerdown", function (ev) {
      if (!au || !au.duration) return;
      dragging = true;
      if (prog.setPointerCapture && ev.pointerId != null) {
        try { prog.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      move(ev);
    });
    prog.addEventListener("pointermove", function (ev) { if (dragging) move(ev); });
    function end(ev) {
      if (!dragging) return;
      dragging = false;
      if (ev && prog.releasePointerCapture && ev.pointerId != null) {
        try { prog.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
      sync(true);
    }
    prog.addEventListener("pointerup", end);
    prog.addEventListener("pointercancel", end);

    prog.addEventListener("keydown", function (ev) {
      var au2 = null;
      try { au2 = audioEl(); } catch (e) {}
      if (!au2 || !au2.duration) return;
      var step = ev.shiftKey ? 30 : 5;
      var cur = au2.currentTime;
      if (ev.key === "ArrowRight") seekTo(Math.min(1, (cur + step) / au2.duration));
      else if (ev.key === "ArrowLeft") seekTo(Math.max(0, (cur - step) / au2.duration));
      else if (ev.key === "Home") seekTo(0);
      else if (ev.key === "End") seekTo(0.999);
      else return;
      ev.preventDefault();
      sync(true);
    });
  }

  /* ---- swipe down to dismiss ---- */
  function bindSwipeDown(ov) {
    var startY = null, startT = 0, moved = false;
    ov.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse") return;
      if (ev.target.closest && ev.target.closest(".mp2-compose, .mp2-queuelist, .mp2-comments, input, button, .mp2-scrub")) return;
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

  /* ------------------------------------------------------------------ */
  /* open / close                                                       */
  /* ------------------------------------------------------------------ */
  function open() {
    if (document.getElementById(OV)) return;
    css();
    lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null, title: null, artist: null, cover: null, fav: null };
    lastBgCover = null;
    lastQueueSig = "";
    currentView = "now";

    var ov = document.createElement("div");
    ov.className = "mp2";
    ov.id = OV;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Now playing");

    var t = currentTitle(), a = currentArtist(), cover = coverOf();

    ov.innerHTML =
      '<div class="mp2-bg" aria-hidden="true"></div>' +
      '<div class="mp2-vignette" aria-hidden="true"></div>' +
      '<div class="mp2-grab" aria-hidden="true"></div>' +

      '<header class="mp2-top">' +
        '<button type="button" class="mp2-x" data-mp-close aria-label="Close the player"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
        '<span class="mp2-context">TheHighWRLD</span>' +
        '<button type="button" class="mp2-more" data-mp-more aria-label="More options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
      '</header>' +

      '<div class="mp2-body">' +

        '<section class="mp2-view is-active" data-view="now">' +
          '<img decoding="async" class="mp2-cover" data-mp="cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<h2 class="mp2-title" data-mp="title">' + esc(t) + '</h2>' +
          '<p class="mp2-artist" data-mp="artist">' + esc(a) + '</p>' +
          '<button type="button" class="mp2-pill" data-mp="pill" title="Open the song page"><i class="fas fa-key" aria-hidden="true"></i><span data-mp="tag"></span><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
          '<div class="mp2-chiprow"><span class="mp2-chip chip-year" data-mp="chip-cat"></span><span class="mp2-chip chip-year" data-mp="chip-year"></span></div>' +
          '<div class="mp2-actions">' +
            '<div class="mp2-actions-left">' +
              '<button type="button" class="mp2-act" data-mp="fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
              '<button type="button" class="mp2-act" data-mp="addqueue" aria-label="Add to the queue"><i class="fas fa-plus" aria-hidden="true"></i></button>' +
            '</div>' +
            '<button type="button" class="mp2-act" data-mp="share" aria-label="Share this song"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></button>' +
          '</div>' +
        '</section>' +

        '<section class="mp2-view" data-view="queue">' +
          '<div class="mp2-nowcard">' +
            '<img decoding="async" class="mp2-card-cover" data-mp="card-cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
            '<div class="mp2-card-meta"><p class="mp2-card-title" data-mp="title2">' + esc(t) + '</p><p class="mp2-card-artist" data-mp="artist2">' + esc(a) + '</p></div>' +
            '<div class="mp2-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
            '<button type="button" class="mp2-card-fav" data-mp="fav2" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
          '</div>' +
          '<p class="mp2-section">Up next</p>' +
          '<div class="mp2-queuelist" data-mp="queue-list"></div>' +
          '<button type="button" class="mp2-openqueue" data-mp="openqueue">Open full queue</button>' +
        '</section>' +

        '<section class="mp2-view" data-view="comments">' +
          '<div class="mp2-compose">' +
            '<span class="mp2-compose-avatar" data-mp="avatar"></span>' +
            '<input class="mp2-compose-input" data-mp="comment-input" type="text" maxlength="2000" enterkeyhint="send" placeholder="Comment at 0:00" aria-label="Write a comment">' +
            '<button type="button" class="mp2-compose-send" data-mp="comment-send" aria-label="Send the comment"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
          '</div>' +
          '<p class="mp2-comments-note" data-mp="comments-note"></p>' +
          '<div class="mp2-comments" data-mp="comments"></div>' +
          '<div class="mp2-mini">' +
            '<img decoding="async" class="mp2-mini-cover" data-mp="mini-cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
            '<div class="mp2-mini-meta"><p class="mp2-mini-title" data-mp="title3">' + esc(t) + '</p><p class="mp2-mini-artist" data-mp="artist3">' + esc(a) + '</p></div>' +
            '<button type="button" class="mp2-mini-fav" data-mp="fav3" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
          '</div>' +
        '</section>' +

      '</div>' +

      '<div class="mp2-scrub" data-mp="prog" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00 of 0:00">' +
        '<div class="mp2-scrub-line"></div><div class="mp2-fill" data-mp="fill"></div><div class="mp2-knob" data-mp="thumb"></div>' +
      '</div>' +
      '<div class="mp2-times"><span data-mp="cur">0:00</span><span data-mp="dur">0:00</span></div>' +

      '<div class="mp2-transport">' +
        '<button type="button" class="mp2-tbtn" data-mp="shuffle" aria-label="Shuffle" aria-pressed="false"><i class="fas fa-shuffle" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="prev" aria-label="Previous track"><i class="fas fa-backward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-play" data-mp="play" aria-label="Play or pause"><i class="fas fa-play" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="next" aria-label="Next track"><i class="fas fa-forward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="repeat" aria-label="Repeat" aria-pressed="false"><i class="fas fa-repeat" aria-hidden="true"></i></button>' +
      '</div>' +

      '<nav class="mp2-bottom">' +
        '<button type="button" class="mp2-vbtn" data-mp="view-comments" aria-label="Comments" aria-pressed="false"><i class="fas fa-comment" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-vbtn" data-mp="view-queue" aria-label="Up next" aria-pressed="false"><i class="fas fa-list-ul" aria-hidden="true"></i></button>' +
      '</nav>' +

      '<div class="mp2-sheet-scrim" data-mp-scrim hidden></div>' +
      '<div class="mp2-sheet" data-mp-sheet hidden>' +
        '<button type="button" data-mp="sheet-song"><i class="fas fa-music" aria-hidden="true"></i>Song page</button>' +
        '<button type="button" data-mp="sheet-add"><i class="fas fa-plus" aria-hidden="true"></i>Add to the queue</button>' +
        '<button type="button" data-mp="sheet-bluetooth"><i class="fab fa-bluetooth" aria-hidden="true"></i>Bluetooth speaker</button>' +
        '<button type="button" data-mp="sheet-copy"><i class="fas fa-link" aria-hidden="true"></i>Copy song link</button>' +
      '</div>';

    ov.addEventListener("click", function (e) {
      var target = e.target;
      var closeBtn = target.closest ? target.closest("[data-mp-close]") : null;
      if (closeBtn) { close(); return; }

      var moreBtn = target.closest ? target.closest("[data-mp-more]") : null;
      if (moreBtn) { toggleSheet(ov); return; }

      var scrim = target.closest ? target.closest("[data-mp-scrim]") : null;
      if (scrim) { hideSheet(ov); return; }

      var sheet = target.closest ? target.closest("[data-mp-sheet]") : null;
      var b = target.closest ? target.closest("[data-mp]") : null;
      if (!b) return;
      var action = b.getAttribute("data-mp");

      var liveTitle = currentTitle();
      try {
        if (action === "play") {
          var mp = document.getElementById("deck-play");
          if (mp) mp.click();
        } else if (action === "prev") {
          var pb = document.getElementById("prev-btn");
          if (pb) pb.click();
          else if (document.getElementById("deck-prev")) document.getElementById("deck-prev").click();
        } else if (action === "next") {
          if (typeof nextTrack === "function") nextTrack();
          else { var nb = document.getElementById("next-btn"); if (nb) nb.click(); }
        } else if (action === "shuffle") {
          if (typeof setShuffle === "function") setShuffle(shuffleOn() ? 0 : 1);
        } else if (action === "repeat") {
          if (typeof setRepeat === "function") { try { var m = (typeof repeatMode !== "undefined" ? repeatMode : 0); setRepeat(m + 1); } catch (e) { setRepeat(1); } }
        } else if (action === "fav" || action === "fav2" || action === "fav3") {
          toggleFav();
        } else if (action === "addqueue" || action === "sheet-add") {
          addQueue();
          if (sheet) hideSheet(ov);
        } else if (action === "share") {
          shareSong(liveTitle);
        } else if (action === "sheet-copy") {
          copySongLink(liveTitle);
          hideSheet(ov);
        } else if (action === "sheet-song") {
          hideSheet(ov);
          openSongPage(liveTitle);
        } else if (action === "sheet-bluetooth") {
          hideSheet(ov);
          if (window.__thwBluetoothPick) window.__thwBluetoothPick();
          else toast("Bluetooth is not available in this browser", "error");
        } else if (action === "view-comments") {
          toggleView(ov, "comments");
        } else if (action === "view-queue") {
          toggleView(ov, "queue");
        } else if (action === "openqueue") {
          close();
          if (typeof toggleQueuePanel === "function") toggleQueuePanel();
        } else if (action === "pill") {
          openSongPage(liveTitle);
        } else if (action === "comment-send") {
          postComment(ov);
        }
      } catch (err) {}
      setTimeout(function () { sync(true); }, 120);
    });

    /* the composer sends on Enter */
    var input = ov.querySelector("[data-mp='comment-input']");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); postComment(ov); }
      });
    }

    bindScrubbing(ov);
    bindSwipeDown(ov);

    /* the Bluetooth row hides where the browser can't do it */
    var bt = ov.querySelector("[data-mp='sheet-bluetooth']");
    try {
      if (bt && typeof window.__thwBluetoothSupported === "function" && !window.__thwBluetoothSupported()) bt.style.display = "none";
    } catch (e) {}

    document.body.appendChild(ov);
    stopSync();
    syncIv = setInterval(sync, 1000);
    sync(true);

    try {
      var au = audioEl();
      if (au) {
        au.addEventListener("timeupdate", onAudioTick);
        au.addEventListener("play", onAudioTick);
        au.addEventListener("pause", onAudioTick);
      }
    } catch (e) {}
  }

  function onAudioTick() { sync(false); }

  function close() {
    stopSync();
    try {
      var au = audioEl();
      if (au) {
        au.removeEventListener("timeupdate", onAudioTick);
        au.removeEventListener("play", onAudioTick);
        au.removeEventListener("pause", onAudioTick);
      }
    } catch (e) {}
    var ov = document.getElementById(OV);
    if (ov) ov.remove();
  }

  function toggleSheet(ov) {
    var sheet = ov.querySelector("[data-mp-sheet]");
    var scrim = ov.querySelector("[data-mp-scrim]");
    if (!sheet || !scrim) return;
    var show = sheet.hidden;
    sheet.hidden = !show;
    scrim.hidden = !show;
  }

  function hideSheet(ov) {
    var sheet = ov.querySelector("[data-mp-sheet]");
    var scrim = ov.querySelector("[data-mp-scrim]");
    if (sheet) sheet.hidden = true;
    if (scrim) scrim.hidden = true;
  }

  function openSongPage(title) {
    try {
      if (window.openSongPage) {
        window.openSongPage(title);
        close();
        return;
      }
    } catch (e) {}
    toast("The song page is not ready yet", "error");
  }

  function songLink(title) {
    var origin = "";
    try { origin = window.location.origin; } catch (e) {}
    return origin + "/song/" + songPageSlugOf(title);
  }

  function copySongLink(title) {
    var link = songLink(title);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () {
          toast("Song link copied", "success");
        }, function () { toast("Could not copy the link", "error"); });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Song link copied", "success");
    } catch (e) {
      toast("Could not copy the link", "error");
    }
  }

  function shareSong(title) {
    var link = songLink(title);
    try {
      if (navigator.share) {
        navigator.share({ title: title, url: link }).catch(function () {});
        return;
      }
    } catch (e) {}
    copySongLink(title);
  }

  window.openMobilePlayer = open;
  window.closeMobilePlayer = close;

  function boot() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (document.getElementById(OV)) close();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
