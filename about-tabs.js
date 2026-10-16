/* About page tabs - a two-tab split: About, and Info.
 *
 * The previous attempt at this was four tabs (About / Info / Apps / Socials) and
 * it was reverted, so this is deliberately the smallest thing that answers the
 * request: one added tab, and the existing page untouched behind it. Nothing is
 * regrouped, nothing is moved, no existing section changes which tab it lives on.
 *
 * Reuses the pattern social-panel.js already established rather than inventing a
 * second one: a real role="tablist", tabs carrying role="tab" and aria-selected,
 * panels toggled with the `hidden` attribute, and roving tabindex so the arrow
 * keys move between tabs instead of trapping on every button.
 *
 * The Info figures are read from `trackList` directly rather than from the spans
 * on the Vault. That matters: the Vault's changelog footer was found this session
 * to have been showing hardcoded placeholders for an unknown length of time, and
 * reading a number back out of the DOM is one more place that number can be
 * stale. trackList is the source the whole player is built from, so it is the
 * right thing to depend on. The DOM spans are used only as a fallback.
 */

(function () {
  "use strict";

  var TABS = ["about", "info"];
  var page = document.getElementById("page-section-about");
  if (!page) return;

  var tabs = {};
  var panels = {};
  TABS.forEach(function (name) {
    var t = page.querySelector("#abp-tab-" + name);
    var p = page.querySelector("#abp-panel-" + name);
    if (t && p) { tabs[name] = t; panels[name] = p; }
  });
  if (!tabs.about || !tabs.info) return;

  /* Counts straight from the catalogue. */
  function fromTrackList() {
    if (typeof trackList === "undefined" || !trackList || !trackList.length) return null;
    var by = { sessions: 0, leaks: 0, halloween: 0 };
    var other = 0;
    for (var i = 0; i < trackList.length; i++) {
      var c = trackList[i].category;
      if (Object.prototype.hasOwnProperty.call(by, c)) by[c]++;
      else other++;
    }
    return { total: trackList.length, sessions: by.sessions, leaks: by.leaks, halloween: by.halloween, other: other };
  }

  function fromVaultSpans() {
    var g = function (id) {
      var el = document.getElementById(id);
      var v = el ? String(el.textContent || "").trim() : "";
      return /^\d+$/.test(v) ? parseInt(v, 10) : null;
    };
    var total = g("changelog-total");
    var sessions = g("changelog-sessions");
    var leaks = g("changelog-leaks");
    var halloween = g("changelog-halloween");
    if (total === null) return null;
    return { total: total, sessions: sessions, leaks: leaks, halloween: halloween, other: null };
  }

  function paint() {
    if (!panels.info) return;
    var d = fromTrackList() || fromVaultSpans();
    if (!d) return;
    [["tracks", "total"], ["sessions", "sessions"], ["leaks", "leaks"], ["halloween", "halloween"]].forEach(function (pair) {
      var out = page.querySelector("#abp-stat-" + pair[0]);
      if (!out) return;
      out.textContent = d[pair[1]] === null || d[pair[1]] === undefined ? "\u2014" : String(d[pair[1]]);
    });
    // Only shown when there are tracks in a category outside the three known ones,
    // so the panel does not claim to be a complete breakdown when it is not.
    var other = page.querySelector("#abp-stat-other-card");
    if (other) other.hidden = !(d.other > 0);
  }

  function select(name) {
    if (!tabs[name]) return;
    TABS.forEach(function (n) {
      var t = tabs[n];
      var p = panels[n];
      var on = n === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.classList.toggle("is-active", on);
      t.tabIndex = on ? 0 : -1;
      p.hidden = !on;
    });
    if (name === "info") paint();
    try { sessionStorage.setItem("thw:about-tab", name); } catch (_) {}
  }

  TABS.forEach(function (name, i) {
    var t = tabs[name];
    t.addEventListener("click", function () { select(name); t.focus(); });
    t.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
      else if (e.key === "ArrowLeft") next = TABS[(i - 1 + TABS.length) % TABS.length];
      else if (e.key === "Home") next = TABS[0];
      else if (e.key === "End") next = TABS[TABS.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next);
      tabs[next].focus();
    });
  });

  /* Restore the last tab used this session, so someone who keeps coming back to
     Info is not made to click it every time. */
  try {
    var saved = sessionStorage.getItem("thw:about-tab");
    if (saved && tabs[saved]) select(saved);
  } catch (_) {}

  window.__thwAboutTabs = { select: select, paint: paint };
})();