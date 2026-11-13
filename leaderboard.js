/* Leaderboard — the vault's people, ranked by the points they earn
 *
 * Three tabs:
 *   All time   - every point, by anyone, ever.
 *   This week  - the week that is now, so a quiet week can be won.
 *   Your rank  - you, against everyone, with the progress into the next level.
 *
 * Points are earned server-side (a play is +5, a comment +15, a like you
 * receive +2). The server decides; this page only draws.
 */
(function () {
  "use strict";
  if (window.__leaderboardMounted) return;
  window.__leaderboardMounted = true;

  var API = "/api/xp";
  var state = { data: null, tab: "alltime", busy: false };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function levelFor(xp) {
    return Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 50)) + 1);
  }
  function levelProgress(xp) {
    xp = Math.max(0, Number(xp) || 0);
    var lvl = levelFor(xp);
    var base = 50 * (lvl - 1) * (lvl - 1);
    var next = 50 * lvl * lvl;
    return Math.min(1, (xp - base) / Math.max(1, next - base));
  }

  function load() {
    if (state.busy) return;
    state.busy = true;
    fetch(API, { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || !d.ok) { renderError(); return; }
        state.data = d;
        render();
      })
      .catch(renderError)
      .finally(function () { state.busy = false; });
  }

  function renderError() {
    var list = document.getElementById("lb-list");
    if (list) list.innerHTML = '<li class="lb-empty">The board could not be loaded right now.</li>';
    var empty = document.getElementById("lb-empty");
    if (empty) empty.hidden = true;
  }

  function rowHTML(m) {
    var isMe = state.data && state.data.me && state.data.me.uid === m.uid;
    var avatar = m.avatar
      ? '<img decoding="async" loading="lazy" src="' + esc(m.avatar) + '" alt="" onerror="this.onerror=null;this.outerHTML=\'<i class=&quot;fas fa-user&quot;></i>\'">'
      : '<i class="fas fa-user" aria-hidden="true"></i>';
    var pct = Math.round(levelProgress(m.xp) * 100);
    var tag = isMe ? '<span class="lb-name-tag">You</span>' : "";
    return (
      '<li class="lb-row' + (isMe ? " is-me" : "") + '">' +
        '<span class="lb-rank">' + m.rank + "</span>" +
        '<span class="lb-avatar">' + avatar + "</span>" +
        '<span class="lb-meta">' +
          '<span class="lb-name">' + esc(m.name) + tag + "</span>" +
          '<span class="lb-level">' +
            '<span class="lb-level-chip">Level ' + m.level + "</span>" +
            '<span class="lb-bar"><span class="lb-bar-fill" style="width:' + pct + '%"></span></span>' +
          "</span>" +
        "</span>" +
        '<span class="lb-xp"><b>' + Number(m.score).toLocaleString() + "</b><small>" + (state.tab === "week" ? "this week" : "points") + "</small></span>" +
      "</li>"
    );
  }

  function render() {
    var list = document.getElementById("lb-list");
    var empty = document.getElementById("lb-empty");
    var d = state.data;
    if (!list || !d) return;

    if (state.tab === "mine") return renderMine();

    var board = state.tab === "week" ? d.board.week : d.board.alltime;
    var count = board.length;
    if (empty) {
      empty.hidden = count > 0;
      empty.textContent = count
        ? ""
        : "No points have been earned yet. Plays and comments both count — be the first.";
    }
    list.innerHTML = board.map(rowHTML).join("");
    if (d.me) paintYou(d.me);

    /* the subtitle under the trophy counts the field */
    var sub = document.getElementById("lb-sub");
    if (sub) sub.textContent = (d.total || 0) + (d.total === 1 ? " member ranked · you earn yours by playing and commenting" : " members ranked · you earn yours by playing and commenting");
  }

  function renderMine() {
    var list = document.getElementById("lb-list");
    var empty = document.getElementById("lb-empty");
    var d = state.data;
    if (!list || !d) return;

    if (!d.me) {
      list.innerHTML = '<li class="lb-empty">Sign in to see your rank, your level and how far you have to go.</li>';
      if (empty) empty.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;

    var me = d.me;
    var pct = Math.round(levelProgress(me.xp) * 100);
    var toNext = 50 * me.level * me.level - me.xp;
    var rankAll = me.rankAll ? "#" + me.rankAll + " all time" : "unranked all time";
    var rankWeek = me.rankWeek ? "#" + me.rankWeek + " this week" : "unranked this week";
    var avatar = '';
    try {
      var holder = document.getElementById("navAvatarInner");
      var img = holder && holder.querySelector ? holder.querySelector("img") : null;
      if (img && img.src) avatar = '<img decoding="async" src="' + esc(img.src) + '" alt="">';
    } catch (e) {}
    if (!avatar) avatar = '<i class="fas fa-user" aria-hidden="true"></i>';

    list.innerHTML =
      '<li class="lb-row is-me lb-mine">' +
        '<span class="lb-rank"><i class="fas fa-trophy" aria-hidden="true"></i></span>' +
        '<span class="lb-avatar">' + avatar + "</span>" +
        '<span class="lb-meta">' +
          '<span class="lb-name">Your standing</span>' +
          '<span class="lb-level"><span class="lb-level-chip">Level ' + me.level + "</span>" +
            '<span class="lb-bar"><span class="lb-bar-fill" style="width:' + pct + '%"></span></span>' +
          "</span>" +
        "</span>" +
        '<span class="lb-xp"><b>' + Number(me.xp).toLocaleString() + "</b><small>points</small></span>" +
      "</li>" +
      '<li class="lb-mine-grid">' +
        '<div class="lb-mine-cell"><b>' + Number(me.week_xp).toLocaleString() + "</b><span>this week</span></div>" +
        '<div class="lb-mine-cell"><b>' + rankAll + "</b><span>all time</span></div>" +
        '<div class="lb-mine-cell"><b>' + rankWeek + "</b><span>this week</span></div>" +
        '<div class="lb-mine-cell"><b>' + Number(toNext).toLocaleString() + "</b><span>to the next level</span></div>" +
      "</li>" +
      '<li class="lb-mine-note">Points come from plays (+5), comments (+15) and likes you receive (+2). They reset never for all time, and every Monday for this week.</li>';
  }

  function paintYou(me) {
    var box = document.getElementById("lb-you");
    var name = document.getElementById("lb-you-name");
    var stats = document.getElementById("lb-you-stats");
    var avatar = document.getElementById("lb-you-avatar");
    if (!box) return;
    box.hidden = false;
    if (name) name.textContent = "You";
    if (stats) stats.textContent = "Level " + me.level + " · " + Number(me.xp).toLocaleString() + " points · " + (me.rankAll ? "#" + me.rankAll + " all time" : "unranked");
    try {
      var holder = document.getElementById("navAvatarInner");
      var img = holder && holder.querySelector ? holder.querySelector("img") : null;
      if (img && img.src && avatar) avatar.innerHTML = '<img decoding="async" src="' + esc(img.src) + '" alt="">';
    } catch (e) {}
  }

  function mount() {
    var tabs = document.querySelectorAll(".lb-tab");
    Array.prototype.slice.call(tabs).forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.tab = tab.getAttribute("data-tab") || "alltime";
        Array.prototype.slice.call(tabs).forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        render();
      });
    });

    /* the page is only worth building when people open it, so the fetch runs on visibility */
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    if (typeof window.switchAppPage === "function") {
      var orig = window.switchAppPage;
      window.switchAppPage = function (page) {
        var r = orig.apply(this, arguments);
        if (page === "leaderboard") load();
        return r;
      };
    }
    /* boot: show the skeleton immediately, fill it when ready */
    var list = document.getElementById("lb-list");
    if (list && !list.children.length) {
      list.innerHTML = '<li class="lb-empty">Loading the board…</li>';
    }
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
