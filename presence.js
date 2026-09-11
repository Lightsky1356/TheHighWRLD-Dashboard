/**
 * TheHighWRLD — Online presence client (HTTP polling).
 *
 * Sends a heartbeat POST every 15 s and fetches the live counts via GET every 4 s.
 * No WebSocket / Durable Object required — works purely with D1.
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
    setCount('guest-count', 'site-guest-badge', state.guests, ' guest browsing now', ' guests browsing now');
  }

  function applyCounts(data) {
    if (!data) return;
    if (typeof data.online === 'number') state.online = data.online;
    if (typeof data.guests === 'number') state.guests = data.guests;
    updateBadge();
  }

  function isAuthed() {
    try { return !!localStorage.getItem('wantedAuthUser'); } catch (_) { return false; }
  }

  async function heartbeat() {
    if (!isAuthed()) return;
    if (document.hidden || inFlight) return;
    inFlight = true;
    try {
      const res = await fetch('/api/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uid() }),
      });
      inFlight = false;
      if (!res.ok) return;
      const data = await res.json();
      applyCounts(data);
    } catch (_) { inFlight = false; }
  }

  async function poll() {
    if (document.hidden || inFlight) return;
    inFlight = true;
    try {
      const res = await fetch('/api/online');
      inFlight = false;
      if (!res.ok) return;
      const data = await res.json();
      applyCounts(data);
    } catch (_) { inFlight = false; }
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (_) {} }
  }

  function wsScheduleReconnect() {
    if (wsReconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, wsAttempts), 20000);
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
      wsAttempts = 0;
      if (wsHbTimer) clearInterval(wsHbTimer);
      wsHbTimer = setInterval(function () { wsSend({ type: 'heartbeat' }); }, 25000);
    };
    ws.onmessage = function (ev) {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'report:created' || msg.type === 'report:updated' || msg.type === 'report:deleted') { try { window.dispatchEvent(new CustomEvent('thw:report', { detail: msg })); } catch (_) {} return; }
      if (msg.type !== 'connected' && msg.type !== 'presence:update') return;
      const counts = msg.presence && msg.presence.counts;
      if (!counts) return;
      if (typeof counts.online === 'number') state.online = counts.online;
      if (typeof counts.guests === 'number') state.guests = counts.guests;
      updateBadge();
    };
    ws.onclose = function () {
      if (wsHbTimer) { clearInterval(wsHbTimer); wsHbTimer = null; }
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
    const guestBadge = document.getElementById('site-guest-badge');
    if (guestBadge && !guestBadge.hasAttribute('aria-live')) guestBadge.setAttribute('aria-live', 'polite');

    heartbeat();
    poll();
    wsConnect();
    heartbeatTimer = setInterval(heartbeat, 30000);
    pollTimer = setInterval(poll, 4000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        wsConnect();
        heartbeat(); poll();
      }
    });
    const unload = function () {
      wsLeave();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (wsHbTimer) clearInterval(wsHbTimer);
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pagehide', unload);
  }

  window.Presence = {
    init: start,
    refresh() { poll(); },
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
})();