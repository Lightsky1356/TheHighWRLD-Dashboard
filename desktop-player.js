/* Desktop player — the full-screen music sheet
 *
 * The phone has its full-screen sheet, and the desktop gets the same
 * treatment, sized for a monitor:
 *
 *   left  the cover, the song, the favourite / add-to-queue / song-page
 *         actions, the chips, the progress bar and the transport /
 *         volume, on a warm background painted from this cover.
 *   right the tabbed panel — Up next / Comments / Credits — the same
 *         three tabs the desktop panel carries, here as a page of its
 *         own instead of a side panel.
 *
 * Opens with the deck's expand button or the O key. Escape closes. The
 * mobile sheet hides it all on phones, where the sheet rules.
 */
(function () {
  "use strict";
  if (window.__desktopPlayerMounted) return;
  window.__desktopPlayerMounted = true;

  var OV = "dplayer-ov";
  var syncIv = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function audioEl() { try { return document.querySelector("audio"); } catch (e) { return null; } }
  function currentIndex() { try { if (typeof currentTrackIndex === "number") return currentTrackIndex; } catch (e) {} return -1; }
  function currentTrack() {
    var i = currentIndex();
    try { if (i >= 0 && typeof trackList !== "undefined" && trackList[i]) return trackList[i]; } catch (e) {}
    return null;
  }
  function currentTitle() {
    var t = currentTrack();
    if (t && t.title) return String(t.title);
    var el = document.getElementById("deck-title") || document.getElementById("track-title");
    return el ? String(el.textContent || "").trim() : "Nothing playing";
  }
  function currentArtist() {
    var t = currentTrack();
    if (t && t.artist) return String(t.artist);
    var el = document.getElementById("deck-artist");
    return el ? String(el.textContent || "").trim() : "Juice WRLD";
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function coverThumb(src, tier) {
    try { if (window._coverThumb) { var t = window._coverThumb(src || "Juice-WRLD.png", tier || "320"); if (t) return t; } } catch (e) {}
    return src || "Juice-WRLD.png";
  }
  function toast(text, kind) {
    try { if (typeof showToast === "function") { showToast(text, kind || "info", 2200); return; } } catch (e) {}
    try { if (window.showToastSimple) window.showToastSimple(text, kind || "info", 2200); } catch (e) {}
  }
  function playing() {
    try { if (typeof isPlaying !== "undefined") return !!isPlaying; } catch (e) {}
    var au = audioEl();
    return !!(au && !au.paused);
  }

  /* ---- the background, painted from this cover's accent ---- */
  var lastBg = null;
  function toAlpha(color, a) {
    var c = String(color || "").trim();
    var m = c.match(/^hsl\(([^)]+)\)$/i);
    if (m) return "hsla(" + m[1] + "," + a + ")";
    m = c.match(/^rgb\(([^)]+)\)$/i);
    if (m) return "rgba(" + m[1] + "," + a + ")";
    return c;
  }
  function paintBackground(ov) {
    var t = currentTrack();
    var cover = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
    if (cover === lastBg) return;
    lastBg = cover;
    var gradient = null;
    try { if (typeof getCoverGradientValue === "function") gradient = getCoverGradientValue(cover); } catch (e) {}
    var cols = gradient ? (gradient.match(/hsl\([^)]+\)|rgb\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || []) : [];
    var c1 = cols[0] || "hsl(266,60%,58%)";
    var c2 = cols[1] || "hsl(20,72%,30%)";
    var bg = ov.querySelector(".dpl-bg");
    if (!bg) return;
    bg.style.background =
      "radial-gradient(130% 70% at 28% 45%, " + toAlpha(c1, 0.7) + " 0%, transparent 60%)," +
      "radial-gradient(100% 60% at 78% 15%, " + toAlpha(c2, 0.38) + " 0%, transparent 55%)," +
      "radial-gradient(80% 55% at 10% 15%, " + toAlpha(c2, 0.28) + " 0%, transparent 55%)," +
      "linear-gradient(180deg,#17120f 0%,#100d0b 55%,#0b0908 100%)";
  }

  /* ---- chips: the same ones the mobile sheet shows ---- */
  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;
  var ERA_NAME = {
    "GB&GR": "Goodbye & Good Riddance", "WOD": "WRLD ON DRUGS", "DRFL": "Death Race For Love",
    "JW3": "Legends Never Die", "POST": "Posthumous", "OUT": "Outsiders", "AF": "Afflictions",
    "ND": "Nothing's Different", "BDM": "BINGEDRINKINGMUSIC", "SOUNDCLOUD": "SoundCloud",
  };
  var ERA_SLUG = {
    "GB&GR": "gbgr", "WOD": "wod", "DRFL": "drfl", "JW3": "jw3", "POST": "post",
    "OUT": "out", "AF": "af", "ND": "nd", "BDM": "bdm", "SOUNDCLOUD": "soundcloud",
  };
  function eraCode(t) {
    try { var m = String((t || {}).tag || "").match(ERA_RE); if (m) return m[1].toUpperCase(); } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }
  function eraName(t) { return ERA_NAME[eraCode(t)] || "Other"; }
  function eraSlug(t) { return ERA_SLUG[eraCode(t)] || "gbgr"; }
  function catLabel(t) {
    var c = String((t || {}).category || "");
    return c === "leaks" ? "Leaked" : c === "sessions" ? "Session" : c === "halloween" ? "Halloween" : "";
  }
  function versionCount(t) {
    try {
      if (typeof trackList === "undefined" || !trackList) return 1;
      var base = String((t && t.title) || "").split("(")[0].trim().toLowerCase();
      var n = 0;
      for (var i = 0; i < trackList.length; i++) {
        if (String((trackList[i] || {}).title || "").split("(")[0].trim().toLowerCase() === base) n++;
      }
      return Math.max(1, n);
    } catch (e) { return 1; }
  }

  /* ===================================================================
     the stylesheet — the desktop sheet is drawn here, in one place
     =================================================================== */
  function css() {
    if (document.getElementById("dplayer-style")) return;
    var st = document.createElement("style");
    st.id = "dplayer-style";
    st.textContent =
      ".dpl-ov{position:fixed;inset:0;z-index:10500;display:flex;background:#0e0c0a;color:#fff;font-family:inherit;overflow:hidden}" +
      ".dpl-ov[hidden]{display:none}" +
      ".dpl-bg{position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,#17120f,#100d0b);transition:background .6s ease}" +
      ".dpl-vignette{position:absolute;inset:0;z-index:0;background:radial-gradient(130% 90% at 30% 60%,transparent 40%,rgba(4,3,2,.55) 100%);pointer-events:none}" +

      /* top bar */
      ".dpl-top{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:18px 26px 0;min-height:56px}" +
      ".dpl-context{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:700}" +
      ".dpl-more{background:none;border:none;color:rgba(255,255,255,.6);width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer}" +
      ".dpl-more:hover{background:rgba(255,255,255,.07);color:#fff}" +
      ".dpl-close{background:none;border:none;color:rgba(255,255,255,.6);width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer}" +
      ".dpl-close:hover{background:rgba(255,255,255,.07);color:#fff}" +

      /* the two columns */
      ".dpl-body{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(420px,680px);gap:36px;min-height:0;height:100%;padding:6px 36px 30px}" +

      /* left */
      ".dpl-left{display:flex;flex-direction:column;align-items:center;min-height:0;min-width:0;justify-content:center;overflow-y:auto;overscroll-behavior:contain;padding:10px 6px}" +
      ".dpl-cover{width:min(56%,520px);aspect-ratio:1/1;object-fit:cover;border-radius:18px;background:#1c1530;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 .5px rgba(255,255,255,.06) inset}" +
      ".dpl-title{margin:22px 0 0;font-size:clamp(24px,2.4vw,32px);line-height:1.1;font-weight:900;letter-spacing:-.02em;text-align:center;max-width:100%}" +
      ".dpl-artist{margin:8px 0 0;font-size:19px;font-weight:700;color:rgba(255,255,255,.75);text-align:center}" +

      ".dpl-actions{display:flex;align-items:center;gap:16px;margin-top:16px}" +
      ".dpl-act{background:none;border:none;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.65);font-size:18px;cursor:pointer;border:1px solid rgba(255,255,255,.1)}" +
      ".dpl-act:hover{background:rgba(255,255,255,.07);color:#fff}" +
      ".dpl-act.is-on{color:#fb7185;border-color:rgba(251,113,133,.3)}" +
      ".dpl-act.primary{width:52px;height:52px;background:rgba(255,255,255,.07)}" +

      ".dpl-chips{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;justify-content:center}" +
      ".dpl-chip{font-size:10.5px;font-weight:700;letter-spacing:.03em;border-radius:8px;padding:4px 11px}" +
      ".chip-leaked{background:rgba(251,191,36,.13);color:#fcd34d;border:1px solid rgba(251,191,36,.28)}" +
      ".chip-sessions{background:rgba(34,211,238,.12);color:#67e8f9;border:1px solid rgba(34,211,238,.25)}" +
      ".chip-halloween{background:rgba(192,132,252,.13);color:#d8b4fe;border:1px solid rgba(192,132,252,.3)}" +
      ".chip-era{background:rgba(255,255,255,.07);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.09)}" +
      ".chip-year{background:rgba(255,255,255,.08);color:rgba(255,255,255,.7)}" +

      ".dpl-prog{display:flex;align-items:center;gap:12px;width:min(640px,100%);margin-top:22px}" +
      ".dpl-prog-bar{position:relative;flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.16);cursor:pointer;touch-action:none}" +
      ".dpl-prog-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#c084fc,#e879f9);width:0%}" +
      ".dpl-knob{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);left:0%}" +
      ".dpl-times{font-size:10.5px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;min-width:34px;text-align:center}" +

      ".dpl-transport{display:flex;align-items:center;gap:14px;margin-top:18px}" +
      ".dpl-tbtn{background:none;border:none;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.6);font-size:17px;cursor:pointer}" +
      ".dpl-tbtn:hover{color:#fff;background:rgba(255,255,255,.06)}" +
      ".dpl-tbtn.on{color:#e879f9}" +
      ".dpl-play{width:74px;height:74px;border-radius:50%;background:#fff;color:#161016;border:none;display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer}" +
      ".dpl-play:active{transform:scale(.93)}" +

      ".dpl-volume{display:flex;align-items:center;gap:12px;margin-top:16px}" +
      ".dpl-vol-ic{background:none;border:none;color:rgba(255,255,255,.5);width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}" +
      ".dpl-vol{position:relative;width:170px;height:5px;border-radius:99px;background:rgba(255,255,255,.14);cursor:pointer}" +
      ".dpl-vol-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:rgba(255,255,255,.7);width:75%}" +

      ".dpl-signin{margin-top:22px}" +
      ".dpl-signin a{color:#fcd34d;font-size:12px;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(252,211,77,.3)}" +

      /* right: the tabbed panel */
      ".dpl-right{display:flex;flex-direction:column;min-height:0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:22px;overflow:hidden;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}" +
      ".dpl-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}" +
      ".dpl-tab{flex:1;background:none;border:none;color:rgba(255,255,255,.45);font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.01em;padding:16px 10px;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s ease,border-color .15s ease}" +
      ".dpl-tab:hover{color:#fff}" +
      ".dpl-tab.is-active{color:#fff;border-bottom-color:#e879f9}" +
      ".dpl-tab small{display:block;font-size:9px;font-weight:700;color:rgba(255,255,255,.35);font-variant-numeric:tabular-nums;letter-spacing:.05em;margin-top:2px}" +
      ".dpl-tabpane{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px}" +
      ".dpl-tabpane[hidden]{display:none}" +

      /* up next */
      ".dpl-upnext-hrow{display:flex;align-items:baseline;justify-content:space-between;padding:2px 2px 10px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px}" +
      ".dpl-upnext-h{font-size:13px;font-weight:700;color:rgba(255,255,255,.55);letter-spacing:.02em}" +
      ".dpl-upnext-count{color:rgba(255,255,255,.35);font-variant-numeric:tabular-nums;margin-left:6px}" +
      ".dpl-clear{background:none;border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;padding:4px 10px;border-radius:8px}" +
      ".dpl-clear:disabled{color:rgba(255,255,255,.22);cursor:default}" +
      ".dpl-row{display:flex;align-items:center;gap:12px;padding:9px 8px;border-radius:14px;cursor:pointer}" +
      ".dpl-row:hover{background:rgba(255,255,255,.06)}" +
      ".dpl-row-cover{width:52px;height:52px;border-radius:10px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".dpl-row-meta{flex:1;min-width:0}" +
      ".dpl-row-title{font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-row-sub{font-size:11px;color:rgba(255,255,255,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".dpl-row-duration{font-size:11px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;flex-shrink:0}" +
      ".dpl-row-x{background:none;border:none;color:rgba(255,255,255,.35);width:34px;height:44px;min-width:34px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".dpl-row-x:hover{color:#fff}" +
      ".dpl-row-empty{text-align:center;color:rgba(255,255,255,.4);font-size:13px;padding:40px 20px;line-height:1.7}" +

      /* comments */
      ".dpl-comment-cta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:10px 12px;border:1px dashed rgba(255,255,255,.1);border-radius:14px}" +
      ".dpl-comment-cta p{margin:0;font-size:11px;color:rgba(255,255,255,.45);line-height:1.5}" +
      ".dpl-comment-cta button{background:rgba(232,121,249,.14);border:1px solid rgba(232,121,249,.3);color:#f0abfc;font-size:11px;font-weight:800;letter-spacing:.04em;border-radius:9px;padding:8px 13px;cursor:pointer;white-space:nowrap}" +
      ".dpl-comment-cta button:hover{background:rgba(232,121,249,.22)}" +

      /* credits grid */
      ".dpl-credits{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}" +
      ".dpl-credit-cell{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;min-width:0}" +
      ".dpl-credit-cell--wide{grid-column:1/-1}" +
      ".dpl-credit-label{display:block;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.38);margin-bottom:4px}" +
      ".dpl-credit-value{font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}" +
      ".dpl-credit-link{color:#c084fc;text-decoration:none}" +
      ".dpl-credit-link:hover{text-decoration:underline}" +

      /* the expand button that opens this on the deck */
      ".deck-expand-btn{display:flex}" +

      /* responsive: shorter screens tighten the column */
      "@media (max-height:760px){.dpl-cover{width:min(44%,420px)}.dpl-title{margin-top:14px;font-size:clamp(20px,2.2vw,26px)}}" +
      "@media (max-width:1100px){.dpl-body{grid-template-columns:minmax(0,1.1fr) minmax(380px,1fr);gap:18px;padding-left:22px;padding-right:22px}}" +
      "@media (max-width:880px){.dpl-body{grid-template-columns:1fr;overflow-y:auto}.dpl-left{justify-content:flex-start}.dpl-right{min-height:420px}}" +

      /* phones: the desktop sheet is gone, the mobile sheet owns the phone */
      "@media (max-width:767px){.dpl-ov{display:none!important}}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* =================================================================== */
  /* the build                                                       */
  /* =================================================================== */
  function q(ov, sel) { return ov.querySelector(sel); }
  function qa(ov, sel) { return Array.prototype.slice.call(ov.querySelectorAll(sel)); }

  function build() {
    css();
    var t = currentTrack();
    var title = currentTitle();
    var artist = currentArtist();
    var cover = t && t.cover ? String(t.cover) : "Juice-WRLD.png";

    var ov = document.createElement("div");
    ov.className = "dpl-ov";
    ov.id = OV;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Now playing");

    var tag = t && t.tag ? String(t.tag) : "";
    var versions = t ? versionCount(t) : 1;
    var chipClass = t && t.category === "halloween" ? "chip-halloween" : t && t.category === "sessions" ? "chip-sessions" : "chip-leaked";

    ov.innerHTML =
      '<div class="dpl-bg" aria-hidden="true"></div><div class="dpl-vignette" aria-hidden="true"></div>' +
      '<header class="dpl-top">' +
        '<span class="dpl-context">Playing from The Vault</span>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button type="button" class="dpl-more" data-dpl="more" aria-label="More options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
          '<button type="button" class="dpl-close" data-dpl="close" aria-label="Close"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
        '</div>' +
      '</header>' +
      '<div class="dpl-body">' +

        /* -------- the left column -------- */
        '<section class="dpl-left">' +
          '<img decoding="async" class="dpl-cover" data-dpl="cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<h1 class="dpl-title" data-dpl="title">' + esc(title) + '</h1>' +
          '<p class="dpl-artist" data-dpl="artist">' + esc(artist) + '</p>' +
          '<div class="dpl-actions">' +
            '<button type="button" class="dpl-act" data-dpl="fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-act primary" data-dpl="addqueue" aria-label="Add to the queue"><i class="fas fa-plus" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-act" data-dpl="songpage" aria-label="Open the song page"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></button>' +
          '</div>' +
          '<div class="dpl-chips">' +
            '<span class="dpl-chip ' + chipClass + '" data-dpl="chip-cat">' + esc(catLabel(t) || "") + '</span>' +
            '<span class="dpl-chip chip-era" data-dpl="chip-era">' + esc(eraName(t)) + '</span>' +
            '<span class="dpl-chip chip-year" data-dpl="chip-year" style="display:none"></span>' +
          '</div>' +
          '<div class="dpl-prog" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="dpl-times" data-dpl="cur">0:00</span>' +
            '<div class="dpl-prog-bar" data-dpl="scrub"><div class="dpl-prog-fill" data-dpl="fill"></div><div class="dpl-knob" data-dpl="knob"></div></div>' +
            '<span class="dpl-times" data-dpl="dur">0:00</span>' +
          '</div>' +
          '<div class="dpl-transport">' +
            '<button type="button" class="dpl-tbtn" data-dpl="shuffle" aria-label="Shuffle" aria-pressed="false"><i class="fas fa-shuffle" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-tbtn" data-dpl="prev" aria-label="Previous track"><i class="fas fa-backward-step" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-play" data-dpl="play" aria-label="Play or pause"><i class="fas fa-play" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-tbtn" data-dpl="next" aria-label="Next track"><i class="fas fa-forward-step" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-tbtn" data-dpl="repeat" aria-label="Repeat" aria-pressed="false"><i class="fas fa-repeat" aria-hidden="true"></i></button>' +
          '</div>' +
          '<div class="dpl-volume">' +
            '<button type="button" class="dpl-vol-ic" data-dpl="mute" aria-label="Mute"><i class="fas fa-volume-high" aria-hidden="true"></i></button>' +
            '<div class="dpl-vol" data-dpl="vol" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-label="Volume"><div class="dpl-vol-fill" data-dpl="vol-fill"></div></div>' +
          '</div>' +
          '<div class="dpl-signin" id="dpl-signin"></div>' +
        '</section>' +

        /* -------- the right column: tabbed panel -------- */
        '<section class="dpl-right">' +
          '<nav class="dpl-tabs" aria-label="Now playing panel">' +
            '<button type="button" class="dpl-tab" data-dpl="tab-queue">Up next<small data-dpl="upnext-count"></small></button>' +
            '<button type="button" class="dpl-tab is-active" data-dpl="tab-comments">Comments<small data-dpl="comments-count"></small></button>' +
            '<button type="button" class="dpl-tab" data-dpl="tab-credits">Credits</button>' +
          '</nav>' +
          '<div class="dpl-tabpane" data-dpl="pane-queue" hidden>' +
            '<div class="dpl-upnext-hrow"><span class="dpl-upnext-h">Up next<span class="dpl-upnext-count" data-dpl="queue-count"></span></span>' +
              '<button type="button" class="dpl-clear" data-dpl="clear-queue">Clear</button></div>' +
            '<div data-dpl="queue-list"></div>' +
          '</div>' +
          '<div class="dpl-tabpane" data-dpl="pane-comments">' +
            '<div class="dpl-comment-cta"><p>This thread is on the song page, with everyone who has written on it.</p>' +
              '<button type="button" data-dpl="open-panel">Write in the panel</button></div>' +
            '<div data-dpl="comments-thread"></div>' +
          '</div>' +
          '<div class="dpl-tabpane" data-dpl="pane-credits" hidden>' +
            '<div class="dpl-credits" data-dpl="credits-grid"></div>' +
          '</div>' +
        '</section>' +
      '</div>';

    document.body.appendChild(ov);
    bind(ov);
    paintBackground(ov);
    return ov;
  }

  function bind(ov) {
    ov.addEventListener("click", function (e) {
      var target = e.target;
      var act = target.closest ? target.closest("[data-dpl]") : null;
      if (!act) return;
      var a = act.getAttribute("data-dpl");

      try {
        if (a === "close") { close(); return; }
        if (a === "more") { if (window.togglePlayerContextMenu) window.togglePlayerContextMenu(act); return; }
        if (a === "fav") { toggleFav(); return; }
        if (a === "addqueue") { var ci = currentIndex(); if (ci >= 0 && typeof addToQueue === "function") { addToQueue(ci); toast("Added to the queue", "success"); } return; }
        if (a === "songpage") { var tt = currentTitle(); if (window.openSongPage) { window.openSongPage(tt); close(); } return; }
        if (a === "play") { var mp = document.getElementById("deck-play"); if (mp) mp.click(); return; }
        if (a === "prev") { var pb = document.getElementById("prev-btn"); if (pb) pb.click(); else if (document.getElementById("deck-prev")) document.getElementById("deck-prev").click(); return; }
        if (a === "next") { if (typeof nextTrack === "function") nextTrack(); else { var nb = document.getElementById("next-btn"); if (nb) nb.click(); } return; }
        if (a === "shuffle") { if (typeof setShuffle === "function") setShuffle((typeof shuffleMode !== "undefined" && shuffleMode) ? 0 : 1); return; }
        if (a === "repeat") { if (typeof setRepeat === "function") { try { var m = (typeof repeatMode !== "undefined" ? repeatMode : 0); setRepeat(m + 1); } catch (e) { setRepeat(1); } } return; }
        if (a === "mute") { if (typeof toggleMute === "function") toggleMute(); else { var vb = document.getElementById("volume-btn"); if (vb) vb.click(); } return; }
        if (a === "clear-queue") { try { if (typeof clearQueue === "function") window.clearQueue(); } catch (e) {} return; }
        if (a === "tab-queue" || a === "tab-comments" || a === "tab-credits") { switchTab(ov, a.slice(4)); return; }
        if (a === "open-panel") { close(); var b = document.getElementById("song-comments-btn"); if (b) b.click(); return; }
      } catch (err) {}
      setTimeout(function () { sync(true); }, 120);
    });

    /* the volume slider */
    var vol = q(ov, "[data-dpl='vol']");
    if (vol) {
      var setVol = function (e) {
        var r = vol.getBoundingClientRect();
        if (!r.width) return;
        var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        var v = Math.max(0, Math.min(1, x / r.width));
        try { if (typeof setVolume === "function") setVolume(v); } catch (err) {}
      };
      vol.addEventListener("mousedown", setVol);
      vol.addEventListener("touchstart", setVol, { passive: true });
      vol.addEventListener("touchmove", setVol, { passive: true });
    }

    /* the scrub bar */
    var scrub = q(ov, "[data-dpl='scrub']");
    if (scrub) {
      var ratio = function (e) {
        var r = scrub.getBoundingClientRect();
        if (!r.width) return 0;
        return Math.max(0, Math.min(1, ((e.clientX || 0) - r.left) / r.width));
      };
      var seek = function (e) {
        var au = audioEl();
        if (!au || !au.duration) return;
        au.currentTime = Math.max(0, Math.min(au.duration, ratio(e) * au.duration));
        sync(true);
      };
      scrub.addEventListener("mousedown", function (e) { seek(e); var mv = function (ev) { seek(ev); }; var up = function () { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }; document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); });
    }

    /* the year chip only shows with a year */
    var t = currentTrack();
    var year = t && t.year ? String(t.year) : "";
    var yc = q(ov, "[data-dpl='chip-year']");
    if (yc && year) { yc.textContent = year; yc.style.display = ""; }
  }

  function switchTab(ov, name) {
    qa(ov, ".dpl-tab").forEach(function (b) {
      var on = b.getAttribute("data-dpl") === "tab-" + name;
      b.classList.toggle("is-active", on);
    });
    qa(ov, ".dpl-tabpane").forEach(function (p) {
      p.hidden = p.getAttribute("data-dpl") !== "pane-" + name;
    });
    if (name === "comments") loadComments(ov);
    if (name === "credits") renderCredits(ov);
    if (name === "queue") refreshQueue(ov);
  }

  function loadComments(ov) {
    var box = q(ov, "[data-dpl='comments-thread']");
    var title = currentTitle();
    if (!box) return;
    if (!window.SongComments || typeof window.SongComments.renderThreadInto !== "function") {
      box.innerHTML = '<p class="dpl-row-empty">The comments could not be loaded.</p>';
      return;
    }
    window.SongComments.renderThreadInto(box, title);
    var cnt = document.getElementById("song-comments-count");
    var badge = q(ov, "[data-dpl='comments-count']");
    if (badge && cnt) badge.textContent = cnt.textContent || "0";
    /* the sign-in line */
    var sign = document.getElementById("dpl-signin");
    var signedIn = false;
    try { signedIn = typeof window.__thwAuthSignedIn === "boolean" ? window.__thwAuthSignedIn : false; } catch (e) {}
    if (sign && !signedIn) {
      sign.innerHTML = '<a href="/login">Sign in to comment</a>';
    } else if (sign) sign.innerHTML = "";
  }

  function producerSongCount(name) {
    try {
      if (typeof trackList === "undefined" || !trackList) return 0;
      var want = String(name || "").trim().toLowerCase();
      var n = 0;
      for (var i = 0; i < trackList.length; i++) if (String((trackList[i] && trackList[i].producer) || "").trim().toLowerCase() === want) n++;
      return n;
    } catch (e) { return 0; }
  }

  function renderCredits(ov) {
    var grid = q(ov, "[data-dpl='credits-grid']");
    var t = currentTrack();
    if (!grid || !t) return;
    grid.textContent = "";
    function cell(label, value, opts) {
      opts = opts || {};
      if (!value) return;
      var c = document.createElement("div");
      c.className = "dpl-credit-cell" + (opts.wide ? " dpl-credit-cell--wide" : "");
      var a = opts.link ? "a" : null;
      var inner = a
        ? '<a class="dpl-credit-value dpl-credit-link" href="' + esc(opts.link) + '">' + esc(value) + "</a>"
        : '<span class="dpl-credit-value">' + esc(value) + "</span>";
      c.innerHTML = '<span class="dpl-credit-label">' + esc(label) + "</span>" + inner;
      grid.appendChild(c);
    }
    var cat = String(t.category || "").toLowerCase();
    cell("Status", cat === "leaks" ? "Leaked" : cat === "sessions" ? "Session" : cat === "halloween" ? "Halloween" : "");
    var era = eraCode(t);
    cell("Era", eraName(t), { link: "/era/" + eraSlug(t) });
    if (t.tag) cell("Version", String(t.tag), { wide: true });
    if (t.producer) {
      var n = producerSongCount(t.producer);
      cell("Produced by", n ? t.producer + " · " + n + (n === 1 ? " song" : " songs") : t.producer, { wide: true });
    }
    if (t.year) cell("Year", t.year);
    if (t.duration) cell("Length", fmt(t.duration));
    cell("Artist", t.artist || "Juice WRLD");
    try {
      if (typeof artistData !== "undefined" && artistData) {
        var file = String(t.cover || "").replace("https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/", "").replace(/^Covers\//, "");
        try { file = decodeURIComponent(file); } catch (e) {}
        for (var i = 0; i < artistData.length; i++) {
          var list = (artistData[i] && artistData[i].tracks) || [];
          for (var j = 0; j < list.length; j++) {
            if (String(list[j][1] || "").toLowerCase() === String(file).toLowerCase()) {
              cell("Cover art", "Made by " + artistData[i].name);
              i = artistData.length; break;
            }
          }
        }
      }
    } catch (e) {}
  }

  function refreshQueue(ov) {
    var listEl = q(ov, "[data-dpl='queue-list']");
    var countEl = q(ov, "[data-dpl='queue-count']");
    var tabCountEl = q(ov, "[data-dpl='upnext-count']");
    var paneUp = q(ov, "[data-dpl='tab-queue'] small");
    var queue = [];
    try { if (typeof trackQueue !== "undefined" && trackQueue) queue = trackQueue.slice(); } catch (e) {}
    if (paneUp) paneUp.textContent = queue.length ? queue.length + " songs" : "";
    if (countEl) countEl.textContent = queue.length ? String(queue.length) : "";
    if (tabCountEl) tabCountEl.textContent = queue.length ? String(queue.length) : "";
    var clear = q(ov, "[data-dpl='clear-queue']");
    if (clear) clear.disabled = !queue.length;
    if (!listEl) return;
    listEl.textContent = "";
    if (!queue.length) {
      listEl.innerHTML = '<p class="dpl-row-empty">Nothing up next.<br>Songs you queue from the vault or the player line up here.</p>';
      return;
    }
    var list = tl_();
    for (var i = 0; i < Math.min(queue.length, 40); i++) {
      (function (qi, idx) {
        var t = null;
        try { t = (typeof trackList !== "undefined" ? trackList[idx] : null); } catch (e) {}
        var row = document.createElement("div");
        row.className = "dpl-row";
        row.innerHTML =
          '<img decoding="async" class="dpl-row-cover" loading="lazy" src="' + esc(coverThumb(t && t.cover, "64")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<div class="dpl-row-meta"><p class="dpl-row-title">' + esc((t && t.title) || ("Track " + (idx + 1))) + '</p>' +
            '<p class="dpl-row-sub">' + esc(String((t && t.artist) || "Juice WRLD")) + '</p></div>' +
          '<span class="dpl-row-duration">' + fmt((t && t.duration) || 0) + '</span>' +
          '<button type="button" class="dpl-row-x" data-remove="' + qi + '" aria-label="Remove from the queue"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
        row.addEventListener("click", function (e) {
          var rm = e.target.closest ? e.target.closest("[data-remove]") : null;
          if (rm) {
            e.stopPropagation();
            try { if (typeof removeFromQueue === "function") removeFromQueue(Number(rm.getAttribute("data-remove"))); } catch (err) {}
            refreshQueue(ov);
            toast("Removed from the queue", "info");
            return;
          }
          try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {}
        });
        listEl.appendChild(row);
      })(i, queue[i]);
    }
  }

  function tl_() { try { return trackList; } catch (e) { return []; } }

  /* ---- favourite wiring ---- */
  function toggleFav() {
    var i = currentIndex();
    try { if (i >= 0 && typeof toggleFavorite === "function") toggleFavorite(i); } catch (e) {}
  }

  var lastSync = { pct: -1, playing: null, title: null };
  function sync(force) {
    var ov = document.getElementById(OV);
    if (!ov) { stopSync(); return; }
    var t = currentTrack();

    paintBackground(ov);

    qa(ov, "[data-dpl='title']").forEach(function (el) { el.textContent = currentTitle(); });
    qa(ov, "[data-dpl='artist']").forEach(function (el) { el.textContent = currentArtist(); });
    qa(ov, "[data-dpl='cover']").forEach(function (img) {
      var src = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
      if (img.getAttribute("src") !== src) img.src = src;
    });

    /* chips */
    var catChip = q(ov, "[data-dpl='chip-cat']");
    if (catChip && t) {
      catChip.textContent = catLabel(t) || "Session";
      var cat = String(t.category || "");
      catChip.className = "dpl-chip " + (cat === "halloween" ? "chip-halloween" : cat === "sessions" ? "chip-sessions" : "chip-leaked") + "";
    }
    var eraChip = q(ov, "[data-dpl='chip-era']");
    if (eraChip) eraChip.textContent = eraName(t);
    var yChip = q(ov, "[data-dpl='chip-year']");
    if (yChip && t && t.year) { yChip.textContent = String(t.year); yChip.style.display = ""; }

    /* hearts */
    var favBtn = q(ov, "[data-dpl='fav']");
    if (favBtn) {
      var f = false;
      try { if (currentIndex() >= 0 && typeof isFavorite === "function") f = !!isFavorite(currentIndex()); } catch (e) {}
      favBtn.classList.toggle("is-on", f);
      favBtn.setAttribute("aria-pressed", f ? "true" : "false");
      favBtn.innerHTML = '<i class="' + (f ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i>';
    }

    /* progress */
    var au = audioEl();
    var dur = au && isFinite(au.duration) ? au.duration : 0;
    var cur = au ? au.currentTime : 0;
    var pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    var rounded = Math.round(pct * 10) / 10;
    if (force || lastSync.pct !== rounded) {
      lastSync.pct = rounded;
      qa(ov, "[data-dpl='fill']").forEach(function (f) { f.style.width = rounded + "%"; });
      qa(ov, "[data-dpl='knob']").forEach(function (k) { k.style.left = rounded + "%"; });
    }
    qa(ov, "[data-dpl='cur']").forEach(function (el) { if (el.textContent !== fmt(cur)) el.textContent = fmt(cur); });
    qa(ov, "[data-dpl='dur']").forEach(function (el) { var txt = dur > 0 ? fmt(dur) : "--:--"; if (el.textContent !== txt) el.textContent = txt; });

    /* play/pause */
    var isP = playing();
    if (force || lastSync.playing !== isP) {
      lastSync.playing = isP;
      qa(ov, "[data-dpl='play']").forEach(function (pp) { pp.innerHTML = '<i class="fas ' + (isP ? "fa-pause" : "fa-play") + '" aria-hidden="true"></i>'; });
    }

    /* shuffle/repeat state */
    qa(ov, "[data-dpl='shuffle']").forEach(function (el) {
      var on = false; try { on = typeof shuffleMode !== "undefined" && shuffleMode === 1; } catch (e) {}
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    qa(ov, "[data-dpl='repeat']").forEach(function (el) {
      var on = false; try { on = typeof repeatMode !== "undefined" && repeatMode !== 0; } catch (e) {}
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });

    /* volume fill */
    var volFill = q(ov, "[data-dpl='vol-fill']");
    if (volFill) {
      var v = 0.75;
      try { if (typeof masterVolume !== "undefined") v = masterVolume; } catch (e) {}
      volFill.style.width = Math.round(v * 100) + "%";
    }

    /* track changed: refresh the tab that shows the song */
    if (force || lastSync.title !== currentTitle()) {
      lastSync.title = currentTitle();
      var paneComments = q(ov, "[data-dpl='pane-comments']");
      if (paneComments && !paneComments.hidden) loadComments(ov);
      var paneCredits = q(ov, "[data-dpl='pane-credits']");
      if (paneCredits && !paneCredits.hidden) renderCredits(ov);
      var paneQueue = q(ov, "[data-dpl='pane-queue']");
      if (paneQueue && !paneQueue.hidden) refreshQueue(ov);
    }
  }

  function stopSync() { if (syncIv) { clearInterval(syncIv); syncIv = null; } }

  function open() {
    if (document.getElementById(OV)) return;
    css();
    lastBg = null;
    lastSync = { pct: -1, playing: null, title: null };
    var ov = build();
    document.body.appendChild(ov);
    stopSync();
    syncIv = setInterval(function () { sync(false); }, 1000);
    sync(true);
    loadComments(ov);
  }

  function close() {
    stopSync();
    var ov = document.getElementById(OV);
    if (ov) ov.remove();
  }

  /* ================================================================== */

  window.openDesktopPlayer = open;
  window.closeDesktopPlayer = close;

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.getElementById(OV)) close();
    if (e.key === "o" || e.key === "O") {
      var tag = (e.target && e.target.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (document.getElementById(OV)) close();
      else open();
      e.preventDefault();
    }
  });
})();
