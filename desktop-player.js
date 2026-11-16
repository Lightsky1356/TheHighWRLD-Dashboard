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
  var plState = { list: null, current: null };

  var DPL_COLLAPSE_KEY = "thw-dpl-panel";
  function setCollapsed(ov, v) {
    if (!ov) return;
    ov.classList.toggle("is-collapsed", !!v);
    try { localStorage.setItem(DPL_COLLAPSE_KEY, v ? "1" : "0"); } catch (e) {}
  }
  function restoreCollapsed(ov) {
    if (!ov) return;
    var v = false;
    try { v = localStorage.getItem(DPL_COLLAPSE_KEY) === "1"; } catch (e) {}
    if (v) ov.classList.add("is-collapsed");
  }
  var dplMomentMode = "moment"; /* "moment" | "song" */

  function signedInDpl() {
    try { if (typeof window.__thwAuthSignedIn === "boolean") return window.__thwAuthSignedIn; } catch (e) {}
    try {
      var wrap = document.getElementById("nav-account-wrap");
      if (wrap && wrap.style.display !== "none") return true;
    } catch (e) {}
    return false;
  }
  function myAvatarHTML() {
    var html = '<i class="fas fa-user" aria-hidden="true"></i>';
    try {
      var holder = document.getElementById("navAvatarInner");
      var img = holder && holder.querySelector ? holder.querySelector("img") : null;
      if (img && img.src) html = '<img decoding="async" src="' + esc(img.src) + '" alt="">';
    } catch (e) {}
    return html;
  }
  function dplMoment() {
    if (dplMomentMode === "song") return { seconds: 0, label: "" };
    var seconds = 0;
    try {
      var au = audioEl();
      if (au && isFinite(au.currentTime)) seconds = Math.max(0, Math.round(au.currentTime));
    } catch (e) {}
    return { seconds: seconds, label: fmt(seconds) };
  }
  function paintDplComposer(ov) {
    if (!ov) return;
    var can = signedInDpl();
    var compose = q(ov, ".dpl-compose");
    if (compose) compose.style.display = can ? "" : "none";
    var m = dplMoment();
    var wholeSong = dplMomentMode === "song";
    var input = q(ov, "[data-dpl='comment-input']");
    var send = q(ov, "[data-dpl='comment-send']");
    var note = q(ov, "[data-dpl='comments-note']");
    var avatar = q(ov, "[data-dpl='avatar']");
    if (input) {
      input.disabled = !can;
      var ph = !can ? "Sign in to comment" : wholeSong ? "Comment on the song" : "Comment at " + (m.label || "0:00");
      if (input.__dplPh !== ph) { input.__dplPh = ph; input.placeholder = ph; }
    }
    if (send) send.disabled = !can;
    qa(ov, "[data-dpl='moment-moment'],[data-dpl='moment-song']").forEach(function (btn) {
      var on = (btn.getAttribute("data-dpl") === "moment-moment") === !wholeSong;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (note && !can) note.textContent = "Sign in to comment on this song.";
    else if (note && can && note.textContent === "Sign in to comment on this song.") note.textContent = "";
    if (avatar) {
      var html = myAvatarHTML();
      if (avatar.__dplAvatar !== html) { avatar.__dplAvatar = html; avatar.innerHTML = html; }
    }
  }
  /* ------------------------------------------------------------------ */
  /* the search pill                                                     */
  /* ------------------------------------------------------------------ */
  function dplSearchMatches(query) {
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
  function dplRenderSearch(ov) {
    var input = q(ov, "[data-dpl='search']");
    var box = q(ov, "[data-dpl='search-results']");
    var clear = q(ov, "[data-dpl='search-clear']");
    if (!input || !box) return;
    var query = String(input.value || "").trim();
    if (clear) clear.classList.toggle("is-shown", !!query);
    if (!query) { box.hidden = true; box.textContent = ""; return; }
    var matches = dplSearchMatches(query);
    box.textContent = "";
    if (!matches.length) {
      box.innerHTML = '<p class="dpl-srow-empty">Nothing in the vault matches “' + esc(query) + '”.</p>';
      box.hidden = false;
      return;
    }
    /* one button adds the whole match set to the queue */
    var addAll = document.createElement("button");
    addAll.type = "button";
    addAll.className = "dpl-srow-addall";
    addAll.setAttribute("data-dpl", "add-all");
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
      row.className = "dpl-srow";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("data-idx", String(idx));
      row.innerHTML =
        '<img decoding="async" class="dpl-srow-cover" loading="lazy" src="' + esc(thumb) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<span class="dpl-srow-meta"><p class="dpl-srow-title">' + esc((t2 && t2.title) || "Untitled") + '</p>' +
          '<p class="dpl-srow-sub">' + esc(eraName(t2) + (catLabel2 ? " · " + catLabel2 : "")) + '</p></span>' +
        '<span class="dpl-srow-dur">' + esc(fmt((t2 && Number(t2.duration)) || 0)) + '</span>' +
        '<button type="button" class="dpl-srow-add" data-add="' + idx + '" aria-label="Queue ' + esc((t2 && t2.title) || "song") + '"><i class="fas fa-plus" aria-hidden="true"></i></button>';
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
        dplRenderSearch(ov);
        input.blur();
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {} input.value = ""; dplRenderSearch(ov); input.blur(); }
      });
      box.appendChild(row);
    });
    box.hidden = false;
  }
  function dplClearSearch(ov) {
    var input = q(ov, "[data-dpl='search']");
    var box = q(ov, "[data-dpl='search-results']");
    var clear = q(ov, "[data-dpl='search-clear']");
    if (input) input.value = "";
    if (box) { box.hidden = true; box.textContent = ""; }
    if (clear) clear.classList.remove("is-shown");
    if (input) input.blur();
  }

  function dplSendComment(ov) {
    var input = q(ov, "[data-dpl='comment-input']");
    var note = q(ov, "[data-dpl='comments-note']");
    if (!input) return;
    var text = String(input.value || "").trim();
    if (!text) { if (note) note.textContent = "Write something first."; return; }
    if (!signedInDpl()) { if (note) note.textContent = "Sign in to comment on this song."; return; }
    var m = dplMoment();
    var title = currentTitle();
    if (note) note.textContent = "";
    fetch("/api/song-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ track: title, body: text, parentId: 0, atSeconds: m.seconds, atLabel: m.label }),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.d && (res.d.message || res.d.error)) || "The comment could not be saved");
        input.value = "";
        loadComments(ov);
      })
      .catch(function (err) {
        if (note) note.textContent = (err && err.message) || "The comment could not be saved.";
      });
  }

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
    try {
      var on = !window.movingColors || window.movingColors();
      bg.classList.toggle("thw-moving-gradient", !!on);
    } catch (e) {}
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
      ".dpl-ov{position:fixed;inset:0;z-index:10500;display:flex;flex-direction:column;background:#0e0c0a;color:#fff;font-family:inherit;overflow:hidden}" +
      ".dpl-ov[hidden]{display:none}" +
      ".dpl-bg{position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,#17120f,#100d0b);transition:background .6s ease}" +
      ".dpl-vignette{position:absolute;inset:0;z-index:0;background:radial-gradient(130% 90% at 30% 60%,transparent 40%,rgba(4,3,2,.55) 100%);pointer-events:none}" +

      /* top bar */
      ".dpl-top{position:relative;z-index:1;display:flex;align-items:center;padding:14px 24px 0;min-height:52px;flex-shrink:0}" +
      ".dpl-topleft{display:flex;align-items:center;gap:10px}" +
      ".dpl-context{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:700}" +
      ".dpl-more{position:absolute;top:10px;right:10px;z-index:2;background:none;border:none;color:rgba(255,255,255,.6);width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;transition:background .18s ease,color .18s ease}" +
      ".dpl-more:hover{background:rgba(255,255,255,.08);color:#fff}" +
      ".dpl-more:hover{background:rgba(255,255,255,.07);color:#fff}" +
      ".dpl-close{background:none;border:none;color:rgba(255,255,255,.6);width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer}" +
      ".dpl-close:hover{background:rgba(255,255,255,.07);color:#fff}" +

      /* the two columns */
      ".dpl-body{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(420px,680px);gap:36px;min-height:0;height:100%;padding:6px 36px 30px;transition:grid-template-columns .3s ease}" +
      ".dpl-ov.is-collapsed .dpl-body{grid-template-columns:minmax(0,1fr) 0px}" +
      ".dpl-ov.is-collapsed .dpl-right{visibility:hidden;opacity:0;pointer-events:none;transform:translateX(48px)}" +
      ".dpl-ov.is-collapsed .dpl-cover{width:min(58%,560px)}" +
      ".dpl-collapse{position:absolute;left:-22px;top:50%;transform:translateY(-50%);z-index:4;width:30px;height:84px;border:1px solid rgba(255,255,255,.09);border-right:none;border-radius:10px 0 0 10px;background:#1b1714;color:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;transition:color .18s ease}" +
      ".dpl-collapse:hover{color:#fff}" +
      ".dpl-reveal{position:absolute;top:14px;right:22px;z-index:4;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.72);display:none;align-items:center;justify-content:center;font-size:16px;cursor:pointer;transition:background .18s ease,color .18s ease}" +
      ".dpl-reveal:hover{background:rgba(255,255,255,.13);color:#fff}" +
      ".dpl-ov.is-collapsed .dpl-reveal{display:flex}" +
      ".dpl-more-collapsed{position:absolute;top:14px;right:74px;z-index:4;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.72);display:none;align-items:center;justify-content:center;font-size:17px;cursor:pointer;transition:background .18s ease,color .18s ease}" +
      ".dpl-more-collapsed:hover{background:rgba(255,255,255,.13);color:#fff}" +
      ".dpl-ov.is-collapsed .dpl-more-collapsed{display:flex}" +

      /* left */
      ".dpl-left{display:flex;flex-direction:column;align-items:stretch;min-height:0;min-width:0;justify-content:center;overflow-y:auto;overscroll-behavior:contain;padding:14px 38px}" +
      ".dpl-cover{align-self:center;width:min(46%,480px);aspect-ratio:1/1;object-fit:cover;border-radius:18px;background:#1c1530;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 .5px rgba(255,255,255,.06) inset}" +
      ".dpl-titlerow{display:flex;align-items:center;gap:14px;width:100%;margin-top:20px}" +
      ".dpl-titlerow .dpl-act{width:44px;height:44px;min-width:44px;border-radius:12px;flex-shrink:0;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07)}" +
      ".dpl-titlerow .dpl-act:hover{background:rgba(255,255,255,.12);color:#fff}" +
      ".dpl-title{margin:0;font-size:clamp(22px,2vw,30px);line-height:1.12;font-weight:900;letter-spacing:-.02em;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}" +
      ".dpl-meta{display:flex;align-items:baseline;gap:12px;margin:8px 0 0;min-width:0}" +
      ".dpl-albumline{display:flex;align-items:center;gap:8px;margin:10px 0 0;min-width:0;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-albumline i{font-size:11px;color:rgba(255,255,255,.32);flex-shrink:0}" +
      ".dpl-meta-tag{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;font-size:12.5px;font-weight:700;color:#f9a8d4}" +
      ".dpl-meta-tag i{font-size:11px;color:#f472b6}" +
      ".dpl-meta-artists{font-size:12.5px;font-weight:600;color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}" +
      /* the search pill in the top bar */
      ".dpl-searchwrap{position:relative;width:100%;height:38px;z-index:6}" +
      ".dpl-search-ic{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.42);font-size:12px;pointer-events:none}" +
      ".dpl-search-input{display:block;width:100%;height:100%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:999px;color:#fff;font-size:12.5px;font-family:inherit;outline:none;padding:0 36px 0 36px;transition:border-color .2s ease,background .2s ease;line-height:38px}" +
      ".dpl-search-input::placeholder{color:rgba(255,255,255,.36)}" +
      ".dpl-search-input:focus{border-color:rgba(34,211,238,.45);background:rgba(255,255,255,.12)}" +
      ".dpl-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,.5);width:30px;height:30px;border-radius:50%;display:none;align-items:center;justify-content:center;font-size:12px;cursor:pointer}" +
      ".dpl-search-clear:hover{color:#fff;background:rgba(255,255,255,.09)}" +
      ".dpl-search-clear.is-shown{display:flex}" +
      ".dpl-search-results{background:#171310;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:6px;margin-top:8px;max-height:min(40vh,380px);overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 60px rgba(0,0,0,.62);z-index:30}" +
      ".dpl-search-results[hidden]{display:none}" +
      ".dpl-srow{display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:12px;cursor:pointer}" +
      ".dpl-srow:hover,.dpl-srow.is-active{background:rgba(255,255,255,.08)}" +
      ".dpl-srow-cover{width:44px;height:44px;border-radius:9px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".dpl-srow-meta{flex:1;min-width:0}" +
      ".dpl-srow-title{margin:0;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-srow-sub{margin:2px 0 0;font-size:10px;color:rgba(255,255,255,.42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-srow-dur{font-size:10.5px;color:rgba(255,255,255,.46);font-variant-numeric:tabular-nums;flex-shrink:0}" +
      ".dpl-srow-add{background:none;border:none;color:rgba(255,255,255,.55);width:38px;height:44px;min-width:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;border-radius:10px}" +
      ".dpl-srow-add:hover{color:#34d399}" +
      ".dpl-srow-addall{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:rgba(52,211,153,.13);border:1px solid rgba(52,211,153,.3);color:#6ee7b7;font-family:inherit;font-size:12px;font-weight:800;letter-spacing:.02em;border-radius:11px;padding:10px 12px;cursor:pointer;margin-bottom:6px;transition:background .15s ease,color .15s ease}" +
      ".dpl-srow-addall:hover{background:rgba(52,211,153,.2);color:#a7f3d0}" +
      ".dpl-srow-empty{padding:16px 14px;text-align:center;color:rgba(255,255,255,.4);font-size:12px}" +

      ".dpl-act{background:none;border:none;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.75);font-size:18px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07)}" +
      ".dpl-act:hover{background:rgba(255,255,255,.13);color:#fff}" +
      ".dpl-act.is-on{color:#fb7185;border-color:rgba(251,113,133,.35);background:rgba(251,113,133,.09)}" +
      ".dpl-act.primary{background:rgba(255,255,255,.07)}" +

      ".dpl-chips{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;justify-content:flex-start}" +
      ".dpl-chip{font-size:11px;font-weight:700;letter-spacing:.03em;border-radius:8px;padding:5px 12px}" +
      ".dpl-versions{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.92);color:#161016;border:none;cursor:pointer;font-weight:800}" +
      ".dpl-versions:hover{background:#fff}" +
      ".dpl-versions small{font-weight:600;color:rgba(0,0,0,.55)}" +
      ".dpl-versions i{font-size:9px;color:rgba(0,0,0,.5)}" +
      ".chip-snippet{background:rgba(34,211,238,.13);color:#67e8f9;border:1px solid rgba(34,211,238,.3)}" +
      ".chip-leaked{background:rgba(251,191,36,.13);color:#fcd34d;border:1px solid rgba(251,191,36,.28)}" +
      ".chip-sessions{background:rgba(34,211,238,.12);color:#67e8f9;border:1px solid rgba(34,211,238,.25)}" +
      ".chip-halloween{background:rgba(192,132,252,.13);color:#d8b4fe;border:1px solid rgba(192,132,252,.3)}" +
      ".chip-era{background:rgba(248,113,113,.13);color:#fca5a5;border:1px solid rgba(248,113,113,.26)}" +
      ".chip-year{background:rgba(255,255,255,.08);color:rgba(255,255,255,.7)}" +

      ".dpl-prog{display:flex;align-items:center;gap:12px;width:100%;margin-top:22px}" +
      ".dpl-prog-bar{position:relative;flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.16);cursor:pointer;touch-action:none}" +
      ".dpl-prog-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:#38bdf8;width:0%}" +
      ".dpl-knob{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);left:0%}" +
      ".dpl-times{font-size:10.5px;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums;min-width:34px;text-align:center}" +

      ".dpl-markers{width:100%;margin:0}" +
      ".dpl-transport{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:18px}" +
      ".dpl-tbtn{background:none;border:none;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.6);font-size:17px;cursor:pointer}" +
      ".dpl-tbtn:hover{color:#fff;background:rgba(255,255,255,.06)}" +
      ".dpl-tbtn.on{color:#38bdf8}" +
      ".dpl-play{width:74px;height:74px;border-radius:50%;background:#fff;color:#161016;border:none;display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer}" +
      ".dpl-play:active{transform:scale(.93)}" +

      "/* the middle stays one clean screen when the panel is away */" +
      ".dpl-ov.is-collapsed .dpl-left{overflow:hidden}" +
      ".dpl-ov.is-collapsed .dpl-cover{width:min(48%,460px)}" +
      "@media (max-height:900px){.dpl-ov.is-collapsed .dpl-cover{width:min(44%,420px)}}" +
      /* short windows: the whole column, cover and all, fits without cutting anything off */
      "@media (max-height:780px){" +
        ".dpl-left{justify-content:flex-start;padding-top:0;justify-content:flex-start}" +
        ".dpl-cover{width:min(52vw,250px,32vh);margin-top:0}" +
        ".dpl-titlerow{margin-top:8px}" +
        ".dpl-meta{margin-top:2px}" +
        ".dpl-meta-tag{font-size:11px}" +
        ".dpl-meta-artists{font-size:11px}" +
        ".dpl-chips{margin-top:8px}" +
        ".dpl-chip-year,.dpl-chip{padding-top:3px;padding-bottom:3px}" +
        ".dpl-prog{margin-top:10px}" +
        ".dpl-transport{margin-top:12px}" +
        ".dpl-play{width:60px;height:60px;font-size:19px}" +
        ".dpl-volume{margin-top:8px}" +
        ".dpl-actions{margin-top:8px}" +
      "}" +
      ".dpl-volume{display:flex;align-items:center;gap:12px;margin-top:16px}" +
      ".dpl-vol-ic{background:none;border:none;color:rgba(255,255,255,.5);width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;transition:color .18s ease}" +
      ".dpl-vol-ic:hover{color:#fff}" +
      ".dpl-vol{position:relative;width:170px;height:5px;border-radius:99px;background:rgba(255,255,255,.14);cursor:pointer}" +
      ".dpl-vol-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:rgba(255,255,255,.7);width:75%}" +

      /* right: the tabbed panel */
      ".dpl-right{position:relative;display:flex;flex-direction:column;min-height:0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:22px;overflow:hidden;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .3s ease,opacity .3s ease,visibility .3s ease}" +
      ".dpl-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;padding-right:64px}" +
      ".dpl-tab{flex:1;background:none;border:none;color:rgba(255,255,255,.45);font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.01em;padding:16px 10px;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s ease,border-color .15s ease}" +
      ".dpl-tab:hover{color:#fff}" +
      ".dpl-tab.is-active{color:#fff;border-bottom-color:#38bdf8}" +
      ".dpl-tab small{display:block;font-size:9px;font-weight:700;color:rgba(255,255,255,.35);font-variant-numeric:tabular-nums;letter-spacing:.05em;margin-top:2px}" +
      ".dpl-tabpane{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px}" +
      ".dpl-tabpane[hidden]{display:none}" +

      /* up next */
      ".dpl-npcard{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:10px 12px;margin-bottom:12px}" +
      ".dpl-npcard-cover{width:52px;height:52px;border-radius:10px;object-fit:cover;background:#1c1530;flex-shrink:0}" +
      ".dpl-npcard-meta{flex:1;min-width:0}" +
      ".dpl-npcard-title{font-size:14.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-npcard-sub{font-size:10.5px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}" +
      ".dpl-npcard-right{display:flex;align-items:center;gap:8px;flex-shrink:0}" +
      ".dpl-npcard-fav{background:none;border:none;color:rgba(255,255,255,.75);width:38px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border-radius:10px}" +
      ".dpl-npcard-fav:hover{color:#fff;background:rgba(255,255,255,.07)}" +
      ".dpl-npcard-fav.is-on{color:#fb7185}" +
      ".dpl-eq{display:flex;align-items:flex-end;gap:2.5px;height:16px}" +
      ".dpl-eq span{width:3px;border-radius:2px;background:#38bdf8;height:30%;transform-origin:bottom}" +
      ".dpl-eq.is-playing span{animation:dpleq .9s ease-in-out infinite}" +
      ".dpl-eq span:nth-child(2){animation-delay:.2s}" +
      ".dpl-eq span:nth-child(3){animation-delay:.1s}" +
      ".dpl-eq span:nth-child(4){animation-delay:.32s}" +
      "@keyframes dpleq{0%,100%{height:22%}50%{height:100%}}" +
      ".dpl-autoplay-h{display:flex;align-items:baseline;justify-content:space-between;padding:4px 2px 8px;margin-top:4px}" +
      ".dpl-autoplay-label{font-size:11.5px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.01em}" +
      ".dpl-autoplay-row{display:flex;align-items:center;gap:12px;padding:9px 8px;border-radius:14px;cursor:pointer}" +
      ".dpl-autoplay-row:hover{background:rgba(255,255,255,.06)}" +
      ".dpl-autoplay-row .dpl-row-sub{color:rgba(125,211,252,.75)}" +
      ".dpl-fullqueue{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:#fff;font-family:inherit;font-size:13px;font-weight:700;border-radius:12px;padding:12px;cursor:pointer}" +
      ".dpl-fullqueue:hover{background:rgba(255,255,255,.08)}" +
      ".dpl-compose{margin-top:18px}" +
      ".dpl-signin{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:46px 24px}" +
      ".dpl-signin-ic{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:22px;color:rgba(255,255,255,.35)}" +
      ".dpl-signin-t{font-size:15.5px;font-weight:800;color:#fff;letter-spacing:-.01em}" +
      ".dpl-signin-s{font-size:11.5px;line-height:1.65;color:rgba(255,255,255,.5);max-width:290px}" +
      ".dpl-signin-btn{margin-top:4px;display:inline-flex;align-items:center;gap:9px;background:#fff;color:#161016;border:none;border-radius:999px;padding:11px 22px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;text-decoration:none}" +
      ".dpl-signin-btn:hover{background:#e8edf4}" +
      ".dpl-nocomments{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:46px 20px}" +
      ".dpl-nocomments i{font-size:30px;color:rgba(255,255,255,.28)}" +
      ".dpl-nocomments b{font-size:15px;color:#fff}" +
      ".dpl-nocomments span{font-size:11px;color:rgba(255,255,255,.45);max-width:250px;line-height:1.6}" +
      ".dpl-row-grip{background:none;border:none;color:rgba(255,255,255,.38);width:30px;min-width:30px;height:52px;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;font-size:12px}" +
      ".dpl-row-grip:active{cursor:grabbing}" +
      ".dpl-row.is-dragging{opacity:.55;background:rgba(255,255,255,.07)}" +
      ".dpl-row.drop-above{box-shadow:inset 0 2px 0 #38bdf8}" +
      ".dpl-row.drop-below{box-shadow:inset 0 -2px 0 #38bdf8}" +
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
      ".dpl-compose{margin-bottom:10px}" +

      /* credits grid */
      ".dpl-credits{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}" +

      /* ===== playlists ===== */
      ".dpl-pl-hrow{display:flex;align-items:baseline;justify-content:space-between;padding:2px 2px 10px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px}" +
      ".dpl-pl-h{font-size:13px;font-weight:700;color:rgba(255,255,255,.55);letter-spacing:.02em}" +
      ".dpl-pl-card{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font-family:inherit;color:#fff;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:14px;padding:10px 12px;margin-bottom:8px;cursor:pointer}" +
      ".dpl-pl-card:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.09)}" +
      ".dpl-pl-dot{width:13px;height:13px;border-radius:50%;flex-shrink:0}" +
      ".dpl-pl-card-meta{flex:1;min-width:0}" +
      ".dpl-pl-name{font-size:14px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-pl-sub{font-size:10.5px;color:rgba(255,255,255,.45);margin-top:3px}" +
      ".dpl-pl-newrow{display:flex;align-items:center;gap:11px;width:100%;font-family:inherit;color:rgba(255,255,255,.62);background:none;border:1px dashed rgba(255,255,255,.12);border-radius:14px;padding:11px 12px;cursor:pointer;font-size:12.5px;font-weight:700;margin-top:2px}" +
      ".dpl-pl-newrow:hover{color:#fff;border-color:rgba(255,255,255,.22)}" +
      ".dpl-pl-newrow small{margin-left:auto;font-size:10px;font-weight:600;color:rgba(255,255,255,.35)}" +
      ".dpl-pl-manage{text-align:center;font-size:11px;color:rgba(255,255,255,.4);margin:16px 0 4px}" +
      ".dpl-pl-manage a{color:rgba(255,255,255,.6);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.2)}" +
      ".dpl-pl-empty{text-align:center;color:rgba(255,255,255,.4);font-size:13px;padding:44px 24px;line-height:1.7}" +
      ".dpl-pl-empty i{display:block;font-size:24px;margin-bottom:10px;color:rgba(255,255,255,.22)}" +
      ".dpl-pl-empty b{color:#fff}" +
      ".dpl-pl-empty a{display:inline-block;margin-top:12px;background:#fff;color:#161016;border-radius:99px;padding:8px 20px;font-weight:800;font-size:12px;text-decoration:none}" +
      ".dpl-pl-dhead{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.06)}" +
      ".dpl-pl-back{background:none;border:none;color:rgba(255,255,255,.65);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;flex-shrink:0}" +
      ".dpl-pl-back:hover{background:rgba(255,255,255,.07);color:#fff}" +
      ".dpl-pl-dmeta{flex:1;min-width:0}" +
      ".dpl-pl-dname{margin:0;font-size:16px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dpl-pl-dsub{margin:2px 0 0;font-size:10.5px;color:rgba(255,255,255,.45)}" +
      ".dpl-pl-actions{display:flex;gap:10px;margin-bottom:12px}" +
      ".dpl-pl-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-family:inherit;font-size:12px;font-weight:800;border-radius:11px;padding:10px;cursor:pointer}" +
      ".dpl-pl-btn:hover{background:rgba(255,255,255,.09)}" +
      ".dpl-pl-btn.primary{background:#fff;color:#161016;border-color:#fff}" +
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
    ov.setAttribute("data-markers-root", "");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Now playing");

    var tag = t && t.tag ? String(t.tag) : "";
    var versions = t ? versionCount(t) : 1;
    var chipClass = t && t.category === "halloween" ? "chip-halloween" : t && t.category === "sessions" ? "chip-sessions" : "chip-leaked";

    ov.innerHTML =
      '<div class="dpl-bg" aria-hidden="true"></div><div class="dpl-vignette" aria-hidden="true"></div>' +
      '<header class="dpl-top">' +
        '<div class="dpl-topleft">' +
          '<button type="button" class="dpl-close" data-dpl="close" aria-label="Close"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
          '<span class="dpl-context">PLAYING FROM THE WRLD PLAYER</span>' +
        '</div>' +
      '</header>' +
      '<button type="button" class="dpl-reveal" data-dpl="reveal" aria-label="Show the panel"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>' +
      '<button type="button" class="dpl-more-collapsed" data-dpl="more" aria-label="More options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
      '<div class="dpl-body">' +

        /* -------- the left column -------- */
        '<section class="dpl-left">' +
          '<img decoding="async" class="dpl-cover" data-dpl="cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
          '<div class="dpl-titlerow">' +
            '<h1 class="dpl-title" data-dpl="title">' + esc(title) + '</h1>' +
            '<button type="button" class="dpl-act" data-dpl="fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-act" data-dpl="addqueue" aria-label="Add to the queue"><i class="fas fa-list-ul" aria-hidden="true"></i></button>' +
            '<button type="button" class="dpl-act" data-dpl="songpage" aria-label="Open the song page"><i class="fas fa-expand" aria-hidden="true"></i></button>' +
          '</div>' +
          '<p class="dpl-albumline" data-dpl="albumline"></p>' +
          '<p class="dpl-meta"><span class="dpl-meta-tag"><i class="fas fa-asterisk" aria-hidden="true"></i><span data-dpl="album">Session edit</span></span><span class="dpl-meta-artists" data-dpl="artist">' + esc(artist) + '</span></p>' +
          '<div class="dpl-chips">' +
            '<button type="button" class="dpl-chip dpl-versions" data-dpl="versions" title="Every version of this song"><i class="fas fa-code-branch" aria-hidden="true"></i>Main version<small data-dpl="versions-n"></small><i class="fas fa-chevron-down" aria-hidden="true"></i></button>' +
            '<span class="dpl-chip ' + chipClass + '" data-dpl="chip-cat">' + esc(catLabel(t) || "") + '</span>' +
            '<span class="dpl-chip chip-era" data-dpl="chip-era">' + esc(eraName(t)) + '</span>' +
            '<span class="dpl-chip chip-snippet" data-dpl="chip-snippet" style="display:none">Snippet</span>' +
            '<span class="dpl-chip chip-year" data-dpl="chip-year" style="display:none"></span>' +
          '</div>' +
          '<div class="dpl-prog" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="dpl-times" data-dpl="cur">0:00</span>' +
            '<div class="dpl-prog-bar" data-dpl="scrub"><div class="dpl-prog-fill" data-dpl="fill"></div><div class="dpl-knob" data-dpl="knob"></div></div>' +
            '<span class="dpl-times" data-dpl="dur">0:00</span>' +
          '</div>' +
          '<div class="dpl-markers thw-markers" data-thw-markers></div>' +
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
          '<div class="dpl-compose">' +
            '<div class="scc-row">' +
              '<span class="scc-avatar" data-dpl="avatar"><i class="fas fa-user" aria-hidden="true"></i></span>' +
              '<input class="scc-input" data-dpl="comment-input" type="text" maxlength="2000" enterkeyhint="send" placeholder="Comment at 0:00" aria-label="Write a comment">' +
              '<button type="button" class="scc-send" data-dpl="comment-send" aria-label="Send the comment"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
            '</div>' +
            '<div class="scc-moment-row">' +
              '<div class="song-moment-toggle" role="group" aria-label="When this comment applies to">' +
                '<button type="button" class="song-moment-btn is-on" data-dpl="moment-moment">This moment</button>' +
                '<button type="button" class="song-moment-btn" data-dpl="moment-song">Whole song</button>' +
              '</div>' +
            '</div>' +
            '<p class="song-comments-note" data-dpl="comments-note"></p>' +
          '</div>' +
        '</section>' +

        /* -------- the right column: tabbed panel -------- */
        '<section class="dpl-right">' +
          '<button type="button" class="dpl-more" data-dpl="more" aria-label="More options"><i class="fas fa-ellipsis" aria-hidden="true"></i></button>' +
          '<button type="button" class="dpl-collapse" data-dpl="collapse" aria-label="Hide the panel"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' +
          '<nav class="dpl-tabs" aria-label="Now playing panel">' +
            '<button type="button" class="dpl-tab" data-dpl="tab-queue">Up next<small data-dpl="upnext-count"></small></button>' +
            '<button type="button" class="dpl-tab is-active" data-dpl="tab-comments">Comments<small data-dpl="comments-count"></small></button>' +
            '<button type="button" class="dpl-tab" data-dpl="tab-credits">Credits</button>' +
            '<button type="button" class="dpl-tab" data-dpl="tab-playlists">Playlists<small data-dpl="playlists-count"></small></button>' +
          '</nav>' +
          '<div class="dpl-tabpane" data-dpl="pane-queue" hidden>' +
            '<div class="dpl-searchwrap">' +
              '<i class="fas fa-magnifying-glass dpl-search-ic" aria-hidden="true"></i>' +
              '<input class="dpl-search-input" data-dpl="search" type="text" placeholder="Search the vault…" aria-label="Search the vault" autocomplete="off" spellcheck="false">' +
              '<button type="button" class="dpl-search-clear" data-dpl="search-clear" aria-label="Clear the search"><i class="fas fa-xmark" aria-hidden="true"></i></button>' +
              '<div class="dpl-search-results" data-dpl="search-results" hidden></div>' +
            '</div>' +
            '<div class="dpl-npcard">' +
              '<img decoding="async" class="dpl-npcard-cover" data-dpl="np-cover" src="' + esc(cover) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
              '<div class="dpl-npcard-meta"><p class="dpl-npcard-title" data-dpl="np-title">' + esc(title) + '</p><p class="dpl-npcard-sub" data-dpl="np-sub"></p></div>' +
              '<div class="dpl-npcard-right">' +
                '<span class="dpl-eq" data-dpl="np-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
                '<button type="button" class="dpl-npcard-fav" data-dpl="np-fav" aria-label="Favourite" aria-pressed="false"><i class="far fa-heart" aria-hidden="true"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="dpl-upnext-hrow"><span class="dpl-upnext-h">Up next<span class="dpl-upnext-count" data-dpl="queue-count"></span></span>' +
              '<button type="button" class="dpl-clear" data-dpl="clear-queue">Clear</button></div>' +
            '<div data-dpl="queue-list"></div>' +
            '<div data-dpl="autoplay" hidden>' +
              '<div class="dpl-autoplay-h"><span class="dpl-autoplay-label">Autoplay</span></div>' +
              '<div class="dpl-autoplay-row" data-dpl="autoplay-row" role="button" tabindex="0" aria-label="Play the autoplay suggestion">' +
                '<img decoding="async" class="dpl-row-cover" data-dpl="autoplay-cover" src="Juice-WRLD.png" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
                '<div class="dpl-row-meta"><p class="dpl-row-title" data-dpl="autoplay-title"></p>' +
                  '<p class="dpl-row-sub" data-dpl="autoplay-sub">Because: same era</p></div>' +
                '<span class="dpl-row-duration" data-dpl="autoplay-duration"></span>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="dpl-fullqueue" data-dpl="open-fullqueue">Open full queue</button>' +
          '</div>' +
          '<div class="dpl-tabpane" data-dpl="pane-comments">' +
            '<div data-dpl="comments-thread"></div>' +
          '</div>' +
          '<div class="dpl-tabpane" data-dpl="pane-credits" hidden>' +
            '<div class="dpl-credits" data-dpl="credits-grid"></div>' +
          '</div>' +
          '<div class="dpl-tabpane" data-dpl="pane-playlists" hidden>' +
            '<div data-dpl="pl-list-view">' +
              '<div class="dpl-pl-hrow"><span class="dpl-pl-h">Your playlists</span>' +
                '<button type="button" class="dpl-clear" data-dpl="pl-refresh" title="Refresh"><i class="fas fa-rotate-right" aria-hidden="true"></i></button></div>' +
              '<div data-dpl="pl-list"></div>' +
              '<button type="button" class="dpl-pl-newrow" data-dpl="pl-new"><i class="fas fa-plus" aria-hidden="true"></i>New playlist<small>opens your profile</small></button>' +
              '<p class="dpl-pl-manage"><a data-dpl="pl-manage" style="cursor:pointer">Manage your playlists in your profile</a></p>' +
            '</div>' +
            '<div data-dpl="pl-detail-view" hidden>' +
              '<div class="dpl-pl-dhead">' +
                '<button type="button" class="dpl-pl-back" data-dpl="pl-back" aria-label="Back to all playlists"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>' +
                '<div class="dpl-pl-dmeta">' +
                  '<p class="dpl-pl-dname" data-dpl="pl-dname"></p>' +
                  '<p class="dpl-pl-dsub" data-dpl="pl-dsub"></p>' +
                '</div>' +
              '</div>' +
              '<div class="dpl-pl-actions">' +
                '<button type="button" class="dpl-pl-btn primary" data-dpl="pl-playall"><i class="fas fa-play" aria-hidden="true"></i>Play all</button>' +
                '<button type="button" class="dpl-pl-btn" data-dpl="pl-queueall"><i class="fas fa-list-ul" aria-hidden="true"></i>Queue all</button>' +
              '</div>' +
              '<div data-dpl="pl-tracks"></div>' +
            '</div>' +
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
        if (a === "comments-signin") {
          close();
          if (typeof window.switchAppPage === "function") window.switchAppPage("login");
          return;
        }
        if (a === "np-fav") { toggleFav(); refreshQueue(ov); return; }
        if (a === "autoplay-row") {
          if (lastAutoplayPick >= 0) { try { if (window.selectTrackFromList) window.selectTrackFromList(lastAutoplayPick); } catch (err) {} }
          return;
        }
        if (a === "open-fullqueue") {
          close();
          if (typeof window.toggleQueuePanel === "function" && window.matchMedia("(min-width: 1024px)").matches) { try { window.toggleQueuePanel(); } catch (err) {} }
          else if (typeof window.switchAppPage === "function") window.switchAppPage("player");
          return;
        }
        if (a === "versions") { var tt2 = currentTitle(); if (window.openSongPage) { window.openSongPage(tt2); close(); } return; }
        if (a === "songpage") { var tt = currentTitle(); if (window.openSongPage) { window.openSongPage(tt); close(); } return; }
        if (a === "play") { var mp = document.getElementById("deck-play"); if (mp) mp.click(); return; }
        if (a === "prev") { var pb = document.getElementById("prev-btn"); if (pb) pb.click(); else if (document.getElementById("deck-prev")) document.getElementById("deck-prev").click(); return; }
        if (a === "next") { if (typeof nextTrack === "function") nextTrack(); else { var nb = document.getElementById("next-btn"); if (nb) nb.click(); } return; }
        if (a === "shuffle") { if (typeof setShuffle === "function") setShuffle((typeof shuffleMode !== "undefined" && shuffleMode) ? 0 : 1); return; }
        if (a === "repeat") { if (typeof setRepeat === "function") { try { var m = (typeof repeatMode !== "undefined" ? repeatMode : 0); setRepeat(m + 1); } catch (e) { setRepeat(1); } } return; }
        if (a === "mute") { if (typeof toggleMute === "function") toggleMute(); else { var vb = document.getElementById("volume-btn"); if (vb) vb.click(); } return; }
        if (a === "clear-queue") { try { if (typeof clearQueue === "function") window.clearQueue(); } catch (e) {} return; }
        if (a === "tab-queue" || a === "tab-comments" || a === "tab-credits" || a === "tab-playlists") { switchTab(ov, a.slice(4)); return; }
        if (a === "collapse") { setCollapsed(ov, !ov.classList.contains("is-collapsed")); return; }
        if (a === "reveal") { setCollapsed(ov, false); return; }
        if (a === "search-clear") { dplClearSearch(ov); return; }
        if (a === "add-all") {
          var input2 = q(ov, "[data-dpl='search']");
          var matches = dplSearchMatches(input2 ? input2.value : "");
          if (window.queueBulkStart) window.queueBulkStart();
          try {
            for (var i = 0; i < matches.length; i++) { if (typeof addToQueue === "function") addToQueue(matches[i]); }
          } finally { if (window.queueBulkEnd) window.queueBulkEnd(); }
          toast("Added " + matches.length + " songs to the queue", "success");
          if (input2) { input2.value = ""; dplRenderSearch(ov); }
          return;
        }
        if (a === "vault-pull") { if (window.vaultPull) window.vaultPull(); return; }
        if (a === "pl-refresh") { loadPlaylists(ov); return; }
        if (a === "pl-back") { plState.current = null; paintPlView(ov, "list"); return; }
        if (a === "pl-playall") {
          var idxsAll = plMatchedIdxs(plState.current);
          if (idxsAll.length) { try { if (window.selectTrackFromList) window.selectTrackFromList(idxsAll[0]); } catch (e) {} }
          else toast("Nothing in the vault from this playlist", "info");
          return;
        }
        if (a === "pl-queueall") {
          var idxsQ = plMatchedIdxs(plState.current);
          if (!idxsQ.length) { toast("Nothing in the vault from this playlist", "info"); return; }
          var added = 0;
          if (window.queueBulkStart) window.queueBulkStart();
          try {
            for (var qi = 0; qi < idxsQ.length; qi++) { if (typeof addToQueue === "function") { addToQueue(idxsQ[qi]); added++; } }
          } finally { if (window.queueBulkEnd) window.queueBulkEnd(); }
          toast("Queued " + added + (added === 1 ? " track" : " tracks"), "success");
          return;
        }
        if (a === "pl-new") {
          close();
          if (window.viewMyProfile) window.viewMyProfile();
          else if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
          return;
        }
        if (a === "pl-manage") {
          close();
          if (window.viewMyProfile) window.viewMyProfile();
          else if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
          return;
        }
        if (a === "moment-moment") { dplMomentMode = "moment"; paintDplComposer(ov); return; }
        if (a === "moment-song") { dplMomentMode = "song"; paintDplComposer(ov); return; }
        if (a === "comment-send") { dplSendComment(ov); return; }
        if (a === "open-panel") { close(); var b = document.getElementById("song-comments-btn"); if (b) b.click(); return; }
      } catch (err) {}
      setTimeout(function () { sync(true); }, 120);
    });

    bindDplQueueDrag(ov);

    /* the volume slider */
    /* the moment labels follow the song */
    var dinput = q(ov, "[data-dpl='comment-input']");
    if (dinput) {
      dinput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); dplSendComment(ov); }
      });
    }
    var sInput = q(ov, "[data-dpl='search']");
    if (sInput) {
      sInput.addEventListener("input", function () { dplRenderSearch(ov); });
      sInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); dplClearSearch(ov); return; }
        if (e.key === "Enter") {
          var matches = dplSearchMatches(sInput.value);
          if (matches.length) {
            e.preventDefault();
            try { if (window.selectTrackFromList) window.selectTrackFromList(matches[0]); } catch (err) {}
            sInput.value = "";
            dplRenderSearch(ov);
            sInput.blur();
          }
        }
      });
    }

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
    if (name === "playlists") loadPlaylists(ov);
  }

  /* ------------------------------------------------------------------ */
  /* the playlists tab                                                  */
  /* ------------------------------------------------------------------ */
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
    var listView = q(ov, "[data-dpl='pl-list-view']");
    var detailView = q(ov, "[data-dpl='pl-detail-view']");
    if (listView) listView.hidden = view !== "list";
    if (detailView) detailView.hidden = view !== "detail";
  }

  function loadPlaylists(ov) {
    var box = q(ov, "[data-dpl='pl-list']");
    if (!box) return;
    plState.current = null;
    paintPlView(ov, "list");
    box.innerHTML = '<div class="dpl-pl-empty"><i class="fas fa-compact-disc"></i>Loading your playlists…</div>';

    fetch("/api/playlists", { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) return { status: 401, d: null };
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
      })
      .then(function (res) {
        if (!document.getElementById(OV)) return;
        box.textContent = "";
        var tabBadge = q(ov, "[data-dpl='playlists-count']");
        if (res.status === 401) {
          if (tabBadge) tabBadge.textContent = "";
          box.innerHTML = '<div class="dpl-pl-empty"><i class="fas fa-user"></i><b>Sign in to see your playlists</b><br>The playlists you make live on your account.<br><a href="/login">Sign in</a></div>';
          return;
        }
        var list = (res.d && Array.isArray(res.d.playlists)) ? res.d.playlists : [];
        plState.list = list;
        if (tabBadge) tabBadge.textContent = list.length ? String(list.length) : "";
        if (!list.length) {
          box.innerHTML = '<div class="dpl-pl-empty"><i class="fas fa-compact-disc"></i><b>No playlists yet</b><br>Make one in your profile, or hit the + on any song to save it.</div>';
          return;
        }
        list.forEach(function (pl) {
          var count = Number(pl.count) || (pl.tracks || []).length || 0;
          var vis = pl.visibility === "public" ? "Public" : pl.visibility === "unlisted" ? "Unlisted" : "Private";
          var b = document.createElement("button");
          b.type = "button";
          b.className = "dpl-pl-card";
          b.innerHTML =
            '<span class="dpl-pl-dot" style="background:' + esc(pl.color || "#a855f7") + '"></span>' +
            '<span class="dpl-pl-card-meta">' +
              '<span class="dpl-pl-name">' + esc(pl.name || "Playlist") + '</span><br>' +
              '<span class="dpl-pl-sub">' + count + (count === 1 ? " song" : " songs") + " · " + esc(vis) + "</span>" +
            "</span>" +
            '<i class="fas fa-chevron-right" style="color:rgba(255,255,255,.3)" aria-hidden="true"></i>';
          b.addEventListener("click", function () { openPlaylistDetail(ov, pl); });
          box.appendChild(b);
        });
      })
      .catch(function () {
        if (!document.getElementById(OV)) return;
        box.innerHTML = '<div class="dpl-pl-empty"><i class="fas fa-triangle-exclamation"></i>The playlists could not be loaded.<br>Check your connection and try again.</div>';
      });
  }

  function openPlaylistDetail(ov, pl) {
    plState.current = pl;
    var nameEl = q(ov, "[data-dpl='pl-dname']");
    var subEl = q(ov, "[data-dpl='pl-dsub']");
    var tracks = (pl && pl.tracks) || [];
    var vis = pl.visibility === "public" ? "Public" : pl.visibility === "unlisted" ? "Unlisted" : "Private";
    var count = tracks.length;
    if (nameEl) nameEl.textContent = pl.name || "Playlist";
    if (subEl) subEl.textContent = count + (count === 1 ? " song" : " songs") + " · " + vis;

    var wrap = q(ov, "[data-dpl='pl-tracks']");
    if (wrap) {
      wrap.textContent = "";
      if (!tracks.length) {
        wrap.innerHTML = '<div class="dpl-pl-empty"><i class="fas fa-compact-disc"></i><b>Nothing in here yet</b><br>Add songs from the player or any song page with the + button.</div>';
      } else {
        tracks.forEach(function (tr) {
          var row = document.createElement("div");
          row.className = "dpl-row";
          var title = String(tr.title || "");
          var idx = plCatalogueIndex(title);
          var t = null;
          try { if (idx >= 0 && typeof trackList !== "undefined" && trackList) t = trackList[idx]; } catch (e) {}
          var src = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
          row.innerHTML =
            '<img decoding="async" class="dpl-row-cover" loading="lazy" src="' + esc(coverThumb(src, "64")) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
            '<div class="dpl-row-meta">' +
              '<p class="dpl-row-title">' + esc(title || "Untitled") + '</p>' +
              '<p class="dpl-row-sub">' + (t ? esc(eraName(t) + (catLabel(t) ? " · " + catLabel(t) : "")) : "Not in the vault") + "</p></div>" +
            '<span class="dpl-row-duration">' + (t ? esc(fmt(Number(t.duration) || 0)) : "") + "</span>" +
            '<button type="button" class="dpl-row-x" data-plrm aria-label="Remove from this playlist"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
          row.addEventListener("click", function (e) {
            var rm = e.target.closest ? e.target.closest("[data-plrm]") : null;
            if (rm) {
              e.stopPropagation();
              fetch("/api/playlists", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ action: "remove", id: pl.id, track_id: tr.id }),
              }).then(function (r) { return r.json().catch(function () { return {}; }); })
                .then(function (d) {
                  if (d && d.ok && d.playlist) {
                    toast("Removed from the playlist", "info");
                    openPlaylistDetail(ov, d.playlist);
                  } else {
                    toast((d && (d.error || d.message)) || "Could not remove that song", "error");
                  }
                })
                .catch(function () { toast("Could not remove that song", "error"); });
              return;
            }
            if (idx < 0) { toast("This song is not in the vault yet", "info"); return; }
            try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {}
          });
          wrap.appendChild(row);
        });
      }
    }
    paintPlView(ov, "detail");
  }

  function loadComments(ov) {
    var box = q(ov, "[data-dpl='comments-thread']");
    var title = currentTitle();
    if (!box) return;
    if (!signedInDpl()) {
      /* Signed out: a designed call to action instead of a dead list. */
      box.innerHTML =
        '<div class="dpl-signin">' +
          '<div class="dpl-signin-ic"><i class="far fa-comment-dots" aria-hidden="true"></i></div>' +
          '<p class="dpl-signin-t">Sign in to join the conversation</p>' +
          '<p class="dpl-signin-s">Every comment on the vault is from a signed-in member. Sign in to read along and add your own at any moment of the song.</p>' +
          '<button type="button" class="dpl-signin-btn" data-dpl="comments-signin"><i class="fas fa-right-to-bracket" aria-hidden="true"></i>Sign in to comment</button>' +
        '</div>';
      paintDplComposer(ov);
      return;
    }
    if (!window.SongComments || typeof window.SongComments.renderThreadInto !== "function") {
      box.innerHTML = '<p class="dpl-row-empty">The comments could not be loaded.</p>';
      return;
    }
    window.SongComments.renderThreadInto(box, title);
    paintDplComposer(ov);
    /* Signed in but nobody has said anything yet: a designed empty state. */
    setTimeout(function () {
      try {
        if (!/No comments yet/i.test(box.textContent || "")) return;
        if (box.querySelector(".dpl-nocomments")) return;
        box.innerHTML =
          '<div class="dpl-nocomments">' +
            '<i class="far fa-comment-dots" aria-hidden="true"></i>' +
            '<b>No comments yet</b>' +
            '<span>Be the first — drop a comment at the exact moment that hits, like a real one.</span>' +
          '</div>';
      } catch (e) {}
    }, 350);
    var cnt = document.getElementById("song-comments-count");
    var badge = q(ov, "[data-dpl='comments-count']");
    if (badge && cnt) badge.textContent = cnt.textContent || "0";
  }

  /* The version marker — v1, v2.1, whatever the vault says it is. Only the
     marker, never the rest of the tag. */
  function versionLabel(t) {
    var tag = String((t || {}).tag || "");
    var m = tag.match(/\(v(\d+(?:\.\d+){0,2}[a-z]?)\)/i);
    return m ? "v" + m[1] : "";
  }

  /* Alt names — the other titles the vault has filed this song under.
     The tag carries them: everything in parentheses that is not the
     category, the era, or a version marker is an alternate name. */
  function altNames(t) {
    var tag = String((t || {}).tag || "");
    var out = [];
    var re = /\(([^()]*)\)/g;
    var m;
    var ERA = { "GB&GR":1, "WOD":1, "DRFL":1, "JW3":1, "POST":1, "OUT":1, "AF":1, "ND":1, "BDM":1, "SOUNDCLOUD":1 };
    while ((m = re.exec(tag))) {
      var tok = m[1].trim();
      if (!tok) continue;
      var low = tok.toLowerCase();
      if (low === "sessions" || low === "leaks" || low === "leaked" || low === "halloween") continue;
      if (/^v\d+(\.\d+)?$/i.test(low)) continue;
      if (ERA[tok.toUpperCase()]) continue;
      out.push(tok);
    }
    return out;
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
      var labelSpan = document.createElement("span");
      labelSpan.className = "dpl-credit-label";
      labelSpan.textContent = String(label);
      c.appendChild(labelSpan);
      if (opts.link) {
        var a = document.createElement("a");
        a.className = "dpl-credit-value dpl-credit-link";
        a.href = opts.link;
        a.textContent = String(value);
        var eraSlugFromLink = opts.link.indexOf("/era/") === 0 ? (opts.link.split("/era/")[1] || "") : "";
        if (eraSlugFromLink) {
          a.addEventListener("click", function (ev) {
            if (window.openEraPage) { ev.preventDefault(); window.openEraPage(eraSlugFromLink); }
          });
        }
        c.appendChild(a);
      } else {
        var span = document.createElement("span");
        span.className = "dpl-credit-value";
        span.textContent = String(value);
        c.appendChild(span);
      }
      grid.appendChild(c);
    }
    var cat = String(t.category || "").toLowerCase();
    cell("Status", cat === "leaks" ? "Leaked" : cat === "sessions" ? "Session" : cat === "halloween" ? "Halloween" : "");
    var era = eraCode(t);
    cell("Era", eraName(t), { link: "/era/" + eraSlug(t) });
    var alts = altNames(t);
    if (alts.length) cell("Alt names", alts.join(" · "), { wide: true });
    var vlabel = versionLabel(t);
    if (vlabel) cell("Version", vlabel);
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

  /* ---- drag to reorder Up next rows — grip only, pointer events ---- */
  var dplDragActive = false;
  function bindDplQueueDrag(ov) {
    var list = ov.querySelector("[data-dpl='queue-list']");
    if (!list || list._thwDplDragWired) return;
    list._thwDplDragWired = true;
    var drag = null; /* {row, from, overRow, below} */

    function clearMarks() {
      qa(ov, ".dpl-row").forEach(function (r) { r.classList.remove("is-dragging", "drop-above", "drop-below"); });
    }
    function rowFromPoint(x, y) {
      try {
        var el = document.elementFromPoint(x, y);
        var row = el && el.closest ? el.closest(".dpl-row") : null;
        if (row && list.contains(row)) return row;
      } catch (e) {}
      return null;
    }
    list.addEventListener("pointerdown", function (e) {
      var grip = e.target.closest ? e.target.closest(".dpl-row-grip") : null;
      if (!grip) return;
      var row = grip.closest(".dpl-row");
      if (!row) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      var qi = Number(row.getAttribute("data-qi"));
      if (!isFinite(qi)) return;
      drag = { row: row, from: qi, overRow: null, below: false };
      dplDragActive = true;
      row.classList.add("is-dragging");
    }, { passive: false });
    list.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (e.cancelable) e.preventDefault();
      var row = rowFromPoint(e.clientX, e.clientY);
      qa(ov, ".dpl-row").forEach(function (r) { r.classList.remove("drop-above", "drop-below"); });
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
      dplDragActive = false;
      clearMarks();
      var to = -1;
      if (targetRow) {
        var ti = Number(targetRow.getAttribute("data-qi")) || 0;
        to = below ? ti + 1 : ti;
        if (ti > from) to -= 1;
      }
      if (to >= 0 && typeof window.moveQueueItemTo === "function") {
        try { window.moveQueueItemTo(from, to); } catch (err2) {}
        refreshQueue(ov);
      }
    }
    list.addEventListener("pointerup", endDrag);
    list.addEventListener("pointercancel", function () {
      drag = null;
      dplDragActive = false;
      clearMarks();
    });
  }

  var lastAutoplayPick = -1;
  var DPL_ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;
  function dplEraCode(t) {
    var m = String((t && t.tag) || "").match(DPL_ERA_RE);
    return m ? m[1].toUpperCase() : (t && t.category === "halloween" ? "POST" : "");
  }
  /* Same-base-title versions in the vault — feeds the "3 versions" pill. */
  function dplVersionCount(t) {
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
  /* The autoplay pick: the first same-era song in the vault that is not the
     one playing. Deterministic — the same song every time for a given track,
     which is what makes it predictable enough to be labelled "Because: same era". */
  function dplAutoplayPick(t) {
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      var code = dplEraCode(t);
      if (!code) return -1;
      var curBase = String((t && t.title) || "").split("(")[0].trim().toLowerCase();
      for (var i = 0; i < trackList.length; i++) {
        if (dplEraCode(trackList[i]) !== code) continue;
        var base = String((trackList[i] && trackList[i].title) || "").split("(")[0].trim().toLowerCase();
        if (base === curBase) continue;
        return i;
      }
    } catch (e) {}
    return -1;
  }

  function refreshQueue(ov) {
    if (dplDragActive) return; /* don't rebuild rows mid-drag */
    var t = currentTrack();
    /* the pinned now-playing card */
    var npCov = q(ov, "[data-dpl='np-cover']");
    if (npCov) {
      var npsrc = t && t.cover ? String(t.cover) : "Juice-WRLD.png";
      if (npCov.getAttribute("src") !== npsrc) npCov.setAttribute("src", npsrc);
    }
    var npTitle = q(ov, "[data-dpl='np-title']");
    if (npTitle) npTitle.textContent = currentTitle();
    var npSub = q(ov, "[data-dpl='np-sub']");
    if (npSub) npSub.textContent = t ? eraName(t) + (catLabel(t) ? " · " + catLabel(t) : "") : "";
    var npEq = q(ov, "[data-dpl='np-eq']");
    if (npEq) npEq.classList.toggle("is-playing", playing());
    var npFav = q(ov, "[data-dpl='np-fav']");
    if (npFav) {
      var nf = false;
      try { if (currentIndex() >= 0 && typeof isFavorite === "function") nf = !!isFavorite(currentIndex()); } catch (e) {}
      npFav.classList.toggle("is-on", nf);
      npFav.setAttribute("aria-pressed", nf ? "true" : "false");
      npFav.innerHTML = '<i class="' + (nf ? "fas" : "far") + ' fa-heart" aria-hidden="true"></i>';
    }

    /* autoplay — a real same-era pick, hidden when it cannot be made or the
       listener turned autoplay off in settings */
    var apBox = q(ov, "[data-dpl='autoplay']");
    if (apBox) {
      var wantsAutoplay = true;
      try { if (window.wrldPlayerSettings && window.wrldPlayerSettings.get("autoplaySimilar") === false) wantsAutoplay = false; } catch (e) {}
      var pick = wantsAutoplay ? dplAutoplayPick(t) : -1;
      if (pick >= 0) {
        apBox.hidden = false;
        var at = null;
        try { at = (typeof trackList !== "undefined" && trackList) ? trackList[pick] : null; } catch (e) {}
        var ac = q(ov, "[data-dpl='autoplay-cover']");
        if (ac) { var asrc = at ? coverThumb(at.cover, "64") : "Juice-WRLD.png"; if (ac.getAttribute("src") !== asrc) ac.setAttribute("src", asrc); }
        var ati = q(ov, "[data-dpl='autoplay-title']");
        if (ati) ati.textContent = (at && at.title) || ("Track " + (pick + 1));
        var adur = q(ov, "[data-dpl='autoplay-duration']");
        if (adur) adur.textContent = fmt((at && Number(at.duration)) || 0);
        lastAutoplayPick = pick;
      } else {
        apBox.hidden = true;
        lastAutoplayPick = -1;
      }
    }

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
        row.setAttribute("data-qi", String(qi));
        row.innerHTML =
          '<button type="button" class="dpl-row-grip" tabindex="-1" aria-label="Drag to reorder"><i class="fas fa-grip-vertical" aria-hidden="true"></i></button>' +
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
    qa(ov, "[data-dpl='albumline']").forEach(function (el) {
      var albumText = "";
      try {
        if (typeof getTrackAlbum === "function" && t) albumText = String(getTrackAlbum(t) || "");
        else if (t) albumText = String(t.tag || "");
      } catch (e) {}
      var prev = el.getAttribute("data-cur") || "";
      if (prev !== albumText) {
        el.setAttribute("data-cur", albumText);
        el.innerHTML = albumText ? '<i class="fas fa-compact-disc" aria-hidden="true"></i><span>' + esc(albumText) + '</span>' : '';
        el.style.display = albumText ? "" : "none";
      }
    });

    qa(ov, "[data-dpl='album']").forEach(function (el) {
      var label = "";
      try {
        /* the tag's trailing parenthesis is this version's name ("Session edit",
           "Sessions") — the honest bit of metadata the vault carries */
        var m2 = String((t && t.title) || "").match(/\(([^)]*)\)\s*$/);
        var v = m2 ? String(m2[1] || "").trim() : "";
        label = v;
        if (!label && typeof getTrackAlbum === "function" && t) label = String(getTrackAlbum(t) || "");
        if (!label && t) label = eraName(t);
      } catch (e) {}
      el.textContent = label;
      el.style.display = label ? "" : "none";
    });
    qa(ov, "[data-dpl='cover']").forEach(function (img) {
      var src = "Juice-WRLD.png";
      try { if (t && window.wrldCoverFor) src = window.wrldCoverFor(t); else if (t && t.cover) src = String(t.cover); } catch (e) { if (t && t.cover) src = String(t.cover); }
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
    var versN = q(ov, "[data-dpl='versions-n']");
    if (versN) {
      var vc = dplVersionCount(t);
      versN.textContent = vc > 1 ? " · " + vc + " versions" : "";
    }
    var snip = q(ov, "[data-dpl='chip-snippet']");
    if (snip) snip.style.display = /snippet/i.test(String((t && t.tag) || "")) ? "" : "none";
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

    /* volume fill — read the element's own volume: keyboard shortcuts and the
       deck's slider both land on the audio element, not on any global */
    var volFill = q(ov, "[data-dpl='vol-fill']");
    if (volFill) {
      var au = audioEl();
      var v = au && isFinite(au.volume) ? Math.max(0, Math.min(1, Number(au.volume) || 0)) : 0.75;
      volFill.style.width = Math.round(v * 100) + "%";
    }

    /* the mute button shows the level, like the deck's does */
    var muteBtn = q(ov, "[data-dpl='mute']");
    if (muteBtn) {
      var au2 = audioEl();
      var vw = au2 && isFinite(au2.volume) ? Number(au2.volume) || 0 : 1;
      var ic = muteBtn.querySelector("i");
      if (ic) ic.className = vw === 0 ? "fas fa-volume-xmark" : vw < 0.5 ? "fas fa-volume-low" : "fas fa-volume-high";
    }

    /* the composer follows the song's clock */
    var cp = q(ov, "[data-dpl='pane-comments']");
    if (cp && !cp.hidden) paintDplComposer(ov);

    /* track changed: refresh the tab that shows the song */
    if (force || lastSync.title !== currentTitle()) {
      lastSync.title = currentTitle();
      if (window.THWCommentMarkers) window.THWCommentMarkers.refresh(ov);
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
    restoreCollapsed(ov);
    stopSync();
    syncIv = setInterval(function () { sync(false); }, 1000);
    sync(true);
    loadComments(ov);
    if (window.THWCommentMarkers) window.THWCommentMarkers.refresh(ov);
  }

  function close() {
    stopSync();
    var ov = document.getElementById(OV);
    if (ov) ov.remove();
  }

  /* ================================================================== */

  window.openDesktopPlayer = open;
  window.closeDesktopPlayer = close;
  /* Moving colours live: flip the bg animation the moment the toggle does,
     without waiting for a track change. */
  try {
    window.addEventListener("thw:appearance-changed", function () {
      var ov = document.getElementById(OV);
      if (ov) { lastBg = null; paintBackground(ov); }
    });
  } catch (e) {}
  /* The context menu's "My playlists" opens the sheet straight onto it. */
  window.openDesktopPlaylists = function () {
    open();
    var ov = document.getElementById(OV);
    if (ov) switchTab(ov, "playlists");
  };

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
