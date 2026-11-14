/* D1 free-tier limit countdown.
 *
 * The API plane has a hard daily row-read limit on Cloudflare's free D1 tier,
 * and when it trips every /api/* call returns 500 with the D1_ERROR body. The
 * site stays usable but empty - online count stays 0, trending shows nothing,
 * and by the time anyone notices, the limit badge is the only honest signal.
 *
 * This file shows a quiet chip in the footer with a live countdown to the
 * reset, which is always midnight UTC. It polls /api/online every minute to
 * notice when the limit stops being hit, or when it starts.
 */
(function () {
  "use strict";
  if (window.__d1ResetMounted) return;
  window.__d1ResetMounted = true;

  var chip = document.getElementById("d1-reset-chip");
  var label = document.getElementById("d1-reset-left");
  if (!chip || !label) return;

  function secsUntilMidnightUtc() {
    var now = new Date();
    var reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(0, Math.floor((reset.getTime() - now.getTime()) / 1000));
  }
  function fmt(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h + "h " + String(m).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
  }
  function show() { chip.hidden = false; }
  function hide() { chip.hidden = true; }
  function tick() { label.textContent = fmt(secsUntilMidnightUtc()); }

  function check() {
    fetch("/api/online", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (res) {
        var msg = (res && res.body && String(res.body.error || res.body.message || "") || "");
        if (res && res.status === 500 && /D1_ERROR|free tier|row read limit/i.test(msg)) { show(); return; }
        hide();
      })
      .catch(function () { hide(); });
  }

  check();
  setInterval(check, 60000);
  setInterval(tick, 1000);
  tick();
})();
