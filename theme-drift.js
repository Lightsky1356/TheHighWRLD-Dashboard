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

   And the circles do not overlap. A new place is only taken if it is
   clear of the others; where there is no clear place, the emptiest one
   wins. The bend in the path is checked the same way, so a circle does
   not swing through another one on its way.

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

  /* The biggest a circle gets: the pulse takes it to 1.2 of its size, and
     the circles must not touch even at their biggest. */
  var MAX_SCALE = 1.2;

  /* Where a circle is right now, and how big it is. */
  function centre(el) {
    var r = el.getBoundingClientRect();
    var size = el.offsetWidth || 300;
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      r: (size / 2) * MAX_SCALE
    };
  }

  /* How much two circles would overlap. Zero is clear. */
  function overlap(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var need = a.r + b.r;
    if (d >= need) return 0;
    var miss = need - d;
    return miss * miss;
  }

  /* The other circles, where they are right now. */
  function near(el) {
    var list = [];
    for (var i = 0; i < blobs.length; i++) {
      if (blobs[i] === el) continue;
      list.push(centre(blobs[i]));
    }
    return list;
  }

  /* A place on the screen that is clear of the others. Where there is no
     clear place, the emptiest one wins - which is better than a place
     that is completely covered. */
  function spot(el) {
    var w = el.offsetWidth || 300;
    var h = el.offsetHeight || 300;
    var r = (Math.max(w, h) / 2) * MAX_SCALE;
    var pad = Math.min(w, h) * 0.08;

    var minX = r + pad, maxX = window.innerWidth - r - pad;
    var minY = r + pad, maxY = window.innerHeight - r - pad;
    if (maxX < minX) { minX = maxX = window.innerWidth / 2; }
    if (maxY < minY) { minY = maxY = window.innerHeight / 2; }

    var others = near(el);
    var best = null;
    var bestCost = Infinity;
    for (var i = 0; i < 60; i++) {
      var cand = {
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY),
        r: r
      };
      var cost = 0;
      for (var j = 0; j < others.length; j++) cost += overlap(cand, others[j]);
      if (cost < bestCost) { bestCost = cost; best = cand; }
      if (cost === 0) break;
    }
    return best;
  }

  /* The circle's own place, as an offset from where the stylesheet puts
     it. */
  function offsetOf(el, at) {
    var w = el.offsetWidth || 300;
    var h = el.offsetHeight || 300;
    return {
      x: Math.round(at.x - (el.offsetLeft || 0) - w / 2),
      y: Math.round(at.y - (el.offsetTop || 0) - h / 2)
    };
  }

  function glide(el) {
    var from = offsetOf(el, centre(el));
    var to = spot(el);
    var off = offsetOf(el, to);
    var dur = 9000 + Math.random() * 9000;
    var reach = Math.min(window.innerWidth, window.innerHeight) * 0.4;

    /* The bend. A point off the straight line, halfway along, so the path
       curves instead of running dead straight. It is checked against the
       others too, so a circle does not swing through one on its way. */
    var others = near(el);
    var mid = null;
    for (var i = 0; i < 12; i++) {
      var cand = {
        x: (from.x + off.x) / 2 + (Math.random() - 0.5) * reach,
        y: (from.y + off.y) / 2 + (Math.random() - 0.5) * reach,
        r: (el.offsetWidth || 300) / 2
      };
      var cost = 0;
      for (var j = 0; j < others.length; j++) cost += overlap(cand, others[j]);
      if (!mid || cost < mid.cost) mid = { x: cand.x, y: cand.y, cost: cost };
      if (cost === 0) break;
    }

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
      setTimeout(function () { glide(el); }, dur);
      return;
    }

    runs.push(anim);
    anim.onfinish = function () {
      el.style.translate = off.x + "px " + off.y + "px";
      /* The finished walk steps out of the list, so the list stays short. */
      var at = runs.indexOf(anim);
      if (at >= 0) runs.splice(at, 1);
      /* The next walk starts where this one ended. No jump. */
      glide(el);
    };
  }

  /* The first walk. Every circle starts somewhere clear of the others and
     starts moving. */
  blobs.forEach(function (el) {
    var at = spot(el);
    var off = offsetOf(el, at);
    el.style.translate = off.x + "px " + off.y + "px";
    /* A short stagger, so they do not all set off at the same moment. */
    setTimeout(function () { glide(el); }, Math.random() * 2500);
  });

  /* The window changed size: the room the circles have to move in has
     changed. The next walk sorts that out. */
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (document.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < blobs.length; i++) {
        var el = blobs[i];
        var off = offsetOf(el, spot(el));
        el.style.translate = off.x + "px " + off.y + "px";
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
