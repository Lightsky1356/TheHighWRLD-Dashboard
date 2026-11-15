/* ============================================================================
   THEME DRIFT - the background circles wander
   ---------------------------------------------------------------------------
   The pulse is CSS: the circles grow, shrink, brighten and dim on a timer.
   The movement is here, because CSS cannot pick a random place.

   Each circle drifts on its own heading, turning now and then, wobbling a
   little as it goes. It never stops and never teleports - it slides.

   And the circles do not overlap. Every frame the positions are checked,
   and any two that have come too close are pushed apart. That is the only
   way to promise it: checking where a circle is GOING is not enough,
   because two circles drifting towards each other meet on the way, and
   because the circles move while a plan is being made.

   The pulse is the only thing that animates in CSS. The drift is one loop
   that reads and writes six numbers a frame - cheap, and it is what lets
   the circles keep clear of each other.
   ========================================================================== */
(function () {
  "use strict";

  if (window.__thwBlobDrift) return;
  window.__thwBlobDrift = true;

  var blobs = Array.prototype.slice.call(document.querySelectorAll(".th-blob"));
  if (!blobs.length) return;

  function motionOk() {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      /* Moving colours off in Settings > Appearance: the circles still paint,
         but they never drift. */
      if (window.wrldPlayerSettings && window.wrldPlayerSettings.get("movingColors") === false) return false;
      return true;
    } catch (e) { return true; }
  }
  if (!motionOk()) return;

  /* The pulse takes a circle to 1.2 of its size, and two circles must not
     touch even at their biggest, so that is the size they are treated as.
     A little more on top, so they keep a gap rather than just missing
     each other. */
  var MAX_SCALE = 1.2;
  var PAD = 1.16;

  /* How fast each circle drifts, in pixels a second. Faster than before
     so the movement is clearly visible instead of a slow creep. */
  var SPEEDS = [22, 28, 18, 26, 30, 24];

  var state = blobs.map(function (el, i) {
    var size = el.offsetWidth || 300;
    return {
      el: el,
      size: size,
      r: (size / 2) * MAX_SCALE * PAD,
      anchorX: el.offsetLeft || 0,
      anchorY: el.offsetTop || 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: Math.random() * Math.PI * 2,
      turnIn: 900 + Math.random() * 2400,
      wobble: Math.random() * Math.PI * 2,
      speed: SPEEDS[i % SPEEDS.length]
    };
  });

  function overlap(ax, ay, ar, b) {
    var dx = ax - b.x;
    var dy = ay - b.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var need = ar + b.r;
    if (d >= need) return 0;
    var miss = need - d;
    return { push: miss, d: d };
  }

  /* Put them somewhere to start, clear of each other. */
  function placeAll() {
    for (var i = 0; i < state.length; i++) {
      var s = state[i];
      var best = null;
      var bestCost = Infinity;
      for (var k = 0; k < 120; k++) {
        var cand = {
          x: s.r + Math.random() * Math.max(1, window.innerWidth - s.r * 2),
          y: s.r + Math.random() * Math.max(1, window.innerHeight - s.r * 2)
        };
        var cost = 0;
        for (var j = 0; j < state.length; j++) {
          if (j === i) continue;
          var o = overlap(cand.x, cand.y, s.r, state[j]);
          if (o) cost += o.push * o.push;
        }
        if (cost < bestCost) { bestCost = cost; best = cand; }
        if (cost === 0) break;
      }
      s.x = best.x;
      s.y = best.y;
    }
  }

  /* The room a circle has to move in. */
  function bounds(s) {
    var minX = s.r;
    var maxX = Math.max(minX, window.innerWidth - s.r);
    var minY = s.r;
    var maxY = Math.max(minY, window.innerHeight - s.r);
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  /* PERFORMANCE: the drift stops while the page is busy.
   *
   * The loop writes a position for every circle on every frame, and
   * a write is a style change the browser has to make good on. The
   * CSS motion around the circles was already paused while the page
   * was scrolled and while nothing was happening - this loop was
   * not, so the page was doing the work during every scroll even
   * though the circles were standing still.
   *
   * The class is the signal the rest of the site already uses, so
   * the two stay in step. */
  function paused() {
    var root = document.documentElement;
    return root.classList.contains("is-scrolling") || root.classList.contains("is-idle");
  }

  var last = 0;
  var running = false;

  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;

    for (var i = 0; i < state.length; i++) {
      var s = state[i];

      /* The heading turns now and then, and the circle wobbles a little as
         it travels - so the path is a drift, not a line. More frequent
         turns than before so the movement feels alive. */
      s.turnIn -= dt * 1000;
      if (s.turnIn <= 0) {
        s.turnIn = 1200 + Math.random() * 2400;
        s.heading += (Math.random() - 0.5) * 2.4;
      }
      s.wobble += dt * 0.7;

      var want = s.speed;
      var wob = Math.sin(s.wobble) * 0.7;
      var hx = Math.cos(s.heading + wob);
      var hy = Math.sin(s.heading + wob);
      /* The velocity eases toward the heading, so a turn is a curve and
         not a corner. */
      s.vx += (hx * want - s.vx) * Math.min(1, dt * 2.2);
      s.vy += (hy * want - s.vy) * Math.min(1, dt * 2.2);

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      var b = bounds(s);
      if (s.x < b.minX) { s.x = b.minX; s.vx = Math.abs(s.vx); }
      if (s.x > b.maxX) { s.x = b.maxX; s.vx = -Math.abs(s.vx); }
      if (s.y < b.minY) { s.y = b.minY; s.vy = Math.abs(s.vy); }
      if (s.y > b.maxY) { s.y = b.maxY; s.vy = -Math.abs(s.vy); }
    }

    /* Keep them apart. A few rounds, because moving one can push it into
       another. */
    for (var pass = 0; pass < 5; pass++) {
      for (var a = 0; a < state.length; a++) {
        for (var c = a + 1; c < state.length; c++) {
          var A = state[a];
          var C = state[c];
          var dx = C.x - A.x;
          var dy = C.y - A.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          var need = A.r + C.r;
          if (d >= need || d < 0.001) {
            /* Dead on top of each other: push them apart in some
               direction rather than dividing by zero. */
            if (d < 0.001) { dx = 1; dy = 0; d = 1; }
            continue;
          }
          var push = (need - d) / 2;
          var ux = dx / d;
          var uy = dy / d;
          A.x -= ux * push;
          A.y -= uy * push;
          C.x += ux * push;
          C.y += uy * push;
          /* The nudge is taken off the heading, so the circles do not
             fight the push and end up jittering. */
          A.vx -= ux * push * 4;
          A.vy -= uy * push * 4;
          C.vx += ux * push * 4;
          C.vy += uy * push * 4;
        }
      }
      /* And back inside the screen, after the pushes. */
      for (var e = 0; e < state.length; e++) {
        var S = state[e];
        var bb = bounds(S);
        if (S.x < bb.minX) { S.x = bb.minX; S.vx = Math.abs(S.vx); }
        if (S.x > bb.maxX) { S.x = bb.maxX; S.vx = -Math.abs(S.vx); }
        if (S.y < bb.minY) { S.y = bb.minY; S.vy = Math.abs(S.vy); }
        if (S.y > bb.maxY) { S.y = bb.maxY; S.vy = -Math.abs(S.vy); }
      }
    }

    /* Put them where they belong. */
    for (var w = 0; w < state.length; w++) {
      var st = state[w];
      st.el.style.translate =
        Math.round(st.x - st.anchorX - st.size / 2) + "px " +
        Math.round(st.y - st.anchorY - st.size / 2) + "px";
    }

    requestAnimationFrame(frame);
  }

  function start() {
    if (running || paused()) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  /* The class changes when the page starts and stops being busy, and
     on its own it is enough to start and stop the loop. */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (paused()) stop(); else start();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }

  function stop() {
    running = false;
  }

  placeAll();
  start();

  /* The window changed size: the room they have to move in has changed. */
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      for (var i = 0; i < state.length; i++) {
        var s = state[i];
        s.anchorX = s.el.offsetLeft || 0;
        s.anchorY = s.el.offsetTop || 0;
        s.size = s.el.offsetWidth || s.size;
        s.r = (s.size / 2) * MAX_SCALE * PAD;
      }
      placeAll();
    }, 300);
  }, { passive: true });

  /* A tab nobody is looking at does not need a background drifting. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });
})();
