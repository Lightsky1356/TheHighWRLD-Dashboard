/* Vault Pull — one button, one random song, from the vault
 *
 * juicewrld.io's home page leads with "Shuffle play — 100 songs from the
 * archive". This is the vault's answer to it, in two sizes:
 *
 *   Shuffle 100   the Lobby's third button. Takes a hundred random, unique
 *                 songs from the whole catalogue and lines them up in the
 *                 queue, then starts playing the first pull.
 *   Vault pull    a dice in the full sheets. One random song, right now.
 *
 * Nothing is invented and nothing is removed — the picks come from the
 * catalogue the rest of the page already knows about.
 */
(function () {
  "use strict";
  if (window.__vaultPullMounted) return;
  window.__vaultPullMounted = true;

  function catalogue() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    return [];
  }
  function toast(msg) {
    try { if (typeof showToastSimple === "function") { showToastSimple(msg, { type: "success" }); return; } } catch (e) {}
    try { if (typeof showToast === "function") window.showToast(msg, "success", 2600); } catch (e) {}
  }
  function shuffledIndices() {
    var tl = catalogue();
    var idx = [];
    for (var i = 0; i < tl.length; i++) idx.push(i);
    for (var j = idx.length - 1; j > 0; j--) {
      var r = Math.floor(Math.random() * (j + 1));
      var t = idx[j]; idx[j] = idx[r]; idx[r] = t;
    }
    return idx;
  }

  /* one random song, started now */
  window.vaultPull = function () {
    var picks = shuffledIndices();
    if (!picks.length) return;
    var t = catalogue()[picks[0]];
    try { if (typeof selectTrackFromList === "function") selectTrackFromList(picks[0]); } catch (e) {}
    toast("The vault pulled: " + (t && t.title ? t.title : "a mystery"));
  };

  /* a hundred random songs, lined up and started */
  window.vaultShuffle100 = function () {
    var picks = shuffledIndices().slice(0, 100);
    if (!picks.length) return;
    var added = 0;
    if (window.queueBulkStart) window.queueBulkStart();
    try {
      for (var i = 0; i < picks.length; i++) {
        if (typeof addToQueue === "function") { addToQueue(picks[i]); added++; }
      }
    } finally { if (window.queueBulkEnd) window.queueBulkEnd(); }
    try { if (typeof selectTrackFromList === "function") selectTrackFromList(picks[0]); } catch (e) {}
    toast("The vault pulled " + added + " songs — enjoy");
  };
})();
