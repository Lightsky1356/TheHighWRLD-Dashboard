/**
 * TheHighWRLD — Real-time online presence client.
 *
 * Opens an always-on WebSocket to `/api/realtime` and sends a lightweight
 * heartbeat while the page is active. The backend Durable Object tracks who is
 * online (ephemeral, no per-heartbeat DB writes) and broadcasts presence
 * updates so the online count and profile status stay live WITHOUT a refresh.
 *
 *   ● 12 Online        (site-wide live count badge)
 *   ● Online / ○ Offline  (per-user profile status)
 *
 * - Multi-tab safe: all tabs share an identity key, so a user is counted once.
 * - Heartbeat ~15s, backend timeout ~45s: offline/refresh/sleep auto-expires.
 * - Privacy: only the count + display names are exposed to others.
 */
(function () {
  'use strict';

  let ws = null;
  let reconnectTimer = null;
  let attempts = 0;
  let heartbeatTimer = null;
  let stopHearbeat = false;
  let started = false;

  // Public state kept in sync via presence:update broadcasts + initial snapshot.
  const state = {
    online: 0,
    users: {},          // presenceId -> { type, name, lastSeen }
    authUids: new Set(), // Set of live authenticated user uids
    connected: false,
  };

  let guestKey = '';
  function guestId() {
    if (guestKey) return guestKey;
    try { guestKey = localStorage.getItem('wantedUserId') || ''; } catch (_) {}
    if (!guestKey) {
      guestKey = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('wantedUserId', guestKey); } catch (_) {}
    }
    return guestKey;
  }

  function wsUrl() {
    const uid = guestId();
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
      '/api/realtime?uid=' + encodeURIComponent(uid) + '&pkey=' + encodeURIComponent(uid);
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (_) {} }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    try { ws = new WebSocket(wsUrl()); } catch (_) { scheduleReconnect(); return; }

    ws.onopen = () => {
      attempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      state.connected = true;
      send({ type: 'hello' }); // proxy sets real auth uid; pkey (guest) via query
      startHeartbeat();
      emit('connect');
    };

    ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch (_) {} };
    ws.onclose = () => {
      state.connected = false;
      stopHeartbeat();
      emit('disconnect');
      scheduleReconnect();
    };
    ws.onerror = () => {
      console.warn('Presence WebSocket connection failed - this is expected if backend not configured');
      // Don't aggressively retry if backend is not available
      if (attempts > 2) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(1500 * Math.pow(1.6, attempts), 15000);
    attempts++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    // Heartbeat immediately, then every 15s (backend TTL is 45s, so a throttled
    // hidden tab or brief network blip won't falsely expire us).
    send({ type: 'presence:heartbeat' });
    heartbeatTimer = setInterval(() => send({ type: 'presence:heartbeat' }), 15000);
    stopHearbeat = false;
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function applyPresence(p) {
    if (!p) return;
    if (typeof p.online === 'number') state.online = p.online;
    if (Array.isArray(p.users)) {
      state.users = {};
      state.authUids.clear();
      for (const u of p.users) {
        if (!u || !u.id) continue;
        state.users[u.id] = { type: u.type, name: u.name || '', lastSeen: u.lastSeen || 0 };
        if (u.type === 'auth' && u.id.startsWith('u:')) state.authUids.add(u.id.slice(2));
      }
    }
    emit('change');
    render();
  }

  function handle(msg) {
    switch (msg.type) {
      case 'connected':
        if (msg.presence) applyPresence(msg.presence);
        break;
      case 'hello:ok':
        // Registration done; initial snapshot arrives via connected.
        break;
      case 'presence:update':
        if (msg.presence) applyPresence(msg.presence);
        break;
      case 'presence:start':
      case 'presence:count':
        if (typeof msg.online === 'number') { state.online = msg.online; emit('change'); render(); }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // Rendering (idempotent: only touches the DOM when state actually
  // changed, and never rewrites a node it already rendered correctly).
  // ------------------------------------------------------------------
  function updateBadge() {
    const badge = document.getElementById('presence-count');
    if (!badge) return false;
    const text = String(state.online);
    if (badge.textContent === text) return false;
    badge.textContent = text;
    return true;
  }

  function updateDots() {
    const els = document.querySelectorAll('.cmp-site-presence[data-uid]');
    let touched = false;
    els.forEach((el) => {
      const uid = el.getAttribute('data-uid');
      const online = !!uid && state.authUids.has(uid);
      const wantClass = online ? ' on' : ' off';
      if (!el.classList.contains(online ? 'on' : 'off')) {
        el.classList.toggle('on', online);
        el.classList.toggle('off', !online);
        touched = true;
      }
      // Build the correct label/dot, but only assign when different to avoid
      // triggering the MutationObserver (which would feed back into ourselves).
      const wantLabel = online ? 'Online now' : 'Offline';
      let l = el.querySelector('.ps-label');
      if (!l) {
        l = document.createElement('span');
        l.className = 'ps-label';
        el.appendChild(l);
        touched = true;
      }
      if (l.textContent !== wantLabel) { l.textContent = wantLabel; touched = true; }
      let d = el.querySelector('.ps-dot');
      if (!d) {
        d = document.createElement('span');
        d.className = 'ps-dot';
        el.insertBefore(d, l);
        touched = true;
      }
      const dotClass = 'ps-dot ' + (online ? 'on' : 'off');
      if (d.className !== dotClass) { d.className = dotClass; touched = true; }
      if (el.className !== 'cmp-site-presence' + wantClass) { el.className = 'cmp-site-presence' + wantClass; touched = true; }
    });
    return touched;
  }

  // Returns true if presence UI actually needs a pass (fewer than all checks).
  function presenceUIExists() {
    return !!document.getElementById('presence-count') || document.querySelector('.cmp-site-presence[data-uid]') != null;
  }

  function render() {
    // 1) Site-wide online count badge (live).
    const badgeTouched = updateBadge();
    // 2) Per-user profile status dots: ● Online / ○ Offline.
    const dotsTouched = updateDots();
    return badgeTouched || dotsTouched;
  }

  // Re-scan+sync after dynamic UI (profile cards) renders.
  function refresh() { render(); }
  function isUserOnline(uid) { return !!(uid && state.authUids.has(uid)); }

  function emit(name) {
    document.dispatchEvent(new CustomEvent('presence:' + name, { detail: { state: state } }));
  }

  // ------------------------------------------------------------------
  // Lifecycle: tabs, visibility, browser online/offline, sleep.
  // ------------------------------------------------------------------
  function onVisibility() {
    if (document.visibilityState === 'visible') {
      // Returned to foreground — re-open if needed and ping immediately.
      connect();
      send({ type: 'presence:heartbeat' });
    }
  }
  function onBrowserOnline() { connect(); send({ type: 'presence:heartbeat' }); }
  function onBrowserOffline() { /* WS will close on its own; reconnect on back-online */ }

  function init() {
    if (started) return;
    started = true;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('beforeunload', () => { try { ws && ws.close(); } catch (_) {} stopHeartbeat(); });
    // Delay connection until after page is interactive to prevent blocking startup
    if (document.readyState === 'complete') {
      setTimeout(connect, 5000);
    } else {
      window.addEventListener('load', () => setTimeout(connect, 5000));
    }
    // Watch for dynamically-rendered profile status elements.
    // Cost-aware observer:
    //  - does nothing at all unless there is presence UI to update
    //  - coalesces bursts of mutations into a single frame with rAF
    //  - render() is idempotent, so our own (unchanged) DOM writes never
    //    retrigger a meaningful pass -> no feedback loop.
    if (typeof MutationObserver === 'function') {
      let pendingFrame = false;
      const observer = new MutationObserver(() => {
        if (!presenceUIExists()) return; // no presence elements -> skip entirely
        if (pendingFrame) return;        // already scheduled for this frame
        pendingFrame = true;
        requestAnimationFrame(() => {
          pendingFrame = false;
          render();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.Presence = {
    init,
    refresh,
    isUserOnline,
    getOnline() { return state.online; },
    get connected() { return state.connected; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
