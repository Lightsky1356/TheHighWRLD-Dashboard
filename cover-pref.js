/* ============================================================================
   COVER PREFERENCE - "Song covers" / "Era covers" in Settings > Appearance
   ---------------------------------------------------------------------------
   'song'  Every track wears its own cover. This is the vault's historic look.
   'era'   Every track wears its era's cover, where the vault holds one
           (GB&GR, DRFL, JW3, POST, 999). Tracks whose era has no art keep
           their own cover.

   The vault stores one cover per track in trackList[].cover, so the
   preference is applied at the three call sites that fetch it for the
   UI the listener stares at: the player, Now Playing art and the track
   page. Track lists keep song art either way - swapping hundreds of
   background-images for a preference nobody can see until they click
   Settings would be worse than honest copy.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var ERA_ART = {
    "GB&GR": "AlbumArt/goodbye.jpg",
    "DRFL": "AlbumArt/death.jpg",
    "JW3": "AlbumArt/legends.jpg",
    "POST": "AlbumArt/party.jpg",
    "999": "AlbumArt/999.jpg",
    "JW999": "AlbumArt/999.jpg"
  };
  /* Strip the ANSI leftovers some tags carry, then take era tags - the
     form is do"..." (title words) ... (ERA) with spaces between. */
  function eraOf(track) {
    if (!track) return null;
    var tag = String(track.tag || track.title || "").replace(/\[?\d+m/g, "");
    var m = tag.match(/\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH)\)(?:\s*[)\]]?)*\s*$/i);
    if (!m) m = tag.match(/\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH)\)/i);
    return m ? m[1].toUpperCase().replace(/^JW999$/, "999") : null;
  }

  function pref() {
    try {
      return (window.wrldPlayerSettings && window.wrldPlayerSettings.get("coversPref")) || "song";
    } catch (e) { return "song"; }
  }

  window.movingColors = function () {
    try { return !(window.wrldPlayerSettings && window.wrldPlayerSettings.get("movingColors") === false); } catch (e) { return true; }
  };

  window.wrldCoverFor = function (track) {
    var own = (track && track.cover) || "Juice-WRLD.png";
    if (pref() !== "era") return own;
    var era = eraOf(track);
    return (era && ERA_ART[era]) ? ERA_ART[era] : own;
  };

  function toAlpha(color, a) {
    var c = String(color || "").trim();
    var m = c.match(/^hsl\(([^)]+)\)$/i);
    if (m) return "hsla(" + m[1] + "," + a + ")";
    m = c.match(/^rgb\(([^)]+)\)$/i);
    if (m) return "rgba(" + m[1] + "," + a + ")";
    m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h, 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }
    return c;
  }

  /* "Auto" theme: the whole page background wears the current cover's
     gradient, the same way the reference player does. The two hues come from
     the real cover map, and the theme is reset the moment Auto is left. */
  function currentCover() {
    try {
      if (typeof currentTrackIndex === "number" && typeof trackList !== "undefined" && trackList && trackList[currentTrackIndex]) {
        return window.wrldCoverFor(trackList[currentTrackIndex]);
      }
    } catch (_) {}
    return "";
  }
  /* script.js owns the Auto palette (it has the cover-map colour helpers and
     repaints on every track change). This module only tells it which cover is
     actually on screen, so "Era covers" and song covers stay in sync and no
     second writer fights over the theme variables. */
  function paintAutoTheme() {
    try {
      var theme = document.documentElement.getAttribute("data-theme") || "default";
      if (theme !== "default" && theme !== "auto") {
        if (window.thwClearAmbient) window.thwClearAmbient();
        return;
      }
      /* No cover yet at boot is not a reason to clear - script.js may have
         just painted from the loaded track. Leave the palette alone. */
      var cover = currentCover();
      if (!cover) return;
      if (window.thwPaintAmbient) window.thwPaintAmbient(cover);
    } catch (_) {}
  }
  window.paintAutoTheme = paintAutoTheme;

  /* The gradient wash behind the WRLD Deck - the deck's own slice of
     Moving colours. Painted from the same two accent hues as the full
     sheets, and animated by the same class the sheets use. */
  function paintDeckWash() {
    try {
      var wash = document.getElementById('deck-cover-wash');
      if (!wash) return;
      var cur = null;
      try {
        if (typeof currentTrackIndex === 'number' && typeof trackList !== 'undefined' && trackList && trackList[currentTrackIndex]) {
          cur = trackList[currentTrackIndex];
        }
      } catch (_) {}
      var on = !!window.movingColors() && !!cur && !!cur.cover && !!window.coverGradientsOn && window.coverGradientsOn();
      var cls = "thw-moving-gradient";
      if (!on) { wash.classList.remove("on"); wash.classList.remove(cls); wash.style.background = "none"; return; }
      var gradient = null;
      try { if (typeof getCoverGradientValue === "function") gradient = getCoverGradientValue(cur.cover); } catch (_) {}
      var cols = gradient ? (String(gradient).match(/hsl\([^)]+\)|rgb\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || []) : [];
      var c1 = cols[0] || "hsl(266,60%,58%)";
      var c2 = cols[1] || "hsl(20,72%,30%)";
      wash.style.background =
        "radial-gradient(70% 130% at 8% 50%, " + toAlpha(c1, 0.5) + " 0%, transparent 62%)," +
        "radial-gradient(60% 130% at 92% 50%, " + toAlpha(c2, 0.4) + " 0%, transparent 58%)";
      wash.classList.add("on");
      wash.classList.add(cls);
    } catch (_) {}
  }

  /* The deck cover is painted by the player directly, outside this module,
     so it never visits wrldCoverFor. Keep it honest: watch the img and
     swap to era art when the reader wants era covers, back to song art
     when they don't. */
  function paintDeckCover() {
    try {
      var deck = document.getElementById('deck-cover');
      if (!deck) return;
      var cur = null;
      try {
        if (typeof currentTrackIndex === 'number' && typeof trackList !== 'undefined' && trackList && trackList[currentTrackIndex]) {
          cur = trackList[currentTrackIndex];
        }
      } catch (_) {}
      var want = window.wrldCoverFor(cur);
      if (want && deck.getAttribute('src') !== want) deck.setAttribute('src', want);
      paintDeckWash();
      paintControlIcons();
      paintAutoTheme();
    } catch (_) {}
  }
  /* The transport icons wear the current cover's gradient, darkened in CSS. */
  function paintControlIcons() {
    try {
      var cover = currentCover();
      if (!cover) return;
      var raw = (typeof coverGradientRaw === "function") ? coverGradientRaw(cover)
        : (typeof getCoverGradientValue === "function" ? getCoverGradientValue(cover) : "");
      if (!raw) return;
      var root = document.documentElement;
      root.style.setProperty("--thw-cover-grad", String(raw));
      var cols = String(raw).match(/hsl\([^)]+\)|rgb\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || [];
      if (cols[0]) root.style.setProperty("--thw-cover-c1", cols[0]);
      if (cols[1]) root.style.setProperty("--thw-cover-c2", cols[1]);
    } catch (_) {}
  }
  window.paintControlIcons = paintControlIcons;

  window.paintDeckWash = paintDeckWash;
  window.addEventListener('thw:appearance-changed', function () { paintDeckCover(); paintAutoTheme(); });
  window.addEventListener('thw:trackplaying', function () { paintAutoTheme(); paintControlIcons(); });
  function bootPaint() {
    /* Nothing may be playing on load. thwPaintAmbientSync falls back to the
       first catalogue cover, so Auto still has a real palette to wear. */
    if (typeof window.thwPaintAmbientSync === "function") {
      try { window.thwPaintAmbientSync(document.documentElement.getAttribute("data-theme") || "default"); } catch (e) {}
    } else {
      paintAutoTheme();
    }
    paintControlIcons();
  }
  bootPaint();
  /* The first paint can run before script.js has built coverGradientMap, so
     the cover lookup throws and nothing is painted. Repaint once the DOM is
     ready and every gradient helper exists. */
  if (document.readyState !== "complete") document.addEventListener("DOMContentLoaded", bootPaint, { once: true });
  if (typeof MutationObserver === 'function') {
    try {
      var deck = document.getElementById('deck-cover');
      if (deck) {
        var mo = new MutationObserver(function () { paintDeckCover(); });
        mo.observe(deck, { attributes: true, attributeFilter: ['src'] });
      }
      var themeObserver = new MutationObserver(paintAutoTheme);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (_) {}
  }
})();
