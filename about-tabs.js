/* About page - derived published counts.
 *
 * This file used to drive a two-tab About / Info split, and it also owned the
 * two places on the site that publish the catalogue size. The tabs are gone: the
 * Info tab duplicated the Vault's own figures and the top nav, and with one tab
 * left a tablist is a label wearing a widget's clothes. The counts stay, because
 * they are not about the About page at all.
 *
 * Two other places on the site publish the catalogue size: this page's hero stat
 * and the WRLD LOG footer. Both used to hardcode it, and both drifted - the
 * WRLD LOG footer was found earlier saying "Track count now at 30" while the
 * panel it sits under listed 31 releases. Adding three tracks just made them
 * wrong again.
 *
 * So they are derived from trackList rather than typed in, and the markup keeps
 * a correct fallback so the number is right even before this runs. Declared and
 * called unconditionally rather than from a page-ready hook, because the WRLD
 * LOG footer is reachable without ever opening the About page - gating this on
 * the About page existing is what let those two numbers drift apart in the first
 * place.
 */

(function () {
  "use strict";

  function syncPublishedCounts() {
    if (typeof trackList === "undefined" || !trackList || !trackList.length) return;
    var total = String(trackList.length);
    var hero = document.getElementById("abp-hero-tracks");
    if (hero) hero.textContent = total;
    var wl = document.getElementById("wrldlog-track-count");
    if (wl) wl.textContent = total;
  }
  syncPublishedCounts();
  window.addEventListener("load", syncPublishedCounts);
})();
