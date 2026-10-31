/* ============================================================================
   THEME EFFECTS - seasonal decals
   ---------------------------------------------------------------------------
   A season that is worn should feel worn. A thin fixed layer floats a handful
   of glyphs over everything - snow at Christmas, pumpkins and ghosts at
   Halloween, hearts at Valentine's - and nothing at all for the other
   twenty-odd themes, or for whichever seasonal theme the member turned the
   switch off in Account Settings (localStorage.thwThemeFx).

   The glyphs are plain text characters, so the layer needs no requests, is
   harmless to screen readers (aria-hidden) and to the mouse (pointer-events:
   none), and keeps working on every theme's background. Motion stops for
   anyone whose system asks for reduced motion - by a CSS rule that hides the
   layer entirely, and a JS check so the spans are never even built.
   ========================================================================== */
(function () {
  "use strict";

  /* Theme id -> glyph set. Each entry is the character and, when the
     character is a shape rather than a coloured emoji, its colour. */
  var FX = {
    newyear: [{ t: "\uD83C\uDF89" }, { t: "\u2728" }, { t: "\uD83C\uDF8A" }],
    valentines: [{ t: "\u2764\uFE0F" }, { t: "\uD83D\uDC95" }, { t: "\uD83D\uDC9D" }],
    stpatricks: [{ t: "\uD83C\uDF40" }, { t: "\u2618\uFE0F" }],
    easter: [{ t: "\uD83E\uDD5A" }, { t: "\uD83C\uDF37" }, { t: "\uD83D\uDC23" }],
    july4: [{ t: "\uD83C\uDF86" }, { t: "\uD83C\uDF87" }, { t: "\u2B50", c: "#ffd75e" }],
    halloween: [{ t: "\uD83C\uDF83" }, { t: "\uD83D\uDC7B" }, { t: "\uD83E\uDE87" }],
    christmas: [
      { t: "\u2744", c: "#e0f2ff" }, { t: "\u2745", c: "#e0f2ff" },
      { t: "\u2746", c: "#cfe8ff" }, { t: "\uD83C\uDF84" }
    ]
  };
  var COUNT = 16;
  var overlay = null;
  var current = void 0;

  function fxOn() {
    var off = "";
    try { off = localStorage.getItem("thwThemeFx") || "on"; } catch (_) {}
    return off !== "off";
  }
  function motionOk() {
    try {
      return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) { return true; }
  }
  function themeNow() {
    return document.documentElement.getAttribute("data-theme") || "";
  }

  function clear() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function build(theme) {
    clear();
    current = theme;
    var glyphs = FX[theme];
    if (!glyphs || !fxOn() || !motionOk()) return;

    overlay = document.createElement("div");
    overlay.className = "thw-fx";
    overlay.setAttribute("aria-hidden", "true");
    for (var i = 0; i < COUNT; i++) {
      var g = glyphs[i % glyphs.length];
      var s = document.createElement("i");
      s.className = "thw-fx-i";
      s.textContent = g.t;
      s.style.left = (Math.random() * 100).toFixed(2) + "%";
      s.style.fontSize = (12 + Math.random() * 14).toFixed(1) + "px";
      s.style.opacity = (0.5 + Math.random() * 0.45).toFixed(2);
      if (g.c) s.style.color = g.c;
      /* Sown mid-fall: negative delays put every glyph partway down the
         screen from the first frame instead of marching down in formation. */
      s.style.animationDuration = (9 + Math.random() * 11).toFixed(1) + "s";
      s.style.animationDelay = (-Math.random() * 20).toFixed(1) + "s";
      s.style.setProperty("--fx-drift", Math.round(Math.random() * 120 - 60) + "px");
      overlay.appendChild(s);
    }
    document.body.appendChild(overlay);
  }

  function onThemeChange() {
    var t = themeNow();
    if (t === current) return;
    build(t);
  }

  function start() {
    build(themeNow());
    try {
      new MutationObserver(onThemeChange).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    } catch (_) {}
    /* The switch: same theme, new decision - so this path must not treat
       "still Halloween" as "nothing to do". */
    document.addEventListener("thw-fx-toggle", function () { build(themeNow()); });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
