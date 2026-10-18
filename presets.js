/* Player presets — one-tap bundles for existing player settings.
 * Controls only verified-live settings: shuffle mode and volume. Stored in
 * localStorage (wrldPreset), applied on boot.
 *
 * Keyboard shortcuts are deliberately NOT part of a preset.
 *
 * They used to be, and it was quietly wrong. Focus and Minimal carried
 * shortcuts:false, apply() wrote that into wrldPlayerSettings, and init() then
 * re-applied the stored preset on every boot — so a desktop user who ever
 * clicked either preset came back to a site with shortcuts off, with no prompt,
 * no indication of why, and no obvious way back other than finding this toggle.
 * Presets were also the only writer of the setting, which quietly made the
 * toggle look unreliable.
 *
 * Now the toggle in Player Settings is the only thing that changes it, so the
 * default (on) holds for a fresh visitor, an explicit choice persists, and a
 * stored preset can no longer override either. */
(function () {
  "use strict";
  if (window.__presetsMounted) return;
  window.__presetsMounted = true;

  var KEY = "wrldPreset";
  var PRESETS = [
    { id: "default", name: "Default", shuffle: false, volume: 0.8 },
    { id: "focus", name: "Focus", shuffle: false, volume: 0.7 },
    { id: "party", name: "Party", shuffle: true, volume: 0.9 },
    { id: "smooth", name: "Smooth", shuffle: false, volume: 0.55 },
    { id: "minimal", name: "Minimal", shuffle: false, volume: 0.5 }
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function audioEl() {
    try { return document.querySelector("audio"); } catch (e) { return null; }
  }

  function shuffleOn() {
    try {
      var b = document.getElementById("shuffle-btn");
      return !!(b && b.classList.contains("shuffle-active"));
    } catch (e) { return false; }
  }

  function apply(p, silent) {
    /* No keyboardShortcuts here on purpose - see the note at the top. A preset
       that set it would overwrite the toggle's value on every boot, which is
       exactly the bug this was removed to fix. */
    try {
      if (typeof setShuffle === "function" && shuffleOn() !== !!p.shuffle) setShuffle(!!p.shuffle);
    } catch (e) {}
    try {
      if (typeof window.__setVolume === "function") window.__setVolume(p.volume);
      else {
        var a = audioEl();
        if (a) a.volume = p.volume;
      }
    } catch (e) {}
    try { localStorage.setItem(KEY, p.id); } catch (e) {}
    paint();
    if (!silent && window.toast) window.toast(p.name + " preset on", "success");
  }

  function current() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }

  function paint() {
    var cur = current();
    document.querySelectorAll("[data-preset]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-preset") === cur);
    });
  }

  function css() {
    if (document.getElementById("presets-style")) return;
    var st = document.createElement("style");
    st.id = "presets-style";
    st.textContent =
      ".psp-presets{margin-top:4px}" +
      ".psp-presets-title{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin:10px 0 8px}" +
      ".psp-preset-row{display:flex;gap:6px;flex-wrap:wrap}" +
      ".psp-preset{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);border-radius:9999px;padding:6px 13px;font-size:11px;font-weight:700;cursor:pointer}" +
      ".psp-preset:hover{border-color:rgba(251,191,36,.5);color:#fbbf24}" +
      ".psp-preset.on{background:rgba(251,191,36,.16);border-color:rgba(251,191,36,.55);color:#fbbf24}";
    (document.head || document.documentElement).appendChild(st);
  }

  function mount() {
    var body = document.querySelector("#player-settings-overlay .psp-body");
    if (!body || document.getElementById("psp-presets")) return false;
    css();
    var wrap = document.createElement("div");
    wrap.className = "psp-presets";
    wrap.id = "psp-presets";
    var h = '<div class="psp-presets-title">Presets</div><div class="psp-preset-row">';
    PRESETS.forEach(function (p) {
      h += '<button type="button" class="psp-preset" data-preset="' + p.id + '">' + esc(p.name) + "</button>";
    });
    wrap.innerHTML = h + "</div>";
    body.appendChild(wrap);
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-preset]") : null;
      if (!b) return;
      var id = b.getAttribute("data-preset");
      for (var i = 0; i < PRESETS.length; i++) {
        if (PRESETS[i].id === id) { apply(PRESETS[i]); return; }
      }
    });
    paint();
    return true;
  }

  window.applyPlayerPreset = function (id) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) { apply(PRESETS[i]); return true; }
    }
    return false;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  function init() {
    mount();
    var tries = 0;
    var iv = setInterval(function () {
      if (mount() || ++tries > 20) clearInterval(iv);
    }, 1000);
    var cur = current();
    if (cur) {
      for (var i = 0; i < PRESETS.length; i++) {
        if (PRESETS[i].id === cur) { apply(PRESETS[i], true); break; }
      }
    }
  }
})();
