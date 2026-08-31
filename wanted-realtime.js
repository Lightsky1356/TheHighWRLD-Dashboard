/*
  Wanted Vault Realtime Client (WebSocket-based)
  Listens for live reply:created / typing events over the WebSocket and renders
  instantly with NO page refreshes. Own replies are optimistic + deduped.
*/

(function () {
  'use strict';

  let ws = null;
  let reconnectTimer = null;
  let attempts = 0;
  let heartbeat = null;
  let myUserName = 'Anonymous';
  let uid = '';
  let currentTrackTitle = '';
  let pendingReplies = new Map(); // tempId -> { text, trackTitle }
  let typingTimeout = null;
  let isTyping = false;
  let visibleReplies = new Set(); // Set of reply IDs currently visible
  let autoInitDone = false;

  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/realtime' + (uid ? '?uid=' + encodeURIComponent(uid) : '');
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(data)); } catch (_) {} }
  }

  function initWantedRealtime() {
    if (autoInitDone) return;
    autoInitDone = true;

    try {
      if (typeof _wantedServer !== 'undefined' && _wantedServer.me && _wantedServer.me.discord) {
        myUserName = _wantedServer.me.discord;
      } else {
        myUserName = 'Anonymous User';
      }
    } catch (e) { myUserName = 'Anonymous User'; }
    try { uid = localStorage.getItem('wantedUserId') || ''; } catch (_) {}

    // Delay connection until after page is interactive to prevent blocking startup
    if (document.readyState === 'complete') {
      setTimeout(connect, 6000);
    } else {
      window.addEventListener('load', () => setTimeout(connect, 6000));
    }
    setupTypingIndicators();
    overrideReplySubmission();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') connect();
      else { if (heartbeat) clearInterval(heartbeat); }
    });
    window.addEventListener('beforeunload', () => { try { ws && ws.close(); } catch (_) {} if (heartbeat) clearInterval(heartbeat); });
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    try { ws = new WebSocket(wsUrl()); } catch (_) { scheduleReconnect(); return; }

    ws.onopen = () => {
      attempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      send({ type: 'hello', uid: uid });
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 25000);
    };

    ws.onmessage = (ev) => { try { handleMsg(JSON.parse(ev.data)); } catch (_) {} };
    ws.onclose = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } scheduleReconnect(); };
    ws.onerror = () => {};
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, attempts), 20000);
    attempts++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function handleMsg(msg) {
    switch (msg.type) {
      case 'reply:created': {
        if (msg.reply && msg.reply.track_id) handleNewReplies([msg.reply]);
        break;
      }
      case 'reply:updated':
      case 'reply:deleted': {
        // Wanted replies have no stable DOM id; do a lightweight re-sync to stay
        // consistent after an edit/delete (rare events).
        if (typeof _wantedGet === 'function') { try { _wantedGet(); } catch (_) {} }
        break;
      }
      case 'typing:start': {
        // Only show typing scoped to the currently-open track's conversation.
        if (msg.conversationId && currentTrackTitle && msg.conversationId === currentTrackTitle) {
          updateTypingIndicator([{ userId: msg.userId, userName: msg.userName }]);
        } else if (!currentTrackTitle) {
          updateTypingIndicator([{ userId: msg.userId, userName: msg.userName }]);
        }
        break;
      }
      case 'typing:stop': {
        if (msg.conversationId && currentTrackTitle && msg.conversationId !== currentTrackTitle) break;
        updateTypingIndicator([]);
        break;
      }
      default:
        break;
    }
  }

  // Handle a live reply (already in legacy wanted format, includes track_id).
  function handleNewReplies(replies) {
    if (typeof _wantedSorted === 'undefined') return;
    const list = _wantedSorted;

    replies.forEach(function (reply) {
      // Dedup own optimistic replies.
      for (const [tempId, pending] of pendingReplies) {
        if (pending.trackTitle === reply.track_id &&
            reply.u && reply.r && pending.text === reply.r) {
          pendingReplies.delete(tempId);
          // update the temp element id if it had no server id
          return;
        }
      }
      if (visibleReplies.has(reply.id)) return;

      let trackIndex = -1;
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].t) === String(reply.track_id)) { trackIndex = i; break; }
      }
      if (trackIndex === -1) return;

      const repliesList = document.getElementById('wanted-replies-' + trackIndex);
      if (repliesList) {
        let replyHtml = '';
        try { replyHtml = wantedThreadHtml([reply], trackIndex, 0)[0]; } catch (_) {}
        if (replyHtml) {
          repliesList.insertAdjacentHTML('afterbegin', replyHtml);
          visibleReplies.add(reply.id);

          const toggleBtn = document.getElementById('wanted-reply-toggle-' + trackIndex);
          if (toggleBtn) {
            const currentCount = parseInt(toggleBtn.textContent, 10) || 0;
            const next = currentCount + 1;
            toggleBtn.textContent = next + ' ' + (next === 1 ? 'reply' : 'replies');
          }
        }
      }
    });
  }

  function updateTypingIndicator(others) {
    const othersList = (others || []).filter((u) => u.userName && u.userName !== myUserName);

    if (othersList.length === 0) {
      document.querySelectorAll('.wanted-typing-indicator').forEach((el) => { el.style.display = 'none'; el.textContent = ''; });
      return;
    }
    let text = '';
    const names = othersList.map((u) => u.userName);
    if (names.length === 1) text = names[0] + ' is typing...';
    else if (names.length === 2) text = names[0] + ' and ' + names[1] + ' are typing...';
    else text = names.length + ' people are typing...';

    document.querySelectorAll('.wanted-typing-indicator').forEach((el) => {
      el.textContent = text;
      el.style.display = 'block';
    });
  }

  function setCurrentTrack(track) { currentTrackTitle = track || ''; }

  // ------------------------------------------------------------------
  // Typing via WebSocket (never persisted)
  // ------------------------------------------------------------------
  function setupTypingIndicators() {
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id && e.target.id.indexOf('wanted-reply-input-') === 0) {
        const idx = e.target.id.replace('wanted-reply-input-', '');
        handleTypingInput(e.target, idx);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.id && e.target.id.indexOf('wanted-reply-input-') === 0) {
        handleTypingKeydown(e);
      }
    });
  }

  function handleTypingInput(input, idx) {
    let track = '';
    if (typeof _wantedSorted !== 'undefined' && _wantedSorted[idx]) track = String(_wantedSorted[idx].t);
    setCurrentTrack(track);

    if (!isTyping) {
      isTyping = true;
      send({ type: 'typing:start', conversationId: currentTrackTitle || 'wanted' });
    }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      send({ type: 'typing:stop', conversationId: currentTrackTitle || 'wanted' });
    }, 2000);
  }

  function handleTypingKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      isTyping = false;
      send({ type: 'typing:stop', conversationId: currentTrackTitle || 'wanted' });
      if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
    }
  }

  // ------------------------------------------------------------------
  // Optimistic reply submission (still hits /api/wanted action="reply")
  // ------------------------------------------------------------------
  function overrideReplySubmission() {
    if (typeof window.replyWantedIdx === 'function') {
      const original = window.replyWantedIdx;
      window.replyWantedIdx = function (i2) {
        const input = document.getElementById('wanted-reply-input-' + i2);
        if (!input || !input.value.trim()) { original(i2); return; }

        const text = input.value.trim();
        const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2);

        let track = '';
        if (typeof _wantedSorted !== 'undefined' && _wantedSorted[i2]) track = _wantedSorted[i2].t;
        setCurrentTrack(track);
        pendingReplies.set(tempId, { text: text, trackTitle: track });

        input.value = '';
        original(i2); // script.js already optimistically renders + calls _wantedPost
      };
    }
  }

  // Expose init + helpers
  window.initWantedRealtime = initWantedRealtime;
  window._wantedRealtimeSetTrack = setCurrentTrack;

  const _origInitWanted = window.initWanted;
  if (typeof _origInitWanted === 'function') {
    window.initWanted = function () {
      _origInitWanted();
      initWantedRealtime();
    };
  }
  // Also init if the vault is already showing.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    const sec = document.getElementById('page-section-wanted');
    if (sec && sec.classList.contains('active')) initWantedRealtime();
  }
})();
