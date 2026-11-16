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
  var momentMode = "moment"; /* "moment" | "song" — the comments composer's pin */

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

  /* Alt names — the other titles the vault has filed this song under.
     The tag carries them: everything in parentheses that is not the
     category, the era, or a version marker is an alternate name. */
  var ERA_CODES = { "GB&GR":1, "WOD":1, "DRFL":1, "JW3":1, "POST":1, "OUT":1, "AF":1, "ND":1, "BDM":1, "SOUNDCLOUD":1 };
  function altNames(t) {
    var tag = String((t || {}).tag || "");
    var out = [];
    var re = /\(([^()]*)\)/g;
    var m;
    while ((m = re.exec(tag))) {
      var tok = m[1].trim();
      if (!tok) continue;
      var low = tok.toLowerCase();
      if (low === "sessions" || low === "leaks" || low === "leaked" || low === "halloween") continue;
      if (/^v\d+(\.\d+)?$/i.test(low)) continue;
      if (ERA_CODES[tok.toUpperCase()]) continue;
      out.push(tok);
    }
    return out;
  }

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

  function versionPillLabel(t) {
    if (!t) return { label: "Main version", count: 1 };
    var m = String(t.title || "").match(/\(([^)]*)\)\s*$/);
    var base = m ? String(m[1] || "").trim() : "";
    return { label: base || "Main version", count: versionCount(t) };
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
      ".mp2-x,.mp2-more{background:none;border:none;color:rgba(255,255,255,.85);width:46px;height:46px;min-width:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:19px}" +
      ".mp2-more{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08)}" +
      ".mp2-x:active,.mp2-more:active{background:rgba(255,255,255,.14)}" +
      ".mp2-context{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.42);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}" +
      ".mp2-context b{color:rgba(255,255,255,.92);font-weight:800}" +
      /* the search pill, inside the queue view */
      ".mp2-search{position:relative;width:100%;height:40px;margin:0 0 12px}" +
      ".mp2-search-input{display:block;width:100%;height:100%;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);border-radius:999px;color:#fff;font-size:12.5px;font-family:inherit;outline:none;padding:0 40px 0 38px;transition:border-color .2s ease,background .2s ease;line-height:40px}" +
      ".mp2-search-input::placeholder{color:rgba(255,255,255,.55)}" +
      ".mp2-search-input:focus{border-color:rgba(34,211,238,.6);background:rgba(255,255,255,.17)}" +
      ".mp2-search-ic{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.65);font-size:12.5px;pointer-events:none}" +
      ".mp2-search-clear{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.5);width:32px;height:32px;border-radius:50%;display:none;align-items:center;justify-content:center;font-size:13px;cursor:pointer}" +
      ".mp2-search-clear.is-shown{display:flex}" +
      ".mp2-search-results{background:#171310;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:6px;max-height:min(40vh,380px);overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 60px rgba(0,0,0,.62);z-index:30}" +
      ".mp2-search-results[hidden]{display:none}" +
      ".mp2-search-addall{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:rgba(52,211,153,.13);border:1px solid rgba(52,211,153,.3);color:#6ee7b7;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;border-radius:11px;padding:9px 12px;cursor:pointer;margin-bottom:6px;transition:background .15s ease,color .15s ease}" +
      ".mp2-search-addall:hover{background:rgba(52,211,153,.2);color:#a7f3d0}" +
      ".mp2-srow{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:11px;cursor:pointer}" +
      ".mp2-srow:hover,.mp2-srow.is-active{background:rgba(255,255,255,.08)}" +
      ".mp2-srow-cover{width:44px;height:44px;border-radius:9px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".mp2-srow-meta{flex:1;min-width:0}" +
      ".mp2-srow-title{margin:0;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-srow-sub{margin:2px 0 0;font-size:10px;color:rgba(255,255,255,.42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-srow-dur{font-size:10.5px;color:rgba(255,255,255,.46);font-variant-numeric:tabular-nums;flex-shrink:0}" +
      ".mp2-srow-add{background:none;border:none;color:rgba(255,255,255,.55);width:38px;height:44px;min-width:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;border-radius:10px}" +
      ".mp2-srow-add:hover{color:#34d399}" +
      ".mp2-srow-empty{padding:18px 14px;text-align:center;color:rgba(255,255,255,.4);font-size:12px}" +

      /* the two views */
      ".mp2-body{position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;padding:0 22px;overflow:hidden}" +
      /* the views never scroll - the comments list inside its own view is
         the only thing that scrolls, so the cover can never be dragged out
         from under the finger and the page behind never moves. */
      ".mp2-view{display:none;flex:1;min-height:0;width:100%;flex-direction:column;align-items:center;overflow:hidden;overscroll-behavior:contain}" +
      ".mp2-view.is-active{display:flex}" +

      /* the equalizer bars (now-playing card + queue rows) */
      ".mp2-eq{display:flex;align-items:flex-end;gap:2.5px;height:17px}" +
      ".mp2-eq span{width:3px;border-radius:2px;background:#38bdf8;height:35%;transform-origin:bottom}" +
      ".mp2-eq.is-playing span{animation:mp2eq .9s ease-in-out infinite}" +
      ".mp2-eq span:nth-child(2){animation-delay:.22s}" +
      ".mp2-eq span:nth-child(3){animation-delay:.1s}" +
      ".mp2-eq span:nth-child(4){animation-delay:.34s}" +
      "@keyframes mp2eq{0%,100%{height:22%}50%{height:100%}}" +

      /* ===== the now-playing hero ===== */
      ".mp2-view[data-view='now']{align-items:stretch}" +
      "@media (max-height:640px){.mp2-view[data-view='now']{overflow-y:auto;-webkit-overflow-scrolling:touch}}" +
      ".mp2-hero{display:flex;flex-direction:column;flex:1;min-height:0;width:100%;justify-content:center}" +
      ".mp2-cover{align-self:center;width:min(58%,300px,32vh);aspect-ratio:1/1;object-fit:cover;border-radius:18px;background:#1c1530;box-shadow:0 26px 60px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.08) inset;margin-bottom:12px;flex-shrink:0}" +
      ".mp2-title{margin:0;font-size:clamp(30px,8.6vw,42px);line-height:1.02;font-weight:900;letter-spacing:-.03em;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-artist{margin:2px 0 0;font-size:14px;font-weight:600;color:rgba(255,255,255,.55);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
      ".mp2-album{margin:14px 0 0;display:flex;align-items:center;gap:8px;min-width:0;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
      ".mp2-album i{font-size:11px;color:rgba(255,255,255,.3);flex-shrink:0}" +
      ".mp2-pill{margin-top:12px;align-self:flex-start;display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:9px 16px;font-size:12.5px;font-weight:700;color:rgba(255,255,255,.88);cursor:pointer;font-family:inherit}" +
      ".mp2-pill small{font-weight:600;color:rgba(255,255,255,.45);font-size:11px}" +
      ".mp2-pill i{font-size:10px;opacity:.65}" +
      ".mp2-chiprow{display:flex;align-items:center;gap:8px;margin-top:14px;width:100%}" +
      ".mp2-chip{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.02em;border-radius:8px;padding:5px 11px}" +
      ".mp2-chip i{font-size:10px}" +
      ".chip-cat-leaks{background:rgba(248,113,113,.16);color:#fca5a5;border:1px solid rgba(248,113,113,.3)}" +
      ".chip-cat-sessions{background:rgba(34,211,238,.13);color:#67e8f9;border:1px solid rgba(34,211,238,.3)}" +
      ".chip-cat-halloween{background:rgba(192,132,252,.15);color:#d8b4fe;border:1px solid rgba(192,132,252,.3)}" +
      ".chip-era{background:rgba(255,255,255,.07);color:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.1)}" +
      ".chip-snippet{background:transparent;color:#67e8f9;border:1px solid rgba(34,211,238,.4)}" +
      ".mp2-chip-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}" +
      ".mp2-chipact{background:none;border:none;color:rgba(255,255,255,.72);width:44px;height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;border-radius:12px}" +
      ".mp2-chipact:active{transform:scale(.9);background:rgba(255,255,255,.07)}" +
      ".mp2-chipact.is-on{color:#fb7185}" +
      /* the mini row is for the queue & comments views; the hero carries the song itself */
      ".mp2.view-now .mp2-mini{display:none}" +
      /* ===== the queue, as an inline view ===== */
      ".mp2-view[data-view='queue']{align-items:stretch}" +
      /* ===== the playlists page ===== */
      ".mp2-plp{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;background:#12100f;border-radius:16px 16px 0 0;transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.9,.25,1);box-shadow:0 -8px 40px rgba(0,0,0,.6)}" +
      ".mp2-plp:not([hidden]){transform:translateY(0)}" +
      ".mp2-plp[hidden]{display:none}" +
      ".mp2-plp-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px 18px max(24px,env(safe-area-inset-bottom))}" +
      ".mp2-plp-card{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font-family:inherit;color:#fff;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:11px 12px;margin-bottom:8px;cursor:pointer}" +
      ".mp2-plp-card:active{background:rgba(255,255,255,.07)}" +
      ".mp2-plp-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0}" +
      ".mp2-plp-card-meta{flex:1;min-width:0}" +
      ".mp2-plp-name{font-size:14.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-plp-sub{font-size:10.5px;color:rgba(255,255,255,.45);margin-top:3px}" +
      ".mp2-plp-newrow{display:flex;align-items:center;gap:11px;width:100%;font-family:inherit;color:rgba(255,255,255,.65);background:none;border:1px dashed rgba(255,255,255,.12);border-radius:14px;padding:12px;cursor:pointer;font-size:13px;font-weight:700;margin-top:2px}" +
      ".mp2-plp-newrow i{color:rgba(255,255,255,.45)}" +
      ".mp2-plp-newrow small{margin-left:auto;font-size:10px;font-weight:600;color:rgba(255,255,255,.35)}" +
      ".mp2-plp-manage{text-align:center;font-size:11px;color:rgba(255,255,255,.4);margin:18px 0 4px}" +
      ".mp2-plp-manage a{color:rgba(255,255,255,.6);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.2)}" +
      ".mp2-plp-empty{text-align:center;color:rgba(255,255,255,.4);font-size:13px;padding:44px 24px;line-height:1.7}" +
      ".mp2-plp-empty i{display:block;font-size:26px;margin-bottom:10px;color:rgba(255,255,255,.25)}" +
      ".mp2-plp-empty b{color:#fff}" +
      ".mp2-plp-empty a{display:inline-block;margin-top:12px;background:#fff;color:#161016;border-radius:99px;padding:9px 22px;font-weight:800;font-size:13px;text-decoration:none}" +
      ".mp2-plp-dhead{display:flex;align-items:center;gap:12px;margin-bottom:10px}" +
      ".mp2-plp-dmeta{flex:1;min-width:0}" +
      ".mp2-plp-dname{margin:0;font-size:17px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-plp-dsub{margin:3px 0 0;font-size:11px;color:rgba(255,255,255,.45)}" +
      ".mp2-plp-actions{display:flex;gap:10px;margin-bottom:12px}" +
      ".mp2-plp-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font-family:inherit;font-size:12.5px;font-weight:800;border-radius:12px;padding:11px 10px;cursor:pointer}" +
      ".mp2-plp-btn.primary{background:#fff;color:#161016;border-color:#fff}" +
      ".mp2-plp-btn:active{transform:scale(.97)}" +
      ".mp2-qp-top{display:flex;align-items:center;justify-content:space-between;padding:max(18px,env(safe-area-inset-top)) 16px 10px;border-bottom:1px solid rgba(255,255,255,.08)}" +
      ".mp2-qp-title{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em;color:#fff}" +
      ".mp2-qp-icons{display:flex;align-items:center;gap:2px}" +
      ".mp2-qp-icon{background:none;border:none;color:rgba(255,255,255,.85);width:42px;height:42px;min-width:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer}" +
      ".mp2-qp-icon:active{background:rgba(255,255,255,.08)}" +
      ".mp2-qp-icon.on{color:#7dd3fc}" +
      ".mp2-qp-icon.close{font-size:19px}" +
      ".mp2-qp-body{flex:1;min-height:0;width:100%;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:6px 2px max(12px,env(safe-area-inset-bottom))}" +
      ".mp2-qp-h{margin:2px 2px 4px;font-size:13px;font-weight:600;color:rgba(255,255,255,.55)}" +
      ".mp2-qp-hrow{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px;margin-top:16px}" +
      ".mp2-qp-hrow .mp2-qp-h{margin:0}" +
      ".mp2-qp-count{color:rgba(255,255,255,.35);margin-left:6px}" +
      ".mp2-qp-clear{background:none;border:none;color:#fff;font-size:13px;font-weight:700;padding:6px 8px;border-radius:8px;cursor:pointer}" +
      ".mp2-qp-clear:disabled{color:rgba(255,255,255,.25);cursor:default}" +
      ".mp2-npcard{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:9px 11px;margin:2px 0 4px}" +
      ".mp2-npcard-cover{width:52px;height:52px;border-radius:10px;object-fit:cover;background:#1c1530}" +
      ".mp2-npcard-meta{flex:1;min-width:0}" +
      ".mp2-npcard-title{font-size:14.5px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-npcard-sub{font-size:11.5px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".mp2-npcard-right{display:flex;align-items:center;gap:10px}" +
      ".mp2-npcard-duration{font-size:12px;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums}" +
      ".mp2-npcard-fav{background:none;border:none;color:rgba(255,255,255,.78);width:38px;height:44px;min-width:38px;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-npcard-fav.is-on{color:#fb7185}" +
      ".mp2-qrow-grip{background:none;border:none;color:rgba(255,255,255,.4);width:30px;min-width:30px;height:46px;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;font-size:13px}" +
      ".mp2-qrow-grip:active{cursor:grabbing}" +
      ".mp2-qrow{display:flex;align-items:center;gap:11px;padding:7px 2px;border-radius:12px}" +
      ".mp2-qrow.is-dragging{opacity:.55;background:rgba(255,255,255,.07)}" +
      ".mp2-qrow.drop-above{box-shadow:inset 0 2px 0 #38bdf8}" +
      ".mp2-qrow.drop-below{box-shadow:inset 0 -2px 0 #38bdf8}" +
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
      ".mp2-ctx-scrim{position:absolute;inset:0;z-index:8;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
      ".mp2-ctx-scrim[hidden]{display:none}" +
      ".mp2-ctx{position:absolute;left:0;right:0;bottom:0;z-index:9;background:#101015;border:1px solid rgba(255,255,255,.09);border-bottom:none;border-radius:22px 22px 0 0;padding:8px 12px max(16px,env(safe-area-inset-bottom));max-height:82vh;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 -18px 60px rgba(0,0,0,.7)}" +
      ".mp2-ctx[hidden]{display:none}" +
      ".mp2-ctx-grab{width:46px;height:4px;border-radius:99px;background:rgba(255,255,255,.28);margin:2px auto 12px}" +
      ".mp2-ctx-title{font-size:19px;font-weight:800;color:#fff;letter-spacing:-.02em;padding:0 10px 12px;border-bottom:1px solid rgba(255,255,255,.09);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mp2-ctx-item{display:flex;align-items:center;gap:16px;width:100%;text-align:left;background:none;border:none;color:rgba(255,255,255,.93);font-size:14px;font-weight:600;font-family:inherit;padding:12px 14px;border-radius:14px;cursor:pointer;position:relative}" +
      ".mp2-ctx-item:active{background:rgba(255,255,255,.1)}" +
      ".mp2-ctx-item > i{width:26px;text-align:center;color:rgba(255,255,255,.72);font-size:17.5px;flex-shrink:0}" +
      ".mp2-ctx-item.is-on > i{color:#fb7185}" +
      ".mp2-ctx-item--emph{background:rgba(255,255,255,.07)}" +
      ".mp2-ctx-item--emph:active{background:rgba(255,255,255,.11)}" +
      ".mp2-ctx-check{color:#a78bfa !important}" +
      ".mp2-ctx-chev{position:absolute;right:14px;color:rgba(255,255,255,.4);font-size:12px}" +
      ".mp2-ctx-sub{display:block;font-size:11px;font-weight:400;color:rgba(255,255,255,.45);margin-top:2px}" +
      ".mp2-ctx-era{background:none;border:none;margin:0}" +
      ".mp2-ctx-era > span{display:block}" +
      ".mp2-ctx-era b{display:block;font-size:14px;font-weight:600;color:#fff}" +
      ".mp2-ctx-div{height:1px;background:rgba(255,255,255,.1);margin:6px 10px}" +
      ".mp2-ctx-brand{display:block;width:max-content;margin:12px auto 2px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.75);font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;border-radius:999px;padding:8px 22px}" +

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
      ".mp2-signin{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:10px;text-align:center;padding:28px 24px}" +
      ".mp2-signin-ic{width:62px;height:62px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(255,255,255,.35)}" +
      ".mp2-signin-t{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.01em}" +
      ".mp2-signin-s{font-size:12px;line-height:1.6;color:rgba(255,255,255,.5);max-width:250px}" +
      ".mp2-signin-btn{margin-top:6px;display:inline-flex;align-items:center;gap:9px;background:#fff;color:#161016;border:none;border-radius:999px;padding:12px 26px;font-size:13px;font-weight:800;font-family:inherit;cursor:pointer;text-decoration:none}" +
      ".mp2-signin-btn:active{transform:scale(.96)}" +
      ".mp2-nocomments{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:38px 22px}" +
      ".mp2-nocomments i{font-size:30px;color:rgba(255,255,255,.28)}" +
      ".mp2-nocomments b{font-size:15px;color:#fff}" +
      ".mp2-nocomments span{font-size:11px;color:rgba(255,255,255,.45);max-width:230px;line-height:1.6}" +
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
      ".mp2-fill{position:absolute;left:0;top:50%;height:4px;transform:translateY(-50%);border-radius:99px;background:#38bdf8;width:0%}" +
      ".mp2-knob{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);left:0%}" +
      ".mp2-scrub:focus-visible{outline:2px solid #38bdf8;outline-offset:3px;border-radius:8px}" +
      ".mp2-times{position:relative;z-index:1;display:flex;justify-content:space-between;padding:0 22px;font-size:10px;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums}" +
      ".mp2-markers{width:100%;margin-top:2px}" +

      /* transport */
      ".mp2-transport{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 0 2px}" +
      ".mp2-tbtn{background:none;border:none;color:rgba(255,255,255,.65);width:48px;height:48px;min-width:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px}" +
      ".mp2-tbtn:active{background:rgba(255,255,255,.08)}" +
      ".mp2-tbtn.on{color:#7dd3fc}" +
      ".mp2-play{width:64px;height:64px;min-width:64px;border-radius:50%;background:#fff;color:#120c07;font-size:21px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer}" +
      ".mp2-play:active{transform:scale(.94)}" +

      /* bottom bar — the two view tabs, pinned to the corners */
      ".mp2-bottom{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:2px 14px max(12px,env(safe-area-inset-bottom))}" +
      ".mp2-vbtn{position:relative;background:none;border:none;color:rgba(255,255,255,.55);width:56px;height:52px;min-width:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:19px}" +
      ".mp2-vbtn:active{background:rgba(255,255,255,.08)}" +
      ".mp2-vbtn.on{color:#fff;background:rgba(255,255,255,.13)}" +
      ".mp2-vbtn.on::after{content:'';position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#38bdf8}";
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
      box.innerHTML = '<div class="mp2-nocomments"><i class="fas fa-compact-disc" aria-hidden="true"></i><b>Nothing playing yet</b><span>Press play and the thread for that song opens here.</span></div>';
      return;
    }
    if (!signedIn()) {
      /* Signed out: no dead comments list, a real call to action instead. */
      box.innerHTML =
        '<div class="mp2-signin">' +
          '<div class="mp2-signin-ic"><i class="far fa-comment-dots" aria-hidden="true"></i></div>' +
          '<p class="mp2-signin-t">Sign in to join the conversation</p>' +
          '<p class="mp2-signin-s">Every comment on the vault is from a signed-in member. Sign in to read along and add your own at any moment of the song.</p>' +
          '<button type="button" class="mp2-signin-btn" data-mp="comments-signin"><i class="fas fa-right-to-bracket" aria-hidden="true"></i>Sign in to comment</button>' +
        '</div>';
      return;
    }
    if (window.SongComments && typeof window.SongComments.renderThreadInto === "function") {
      window.SongComments.renderThreadInto(box, title);
      /* If the thread came back empty, show a designed empty state instead of bare text. */
      setTimeout(function () {
        try {
          if (!box.querySelector(".song-comment-row, .scc-row, [class*='comment'][class*='row']") && /No comments yet/i.test(box.textContent || "")) {
            box.innerHTML =
              '<div class="mp2-nocomments">' +
                '<i class="far fa-comment-dots" aria-hidden="true"></i>' +
                '<b>No comments yet</b>' +
                '<span>Be the first — drop a comment at the exact moment that hits, like a real one.</span>' +
              '</div>';
          }
        } catch (e) {}
      }, 350);
    } else {
      box.innerHTML = '<div class="mp2-nocomments"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><b>Comments unavailable</b><span>The comments could not be loaded. Check your connection and try again.</span></div>';
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
    var wholeSong = momentMode === "song";
    var atTarget = wholeSong ? 0 : (commentsTarget ? 0 : (au && isFinite(au.currentTime) ? Math.max(0, Math.round(au.currentTime)) : 0));
    var atLabel = wholeSong ? "" : fmt(atTarget);
    if (note) note.textContent = "";

    fetch("/api/song-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ track: title, body: text, parentId: 0, atSeconds: atTarget, atLabel: atLabel }),
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

  var lastPlaceholder = "", lastNote = "", lastAvatar = "", lastPostAt = "";
  function paintComposeState(ov) {
    var can = signedIn();
    var compose = q(ov, ".mp2-compose");
    var moment = q(ov, ".mp2-moment-row");
    if (compose) compose.style.display = can ? "" : "none";
    if (moment) moment.style.display = can ? "" : "none";
    var input = q(ov, "[data-mp='comment-input']");
    var send = q(ov, "[data-mp='comment-send']");
    var note = q(ov, "[data-mp='comments-note']");
    if (note) note.style.display = can ? "" : "none";
    var au = audioEl();
    var at = (au && isFinite(au.currentTime)) ? Math.max(0, Math.round(au.currentTime)) : 0;
    var wholeSong = momentMode === "song";
    if (input) {
      input.disabled = !can;
      var ph = !can ? "Sign in to comment"
        : wholeSong ? "Comment on the song"
        : "Comment at " + fmt(at);
      if (ph !== lastPlaceholder) { lastPlaceholder = ph; input.placeholder = ph; }
    }
    if (send) send.disabled = !can;
    if (note) {
      var msg = can ? "" : "Sign in to comment on this song.";
      if (msg !== lastNote) { lastNote = msg; if (!can || note.textContent) note.textContent = msg; }
    }
    var postAt = q(ov, "[data-mp='post-at']");
    if (postAt) {
      var label = wholeSong ? "Post" : "Post at " + fmt(at);
      if (label !== lastPostAt) { lastPostAt = label; postAt.textContent = label; }
      postAt.classList.toggle("is-on", !wholeSong);
      postAt.setAttribute("aria-pressed", !wholeSong ? "true" : "false");
    }
    qa(ov, "[data-mp='moment-moment'],[data-mp='moment-song']").forEach(function (btn) {
      var on = (btn.getAttribute("data-mp") === "moment-moment") === !wholeSong;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
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

  var lastQueueSig = null;
  function paintQueuePage(ov, force) {
    if (queueDragActive) return; /* don't rebuild the rows out from under a drag */
    var page = q(ov, "[data-view='queue']");
    if (!page) return;
    /* rebuild only when something actually changed — the 1s sync must not
       re-create the rows under someone's finger */
    var sig = "";
    try {
      if (typeof trackQueue !== "undefined" && trackQueue) sig += trackQueue.join(",");
    } catch (e) {}
    sig += "|" + currentTitle();
    sig += "|" + sessionHistory.length;
    if (!force && sig === lastQueueSig) return;
    lastQueueSig = sig;

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
            row.setAttribute("data-qi", String(qi));
            var qcover = qt && qt.cover ? coverOfTrack(qt) : "Juice-WRLD.png";
            row.innerHTML =
              '<button type="button" class="mp2-qrow-grip" data-mp="qp-grip-' + qi + '" tabindex="-1" aria-label="Drag to reorder"><i class="fas fa-grip-vertical" aria-hidden="true"></i></button>' +
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

  /* The queue is an inline view (like comments), not an overlay page:
     data-view="queue" shares the persistent mini row, scrubber, transport and
     the corner tabs. */

  /* ------------------------------------------------------------------ */
  /* the playlists page                                                 */
  /* the playlists the reader made - browse, play, queue                */
  /* ------------------------------------------------------------------ */
  var playlistsOpen = false;
  var plState = { list: null, current: null };

  function plCatalogueIndex(title) {
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      var low = String(title || "").trim().toLowerCase();
      for (var i = 0; i < trackList.length; i++) {
        if (String((trackList[i] || {}).title || "").trim().toLowerCase() === low) return i;
      }
    } catch (e) {}
    return -1;
  }
  function plMatchedIdxs(pl) {
    var out = [];
    var tracks = (pl && pl.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var ix = plCatalogueIndex(tracks[i].title);
      if (ix >= 0) out.push(ix);
    }
    return out;
  }

  function paintPlView(ov, view) {
    var listView = q(ov, "[data-mp='pl-list-view']");
    var detailView = q(ov, "[data-mp='pl-detail-view']");
    if (listView) listView.hidden = view !== "list";
    if (detailView) detailView.hidden = view !== "detail";
    var titleEl = q(ov, "[data-mp='pl-title']");
    if (titleEl) titleEl.textContent = view === "detail" && plState.current ? (plState.current.name || "Playlist") : "Playlists";
  }

  function renderPlList(ov) {
    var box = q(ov, "[data-mp='pl-list']");
    if (!box) return;
    plState.current = null;
    paintPlView(ov, "list");
    box.innerHTML = '<div class="mp2-plp-empty"><i class="fas fa-compact-disc"></i>Loading your playlists…</div>';

    fetch("/api/playlists", { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) return { status: 401, d: null };
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
      })
      .then(function (res) {
        if (!document.getElementById(OV)) return;
        box.textContent = "";
        if (res.status === 401) {
          box.innerHTML = '<div class="mp2-plp-empty"><i class="fas fa-user"></i><b>Sign in to see your playlists</b><br>The playlists you make live on your account.<br><a href="/login">Sign in</a></div>';
          return;
        }
        var list = (res.d && Array.isArray(res.d.playlists)) ? res.d.playlists : [];
        plState.list = list;
        if (!list.length) {
          box.innerHTML = '<div class="mp2-plp-empty"><i class="fas fa-compact-disc"></i><b>No playlists yet</b><br>Make one in your profile, or hit the + on any song to save it.</div>';
          return;
        }
        list.forEach(function (pl) {
          var count = Number(pl.count) || (pl.tracks || []).length || 0;
          var vis = pl.visibility === "public" ? "Public" : pl.visibility === "unlisted" ? "Unlisted" : "Private";
          var b = document.createElement("button");
          b.type = "button";
          b.className = "mp2-plp-card";
          b.innerHTML =
            '<span class="mp2-plp-dot" style="background:' + esc(pl.color || "#a855f7") + '"></span>' +
            '<span class="mp2-plp-card-meta">' +
              '<span class="mp2-plp-name">' + esc(pl.name || "Playlist") + '</span><br>' +
              '<span class="mp2-plp-sub">' + count + (count === 1 ? " song" : " songs") + " · " + esc(vis) + "</span>" +
            "</span>" +
            '<i class="fas fa-chevron-right" style="color:rgba(255,255,255,.35)" aria-hidden="true"></i>';
          b.addEventListener("click", function () { renderPlDetail(ov, pl); });
          box.appendChild(b);
        });
      })
      .catch(function () {
        if (!document.getElementById(OV)) return;
        box.innerHTML = '<div class="mp2-plp-empty"><i class="fas fa-triangle-exclamation"></i>The playlists could not be loaded.<br>Check your connection and try again.</div>';
      });
  }

  function renderPlDetail(ov, pl) {
    plState.current = pl;
    var nameEl = q(ov, "[data-mp='pl-dname']");
    var subEl = q(ov, "[data-mp='pl-dsub']");
    if (nameEl) nameEl.textContent = pl.name || "Playlist";
    var tracks = (pl && pl.tracks) || [];
    var vis = pl.visibility === "public" ? "Public" : pl.visibility === "unlisted" ? "Unlisted" : "Private";
    var count = tracks.length;
    if (subEl) subEl.textContent = count + (count === 1 ? " song" : " songs") + " · " + vis;

    var wrap = q(ov, "[data-mp='pl-tracks']");
    if (wrap) {
      wrap.textContent = "";
      if (!tracks.length) {
        wrap.innerHTML = '<div class="mp2-plp-empty"><i class="fas fa-compact-disc"></i><b>Nothing in here yet</b><br>Add songs from the player or any song page with the + button.</div>';
      } else {
        tracks.forEach(function (tr) {
          var row = document.createElement("div");
          row.className = "mp2-qrow";
          var title = String(tr.title || "");
          var idx = plCatalogueIndex(title);
          var t = null;
          try { if (idx >= 0 && typeof trackList !== "undefined" && trackList) t = trackList[idx]; } catch (e) {}
          var cover = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
          row.innerHTML =
            '<img decoding="async" class="mp2-qrow-cover" loading="lazy" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'" src="' + esc(coverThumb(cover, "64")) + '">' +
            '<div class="mp2-qrow-meta">' +
              '<p class="mp2-qrow-title">' + esc(title || "Untitled") + '</p>' +
              '<p class="mp2-qrow-sub">' + (t ? esc(eraNameOf(t) + (catLabel(t) ? " · " + catLabel(t) : "")) : "Not in the vault") + "</p></div>" +
            '<div class="mp2-qrow-right">' +
              '<span class="mp2-qrow-duration">' + (t ? esc(fmt(Number(t.duration) || 0)) : "") + '</span>' +
              '<button type="button" class="mp2-qrow-x" data-rm aria-label="Remove from this playlist"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
            "</div>";
          row.querySelector(".mp2-qrow-meta").addEventListener("click", function () {
            if (idx < 0) { toast("This song is not in the vault yet", "info"); return; }
            try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (e) {}
            closePlaylistsPage(ov);
          });
          row.querySelector("[data-rm]").addEventListener("click", function () {
            fetch("/api/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "remove", id: pl.id, track_id: tr.id }),
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (d) {
                if (d && d.ok && d.playlist) {
                  toast("Removed from the playlist", "info");
                  renderPlDetail(ov, d.playlist);
                } else {
                  toast((d && (d.error || d.message)) || "Could not remove that song", "error");
                }
              })
              .catch(function () { toast("Could not remove that song", "error"); });
          });
          wrap.appendChild(row);
        });
      }
    }
    paintPlView(ov, "detail");
  }

  function openPlaylistsPage(ov) {
    playlistsOpen = true;
    var page = q(ov, "[data-mp='playlistpage']");
    if (page) page.hidden = false;
    var vbtn = q(ov, "[data-mp='view-playlists']");
    if (vbtn) { vbtn.classList.add("on"); vbtn.setAttribute("aria-pressed", "true"); }
    renderPlList(ov);
  }
  function closePlaylistsPage(ov) {
    playlistsOpen = false;
    var page = q(ov, "[data-mp='playlistpage']");
    if (page) page.hidden = true;
    var vbtn = q(ov, "[data-mp='view-playlists']");
    if (vbtn) { vbtn.classList.remove("on"); vbtn.setAttribute("aria-pressed", "false"); }
    plState.current = null;
    paintPlView(ov, "list");
  }
  function togglePlaylistsPage(ov) {
    if (playlistsOpen) closePlaylistsPage(ov); else openPlaylistsPage(ov);
  }

  /* ------------------------------------------------------------------ */
  /* the search pill                                                     */
  /* ------------------------------------------------------------------ */
  function mpSearchMatches(query) {
    var out = [];
    try {
      if (typeof trackList === "undefined" || !trackList) return out;
      var needle = String(query || "").toLowerCase();
      for (var i = 0; i < trackList.length; i++) {
        var t = trackList[i];
        var title = String((t && t.title) || "").toLowerCase();
        var tag = String((t && t.tag) || "").toLowerCase();
        if (title.indexOf(needle) >= 0 || tag.indexOf(needle) >= 0) out.push(i);
        if (out.length >= 9) break;
      }
    } catch (e) {}
    return out;
  }
  function renderMpSearch(ov) {
    var input = q(ov, "[data-mp='search']");
    var box = q(ov, "[data-mp-search-results]");
    var clear = q(ov, "[data-mp-search-clear]");
    if (!input || !box) return;
    var query = String(input.value || "").trim();
    if (clear) clear.classList.toggle("is-shown", !!query);
    if (!query) { box.hidden = true; box.textContent = ""; return; }
    var matches = mpSearchMatches(query);
    box.textContent = "";
    if (!matches.length) {
      box.innerHTML = '<p class="mp2-srow-empty">Nothing in the vault matches “' + esc(query) + '”.</p>';
      box.hidden = false;
      return;
    }
    var addAll = document.createElement("button");
    addAll.type = "button";
    addAll.className = "mp2-search-addall";
    addAll.setAttribute("data-mp", "search-add-all");
    addAll.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i><span>Add all ' + matches.length + ' to the queue</span>';
    box.appendChild(addAll);
    matches.forEach(function (idx) {
      var t2 = null;
      try { t2 = (typeof trackList !== "undefined" ? trackList[idx] : null); } catch (e) {}
      var cat = String((t2 || {}).category || "");
      var catLabel2 = cat === "leaks" ? "Leaked" : cat === "sessions" ? "Sessions" : cat === "halloween" ? "Halloween" : "";
      var src = t2 && t2.cover ? String(t2.cover) : "Juice-WRLD.png";
      var thumb = src;
      try { if (window._coverThumb) thumb = window._coverThumb(src, "64"); } catch (e) {}
      var row = document.createElement("div");
      row.className = "mp2-srow";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("data-idx", String(idx));
      row.innerHTML =
        '<img decoding="async" class="mp2-srow-cover" loading="lazy" src="' + esc(thumb) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<span class="mp2-srow-meta"><p class="mp2-srow-title">' + esc((t2 && t2.title) || "Untitled") + '</p>' +
          '<p class="mp2-srow-sub">' + esc(eraNameOf(t2) + (catLabel2 ? " · " + catLabel2 : "")) + '</p></span>' +
        '<span class="mp2-srow-dur">' + esc(fmt((t2 && Number(t2.duration)) || 0)) + '</span>' +
        '<button type="button" class="mp2-srow-add" data-add="' + idx + '" aria-label="Queue ' + esc((t2 && t2.title) || "song") + '"><i class="fas fa-plus" aria-hidden="true"></i></button>';
      row.addEventListener("click", function (e) {
        var addBtn = e.target.closest ? e.target.closest("[data-add]") : null;
        if (addBtn) {
          e.stopPropagation();
          try { if (typeof addToQueue === "function") addToQueue(idx); } catch (err) {}
          toast("Added to the queue", "success");
          addBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
          return;
        }
        try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {}
        input.value = "";
        renderMpSearch(ov);
        input.blur();
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {} input.value = ""; renderMpSearch(ov); input.blur(); }
      });
      box.appendChild(row);
    });
    box.hidden = false;
  }
  function clearMpSearch(ov) {
    var input = q(ov, "[data-mp='search']");
    var box = q(ov, "[data-mp-search-results]");
    var clear = q(ov, "[data-mp-search-clear]");
    if (input) input.value = "";
    if (box) { box.hidden = true; box.textContent = ""; }
    if (clear) clear.classList.remove("is-shown");
    if (input) input.blur();
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

    /* Comments count for the check row — reads the same badge the deck shows */
    try {
      var badge = document.getElementById("song-comments-count");
      var n = badge ? parseInt(String(badge.textContent || "0").replace(/[^0-9]/g, ""), 10) : 0;
      var cntEl = q(ov, "[data-mp='ctx-comments-count']");
      if (cntEl) cntEl.textContent = n > 0 ? n + " on this song" : "No comments yet";
    } catch (e) {}

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

    if (action === "addqueue") {
      /* menuTrack — the song the menu was opened from; null means the one playing */
      var qi2 = menuTrack ? trackIndexOf(menuTrack) : currentIndex();
      if (qi2 >= 0 && typeof addToQueue === "function") {
        addToQueue(qi2);
        toast("Added to the queue", "success");
      }
      closeCtx(ov);
      if (currentView === "queue") paintQueuePage(ov, true);
      return;
    }

    if (action === "myplaylists") {
      closeCtx(ov);
      openPlaylistsPage(ov);
      return;
    }

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

    if (action === "info") { openSongPage(title); return; }

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
      switchView(ov, "comments");
      return;
    }

    if (action === "close") {
      /* Hide the player — and nothing else. The music keeps playing; the
         deck or the bottom bar is still there to bring it back up. */
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
    ov.classList.toggle("view-now", name === "now");
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
    else if (name === "queue") paintQueuePage(ov, true);
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

    qa(ov, "[data-mp='title2']").forEach(function (el) {
      if (el.textContent !== ctTitle) el.textContent = ctTitle;
    });
    qa(ov, "[data-mp='artist2']").forEach(function (el) {
      if (el.textContent !== ctArtist) el.textContent = ctArtist;
    });
    qa(ov, "[data-mp='mini-cover']").forEach(function (img) {
      if (img.getAttribute("src") !== ctCover) img.setAttribute("src", ctCover);
    });

    /* where the listener is playing from — Lobby, Tracker, The Vault… */
    var ctxEl = q(ov, "[data-mp='ctx-label']");
    if (ctxEl) {
      var ctx = "Lobby";
      try { if (window.__thwPlayContext) ctx = String(window.__thwPlayContext); } catch (e) {}
      if (ctxEl.textContent !== ctx) ctxEl.textContent = ctx;
    }

    /* album line under the title — the vault's own tag; CSS cuts it with an ellipsis */
    qa(ov, "[data-mp='album']").forEach(function (el) {
      var albumText = "";
      try {
        if (typeof getTrackAlbum === "function" && t) albumText = String(getTrackAlbum(t) || "");
        else if (currentTrack()) albumText = String((currentTrack() || {}).tag || "");
      } catch (e) {}
      var want = albumText ? albumText : "";
      var prev = el.getAttribute("data-cur") || "";
      if (prev !== want) {
        el.setAttribute("data-cur", want);
        el.innerHTML = want ? '<i class="fas fa-compact-disc" aria-hidden="true"></i><span>' + esc(want) + '</span>' : '';
        el.style.display = want ? "" : "none";
      }
    });

    /* hero */
    qa(ov, "[data-mp='title']").forEach(function (el) { if (el.textContent !== t) el.textContent = t; });
    qa(ov, "[data-mp='artist']").forEach(function (el) { if (el.textContent !== a) el.textContent = a; });
    qa(ov, "[data-mp='cover']").forEach(function (img) {
      if (img.getAttribute("src") !== cover) img.setAttribute("src", cover);
    });
    var track = currentTrack();
    var pill = q(ov, "[data-mp='pill']");
    if (pill) {
      var lbl = versionPillLabel(track);
      var tagEl = pill.querySelector("[data-mp='tag']");
      if (tagEl && tagEl.textContent !== lbl.label) tagEl.textContent = lbl.label;
      var cntEl = pill.querySelector("[data-mp='tag-count']");
      var countTxt = lbl.count > 1 ? lbl.count + " versions" : "1 version";
      if (cntEl && cntEl.textContent !== countTxt) cntEl.textContent = countTxt;
      pill.style.display = track ? "" : "none";
    }
    var chipCat = q(ov, "[data-mp='chip-cat']");
    if (chipCat && track) {
      var cat = String(track.category || "");
      var cmap = { leaks: ["Leaked", "chip-cat-leaks", "fa-fire"], sessions: ["Sessions", "chip-cat-sessions", "fa-compact-disc"], halloween: ["Halloween", "chip-cat-halloween", "fa-compact-disc"] };
      var cm = cmap[cat];
      chipCat.innerHTML = cm ? '<i class="fas ' + cm[2] + '" aria-hidden="true"></i>' + esc(cm[0]) : "";
      chipCat.className = "mp2-chip" + (cm ? " " + cm[1] : "");
      chipCat.style.display = cm ? "" : "none";
    } else if (chipCat) chipCat.style.display = "none";
    var chipEra = q(ov, "[data-mp='chip-era']");
    if (chipEra) {
      var code = eraCodeOf(track);
      chipEra.innerHTML = '<i class="fas fa-compact-disc" aria-hidden="true"></i>' + esc(code);
      chipEra.style.display = code && code !== "Other" ? "" : "none";
    }
    var chipSnip = q(ov, "[data-mp='chip-snippet']");
    if (chipSnip) chipSnip.style.display = /snippet/i.test(String((track && track.tag) || "")) ? "" : "none";
    var favH = favOn();
    qa(ov, "[data-mp='favhero']").forEach(function (el) {
      el.classList.toggle("is-on", favH);
      el.innerHTML = '<i class="' + (favH ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i>';
      el.setAttribute("aria-pressed", favH ? "true" : "false");
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
      if (window.THWCommentMarkers) window.THWCommentMarkers.refresh(ov);
    }
    if (currentView === "queue") paintQueuePage(ov, force);
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

  /* ---- drag to reorder the queue, touch first ---- */
  var queueDragActive = false;
  function bindQueueDrag(ov) {
    var list = ov.querySelector("[data-mp='qp-list']");
    if (!list || list._thwDragWired) return;
    list._thwDragWired = true;
    var drag = null; /* {row, from, overRow, below} */

    function clearMarks() {
      qa(ov, ".mp2-qrow").forEach(function (r) { r.classList.remove("is-dragging", "drop-above", "drop-below"); });
    }
    function rowFromPoint(x, y) {
      try {
        var el = document.elementFromPoint(x, y);
        var row = el && el.closest ? el.closest(".mp2-qrow") : null;
        if (row && list.contains(row)) return row;
      } catch (e) {}
      return null;
    }
    list.addEventListener("pointerdown", function (e) {
      var grip = e.target.closest ? e.target.closest(".mp2-qrow-grip") : null;
      if (!grip) return;
      var row = grip.closest(".mp2-qrow");
      if (!row) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      var qi = Number(row.getAttribute("data-qi"));
      if (!isFinite(qi)) return;
      drag = { row: row, from: qi, overRow: null, below: false };
      queueDragActive = true;
      row.classList.add("is-dragging");
    }, { passive: false });
    list.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (e.cancelable) e.preventDefault();
      var row = rowFromPoint(e.clientX, e.clientY);
      qa(ov, ".mp2-qrow").forEach(function (r) { r.classList.remove("drop-above", "drop-below"); });
      drag.overRow = null;
      if (row && row !== drag.row) {
        var rect = row.getBoundingClientRect();
        var below = (e.clientY - rect.top) > rect.height / 2;
        row.classList.add(below ? "drop-below" : "drop-above");
        drag.overRow = row;
        drag.below = below;
      }
    }, { passive: false });
    function endDrag() {
      if (!drag) return;
      var from = drag.from, targetRow = drag.overRow, below = drag.below;
      drag = null;
      queueDragActive = false;
      clearMarks();
      var to = -1;
      if (targetRow) {
        var ti = Number(targetRow.getAttribute("data-qi")) || 0;
        to = below ? ti + 1 : ti;
        if (ti > from) to -= 1;
      }
      if (to >= 0 && typeof window.moveQueueItemTo === "function") {
        try { window.moveQueueItemTo(from, to); } catch (err2) {}
        paintQueuePage(ov, true);
      }
    }
    list.addEventListener("pointerup", endDrag);
    list.addEventListener("pointercancel", function () {
      drag = null;
      queueDragActive = false;
      clearMarks();
    });
  }

  /* ---- swipe down to dismiss ---- */
  function bindSwipeDown(ov) {
    var startY = null, startT = 0, moved = false;
    ov.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse") return;
      if (ev.target.closest && ev.target.closest(".mp2-compose, .mp2-qp-body, .mp2-comments, .mp2-ctx, .mp2-pl, .mp2-plp, input, button, .mp2-scrub")) return;
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
    playlistsOpen = false;
    plState = { list: null, current: null };
    commentsTarget = null;
    menuTrack = null;

    var ov = document.createElement("div");
    ov.className = "mp2";
    ov.id = OV;
    ov.setAttribute("data-markers-root", "");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Now playing");
    ov.classList.add("view-now");

    var t = currentTitle(), a = currentArtist(), cover = coverOf();

    ov.innerHTML =
      '<div class="mp2-bg" aria-hidden="true"></div>' +
      '<div class="mp2-vignette" aria-hidden="true"></div>' +
      '<div class="mp2-grab" aria-hidden="true"></div>' +

      '<header class="mp2-top">' +
        '<button type="button" class="mp2-x" data-mp-close aria-label="Close the player"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
        '<span class="mp2-context">Playing from <b data-mp="ctx-label">Lobby</b></span>' +
        '<button type="button" class="mp2-more" data-mp-more aria-label="More options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
      '</header>' +

      '<div class="mp2-body">' +

        '<section class="mp2-view is-active" data-view="now">' +
          '<div class="mp2-hero">' +
            '<img decoding="async" class="mp2-cover" data-mp="cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
            '<h2 class="mp2-title" data-mp="title">' + esc(t) + '</h2>' +
            '<p class="mp2-album" data-mp="album"></p>' +
            '<p class="mp2-artist" data-mp="artist">' + esc(a) + '</p>' +
            '<button type="button" class="mp2-pill" data-mp="pill" title="Open the song page — every version lives there"><span data-mp="tag">Session edit</span><small data-mp="tag-count"></small><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
            '<div class="mp2-chiprow">' +
              '<span class="mp2-chip chip-cat-sessions" data-mp="chip-cat"></span>' +
              '<span class="mp2-chip chip-era" data-mp="chip-era"></span>' +
              '<span class="mp2-chip chip-snippet" data-mp="chip-snippet" style="display:none">Snippet</span>' +
              '<div class="mp2-chip-actions">' +
                '<button type="button" class="mp2-chipact" data-mp="favhero" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
                '<button type="button" class="mp2-chipact" data-mp="addqueuehero" aria-label="Add to the queue"><i class="fas fa-list-ul" aria-hidden="true"></i></button>' +
                '<button type="button" class="mp2-chipact" data-mp="opensong" aria-label="Open the song page"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="mp2-view" data-view="queue">' +
          '<div class="mp2-qp-body">' +
            '<div class="mp2-search">' +
              '<i class="fas fa-magnifying-glass mp2-search-ic" aria-hidden="true"></i>' +
              '<input class="mp2-search-input" data-mp="search" type="text" placeholder="Search the vault…" aria-label="Search the vault" autocomplete="off" spellcheck="false">' +
              '<button type="button" class="mp2-search-clear" data-mp-search-clear aria-label="Clear the search"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
              '<div class="mp2-search-results" data-mp-search-results hidden></div>' +
            '</div>' +
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
        '</section>' +

        '<section class="mp2-view" data-view="comments">' +
          '<div class="mp2-compose">' +
            '<span class="mp2-compose-avatar" data-mp="avatar"></span>' +
            '<input class="mp2-compose-input" data-mp="comment-input" type="text" maxlength="2000" enterkeyhint="send" placeholder="Comment at 0:00" aria-label="Write a comment">' +
            '<button type="button" class="mp2-compose-send" data-mp="comment-send" aria-label="Send the comment"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
          '</div>' +
          '<div class="mp2-moment-row">' +
            '<div class="mp2-moment-toggle" role="group" aria-label="When this comment applies to">' +
              '<button type="button" class="mp2-moment-btn is-on" data-mp="moment-moment">This moment</button>' +
              '<button type="button" class="mp2-moment-btn" data-mp="moment-song">Whole song</button>' +
            '</div>' +
            '<button type="button" class="mp2-post-at is-on" data-mp="post-at">Post at 0:00</button>' +
          '</div>' +
          '<p class="mp2-comments-note" data-mp="comments-note"></p>' +
          '<div class="mp2-comments" data-mp="comments"></div>' +
        '</section>' +

      '</div>' +

      '<div class="mp2-mini">' +
        '<img decoding="async" class="mp2-mini-cover" data-mp="mini-cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<div class="mp2-mini-meta"><p class="mp2-mini-title" data-mp="title2">' + esc(t) + '</p><p class="mp2-mini-artist" data-mp="artist2">' + esc(a) + '</p></div>' +
        '<button type="button" class="mp2-mini-fav" data-mp="fav3" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
      '</div>' +

      '<div class="mp2-scrub" data-mp="prog" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00 of 0:00">' +
        '<div class="mp2-scrub-line"></div><div class="mp2-fill" data-mp="fill"></div><div class="mp2-knob" data-mp="thumb"></div>' +
      '</div>' +
      '<div class="mp2-times"><span data-mp="cur">0:00</span><span data-mp="dur">0:00</span></div>' +
      '<div class="mp2-markers thw-markers" data-thw-markers></div>' +

      '<div class="mp2-transport">' +
        '<button type="button" class="mp2-tbtn" data-mp="shuffle" aria-label="Shuffle" aria-pressed="false"><i class="fas fa-shuffle" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="prev" aria-label="Previous track"><i class="fas fa-backward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-play" data-mp="play" aria-label="Play or pause"><i class="fas fa-play" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="next" aria-label="Next track"><i class="fas fa-forward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-tbtn" data-mp="repeat" aria-label="Repeat" aria-pressed="false"><i class="fas fa-repeat" aria-hidden="true"></i></button>' +
      '</div>' +

      '<nav class="mp2-bottom">' +
        '<button type="button" class="mp2-vbtn" data-mp="view-comments" aria-label="Comments" aria-pressed="false"><i class="far fa-comment" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-vbtn" data-mp="view-queue" aria-label="Queue" aria-pressed="false"><i class="fas fa-bars-staggered" aria-hidden="true"></i></button>' +
      '</nav>' +

      /* ===== the playlists page ===== */
      '<div class="mp2-plp" data-mp="playlistpage" hidden role="dialog" aria-label="Your playlists">' +
        '<header class="mp2-qp-top">' +
          '<h1 class="mp2-qp-title" data-mp="pl-title">Playlists</h1>' +
          '<div class="mp2-qp-icons">' +
            '<button type="button" class="mp2-qp-icon" data-mp="pl-refresh" aria-label="Refresh the playlists"><i class="fas fa-rotate-right" aria-hidden="true"></i></button>' +
            '<button type="button" class="mp2-qp-icon close" data-mp="close-playlists" aria-label="Close playlists"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
          '</div>' +
        '</header>' +
        '<div class="mp2-plp-body">' +
          '<div data-mp="pl-list-view">' +
            '<div data-mp="pl-list"></div>' +
            '<button type="button" class="mp2-plp-newrow" data-mp="pl-new"><i class="fas fa-plus" aria-hidden="true"></i>New playlist<small>opens your profile</small></button>' +
            '<p class="mp2-plp-manage"><a href="#" data-mp="pl-manage">Manage your playlists in your profile</a></p>' +
          '</div>' +
          '<div data-mp="pl-detail-view" hidden>' +
            '<div class="mp2-plp-dhead">' +
              '<button type="button" class="mp2-qp-icon" data-mp="pl-back" aria-label="Back to all playlists"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>' +
              '<div class="mp2-plp-dmeta">' +
                '<p class="mp2-plp-dname" data-mp="pl-dname"></p>' +
                '<p class="mp2-plp-dsub" data-mp="pl-dsub"></p>' +
              '</div>' +
            '</div>' +
            '<div class="mp2-plp-actions">' +
              '<button type="button" class="mp2-plp-btn primary" data-mp="pl-playall"><i class="fas fa-play" aria-hidden="true"></i>Play all</button>' +
              '<button type="button" class="mp2-plp-btn" data-mp="pl-queueall"><i class="fas fa-list-ul" aria-hidden="true"></i>Queue all</button>' +
            '</div>' +
            '<div data-mp="pl-tracks"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ===== the context menu ===== */
      '<div class="mp2-ctx-scrim" data-mp="ctx-scrim" hidden aria-hidden="true"></div>' +
      '<div class="mp2-ctx" data-mp="ctx" hidden role="dialog" aria-modal="true" aria-label="Song options">' +
        '<div class="mp2-ctx-grab" aria-hidden="true"></div>' +
        '<p class="mp2-ctx-title" data-mp="ctx-title">' + esc(t) + '</p>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="like"><i class="far fa-heart" aria-hidden="true"></i><span>Like</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="addqueue"><i class="fas fa-list-ul" aria-hidden="true"></i><span>Add to the queue</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="addplaylist"><i class="fas fa-plus" aria-hidden="true"></i><span>Add to playlist</span><i class="fas fa-chevron-right mp2-ctx-chev" aria-hidden="true"></i></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="myplaylists"><i class="fas fa-compact-disc" aria-hidden="true"></i><span>My playlists<span class="mp2-ctx-sub">Play or queue what you saved</span></span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="cover"><i class="fas fa-image" aria-hidden="true"></i><span>Change cover<span class="mp2-ctx-sub">Only you see it</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="share"><i class="fas fa-share-nodes" aria-hidden="true"></i><span>Share</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="song"><i class="fas fa-music" aria-hidden="true"></i><span>Go to song</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="versions"><i class="fas fa-code-branch" aria-hidden="true"></i><span>Other versions</span></button>' +
        '<button type="button" class="mp2-ctx-item mp2-ctx-era" data-ctx="era"><i class="fas fa-layer-group" aria-hidden="true"></i><span><b>Go to era</b><span class="mp2-ctx-sub" data-mp="ctx-era-sub">Other</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item mp2-ctx-item--emph" data-ctx="edit"><i class="fas fa-pen-to-square" aria-hidden="true"></i><span>Edit this song<span class="mp2-ctx-sub">Fix credits, dates or details</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="info"><i class="fas fa-user-group" aria-hidden="true"></i><span>Credits</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="openqueue"><i class="fas fa-list-ul" aria-hidden="true"></i><span>Open queue</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="eq"><i class="fas fa-sliders" aria-hidden="true"></i><span>Equalizer and reverb</span></button>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="settings"><i class="fas fa-gear" aria-hidden="true"></i><span>Playback settings</span></button>' +
        '<button type="button" class="mp2-ctx-item mp2-ctx-item--emph" data-ctx="comments"><i class="fas fa-check mp2-ctx-check" aria-hidden="true"></i><span>Show comments<span class="mp2-ctx-sub" data-mp="ctx-comments-count">No comments yet</span></span></button>' +
        '<div class="mp2-ctx-div"></div>' +
        '<button type="button" class="mp2-ctx-item" data-ctx="close"><i class="fas fa-xmark" aria-hidden="true"></i><span>Close player<span class="mp2-ctx-sub">Hides the player — the music keeps playing</span></span></button>' +
        '<span class="mp2-ctx-brand" aria-hidden="true">TheHighWRLD</span>' +
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

      if (target && target.tagName === "A") e.preventDefault();
      var ctxScrim = target.closest ? target.closest("[data-mp='ctx-scrim']") : null;
      var searchClearBtn = target.closest ? target.closest("[data-mp-search-clear]") : null;
      var searchAddAllBtn = target.closest ? target.closest("[data-mp='search-add-all']") : null;
      if (searchAddAllBtn) {
        var in2 = q(ov, "[data-mp='search']");
        var matches2 = mpSearchMatches(in2 ? in2.value : "");
        if (window.queueBulkStart) window.queueBulkStart();
        try {
          for (var i = 0; i < matches2.length; i++) { if (typeof addToQueue === "function") addToQueue(matches2[i]); }
        } finally { if (window.queueBulkEnd) window.queueBulkEnd(); }
        toast("Added " + matches2.length + " songs to the queue", "success");
        if (in2) { in2.value = ""; renderMpSearch(ov); }
        return;
      }
      if (searchClearBtn) { clearMpSearch(ov); return; }
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
        } else if (action === "vault-pull") {
          if (window.vaultPull) window.vaultPull();
        } else if (action === "favhero") {
          toggleFav();
        } else if (action === "addqueuehero") {
          var ci2 = currentIndex();
          if (ci2 >= 0 && typeof addToQueue === "function") { addToQueue(ci2); toast("Added to the queue", "success"); }
        } else if (action === "opensong") {
          var tt3 = currentTitle();
          if (window.openSongPage) { window.openSongPage(tt3); close(); }
        } else if (action === "view-comments") {
          toggleView(ov, "comments");
        } else if (action === "view-queue") {
          toggleView(ov, "queue");
        } else if (action === "view-playlists") {
          togglePlaylistsPage(ov);
        } else if (action === "close-playlists") {
          closePlaylistsPage(ov);
        } else if (action === "pl-refresh") {
          renderPlList(ov);
        } else if (action === "pl-back") {
          plState.current = null;
          paintPlView(ov, "list");
        } else if (action === "pl-playall") {
          var idxsAll = plMatchedIdxs(plState.current);
          if (idxsAll.length) {
            try { if (window.selectTrackFromList) window.selectTrackFromList(idxsAll[0]); } catch (e) {}
            closePlaylistsPage(ov);
          } else {
            toast("Nothing in the vault from this playlist", "info");
          }
        } else if (action === "pl-queueall") {
          var idxsQ = plMatchedIdxs(plState.current);
          if (!idxsQ.length) { toast("Nothing in the vault from this playlist", "info"); return; }
          var added = 0;
          if (window.queueBulkStart) window.queueBulkStart();
          try {
            for (var qi2 = 0; qi2 < idxsQ.length; qi2++) { if (typeof addToQueue === "function") { addToQueue(idxsQ[qi2]); added++; } }
          } finally { if (window.queueBulkEnd) window.queueBulkEnd(); }
          toast("Queued " + added + (added === 1 ? " track" : " tracks"), "success");
        } else if (action === "pl-manage") {
          closePlaylistsPage(ov);
          close();
          if (window.viewMyProfile) window.viewMyProfile();
          else if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
        } else if (action === "qp-clear-queue") {
          try { if (typeof clearQueue === "function") clearQueue(); } catch (e) {}
          paintQueuePage(ov, true);
        } else if (action === "qp-clear-history") {
          clearSessionHistory();
          paintQueuePage(ov, true);
        } else if (action === "pill") {
          openSongPage(currentTitle());
        } else if (action === "comment-send" || action === "post-at") {
          postComment(ov);
        } else if (action === "moment-moment") {
          momentMode = "moment";
          paintComposeState(ov);
        } else if (action === "moment-song") {
          momentMode = "song";
          paintComposeState(ov);
        } else if (action === "comments-signin") {
          close();
          if (typeof window.switchAppPage === "function") window.switchAppPage("login");
          return;
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

    /* the search pill */
    var sInput = ov.querySelector("[data-mp='search']");
    if (sInput) {
      sInput.addEventListener("input", function () { renderMpSearch(ov); });
      sInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); clearMpSearch(ov); return; }
        if (e.key === "Enter") {
          var matches = mpSearchMatches(sInput.value);
          if (matches.length) {
            e.preventDefault();
            try { if (window.selectTrackFromList) window.selectTrackFromList(matches[0]); } catch (err) {}
            sInput.value = "";
            renderMpSearch(ov);
            sInput.blur();
          }
        }
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
    bindQueueDrag(ov);

    document.body.appendChild(ov);
    stopSync();
    syncIv = setInterval(sync, 1000);
    sync(true);
    if (window.THWCommentMarkers) window.THWCommentMarkers.refresh(ov);

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
    return origin + "/songs/" + songPageSlugOf(title);
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
        close();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
