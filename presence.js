/**
 * TheHighWRLD — Online presence client (HTTP polling).
 *
 * Sends a heartbeat POST every 15 s and fetches the live count via GET.
 * No WebSocket / Durable Object required — works purely with D1.
 * Bot deterrence removed — all visitors counted regardless of suspected bot status.
 */

(function () {
  'use strict';

  let heartbeatTimer = null;
  let pollTimer = null;
  let started = false;

  const state = { online: 0 };

  function uid() {
    let id = '';
    try { id = localStorage.getItem('wantedUserId') || ''; } catch (_) {}
    if (!id) {
      id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('wantedUserId', id); } catch (_) {}
    }
    return id;
  }

  function updateBadge() {
    const el = document.getElementById('presence-count');
    if (el && String(state.online) !== el.textContent) el.textContent = String(state.online);
  }

  async function heartbeat() {
    try {
      const res = await fetch('/api/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uid() }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.online === 'number') {
        state.online = data.online;
        updateBadge();
      }
    } catch (_) {}
  }

  async function poll() {
    try {
      const res = await fetch('/api/online');
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.online === 'number') {
        state.online = data.online;
        updateBadge();
      }
    } catch (_) {}
  }

  function start() {
    if (started) return;
    started = true;

    heartbeat();
    heartbeatTimer = setInterval(heartbeat, 15000);
    pollTimer = setInterval(poll, 10000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        heartbeat(); poll();
      }
    });
    window.addEventListener('beforeunload', function () {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pollTimer) clearInterval(pollTimer);
    });
  }

  window.Presence = {
    init: start,
    refresh() { poll(); },
    isUserOnline() { return false; },
    getOnline() { return state.online; },
    get connected() { return true; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();