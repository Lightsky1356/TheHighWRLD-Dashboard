/* ==========================================================================
   UPDATES — the timeline of everything shipped, newest first.
   Data comes from wrldlog-data.js (window.THW_WRLDLOG).
   ========================================================================== */
(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  function render() {
    var list = window.THW_WRLDLOG ? window.THW_WRLDLOG.slice() : [];
    var body = document.getElementById("updates-list");
    var count = document.getElementById("updates-count");
    if (!list.length) {
      if (body) body.innerHTML = '<p class="st-empty">WRLD LOG is not loaded.</p>';
      if (count) count.textContent = "0 releases";
      return;
    }
    /* wrldlog-data.js is already newest-first - keep that order so the top of
       the page is the latest release and the bottom is the oldest. */
    var html = list.map(function (e) {
      var title = e.title ? '<h2 class="upd-title">' + esc(e.title) + '</h2>' : "";
      var items = [];
      if (e.chips && e.chips.length) {
        items = e.chips.map(function (c) { return '<li>' + esc(c) + '</li>'; });
      } else if (e.notes) {
        items = ['<li>' + esc(e.notes) + '</li>'];
      }
      return '<article class="upd-entry">' +
        '<div class="upd-rail"><span class="upd-dot"></span></div>' +
        '<div class="upd-body">' +
          '<div class="upd-head"><span class="upd-version">' + esc(e.version || "") + '</span></div>' +
          title +
          (items.length ? '<ul class="upd-chips">' + items.join("") + '</ul>' : "") +
        '</div></article>';
    }).join("");
    if (count) count.textContent = list.length + " release" + (list.length === 1 ? "" : "s");
    if (body) body.innerHTML = html;
  }

  window.renderUpdatesPage = render;
})();
