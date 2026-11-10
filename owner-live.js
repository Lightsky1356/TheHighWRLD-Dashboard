/* owner-live.js - the LIVE chip on the Owner Dashboard.
 *
 * The dashboard already refreshes itself: script.js's poller re-fetches the
 * stats and re-renders the panel while it is open (and the endpoint caches
 * its own answer, so the repeat reads are cheap). What was missing was any
 * VISIBLE proof of that - the owner watched a panel and could not tell
 * whether the numbers were old or moving.
 *
 * So this file is deliberately NOT a second poller: it watches #owner-stats
 * being re-rendered and marks each landing. The chip shows the LIVE pulse
 * and when the numbers last landed, goes stale if the refreshes stop
 * arriving, and can be clicked to ask for a refresh right away - which it
 * does through the panel's own poll URL, so nothing new is exposed. */
(function () {
  "use strict";

  var PANEL = document.getElementById("owner-panel");
  var STATS = document.getElementById("owner-stats");
  if (!PANEL || !STATS) return;

  /* Longest gap we accept between renders before the chip admits staleness.
     The panel's own poller runs every 10 s; give it room to breathe. */
  var STALE_MS = 90000;

  var chip = null;
  var timer = null;
  var landedAt = 0;

  function pad(n) { return String(n).padStart(2, "0"); }

  function paint() {
    if (!chip) return;
    var when = chip.querySelector(".owner-live-when");
    if (!landedAt) { when.textContent = "waiting…"; chip.classList.add("stale"); return; }
    var d = new Date(landedAt);
    when.textContent = "updated " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    chip.classList.toggle("stale", Date.now() - landedAt > STALE_MS);
  }

  function landed() {
    if (!PANEL.classList.contains("owner-active")) return;
    landedAt = Date.now();
    paint();
  }

  function ensureChip() {
    if (chip && chip.isConnected) return;
    var top = PANEL.querySelector(".owner-top");
    if (!top) return;
    chip = document.createElement("span");
    chip.className = "owner-live-chip";
    chip.title = "The dashboard refreshes itself while open. Click to refresh now.";
    chip.innerHTML = '<i class="fas fa-circle"></i><b>LIVE</b><span class="owner-live-when"></span>';
    chip.addEventListener("click", function () {
      var url = window.__ownerStatsURL;
      if (!url) return;
      fetch(url, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (d) {
          if (d && !d.error && typeof window.renderOwnerStats === "function") {
            try { window.renderOwnerStats(d); } catch (e) { /* never break the panel */ }
          }
        });
    });
    top.appendChild(chip);
  }

  /* Every re-render of the stats body (unlock, the 10 s poller, anything
     else that draws the panel) is a "the numbers just landed" event. */
  new MutationObserver(landed).observe(STATS, { childList: true, subtree: true });

  /* The panel opening adds .owner-active - put the chip in and start the
     staleness heartbeat; closing just stills the pulse. */
  new MutationObserver(function () {
    if (PANEL.classList.contains("owner-active")) {
      ensureChip();
      if (!timer) timer = setInterval(paint, 20000);
      if (!landedAt) paint();
    }
  }).observe(PANEL, { attributes: true, attributeFilter: ["class"] });
})();
