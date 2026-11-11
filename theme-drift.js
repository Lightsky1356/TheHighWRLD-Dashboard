/* ============================================================================
   THEME DRIFT - the background circles wander
   ---------------------------------------------------------------------------
   The pulse is CSS: the circles grow, shrink, brighten and dim on a timer.
   The movement is here, because CSS cannot pick a random place.

   Each circle is given a new spot every few seconds and eases into it, so
   the background is never quite where it was. The position uses the CSS
   `translate` property, not `transform`, so it does not fight the pulse:
   the pulse animates `transform`, the movement animates `translate`, and
   the browser does both at once. A circle can be breathing while it
   crosses to the other side of the screen.

   Nothing here runs while the tab is in the background, and nothing runs
   for a member whose system asks for reduced motion.
   ========================================================================== */
(function () {
  "use strict";

  if (window.__thwBlobDrift) return;
  window.__thwBlobDrift = true;

  var blobs = Array.prototype.slice.call(document.querySelectorAll(".th-blob"));
  if (!blobs.length) return;

  function motionOk() {
    try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return true; }
  }
  if (!motionOk()) return;

  /* Somewhere on the screen, with a margin so a circle is never half off
     the edge and never covers the whole of it. */
  function place(el) {
    var w = el.offsetWidth || 300;
    var h = el.offsetHeight || 300;
    var anchorLeft = el.offsetLeft;
    var anchorTop = el.offsetTop;
    var margin = Math.min(w, h) * 0.32;
    var roomX = Math.max(1, window.innerWidth - w - margin * 2);
    var roomY = Math.max(1, window.innerHeight - h - margin * 2);
    var x = margin + Math.random() * roomX;
    var y = margin + Math.random() * roomY;
    el.style.translate = Math.round(x - anchorLeft) + "px " + Math.round(y - anchorTop) + "px";
  }

  /* Every circle picks its own moment, so they never move together. */
  function loop(el) {
    var wait = 3400 + Math.random() * 5600;
    setTimeout(function () {
      if (!document.hidden) place(el);
      loop(el);
    }, wait);
  }

  blobs.forEach(function (el) {
    place(el);
    loop(el);
  });

  /* The window changed size: put them somewhere that still fits. */
  window.addEventListener("resize", function () {
    if (document.hidden) return;
    for (var i = 0; i < blobs.length; i++) place(blobs[i]);
  }, { passive: true });
})();
