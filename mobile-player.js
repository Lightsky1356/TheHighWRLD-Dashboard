/* Mobile player — the full-screen sheet
 *
 * The phone's Now Playing, full-screen. It carries the same track the rest of
 * the page carries, so there is no second engine and no second audio element:
 * every action delegates to the real controls (deck-play's click handler,
 * nextTrack/prevBtn, setShuffle/setRepeat, addToQueue, clearQueue).
 *
 * Bottom bar: two buttons.
 *   left  – the comment box ("Comment at 0:29") posts to the same thread the
 *           player and the song pages draw, and shows it below. At the current
 *           moment of the song, always.
 *   right – the queue, as its own full-screen page (drag handle, header
 *           shuffle/repeat/close, "Now playing" card, "Up next N / Clear",
 *           "Played earlier / Clear"). It is NOT the desktop queue; the
 *           desktop keeps its panel and dropdown exactly as they were. The
 *           code for the phone's queue lives here and nowhere else.
 *
 * The "..." button opens the context menu (Like / Add to playlist / Change
 * cover / Share / Go to song / Other versions / Go to era / Edit this song /
 * Credits / Open queue / Playback settings / Show comments / Close player),
 * the same sheet as on every song in the queue list.
 *
 * The background is painted from the cover's accent every time the track
 * changes, the way the deck's own background moves with the cover.
 * Swipe down or the chevron-down button closes the sheet.
 *
 * Nothing about this file is shared with the desktop. Desktop keeps the
 * player page, the deck, and the queue panel; the phone gets this sheet.
 */
