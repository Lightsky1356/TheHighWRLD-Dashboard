/* D1 free-tier limit countdown.
 *
 * The API plane has a hard daily row-read limit on Cloudflare's free D1 tier.
 * When it trips, every D1-backed endpoint returns 500 with an `D1_ERROR` body.
 * The owner asked for a live countdown so anyone visiting the site while the
 * limit is exhausted can see exactly how long until it resets - which is
 * always midnight UTC, the reset boundary for the D1 free tier.
 *
 * The signal used here is /api/trending, which is one of the endpoints that
 * fails hard when the limit is exhausted and works the rest of the time -
 * which means its ok/500 flip is also our all-clear.
 */
(function () {
  "use strict";
  if (window.__d1ResetMounted) return;
  window.__d1ResetMounted = true;

  var panel = document.getElementById("d1-reset-panel");
  var label = document.getElementById("d1-reset-left");
  if (!panel || !label) return;

  function secsUntilMidnightUtc() {
    var now = new Date();
    var reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(0, Math.floor((reset.getTime() - now.getTime()) / 1000));
  }
  function fmt(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h + "h " + String(m).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
  }
  function show() { panel.hidden = false; }
  function hide() { panel.hidden = true; }
  function tick() { label.textContent = fmt(secsUntilMidnightUtc()); }

  function check() {
    fetch("/api/trending?days=1&limit=1", { cache: "no-store", credentials: "same-origin" })
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
