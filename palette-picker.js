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

  function paint() {
    if (!root) return;
    var c = colors();
    Array.prototype.forEach.call(root.children, function (b) {
      var pv = b.querySelector(".palette-preview");
      if (pv) pv.style.background = preview(b.getAttribute("data-palette"), c);
    });
    paintCount();
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
        '<span class="palette-sub">' + p[2] + '</span></button>';
    }).join("");
    root.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-palette]") : null;
      if (b) select(b.getAttribute("data-palette"));
    });
    var countSel = document.getElementById("coverColorCount");
    if (countSel) countSel.addEventListener("change", paintCount);
    try { current = window.wrldPlayerSettings.get("coverPalette") || "default"; } catch (e) {}
    paint();
    mark();
  }

  if (document.readyState !== "loading") mount();
  else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("thw:trackplaying", function () { setTimeout(paint, 50); });
  window.addEventListener("thw:appearance-changed", function () { setTimeout(paint, 50); });
})();