(function () {
  "use strict";
  if (window.__mplayerMounted) return;
  window.__mplayerMounted = true;

  var OV = "mplayer-ov";
  var syncIv = null;
  var queueOpen = false;

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

  /* The track the menu is about (when the menu was opened from a queue row).
     null means the song that is playing. */
  var menuTrack = null;
  function ctxTarget() { return menuTrack || currentTrack(); }
  var commentsTarget = null; /* set by the menu's "Show comments"; null = the song that is playing */
  function commentTrack() { return commentsTarget || currentTrack(); }
  function commentTitle() {
    var t = commentTrack();
    if (t && t.title) return String(t.title);
    return currentTitle();
  }

  function trackIndexOf(t) {
    if (!t) return -1;
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      for (var i = 0; i < trackList.length; i++) if (trackList[i] === t) return i;
      return trackList.indexOf(t);
    } catch (e) { return -1; }
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

  function cloneTitleOf(t) { return t && t.title ? String(t.title) : "Nothing playing"; }
  function cloneArtistOf(t) { return t && t.artist ? String(t.artist) : "Juice WRLD"; }

  /* ---- per-device cover overrides ("Change cover – only you see it") ---- */
  var coverCache = {};
  function coverSlug(title) {
    return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function customCoverFor(title) {
    var key = coverSlug(title);
    if (key in coverCache) return coverCache[key];
    var found = null;
    try { found = localStorage.getItem("thw-cover-" + key) || null; } catch (e) {}
    coverCache[key] = found;
    return found;
  }
  function setCustomCover(title, dataUrl) {
    var key = coverSlug(title);
    coverCache[key] = dataUrl;
    try { localStorage.setItem("thw-cover-" + key, dataUrl); } catch (e) {}
  }

  function originalCoverOf() {
    var t = currentTrack();
    if (t && t.cover) return String(t.cover);
    try {
      var el = document.getElementById("deck-cover");
      if (el && el.getAttribute("src")) return el.getAttribute("src");
    } catch (e) {}
    return "Juice-WRLD.png";
  }

  function coverOf() { return customCoverFor(currentTitle()) || originalCoverOf(); }
  function coverOfTrack(t) {
    if (t && t.cover) return customCoverFor(t.title) || String(t.cover);
    return coverOf();
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

  function favOn(t) {
    var i = t ? trackIndexOf(t) : currentIndex();
    if (i < 0) return false;
    try {
      if (typeof isFavorite === "function") return !!isFavorite(i);
    } catch (e) {}
    return false;
  }

  function toggleFav(t) {
    var i = t ? trackIndexOf(t) : currentIndex();
    try {
      if (i >= 0 && typeof toggleFavorite === "function") toggleFavorite(i);
    } catch (e) {}
    syncPauseSafe();
  }

  function syncPauseSafe() {
    /* paint the hearts only - cheap enough to call after a fav toggle */
    var ov = document.getElementById(OV);
    if (!ov) return;
    sync(true);
  }

  function toast(text, kind) {
    try { if (typeof showToast === "function") { showToast(text, kind || "info", 2400); return; } } catch (e) {}
    try { if (window.showToastSimple) window.showToastSimple(text, kind || "info", 2400); } catch (e) {}
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

  /* The era code, from the tag's parentheses, e.g. "(GB&GR)" → "GB&GR". */
  var ERA_FULL = {
    "GB&GR": "Goodbye & Good Riddance",
    "WOD": "WRLD ON DRUGS",
    "DRFL": "Death Race For Love",
    "JW3": "Legends Never Die",
    "POST": "Posthumous",
    "OUT": "Outsiders",
    "AF": "Afflictions",
    "ND": "Nothing's Different",
    "BDM": "BINGEDRINKINGMUSIC",
    "SOUNDCLOUD": "SoundCloud",
  };
  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;

  function eraCodeOf(t) {
    try {
      var m = String((t || {}).tag || "").match(ERA_RE);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }
  function eraNameOf(t) { return ERA_FULL[eraCodeOf(t)] || "Other"; }

  function catLabel(t) {
    var c = String((t || {}).category || "");
    return c === "leaks" ? "Leaks" : c === "sessions" ? "Sessions" : c === "halloween" ? "Halloween" : "";
  }

  function versionCount(t) {
    try {
      if (typeof trackList === "undefined" || !trackList) return 1;
      var base = String((t && t.title) || "").split("(")[0].trim().toLowerCase();
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

      /* the two views */
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

      /* the equalizer bars (queue page + now-playing card) */
      ".mp2-eq{display:flex;align-items:flex-end;gap:2.5px;height:17px}" +
      ".mp2-eq span{width:3px;border-radius:2px;background:#c084fc;height:35%;transform-origin:bottom}" +
      ".mp2-eq.is-playing span{animation:mp2eq .9s ease-in-out infinite}" +
      ".mp2-eq span:nth-child(2){animation-delay:.22s}" +
      ".mp2-eq span:nth-child(3){animation-delay:.1s}" +
      ".mp2-eq span:nth-child(4){animation-delay:.34s}" +
      "@keyframes mp2eq{0%,100%{height:22%}50%{height:100%}}" +

      /* ===== the full-screen queue page ===== */
      ".mp2-qp{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;background:#12100f;border-radius:16px 16px 0 0;transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.9,.25,1);box-shadow:0 -8px 40px rgba(0,0,0,.6)}" +
      ".mp2-qp:not([hidden]){transform:translateY(0)}" +
      ".mp2-qp[hidden]{display:none}" +
      ".mp2-qp-top{display:flex;align-items:center;justify-content:space-between;padding:max(18px,env(safe-area-inset-top)) 20px 10px;border-bottom:1px solid rgba(255,255,255,.08)}" +
      ".mp2-qp-title{margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em;color:#fff}" +
      ".mp2-qp-icons{display:flex;align-items:center;gap:2px}" +
      ".mp2-qp-icon{background:none;border:none;color:rgba(255,255,255,.85);width:42px;height:42px;min-width:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer}" +
      ".mp2-qp-icon:active{background:rgba(255,255,255,.08)}" +
      ".mp2-qp-icon.on{color:#7dd3fc}" +
      ".mp2-qp-icon.close{font-size:19px}" +
      ".mp2-qp-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px 18px max(24px,env(safe-area-inset-bottom))}" +
      ".mp2-qp-h{margin:2px 2px 4px;font-size:13px;font-weight:600;color:rgba(255,255,255,.55)}" +
      ".mp2-qp-hrow{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px;margin-top:16px}" +
      ".mp2-qp-hrow .mp2-qp-h{margin:0}" +
      ".mp2-qp-count{color:rgba(255,255,255,.35);margin-left:6px}" +
      ".mp2-qp-clear{background:none;border:none;color:#fff;font-size:13px;font-weight:700;padding:6px 8px;border-radius:8px;cursor:pointer}" +
      ".mp2-qp-clear:disabled{color:rgba(255,255,255,.25);cursor:default}" +
      ".mp2-npcard{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:9px 11px;margin-bottom:2px}" +
      ".mp2-npcard-cover{width:52px;height:52px;border-radius:10px;object-fit:cover;background:#1c1530}" +
      ".mp2-npcard-meta{flex:1;min-width:0}" +
      ".mp2-npcard-title{font-size:14.5px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-npcard-sub{font-size:11.5px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-npcard-right{display:flex;align-items:center;gap:10px}" +
      ".mp2-npcard-duration{font-size:12px;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums}" +
      ".mp2-npcard-fav{background:none;border:none;color:rgba(255,255,255,.78);width:38px;height:44px;min-width:38px;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-npcard-fav.is-on{color:#fb7185}" +
      ".mp2-qrow{display:flex;align-items:center;gap:11px;padding:7px 2px;border-radius:12px}" +
      ".mp2-qrow:active{background:rgba(255,255,255,.06)}" +
      ".mp2-qrow-cover{width:46px;height:46px;border-radius:9px;object-fit:cover;background:#1c1530}" +
      ".mp2-qrow-meta{flex:1;min-width:0}" +
      ".mp2-qrow-title{font-size:13.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-qrow-sub{font-size:10.5px;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-qrow-right{display:flex;align-items:center;gap:4px}" +
      ".mp2-qrow-duration{font-size:12px;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums;padding:0 4px}" +
      ".mp2-qrow-x{background:none;border:none;color:rgba(255,255,255,.45);width:34px;height:44px;min-width:34px;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-qrow-x:active{color:#fff}" +
      ".mp2-qempty{text-align:center;color:rgba(255,255,255,.4);font-size:12px;padding:22px 12px;line-height:1.6}" +
      ".mp2-qempty small{display:block;font-size:10.5px;color:rgba(255,255,255,.3);margin-top:4px}" +

      /* ===== the context menu ===== */
      ".mp2-ctx-scrim{position:absolute;inset:0;z-index:8;background:rgba(0,0,0,.5)}" +
      ".mp2-ctx-scrim[hidden]{display:none}" +
      ".mp2-ctx{position:absolute;left:0;right:0;bottom:0;z-index:9;background:#1f1a17;border-radius:18px 18px 0 0;padding:8px 10px max(16px,env(safe-area-inset-bottom));max-height:78vh;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 -10px 48px rgba(0,0,0,.6)}" +
      ".mp2-ctx[hidden]{display:none}" +
      ".mp2-ctx-grab{width:44px;height:4px;border-radius:99px;background:rgba(255,255,255,.25);margin:2px auto 10px}" +
      ".mp2-ctx-title{font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em;padding:2px 12px 10px;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-ctx-item{display:flex;align-items:center;gap:15px;width:100%;text-align:left;background:none;border:none;color:rgba(255,255,255,.92);font-size:14.5px;font-weight:600;font-family:inherit;padding:11px 12px;border-radius:12px;cursor:pointer;position:relative}" +
      ".mp2-ctx-item:active{background:rgba(255,255,255,.09)}" +
      ".mp2-ctx-item > i{width:22px;text-align:center;color:rgba(255,255,255,.65);font-size:16.5px}" +
      ".mp2-ctx-item.is-on > i{color:#fb7185}" +
      ".mp2-ctx-chev{position:absolute;right:14px;color:rgba(255,255,255,.4);font-size:12px}" +
      ".mp2-ctx-sub{display:block;font-size:11px;font-weight:400;color:rgba(255,255,255,.45);margin-top:1px}" +
      ".mp2-ctx-era{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);margin:4px 0}" +
      ".mp2-ctx-era > span{display:block}" +
      ".mp2-ctx-era b{display:block;font-size:15px;font-weight:700;color:#fff}" +
      ".mp2-ctx-div{height:1px;background:rgba(255,255,255,.1);margin:6px 8px}" +

      /* ===== the playlist picker ===== */
      ".mp2-pl{position:absolute;left:0;right:0;bottom:0;z-index:10;background:#1f1a17;border-radius:18px 18px 0 0;padding:8px 10px max(14px,env(safe-area-inset-bottom));max-height:70vh;display:flex;flex-direction:column;box-shadow:0 -10px 48px rgba(0,0,0,.65)}" +
      ".mp2-pl[hidden]{display:none}" +
      ".mp2-pl-title{font-size:15px;font-weight:800;color:#fff;padding:0 12px 10px;border-bottom:1px solid rgba(255,255,255,.08)}" +
      ".mp2-pl-list{flex:1;min-height:0;overflow-y:auto;padding:6px 2px}" +
      ".mp2-pl-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:none;color:#fff;font-family:inherit;padding:9px 10px;border-radius:12px;cursor:pointer}" +
      ".mp2-pl-row:active{background:rgba(255,255,255,.08)}" +
      ".mp2-pl-dot{width:34px;height:34px;min-width:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;color:rgba(255,255,255,.75)}" +
      ".mp2-pl-meta{flex:1;min-width:0}" +
      ".mp2-pl-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-pl-count{font-size:10.5px;color:rgba(255,255,255,.45)}" +
      ".mp2-pl-empty{text-align:center;color:rgba(255,255,255,.45);font-size:12px;padding:22px 14px;line-height:1.6}" +
      ".mp2-pl-new{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:#fff;font-family:inherit;font-size:13px;font-weight:700;padding:11px 12px;border-radius:12px;cursor:pointer;margin:4px 2px 0}" +

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
      ".mp2-tbtn.on{color:#7dd3fc}" +
      ".mp2-play{width:64px;height:64px;min-width:64px;border-radius:50%;background:#fff;color:#120c07;font-size:21px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-play:active{transform:scale(.94)}" +

      /* bottom bar */
      ".mp2-bottom{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:6px 28px max(10px,env(safe-area-inset-bottom))}" +
      ".mp2-vbtn{position:relative;background:none;border:none;color:rgba(255,255,255,.6);width:48px;height:46px;min-width:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px}" +
      ".mp2-vbtn.on{color:#e879f9;background:rgba(232,121,249,.14)}" +
      ".mp2-vbtn.on::after{content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#e879f9}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* tiny DOM helpers                                                   */
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
      if (typeof getCoverGradientValue === "function") gradient = getCoverGradientValue(originalCoverOf());
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

  /* ------------------------------------------------------------------ */
  /* comments                                                            */
  /* ------------------------------------------------------------------ */

  function loadComments(ov) {
    var box = q(ov, "[data-mp='comments']");
    var title = commentTitle();
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
    var title = commentTitle();
    if (!input) return;
    var text = String(input.value || "").trim();
    if (!text) { if (note) note.textContent = "Write something first."; return; }
    if (title === "Nothing playing") { if (note) note.textContent = "Play a song first."; return; }
    if (!signedIn()) { if (note) note.textContent = "Sign in to comment."; return; }

    var au = audioEl();
    var atTarget = commentsTarget ? 0 : (au && isFinite(au.currentTime) ? Math.round(au.currentTime) : 0);
    if (note) note.textContent = "";

    fetch("/api/song-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ track: title, body: text, parentId: 0, atSeconds: atTarget, atLabel: fmt(atTarget) }),
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
    var at = commentsTarget ? 0 : (au && isFinite(au.currentTime) ? Math.round(au.currentTime) : 0);
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

  /* ------------------------------------------------------------------ */
  /* played earlier — this session's plays                               */
  /*                                                                     */
  /* trackHistory is only filled by the shuffle and queue paths, so      */
  /* watching the <audio> element's own play event is the one place     */
  /* that sees every play (next, previous, queue, vault, song page).     */
  /* Kept in sessionStorage, so the sheet can be closed and reopened     */
  /* without losing it, and it dies with the tab, like the big players.  */
  /* ------------------------------------------------------------------ */
  var sessionHistory = [];
  var lastWatchTitle = null;
  var watchIv = null;

  function loadSessionHistory() {
    try {
      var raw = sessionStorage.getItem("thw-qp-history");
      sessionHistory = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(sessionHistory)) sessionHistory = [];
    } catch (e) { sessionHistory = []; }
  }

  function saveSessionHistory() {
    try { sessionStorage.setItem("thw-qp-history", JSON.stringify(sessionHistory)); } catch (e) {}
  }

  function pushHistory(title) {
    if (!title || title === "Nothing playing") return;
    /* consecutive duplicates collapse, like a real player does */
    if (sessionHistory.length && sessionHistory[sessionHistory.length - 1] === title) return;
    sessionHistory.push(title);
    if (sessionHistory.length > 40) sessionHistory = sessionHistory.slice(sessionHistory.length - 40);
    saveSessionHistory();
  }

  function trackIndexForTitle(title) {
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      var want = String(title || "").trim().toLowerCase();
      for (var i = 0; i < trackList.length; i++) {
        if (String((trackList[i] || {}).title || "").trim().toLowerCase() === want) return i;
      }
    } catch (e) {}
    return -1;
  }

  /* The one cheap check that sees every play: compare the deck's title with the
     one it had a moment ago, on a 1.5s tick, whether or not the sheet is open.
     The <audio> element's own play event is used too when it fires. The
     placeholder deck (nothing selected yet) is not a play, so it is skipped. */
  function watchTick() {
    if (currentIndex() < 0) return;
    var now = currentTitle();
    if (!now || now === "Nothing playing") return;
    if (lastWatchTitle && lastWatchTitle !== now) pushHistory(lastWatchTitle);
    lastWatchTitle = now;
  }

  function attachHistoryListener() {
    loadSessionHistory();
    watchTick();
    var au = audioEl();
    if (au) au.addEventListener("play", watchTick);
    if (!watchIv) watchIv = setInterval(watchTick, 1500);
  }

  function clearSessionHistory() {
    sessionHistory = [];
    saveSessionHistory();
  }

  function paintQueuePage(ov, force) {
    var page = q(ov, "[data-mp='queuepage']");
    if (!page) return;

    var t = currentTrack();
    var idx = currentIndex();

    /* now playing card */
    var npTitle = q(ov, "[data-mp='np-title']");
    var npSub = q(ov, "[data-mp='np-sub']");
    var npCover = q(ov, "[data-mp='np-cover']");
    var npDur = q(ov, "[data-mp='np-duration']");
    var npFav = q(ov, "[data-mp='np-fav']");
    var npEq = q(ov, "[data-mp='np-eq']");
    if (npTitle) npTitle.textContent = cloneTitleOf(t);
    if (npSub) npSub.textContent = eraNameOf(t) + (catLabel(t) ? " · " + catLabel(t) : "");
    if (npCover) {
      var src = t ? coverOfTrack(t) : "Juice-WRLD.png";
      if (npCover.getAttribute("src") !== src) npCover.setAttribute("src", src);
    }
    if (npDur) {
      var au = audioEl();
      var d = au && isFinite(au.duration) ? au.duration : (t && t.duration) || 0;
      npDur.textContent = d > 0 ? fmt(d) : "";
    }
    if (npFav) {
      var f = favOn(t);
      npFav.classList.toggle("is-on", f);
      npFav.setAttribute("aria-pressed", f ? "true" : "false");
      npFav.innerHTML = '<i class="' + (f ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i>';
    }
    if (npEq) npEq.classList.toggle("is-playing", playing());

    /* up next */
    var list = q(ov, "[data-mp='qp-list']");
    var countEl = q(ov, "[data-mp='qp-count']");
    var queue = [];
    try { if (typeof trackQueue !== "undefined" && trackQueue) queue = trackQueue.slice(); } catch (e) {}
    if (countEl) countEl.textContent = queue.length ? String(queue.length) : "";
    var clearUp = q(ov, "[data-mp='qp-clear-queue']");
    if (clearUp) clearUp.disabled = !queue.length;

    if (list) {
      list.textContent = "";
      if (!queue.length) {
        list.innerHTML = '<p class="mp2-qempty">Nothing up next' +
          '<small>Use “Add to queue” on any song, or press play on an album - they will line up here.</small></p>';
      } else {
        for (var i = 0; i < queue.length; i++) {
          (function (qi, qIdx) {
            var qt = null;
            try { qt = (typeof trackList !== "undefined" && trackList) ? trackList[qIdx] : null; } catch (e) {}
            var row = document.createElement("div");
            row.className = "mp2-qrow";
            var qcover = qt && qt.cover ? coverOfTrack(qt) : "Juice-WRLD.png";
            row.innerHTML =
              '<img decoding="async" class="mp2-qrow-cover" loading="lazy" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'" src="' + esc(coverThumb(qcover, "64")) + '">' +
              '<div class="mp2-qrow-meta" data-mp="qp-row-play">' +
                '<p class="mp2-qrow-title">' + esc((qt && qt.title) || "Track " + (qIdx + 1)) + '</p>' +
                '<p class="mp2-qrow-sub">' + esc(eraNameOf(qt) + (catLabel(qt) ? " · " + catLabel(qt) : "")) + '</p>' +
              '</div>' +
              '<div class="mp2-qrow-right">' +
                '<span class="mp2-qrow-duration">' + esc(fmt((qt && qt.duration) || 0)) + '</span>' +
                '<button type="button" class="mp2-qrow-x" data-mp="qp-remove-' + qi + '" aria-label="Remove from the queue"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
                '<button type="button" class="mp2-qrow-x" data-mp="qp-more-' + qi + '" aria-label="Song options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
              '</div>';
            row.querySelector("[data-mp='qp-row-play']").addEventListener("click", function () {
              try { if (window.selectTrackFromList) window.selectTrackFromList(qIdx); } catch (e) {}
            });
            row.querySelector("[data-mp='qp-remove-" + qi + "']").addEventListener("click", function () {
              try { if (typeof removeFromQueue === "function") removeFromQueue(qi); } catch (e) {}
              paintQueuePage(ov, true);
              toast("Removed from the queue", "info");
            });
            row.querySelector("[data-mp='qp-more-" + qi + "']").addEventListener("click", function () {
              menuTrack = qt || null;
              openCtx(ov);
            });
            list.appendChild(row);
          })(i, queue[i]);
        }
      }
    }

    /* played earlier — this session's plays, newest first */
    var histList = q(ov, "[data-mp='qp-history']");
    var history = sessionHistory.slice();
    var clearHist = q(ov, "[data-mp='qp-clear-history']");
    if (clearHist) clearHist.disabled = !history.length;

    if (histList) {
      histList.textContent = "";
      if (!history.length) {
        histList.innerHTML = '<p class="mp2-qempty">Nothing played yet<small>Songs you play this session will appear here.</small></p>';
      } else {
        for (var k = history.length - 1; k >= 0; k--) {
          (function (title) {
            var hIdx = trackIndexForTitle(title);
            var ht = hIdx >= 0 ? trackList[hIdx] : null;
            var row = document.createElement("div");
            row.className = "mp2-qrow";
            var hcover = ht && ht.cover ? coverOfTrack(ht) : "Juice-WRLD.png";
            row.innerHTML =
              '<img decoding="async" class="mp2-qrow-cover" loading="lazy" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'" src="' + esc(coverThumb(hcover, "64")) + '">' +
              '<div class="mp2-qrow-meta">' +
                '<p class="mp2-qrow-title">' + esc(title) + '</p>' +
                '<p class="mp2-qrow-sub">' + esc(ht ? (eraNameOf(ht) + (catLabel(ht) ? " · " + catLabel(ht) : "")) : "") + '</p>' +
              '</div>' +
              '<div class="mp2-qrow-right"><span class="mp2-qrow-duration">' + esc(fmt((ht && ht.duration) || 0)) + '</span></div>';
            if (hIdx >= 0) {
              row.addEventListener("click", function () {
                try { if (window.selectTrackFromList) window.selectTrackFromList(hIdx); } catch (e) {}
              });
            }
            histList.appendChild(row);
          })(history[k]);
        }
      }
    }

    /* header icons */
    qa(ov, "[data-mp='shuffle']").forEach(function (el) {
      el.classList.toggle("on", shuffleOn());
      el.setAttribute("aria-pressed", shuffleOn() ? "true" : "false");
    });
    qa(ov, "[data-mp='repeat']").forEach(function (el) {
      el.classList.toggle("on", repeatOn());
      el.setAttribute("aria-pressed", repeatOn() ? "true" : "false");
    });
  }

  function openQueuePage(ov) {
    queueOpen = true;
    var page = q(ov, "[data-mp='queuepage']");
    if (page) page.hidden = false;
    var vbtn = q(ov, "[data-mp='view-queue']");
    if (vbtn) { vbtn.classList.add("on"); vbtn.setAttribute("aria-pressed", "true"); }
    paintQueuePage(ov, true);
  }

  function closeQueuePage(ov) {
    queueOpen = false;
    var page = q(ov, "[data-mp='queuepage']");
    if (page) page.hidden = true;
    var vbtn = q(ov, "[data-mp='view-queue']");
    if (vbtn) { vbtn.classList.remove("on"); vbtn.setAttribute("aria-pressed", "false"); }
  }

  function toggleQueuePage(ov) {
    if (queueOpen) closeQueuePage(ov); else openQueuePage(ov);
  }

  /* ------------------------------------------------------------------ */
  /* the context menu                                                     */
  /* ------------------------------------------------------------------ */
  function openCtx(ov) {
    var menu = q(ov, "[data-mp='ctx']");
    var scrim = q(ov, "[data-mp='ctx-scrim']");
    if (!menu || !scrim) return;
    var t = ctxTarget();
    q(ov, "[data-mp='ctx-title']").textContent = cloneTitleOf(t);
    q(ov, "[data-mp='ctx-era-sub']").textContent = eraNameOf(t);

    /* Like state */
    var like = q(ov, "[data-ctx='like']");
    var f = favOn(t);
    like.classList.toggle("is-on", f);
    like.innerHTML = '<i class="' + (f ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i><span>' + (f ? "Liked" : "Like") + "</span>";

    menu.hidden = false;
    scrim.hidden = false;
  }

  function closeCtx(ov) {
    var menu = q(ov, "[data-mp='ctx']");
    var scrim = q(ov, "[data-mp='ctx-scrim']");
    if (menu) menu.hidden = true;
    if (scrim) scrim.hidden = true;
    closePlaylistPicker(ov);
    menuTrack = null;
  }

  function ctxAction(ov, action) {
    var t = ctxTarget();
    var title = cloneTitleOf(t);

    if (action === "like") {
      toggleFav(t);
      /* repaint just the like row */
      var like = q(ov, "[data-ctx='like']");
      var f = favOn(t);
      like.classList.toggle("is-on", f);
      like.innerHTML = '<i class="' + (f ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i><span>' + (f ? "Liked" : "Like") + "</span>";
      return;
    }

    if (action === "addplaylist") { openPlaylistPicker(ov, t); return; }

    if (action === "cover") {
      var input = q(ov, "[data-mp='cover-input']");
      if (input) input.click();
      return;
    }

    if (action === "share") { shareSong(title); return; }
    if (action === "song") { openSongPage(title); return; }
    if (action === "versions") { openSongPage(title); return; } /* the song page lists every version */

    if (action === "era") {
      var code = eraCodeOf(t);
      closeCtx(ov);
      if (queueOpen) closeQueuePage(ov);
      close();
      if (typeof window.switchAppPage === "function") window.switchAppPage("hub");
      setTimeout(function () {
        try {
          var nodes = document.querySelectorAll(".era-node");
          for (var i = 0; i < nodes.length; i++) {
            var codeEl = nodes[i].querySelector(".era-code");
            if (codeEl && String(codeEl.textContent || "").trim().toUpperCase() === code) {
              var btn = nodes[i].querySelector(".era-btn");
              if (btn) btn.click();
              nodes[i].scrollIntoView({ block: "center" });
              return;
            }
          }
        } catch (e) {}
      }, 420);
      return;
    }

    if (action === "edit") {
      closeCtx(ov);
      close();
      if (typeof window.switchAppPage === "function") window.switchAppPage("suggestions");
      setTimeout(function () {
        try {
          var titleEl = document.getElementById("sugg-title");
          var descEl = document.getElementById("sugg-desc");
          var catEl = document.getElementById("sugg-category");
          if (titleEl && !titleEl.value) titleEl.value = "Fix: " + title;
          if (descEl && !descEl.value) descEl.value = "Song: " + title + "\n\nWhat needs fixing (credits, dates, details): ";
          if (catEl) catEl.value = "bug_fix";
        } catch (e) {}
      }, 420);
      return;
    }

    if (action === "credits") { openSongPage(title); return; }

    if (action === "openqueue") {
      closeCtx(ov);
      openQueuePage(ov);
      return;
    }

    if (action === "eq") {
      toast("Equalizer and reverb are not in this build yet", "info");
      return;
    }

    if (action === "settings") {
      closeCtx(ov);
      close();
      if (typeof window.switchAppPage === "function") window.switchAppPage("account");
      return;
    }

    if (action === "comments") {
      commentsTarget = t || null;
      closeCtx(ov);
      if (queueOpen) closeQueuePage(ov);
      switchView(ov, "comments");
      return;
    }

    if (action === "close") {
      /* stop the music, then hide the player */
      var au = audioEl();
      if (au && !au.paused) {
        var mp = document.getElementById("deck-play");
        if (mp) mp.click(); else if (typeof window.shadowPause === "function") window.shadowPause();
      }
      closeCtx(ov);
      close();
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* the playlist picker                                                */
  /* ------------------------------------------------------------------ */
  function openPlaylistPicker(ov, targetTrack) {
    var sheet = q(ov, "[data-mp='pl']");
    var list = q(ov, "[data-mp='pl-list']");
    if (!sheet || !list) return;
    var title = cloneTitleOf(targetTrack);
    list.innerHTML = '<p class="mp2-pl-empty">Loading your playlists…</p>';
    sheet.hidden = false;

    fetch("/api/playlists", { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 401 || !d.ok) {
          list.innerHTML = '<p class="mp2-pl-empty">Sign in to save this song to a playlist.</p>';
          return;
        }
        var playlists = Array.isArray(d.playlists) ? d.playlists : [];
        if (!playlists.length) {
          list.innerHTML = '<p class="mp2-pl-empty">No playlists yet.<small>Make one in your profile, then come back.</small></p>';
          return;
        }
        list.textContent = "";
        playlists.forEach(function (pl) {
          var row = document.createElement("button");
          row.type = "button";
          row.className = "mp2-pl-row";
          var color = pl.color || "#7c3aed";
          var count = (pl.tracks && pl.tracks.length) || 0;
          var sub = (pl.visibility === "public" ? "Public · " : "") + count + (count === 1 ? " song" : " songs");
          row.innerHTML =
            '<span class="mp2-pl-dot" style="background:' + esc(color) + '1f;color:' + esc(color) + '"><i class="fas fa-list" aria-hidden="true"></i></span>' +
            '<span class="mp2-pl-meta"><span class="mp2-pl-name">' + esc(pl.name || "Playlist") + '</span><br><span class="mp2-pl-count">' + esc(sub) + '</span></span>';
          row.addEventListener("click", function () {
            fetch("/api/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "add", id: pl.id, title: title }),
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (d2) {
                if (d2 && d2.ok) {
                  toast("Added to " + (pl.name || "your playlist"), "success");
                  closePlaylistPicker(ov);
                } else {
                  toast((d2 && (d2.error || d2.message)) || "Could not add to the playlist", "error");
                }
              }).catch(function () { toast("Could not add to the playlist", "error"); });
          });
          list.appendChild(row);
        });
      })
      .catch(function () {
        list.innerHTML = '<p class="mp2-pl-empty">The playlists could not be loaded.</p>';
      });
  }

  function closePlaylistPicker(ov) {
    var sheet = q(ov, "[data-mp='pl']");
    if (sheet) sheet.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* the views                                                          */
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
  }

  function toggleView(ov, name) {
    switchView(ov, currentView === name ? "now" : name);
  }

  /* ------------------------------------------------------------------ */
  /* sync                                                               */
  /* ------------------------------------------------------------------ */
  var lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null, title: null };

  function sync(force) {
    var ov = document.getElementById(OV);
    if (!ov) { stopSync(); return; }

    var t = currentTitle(), a = currentArtist(), cover = coverOf();
    /* the mini row inside the comments view shows the track whose thread is
       on the screen - the current song, or the one the menu was opened for */
    var ct = commentTrack();
    var ctTitle = ct ? String(ct.title || "Nothing playing") : t;
    var ctArtist = ct ? String(ct.artist || "Juice WRLD") : a;
    var ctCover = ct && ct.cover ? coverOfTrack(ct) : cover;

    paintBackground(ov);

    qa(ov, "[data-mp='title'],[data-mp='title2']").forEach(function (el) {
      var want = el.getAttribute("data-mp") === "title2" ? ctTitle : t;
      if (el.textContent !== want) el.textContent = want;
    });
    qa(ov, "[data-mp='artist'],[data-mp='artist2']").forEach(function (el) {
      var want = el.getAttribute("data-mp") === "artist2" ? ctArtist : a;
      if (el.textContent !== want) el.textContent = want;
    });
    qa(ov, "[data-mp='cover'],[data-mp='mini-cover']").forEach(function (img) {
      var want = img.getAttribute("data-mp") === "mini-cover" ? ctCover : cover;
      if (img.getAttribute("src") !== want) img.setAttribute("src", want);
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

    /* chips */
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

    /* hearts: the big view tracks the song that is playing; the mini row
       tracks the song whose thread is on the screen */
    var fav = favOn();
    qa(ov, "[data-mp='fav']").forEach(function (el) {
      el.classList.toggle("is-on", fav);
      var icon = el.querySelector("i");
      if (icon) icon.className = (fav ? "fas" : "far") + " fa-heart";
      el.setAttribute("aria-pressed", fav ? "true" : "false");
    });
    var favMini = favOn(ct);
    qa(ov, "[data-mp='fav3']").forEach(function (el) {
      el.classList.toggle("is-on", favMini);
      var icon = el.querySelector("i");
      if (icon) icon.className = (favMini ? "fas" : "far") + " fa-heart";
      el.setAttribute("aria-pressed", favMini ? "true" : "false");
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

    /* play/pause */
    var isPlaying = playing();
    if (force || lastSync.playing !== isPlaying) {
      lastSync.playing = isPlaying;
      var pp = q(ov, "[data-mp='play']");
      if (pp) pp.innerHTML = '<i class="fas ' + (isPlaying ? "fa-pause" : "fa-play") + '"></i>';
      qa(ov, ".mp2-eq").forEach(function (el) { el.classList.toggle("is-playing", isPlaying); });
    }

    qa(ov, "[data-mp='shuffle']").forEach(function (el) {
      var on = shuffleOn();
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    qa(ov, "[data-mp='repeat']").forEach(function (el) {
      var on = repeatOn();
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });

    /* the song changed under an open view: refresh it */
    if (force || lastSync.title !== t) {
      lastSync.title = t;
      if (currentView === "comments") { paintComposeState(ov); loadComments(ov); }
    }
    if (queueOpen) paintQueuePage(ov, force);
    if (currentView === "comments") paintComposeState(ov);
  }

  function stopSync() {
    if (syncIv) { clearInterval(syncIv); syncIv = null; }
  }

  /* ------------------------------------------------------------------ */
  /* the scrubbing                                                      */
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
      if (ev.target.closest && ev.target.closest(".mp2-compose, .mp2-qp-body, .mp2-comments, .mp2-ctx, .mp2-pl, input, button, .mp2-scrub")) return;
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
    lastSync = { pct: -1, curTxt: null, durTxt: null, playing: null, title: null };
    lastBgCover = null;
    currentView = "now";
    queueOpen = false;
    commentsTarget = null;
    menuTrack = null;

    var ov = document.createElement("div");
    ov.className = "mp2";
    ov.id = OV;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Now playing");

    var t = currentTitle(), a = currentArtist(), cover = coverOf();
    var versions = currentTrack() ? versionCount(currentTrack()) : 1;

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
            '<div class="mp2-mini-meta"><p class="mp2-mini-title" data-mp="title2">' + esc(t) + '</p><p class="mp2-mini-artist" data-mp="artist2">' + esc(a) + '</p></div>' +
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
        '<button type="button" class="mp2-vbtn" data-mp="view-queue" aria-label="Queue" aria-pressed="false"><i class="fas fa-list-ul" aria-hidden="true"></i></button>' +
      '</nav>' +

      /* ===== the full-screen queue page ===== */
      '<div class="mp2-qp" data-mp="queuepage" hidden role="dialog" aria-label="Queue">' +
        '<header class="mp2-qp-top">' +
          '<h1 class="mp2-qp-title">Queue</h1>' +
          '<div class="mp2-qp-icons">' +
            '<button type="button" class="mp2-qp-icon" data-mp="shuffle" aria-label="Shuffle" aria-pressed="false"><i class="fas fa-shuffle" aria-hidden="true"></i></button>' +
            '<button type="button" class="mp2-qp-icon" data-mp="repeat" aria-label="Repeat" aria-pressed="false"><i class="fas fa-repeat" aria-hidden="true"></i></button>' +
            '<button type="button" class="mp2-qp-icon close" data-mp="close-queue" aria-label="Close the queue"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
          '</div>' +
        '</header>' +
        '<div class="mp2-qp-body">' +
          '<p class="mp2-qp-h">Now playing</p>' +
          '<div class="mp2-npcard">' +
            '<img decoding="async" class="mp2-npcard-cover" data-mp="np-cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
            '<div class="mp2-npcard-meta"><p class="mp2-npcard-title" data-mp="np-title">' + esc(t) + '</p><p class="mp2-npcard-sub" data-mp="np-sub"></p></div>' +
            '<div class="mp2-npcard-right">' +
              '<span class="mp2-eq" data-mp="np-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
              '<span class="mp2-npcard-duration" data-mp="np-duration"></span>' +
              '<button type="button" class="mp2-npcard-fav" data-mp="np-fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mp2-qp-hrow"><p class="mp2-qp-h">Up next<span class="mp2-qp-count" data-mp="qp-count"></span></p>' +
            '<button type="button" class="mp2-qp-clear" data-mp="qp-clear-queue">Clear</button></div>' +
          '<div class="mp2-qp-list" data-mp="qp-list"></div>' +
          '<div class="mp2-qp-hrow"><p class="mp2-qp-h">Played earlier</p>' +
            '<button type="button" class="mp2-qp-clear" data-mp="qp-clear-history">Clear</button></div>' +
          '<div class="mp2-qp-list" data-mp="qp-history"></div>' +
        '</div>' +
      '</div>' +

      /* ===== the context menu ===== */
      '<div class="mp2-ctx-scrim" data-mp="ctx-scrim" hidden aria-hidden="true"></div>' +
      '<div class="mp2-ctx" data-mp="ctx" hidden role="dialog" aria-modal="true" aria-label="Song options">' +
        '<div class="mp2-ctx-grab" aria-hidden="true"></div>' +
        '<p class="mp2-ctx-title" data-mp="ctx-title">' + esc(t) + '</p>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="like"><i class="far fa-heart" aria-hidden="true"></i><span>Like</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="addplaylist"><i class="fas fa-plus" aria-hidden="true"></i><span>Add to playlist</span><i class="fas fa-chevron-right mp2-ctx-chev" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="cover"><i class="fas fa-image" aria-hidden="true"></i><span>Change cover<span class="mp2-ctx-sub">Only you see it</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="share"><i class="fas fa-share-nodes" aria-hidden="true"></i><span>Share</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="song"><i class="fas fa-music" aria-hidden="true"></i><span>Go to song</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="versions"><i class="fas fa-code-branch" aria-hidden="true"></i><span>Other versions</span></button>' +
        '<button type="button" class="mp2-ctx-item mp2-ctx-era" data-ctx="era"><i class="fas fa-layer-group" aria-hidden="true"></i><span><b>Go to era</b><span class="mp2-ctx-sub" data-mp="ctx-era-sub">Other</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="edit"><i class="fas fa-pen-to-square" aria-hidden="true"></i><span>Edit this song<span class="mp2-ctx-sub">Fix credits, dates or details</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="credits"><i class="fas fa-user-group" aria-hidden="true"></i><span>Credits</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="openqueue"><i class="fas fa-list-ul" aria-hidden="true"></i><span>Open queue</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="eq"><i class="fas fa-sliders" aria-hidden="true"></i><span>Equalizer and reverb</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="settings"><i class="fas fa-gear" aria-hidden="true"></i><span>Playback settings</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="comments"><i class="far fa-comment" aria-hidden="true"></i><span>Show comments</span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="close"><i class="fas fa-xmark" aria-hidden="true"></i><span>Close player<span class="mp2-ctx-sub">Stops playback and hides the player</span></span></button>' +
      '</div>' +

      /* ===== the playlist picker ===== */
      '<div class="mp2-pl" data-mp="pl" hidden role="dialog" aria-modal="true" aria-label="Add to playlist">' +
        '<div class="mp2-ctx-grab" aria-hidden="true"></div>' +
        '<p class="mp2-pl-title">Add to playlist</p>' +
        '<div class="mp2-pl-list" data-mp="pl-list"></div>' +
        '<button type="button" class="mp2-pl-new" data-mp="pl-new"><i class="fas fa-plus" aria-hidden="true"></i>New playlist<span class="mp2-ctx-sub">opens your profile</span></button>' +
      '</div>' +

      '<input type="file" accept="image/*" data-mp="cover-input" hidden aria-hidden="true">';

    /* the sheet's own clicks */
    ov.addEventListener("click", function (e) {
      var target = e.target;

      var closeBtn = target.closest ? target.closest("[data-mp-close]") : null;
      if (closeBtn) { close(); return; }

      var moreBtn = target.closest ? target.closest("[data-mp-more]") : null;
      if (moreBtn) {
        menuTrack = null;
        var menu = q(ov, "[data-mp='ctx']");
        var scrim = q(ov, "[data-mp='ctx-scrim']");
        if (menu && scrim) {
          if (menu.hidden) openCtx(ov); else closeCtx(ov);
        }
        return;
      }

      var ctxScrim = target.closest ? target.closest("[data-mp='ctx-scrim']") : null;
      if (ctxScrim) { closeCtx(ov); return; }

      var ctxItem = target.closest ? target.closest("[data-ctx]") : null;
      if (ctxItem) { ctxAction(ov, ctxItem.getAttribute("data-ctx")); return; }

      var plNew = target.closest ? target.closest("[data-mp='pl-new']") : null;
      if (plNew) {
        closeCtx(ov);
        close();
        if (window.viewMyProfile) { window.viewMyProfile(); return; }
        if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
        return;
      }

      var b = target.closest ? target.closest("[data-mp]") : null;
      if (!b) return;
      var action = b.getAttribute("data-mp");

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
        } else if (action === "fav" || action === "fav3") {
          toggleFav(commentsTarget || undefined);
        } else if (action === "np-fav") {
          toggleFav();
        } else if (action === "addqueue") {
          var ci = currentIndex();
          if (ci >= 0 && typeof addToQueue === "function") { addToQueue(ci); toast("Added to the queue", "success"); }
        } else if (action === "share") {
          shareSong(currentTitle());
        } else if (action === "view-comments") {
          toggleView(ov, "comments");
        } else if (action === "view-queue") {
          toggleQueuePage(ov);
        } else if (action === "close-queue") {
          closeQueuePage(ov);
        } else if (action === "qp-clear-queue") {
          try { if (typeof clearQueue === "function") clearQueue(); } catch (e) {}
          paintQueuePage(ov, true);
        } else if (action === "qp-clear-history") {
          clearSessionHistory();
          paintQueuePage(ov, true);
        } else if (action === "pill") {
          openSongPage(currentTitle());
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

    /* the change-cover file input */
    var coverInput = ov.querySelector("[data-mp='cover-input']");
    if (coverInput) {
      coverInput.addEventListener("change", function () {
        var file = coverInput.files && coverInput.files[0];
        if (!file) return;
        var targetTitle = menuTrack ? menuTrack.title : currentTitle();
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var size = 224;
            var canvas = document.createElement("canvas");
            canvas.width = size; canvas.height = size;
            var ctx2d = canvas.getContext("2d");
            var side = Math.min(img.width, img.height);
            ctx2d.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            var dataUrl = "";
            try { dataUrl = canvas.toDataURL("image/jpeg", 0.82); } catch (e) { dataUrl = img.src; }
            setCustomCover(targetTitle, dataUrl);
            closeCtx(ov);
            lastBgCover = null; /* repaint with the new cover in place */
            sync(true);
            toast("Cover changed — only you will see it", "success");
          };
          img.onerror = function () { toast("That picture would not load", "error"); };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
        coverInput.value = "";
      });
    }

    bindScrubbing(ov);
    bindSwipeDown(ov);

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
    menuTrack = null;
    commentsTarget = null;
    queueOpen = false;
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
    attachHistoryListener();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var ov = document.getElementById(OV);
        if (!ov) return;
        /* close the innermost layer first */
        var pl = ov.querySelector("[data-mp='pl']");
        if (pl && !pl.hidden) { closePlaylistPicker(ov); return; }
        var ctx = ov.querySelector("[data-mp='ctx']");
        if (ctx && !ctx.hidden) { closeCtx(ov); return; }
        var qp = ov.querySelector("[data-mp='queuepage']");
        if (qp && !qp.hidden) { closeQueuePage(ov); return; }
        close();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
