/* ==========================================================================
   SCROLL LOCK RECONCILIATION

   The site has several independent scroll locks: the WRLD Log splash, its
   version-history sheet, the Now Playing deck, the social panel, modals and
   the mobile profile sheet each own a class on <html>. When an overlay is
   hidden by a path that does not run its close handler - a route change, a
   splash dismissed another way, a thrown render - its class survives with
   nothing on screen and the whole page stays frozen. That is the "scrolling
   is locked" bug, and it hits phones hardest because there is no scrollbar
   to grab.

   This reconciles each lock against the overlay that owns it. It only removes
   a lock when that overlay is genuinely gone; an open overlay keeps its lock.
   It deliberately leaves the shared, counter-based `scroll-locked` class to
   the modules that own it, so a live modal is never unfrozen by mistake.
   ========================================================================== */
(function () {
  "use strict";

  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function has(el, cls) { return !!(el && el.classList && el.classList.contains(cls)); }
  function isMobile() { return !(window.matchMedia && window.matchMedia("(min-width: 681px)").matches); }

  function sync() {
    var h = document.documentElement;
    var body = document.body;
    if (!h || !body) return;

    var splash = document.getElementById("wrldlog-overlay");
    var history = document.getElementById("wrldlog-vh-overlay");
    var boot = document.getElementById("app-boot");
    var sheet = document.getElementById("mobile-profile-popup");
    var social = document.getElementById("thw-social-panel");
    var player = document.getElementById("dplayer-ov") || document.getElementById("mplayer-ov");
    var cover = document.getElementById("cover-lightbox");
    var info = document.getElementById("info-panel");

    var splashOn = visible(splash);
    var historyOn = has(history, "open") && visible(history);
    var playerOn = !!player;
    var socialOn = visible(social) && isMobile();
    var sheetOn = !has(sheet, "hidden") && visible(sheet);
    var bootOn = !has(boot, "gone") && visible(boot);
    var coverOn = visible(cover);
    var infoOn = !has(info, "hidden") && visible(info);
    var modalOn = !!document.querySelector(".modal-overlay.open");

    /* Per-owner locks: drop each one only when its overlay is gone. */
    if (!splashOn) h.classList.remove("wrldlog-scrolllock");
    if (!historyOn) h.classList.remove("wrldlog-vh-scrolllock");
    if (!playerOn) h.classList.remove("dpl-scrolllock");
    if (!socialOn) h.classList.remove("thw-social-scrolllock");

    /* The profile module mirrors every full-screen surface into this one
       class; clear it (and any inline body overflow) only when none is open. */
    var anyOverlay = splashOn || historyOn || playerOn || socialOn ||
      sheetOn || bootOn || coverOn || infoOn || modalOn;
    if (!anyOverlay) {
      h.classList.remove("thw-scroll-locked");
      if (body.style.overflow === "hidden") body.style.overflow = "";
    }
  }

  setInterval(sync, 400);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("pageshow", sync);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();

  window.thwSyncScrollLock = sync;
})();
