/* Six live previews of how the playing cover's own colours become the theme.
   Tapping one saves the palette and repaints Auto; previews refresh with the
   track so they always show the artwork actually on screen. */
(function () {
  "use strict";

  var PALETTES = [
    ["default", "Default", "cover order"],
    ["blobs", "Blobs", "colour circles"],
    ["glow", "Glow", "colour pools"],
    ["wash", "Wash", "full gradient"],
    ["wave", "Wave", "flowing"],
    ["liquid", "Liquid", "cover flow"],
    ["ripple", "Ripple", "colour rings"],
    ["prism", "Prism", "angled bands"],
    ["sunrise", "Sunrise", "bottom up"]
  ];
  var root = null, current = "default";

  function colors() {
    var g = "";
    try {
      var t = (typeof currentTrackIndex === "number" && currentTrackIndex >= 0 &&
        typeof trackList !== "undefined" && trackList && trackList[currentTrackIndex])
        ? (window.wrldCoverFor ? window.wrldCoverFor(trackList[currentTrackIndex]) : trackList[currentTrackIndex].cover)
        : "";
      if (t && typeof getCoverGradientValue === "function") g = getCoverGradientValue(t) || "";
    } catch (e) {}
    if (!g && typeof getCoverGradientValue === "function") {
      try { g = getCoverGradientValue("Juice-WRLD.png") || ""; } catch (e) {}
    }
    if (!g) g = "linear-gradient(135deg,hsl(220,64%,37%),hsl(280,50%,30%),hsl(340,60%,40%),hsl(20,70%,35%))";
    var m = String(g).match(/hsla?\([^)]+\)|rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || [];
    while (m.length < 4) m.push(m[m.length - 1] || "#7c3aed");
    return m.slice(0, 4);
  }

  function preview(id, c) {
    if (id === "blobs") {
      return "radial-gradient(circle at 30% 35%," + c[0] + " 0 26%,transparent 28%)," +
        "radial-gradient(circle at 68% 62%," + c[1] + " 0 22%,transparent 24%)," +
        "radial-gradient(circle at 80% 22%," + c[2] + " 0 16%,transparent 18%),#151020";
    }
    if (id === "glow") {
      return "radial-gradient(circle at 25% 20%," + c[0] + ",transparent 70%)," +
        "radial-gradient(circle at 80% 70%," + c[2] + ",transparent 70%),#151020";
    }
    if (id === "wash") return "linear-gradient(135deg," + c.join(",") + ")";
    if (id === "wave") return "linear-gradient(135deg," + c.join(",") + "," + c[0] + ")";
    if (id === "liquid") {
      return "radial-gradient(ellipse at 25% 30%," + c[0] + ",transparent 65%)," +
        "radial-gradient(ellipse at 75% 65%," + c[2] + ",transparent 65%)," +
        "linear-gradient(135deg," + c.join(",") + ")";
    }
    if (id === "ripple") {
      return "radial-gradient(circle at 50% 50%," + c[0] + " 0 18%,transparent 20%)," +
        "radial-gradient(circle at 50% 50%," + c[1] + " 0 34%,transparent 36%)," +
        "radial-gradient(circle at 50% 50%," + c[2] + " 0 50%,transparent 52%),#151020";
    }
    if (id === "prism") {
      return "linear-gradient(120deg," + c[0] + " 0 25%," + c[1] + " 25% 50%," + c[2] + " 50% 75%," + c[3] + " 75% 100%)";
    }
    if (id === "sunrise") return "linear-gradient(0deg," + c.slice().reverse().join(",") + ")";
    return c.join(",");
  }

  function paintCount() {
    var sel = document.getElementById("coverColorCount");
    var box = document.getElementById("colorCountPreview");
    if (!sel || !box) return;
    var c = colors();
    var want = Number(sel.value) || c.length;
    var use = c.slice(0, Math.max(2, Math.min(c.length, want)));
    box.innerHTML = use.map(function (x) { return '<span style="background:' + x + '"></span>'; }).join("");
  }

  function alpha(c, a) {
    var m = /^hsl\(([^)]+)\)$/i.exec(String(c || ""));
    if (m) return "hsla(" + m[1] + "," + a + ")";
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(c || ""));
    if (m) return "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + a + ")";
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || ""));
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }
    return c;
  }

  /* The full-sheet players call this so the selected palette is the actual
     sheet background, not a row of buttons floating over it. */
  window.thwSheetPaletteBg = function (cols, base) {
    var p = "default";
    try { p = (window.wrldPlayerSettings && window.wrldPlayerSettings.get("coverPalette")) || "default"; } catch (e) {}
    var c = cols || [], n = c.length, layers = [], i;
    if (!n) return base;
    if (p === "wash") {
      layers.push("linear-gradient(135deg," + c.join(",") + ")");
    } else if (p === "prism") {
      for (i = 0; i < n; i++) layers.push("linear-gradient(" + (110 + i * 18) + "deg,transparent " + (i * 100 / n) + "%," + alpha(c[i], .35) + " " + (i * 100 / n + 18) + "%,transparent " + (i * 100 / n + 36) + "%)");
    } else if (p === "sunrise") {
      layers.push("linear-gradient(0deg," + c.slice().reverse().join(",") + ")");
    } else if (p === "ripple") {
      for (i = 0; i < n; i++) layers.push("radial-gradient(circle at 50% 45%," + alpha(c[i], .34) + " 0 " + (280 + i * 220) + "px,transparent " + (460 + i * 220) + "px)");
    } else if (p === "liquid") {
      for (i = 0; i < n; i++) layers.push("radial-gradient(ellipse 70% 50% at " + (15 + i * 25) + "% " + (28 + i * 16) + "%," + alpha(c[i], .46) + ",transparent 68%)");
    } else if (p === "blobs") {
      for (i = 0; i < n; i++) layers.push("radial-gradient(circle at " + (20 + i * 20) + "% " + (28 + i * 12) + "%," + alpha(c[i], .52) + " 0 18%,transparent 32%)");
    } else if (p === "wave") {
      for (i = 0; i < n; i++) layers.push("radial-gradient(ellipse 120% 45% at " + (i * 30) + "% " + (i % 2 ? 76 : -6) + "%," + alpha(c[i], .44) + ",transparent 60%)");
      layers.push("linear-gradient(135deg," + c.join(",") + "," + c[0] + ")");
    } else {
      var xs = [50, 88, 6, 32], ys = [-12, 26, 52, 82];
      for (i = 0; i < n; i++) layers.push("radial-gradient(130% 62% at " + xs[i % 4] + "% " + ys[i % 4] + "%," + alpha(c[i], i === 0 ? .78 : .4) + " 0%,transparent 62%)");
      if (p !== "glow") layers.push("linear-gradient(135deg," + c.map(function (x) { return alpha(x, .18); }).join(",") + ")");
    }
    layers.push(base || "linear-gradient(180deg,#17120f,#100d0b)");
    return layers.join(",");
  };

  function speedLabel() {
    var d = "normal", p = "normal";
    try {
      d = window.wrldPlayerSettings.get("coverDrift") || "normal";
      p = window.wrldPlayerSettings.get("coverPaletteSpeed") || "normal";
    } catch (e) {}
    return { drift: d, palette: p };
  }

  function syncVisibleControls() {
    var s = speedLabel();
    var db = document.getElementById("driftBadge");
    var pb = document.getElementById("paletteSpeedBadge");
    if (db) db.textContent = s.drift;
    if (pb) pb.textContent = s.palette;
    var label = document.getElementById("paletteStageLabel");
    if (label) {
      label.textContent = current.toUpperCase() + " · " +
        (current === "default" || current === "blobs" || current === "glow" || current === "wash"
          ? "Drift " + s.drift : "Palette " + s.palette);
    }
    if (root) Array.prototype.forEach.call(root.children, function (b) {
      var meta = b.querySelector(".palette-meta");
      if (!meta) return;
      var id = b.getAttribute("data-palette");
      var isPaletteMotion = ["wave", "liquid", "ripple", "prism", "sunrise"].indexOf(id) >= 0;
      var blob = id === "blobs" ? "BLOBS · " : (isPaletteMotion ? "PALETTE · " : "DRIFT · ");
      meta.textContent = blob + (isPaletteMotion ? s.palette : s.drift);
    });
  }

  function paint() {
    if (!root) return;
    var c = colors();
    Array.prototype.forEach.call(root.children, function (b) {
      var pv = b.querySelector(".palette-preview");
      if (pv) pv.style.background = preview(b.getAttribute("data-palette"), c);
    });
    var stage = document.getElementById("paletteStage");
    if (stage) stage.style.background = preview(current, c);
    var wrap = document.getElementById("thw-wrap-layer");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "thw-wrap-layer";
      document.body.appendChild(wrap);
    }
    /* First and last stops match, so the repeating band has no square seams. */
    wrap.style.backgroundImage = "linear-gradient(90deg," + alpha(c[0], .20) + "," + alpha(c[1], .17) + "," + alpha(c[2], .17) + "," + alpha(c[3], .14) + "," + alpha(c[0], .20) + ")";
    paintCount();
    syncVisibleControls();
  }

  function repaint() {
    try {
      window.thwPaintAmbientSync(document.documentElement.getAttribute("data-theme") || "default");
    } catch (e) {
      try { window.paintAutoTheme(); } catch (_) {}
    }
  }

  function mark() {
    Array.prototype.forEach.call(root.children, function (b) {
      var on = b.getAttribute("data-palette") === current;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function select(id) {
    current = id;
    try { window.wrldPlayerSettings.set("coverPalette", id); } catch (e) {}
    mark();
    repaint();
  }

  function mount() {
    root = document.getElementById("palettePick");
    if (!root || root.childNodes.length) return;
    root.innerHTML = PALETTES.map(function (p) {
      return '<button type="button" class="palette-btn" data-palette="' + p[0] + '" aria-pressed="false">' +
        '<span class="palette-preview" aria-hidden="true"></span>' +
        '<span class="palette-name">' + p[1] + '</span>' +
        '<span class="palette-sub">' + p[2] + '</span>' +
        '<span class="palette-meta"></span></button>';
    }).join("");
    root.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-palette]") : null;
      if (b) select(b.getAttribute("data-palette"));
    });
    var countSel = document.getElementById("coverColorCount");
    if (countSel) countSel.addEventListener("change", paintCount);
    ["coverDrift", "coverPaletteSpeed"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function () { setTimeout(syncVisibleControls, 0); });
    });
    try { current = window.wrldPlayerSettings.get("coverPalette") || "default"; } catch (e) {}
    paint();
    mark();
  }

  if (document.readyState !== "loading") mount();
  else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("thw:trackplaying", function () { setTimeout(paint, 50); });
  window.addEventListener("thw:appearance-changed", function () { setTimeout(paint, 50); });
})();
