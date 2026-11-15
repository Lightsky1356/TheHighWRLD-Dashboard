/**
 * TheHighWRLD — Online presence client (WebSocket with HTTP fallback).
 *
 * Uses live WebSocket counts when connected and falls back to HTTP polling while
 * the socket is unavailable. Authenticated visitors also send periodic HTTP
 * heartbeats to keep the existing D1 presence record current.
 * Bot deterrence removed — all visitors counted regardless of suspected bot status.
 */

(function () {
  'use strict';

  let heartbeatTimer = null;
  let pollTimer = null;
  let started = false;
  let inFlight = false;
  let ws = null;
  let wsAttempts = 0;
  let wsHbTimer = null;
  let wsWasOpen = false;
  let wsReconnectTimer = null;

  const state = { online: 0, guests: 0 };

  function uid() {
    let id = '';
    try { id = localStorage.getItem('wantedUserId') || ''; } catch (_) {}
    if (!id) {
      id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('wantedUserId', id); } catch (_) {}
    }
    return id;
  }

  function badgeEl() {
    return document.getElementById('site-online-badge');
  }

  function setCount(id, badgeId, val, singular, plural) {
    const el = document.getElementById(id);
    if (!el) return;
    const txt = String(val);
    if (txt === el.textContent) return;
    el.textContent = txt;
    const badge = document.getElementById(badgeId);
    if (badge) {
      badge.setAttribute('title', txt + (val === 1 ? singular : plural));
      badge.classList.remove('ps-pulse');
      void badge.offsetWidth;
      badge.classList.add('ps-pulse');
    }
  }

  function updateBadge() {
    setCount('presence-count', 'site-online-badge', state.online, ' person online now', ' people online now');
  }

  function applyCounts(data) {
    if (!data) return;
    if (typeof data.online === 'number') state.online = data.online;
    if (typeof data.guests === 'number') state.guests = data.guests;
    updateBadge();
    /* The pill shows real numbers from /api/online — flagged honest when the
       source answered, dimmed when the last poll failed. */
    try { var b = badgeEl(); if (b) b.setAttribute('data-fresh', '1'); } catch (_) {}
  }

  /* Best-effort display name for the heartbeat. Signed-in members have one;
     guests send an empty string, since a visitor id is not a name. */
  function displayName() {
    try {
      const raw = localStorage.getItem('wantedAuthUser');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return String(parsed && (parsed.name || parsed.displayName || parsed.username) || '').slice(0, 64);
    } catch (_) { return ''; }
  }

  async function heartbeat() {
    /* Everyone heartbeats, not just members. This used to return early for
       signed-out visitors, which is half of why the guest count was always 0 -
       the other half was the server refusing to record them. */
    if (document.hidden || inFlight) return;
    inFlight = true;
    try {
      const res = await fetch('/api/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uid(), name: displayName() }),
      });
      inFlight = false;
      if (!res.ok) return;
      const data = await res.json();
      applyCounts(data);
    } catch (_) { inFlight = false; }
  }

  /* How often to ask for the online count when the websocket is not carrying
   * it, and how long to wait after that ask has failed.
   *
   * The websocket is the normal path: while it is open there is no polling at
   * all. The poll is the fallback for when the socket cannot be opened, and
   * that fallback used to run every 4 seconds, forever, for as long as the tab
   * was visible.
   *
   * 4 seconds is 21,600 requests a day, per tab, and every one of them is a
   * request against the plan's daily limit on a Pages project running in
   * bundled mode. The site's request count is what took it down, so the
   * fallback now asks far less often, and backs off further when the ask is
   * failing - which is exactly when the socket is broken and the fallback is
   * the only thing running. */
  var POLL_MS = 60000;
  var POLL_FAIL_MS = 120000;
  var pollFailures = 0;

  async function poll(force) {
    if (document.hidden || inFlight || (!force && ws && ws.readyState === WebSocket.OPEN)) return;
    inFlight = true;
    try {
      const res = await fetch('/api/online');
      inFlight = false;
      if (!res.ok) { pollFailures++; try { var b = badgeEl(); if (b) b.setAttribute('data-fresh', '0'); } catch (_) {} return; }
      const data = await res.json();
      pollFailures = 0;
      applyCounts(data);
    } catch (_) { inFlight = false; pollFailures++; try { var b2 = badgeEl(); if (b2) b2.setAttribute('data-fresh', '0'); } catch (_) {} }
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (_) {} }
  }

  function startPolling() {
    if (pollTimer || document.hidden || (ws && ws.readyState === WebSocket.OPEN)) return;
    scheduleNextPoll();
  }

  /* A timeout rather than an interval, so the delay can change when an ask
   * fails. An interval keeps its original period no matter what happens to the
   * requests it makes. */
  function scheduleNextPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
      pollTimer = null;
      poll().then(function () {
        if (document.hidden || (ws && ws.readyState === WebSocket.OPEN)) return;
        scheduleNextPoll();
      });
    }, pollFailures ? POLL_FAIL_MS : POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function wsScheduleReconnect() {
    if (wsReconnectTimer) return;
    /* The backoff goes to a minute, and to a quarter of an hour once it has
       tried a lot.
     *
       * It gave up after twenty seconds, so a socket that could not be
       * opened was tried three times a minute, for as long as the tab was
       * open. Each attempt is a request, and the socket is opened on every
       * page - so a server refusing them turns into a steady trickle of
       * requests from every tab that is open.
     *
       * A socket that has failed fifteen times is not going to work on the
       * next one, and a tab left open overnight should not be asking. */
    const delay = Math.min(1000 * Math.pow(2, wsAttempts), wsAttempts > 4 ? 900000 : 60000);
    wsAttempts++;
    wsReconnectTimer = setTimeout(function () { wsReconnectTimer = null; wsConnect(); }, delay);
  }

  function wsConnect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    if (typeof WebSocket === 'undefined' || !location.host) return;
    let id = '';
    try { id = uid(); } catch (_) { return; }
    if (!id) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try {
      ws = new WebSocket(proto + location.host + '/api/realtime?uid=' + encodeURIComponent(id) + '&pkey=' + encodeURIComponent(id));
    } catch (_) { wsScheduleReconnect(); return; }
    ws.onopen = function () {
      wsWasOpen = true;
      wsAttempts = 0;
      stopPolling();
      if (wsHbTimer) clearInterval(wsHbTimer);
      /* A minute between heartbeats. The socket is a long-lived worker, and a
         heartbeat is a request every time it fires, for as long as the tab is
         open. A minute is still well inside the ninety-second window the
         presence table counts over. */
      wsHbTimer = setInterval(function () { wsSend({ type: 'heartbeat' }); }, 60000);
    };
    ws.onmessage = function (ev) {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'report:created' || msg.type === 'report:updated' || msg.type === 'report:deleted') { try { window.dispatchEvent(new CustomEvent('thw:report', { detail: msg })); } catch (_) {} return; }
      if (msg.type.indexOf('social:') === 0) { try { window.dispatchEvent(new CustomEvent('thw:social', { detail: msg })); } catch (_) {} return; }
      if (msg.type === 'notification:created') { try { window.dispatchEvent(new CustomEvent('thw:notification', { detail: msg })); } catch (_) {} return; }
      if (msg.type !== 'connected' && msg.type !== 'presence:update') return;
      try { window.dispatchEvent(new CustomEvent('thw:presence')); } catch (_) {}
      const counts = msg.presence && msg.presence.counts;
      if (!counts) return;
      if (typeof counts.online === 'number') state.online = counts.online;
      if (typeof counts.guests === 'number') state.guests = counts.guests;
      updateBadge();
    };
    ws.onclose = function () {
      if (wsHbTimer) { clearInterval(wsHbTimer); wsHbTimer = null; }
      /* The socket has gone, so the counts come from the database again -
         and the table has to be kept current for that to work.
         *
         * But only if it was ever open. A connection attempt that failed
         * closes the socket too, and sending a heartbeat for every one of
         * those means a socket that cannot be opened costs a request as
         * well as the attempt. */
      if (wsWasOpen) heartbeat();
      wsWasOpen = false;
      startPolling();
      wsScheduleReconnect();
    };
    ws.onerror = function () { try { ws.close(); } catch (_) {} };
  }

  function wsLeave() {
    wsSend({ type: 'presence:leave' });
  }

  function start() {
    if (started) return;
    started = true;

    const badge = badgeEl();
    if (badge && !badge.hasAttribute('aria-live')) badge.setAttribute('aria-live', 'polite');

    heartbeat();
    poll();
    wsConnect();
    /* A minute between heartbeats, matching the socket's. */
    heartbeatTimer = setInterval(heartbeat, 60000);
    startPolling();

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        wsConnect();
        heartbeat(); poll();
        startPolling();
      } else stopPolling();
    });
    const unload = function () {
      wsLeave();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pollTimer) clearTimeout(pollTimer);
      if (wsHbTimer) clearInterval(wsHbTimer);
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pagehide', unload);
  }

  window.Presence = {
    init: start,
    refresh() { poll(true); },
    isUserOnline() { return false; },
    getOnline() { return state.online; },
    getGuests() { return state.guests; },
    get connected() { return true; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* =====================================================================
     The "Online now" popover — who is actually on the site, and their
     level. Clicking the online badge toggles it; it refreshes itself
     while open. Signed-in members are listed; guests stay a count.
     ===================================================================== */
  var popOpen = false;
  var popTimer = null;

  function panelEl() { return document.getElementById('online-now-panel'); }
  function closeEl() { return document.getElementById('online-now-close'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderPanel(data) {
    var list = document.getElementById('online-now-list');
    var count = document.getElementById('online-now-count');
    if (count) count.textContent = String((data && data.total) || 0);
    if (!list) return;
    var members = (data && data.members) || [];
    members = members.slice().sort(function (a, b) {
      return (Number(b.level || 1) - Number(a.level || 1)) || (Number(b.xp || 0) - Number(a.xp || 0));
    });
    if (!members.length) {
      list.innerHTML = '<p class="online-now-empty">Nobody signed in right now — the site is quiet.</p>';
      return;
    }
    list.innerHTML = members.map(function (m) {
      var avatar = m.avatar
        ? '<img decoding="async" loading="lazy" src="' + escapeHtml(m.avatar) + '" alt="" onerror="this.onerror=null;this.src=\'\'">'
        : '<i class="fas fa-user" aria-hidden="true"></i>';
      return '<div class="online-now-row" role="listitem">' +
        '<span class="online-now-avatar">' + avatar + '</span>' +
        '<span class="online-now-meta"><span class="online-now-name">' + escapeHtml(m.name) + '</span></span>' +
        '<span class="online-now-level">Lv ' + (m.level || 1) + '</span>' +
      '</div>';
    }).join('');
  }

  async function refreshPanel() {
    try {
      var res = await fetch('/api/online/members');
      if (!res.ok) return;
      var data = await res.json();
      if (data) renderPanel(data);
    } catch (_) {}
  }

  function setPopOpen(open) {
    popOpen = open;
    var panel = panelEl();
    var badge = badgeEl();
    if (panel) panel.hidden = !open;
    if (badge) badge.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (popTimer) { clearInterval(popTimer); popTimer = null; }
    if (open) {
      refreshPanel();
      popTimer = setInterval(refreshPanel, 30000);
    }
  }

  document.addEventListener('click', function (e) {
    var badge = badgeEl();
    var panel = panelEl();
    if (badge && badge.contains(e.target)) { e.preventDefault(); setPopOpen(!popOpen); return; }
    if (panel && !panel.contains(e.target)) setPopOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setPopOpen(false);
  });
  var closeBtn = closeEl();
  if (closeBtn) closeBtn.addEventListener('click', function () { setPopOpen(false); });
  var lb = document.getElementById('online-now-leaderboard');
  if (lb) lb.addEventListener('click', function () {
    setPopOpen(false);
    try { if (typeof window.switchAppPage === 'function') window.switchAppPage('leaderboard'); } catch (_) {}
  });

})();