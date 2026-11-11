/* ============================================================================
   THEME DRIFT - the background circles wander
   ---------------------------------------------------------------------------
   The pulse is CSS: the circles grow, shrink, brighten and dim on a timer.
   The movement is here, because CSS cannot pick a random place.

   Each circle walks from where it is to a new random place, and the walk
   BENDS - the path curves, through a point off the straight line, so it
   looks like something drifting rather than something sliding. The next
   walk starts where the last one ended, so a circle is never put down
   somewhere else from where it was: it never teleports.

   The movement is run by the browser's own animation engine rather than by
   a loop, so it costs nothing while it runs.
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

  var runs = [];

  /* A place on the screen, with a margin so a circle is never entirely
     off the edge and never covers the whole of it. */
  function spot(el) {
    var w = el.offsetWidth || 300;
    var h = el.offsetHeight || 300;
    var margin = Math.min(w, h) * 0.22;
    var roomX = Math.max(1, window.innerWidth - w - margin * 2);
    var roomY = Math.max(1, window.innerHeight - h - margin * 2);
    return {
      x: Math.round(margin + Math.random() * roomX),
      y: Math.round(margin + Math.random() * roomY)
    };
  }

  /* The circle's own place, as an offset from where the stylesheet puts
     it. */
  function offsetOf(el, at) {
    return {
      x: Math.round(at.x - (el.offsetLeft || 0)),
      y: Math.round(at.y - (el.offsetTop || 0))
    };
  }

  function glide(el) {
    var from = offsetOf(el, el.__thwSpot);
    var to = spot(el);
    var off = offsetOf(el, to);
    var dur = 9000 + Math.random() * 9000;
    var reach = Math.min(window.innerWidth, window.innerHeight) * 0.4;

    /* The bend. A point off the straight line, halfway along, so the path
       curves instead of running dead straight from one spot to the next. */
    var mid = {
      x: (from.x + off.x) / 2 + (Math.random() - 0.5) * reach,
      y: (from.y + off.y) / 2 + (Math.random() - 0.5) * reach
    };

    var anim;
    try {
      anim = el.animate(
        [
          { translate: from.x + "px " + from.y + "px" },
          { translate: mid.x + "px " + mid.y + "px", offset: 0.5 },
          { translate: off.x + "px " + off.y + "px" }
        ],
        { duration: dur, easing: "cubic-bezier(.42,0,.58,1)", fill: "forwards" }
      );
    } catch (e) {
      /* No Web Animations: put it in the new place and try again later. */
      el.style.translate = off.x + "px " + off.y + "px";
      el.__thwSpot = to;
      setTimeout(function () { glide(el); }, dur);
      return;
    }

    runs.push(anim);
    anim.onfinish = function () {
      el.__thwSpot = to;
      el.style.translate = off.x + "px " + off.y + "px";
      /* The finished walk steps out of the list, so the list stays short. */
      var at = runs.indexOf(anim);
      if (at >= 0) runs.splice(at, 1);
      /* The next walk starts where this one ended. No jump. */
      glide(el);
    };
  }

  /* The first walk. Every circle starts somewhere and starts moving. */
  blobs.forEach(function (el) {
    el.__thwSpot = spot(el);
    var off = offsetOf(el, el.__thwSpot);
    el.style.translate = off.x + "px " + off.y + "px";
    /* A short stagger, so they do not all set off at the same moment. */
    setTimeout(function () { glide(el); }, Math.random() * 2500);
  });

  /* The window changed size: the circles are where they are, but the room
     they have to move in has changed. The next walk sorts that out. */
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (document.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < blobs.length; i++) {
        var el = blobs[i];
        var off = offsetOf(el, spot(el));
        el.__thwSpot = { x: el.offsetLeft + off.x, y: el.offsetTop + off.y };
      }
    }, 400);
  }, { passive: true });

  /* A tab nobody is looking at does not need a background drifting. */
  document.addEventListener("visibilitychange", function () {
    for (var i = 0; i < runs.length; i++) {
      try { if (document.hidden) runs[i].pause(); else runs[i].play(); } catch (e) {}
    }
  });
})();
