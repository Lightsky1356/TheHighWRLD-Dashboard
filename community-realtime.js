/**
 * TheHighWRLD Community — realtime client.
 *
 * Renders the full Community page (posts + replies + typing + reactions) with
 * OPTIMISTIC updates and a WebSocket to /api/realtime for live sync.
 *
 * No page refreshes. Deduplicates own broadcasts by server id. Auto-reconnects.
 */

(function () {
  'use strict';

  const STATE = {
    ws: null,
    reconnectTimer: null,
    attempts: 0,
    hubUrl: null,
    uid: '',
    myName: '',
    myAvatar: '',
    activePostId: null,
    posts: new Map(),      // id -> post
    replies: new Map(),    // id -> reply
    typing: new Map(),     // uid -> {name, until}
    pendingReplies: new Map(), // tempId -> {domId, postId}
    pendingPosts: new Map(),   // tempId -> domId
    pendingEdits: new Map(),   // serverId -> {tempBody}
    initialized: false,
    heartbeat: null,
    typingSendTimer: null,
    typingStopTimer: null,
    isTyping: false,
    typingConversation: null,
  };

  let root = null; // the page-section-community element

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function timeAgo(iso) {
    if (!iso) return '';
    try {
      const d = (new Date(iso)).getTime();
      const s = Math.floor((Date.now() - d) / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return s + 's ago';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    } catch (_) { return ''; }
  }

  // ------------------------------------------------------------------
  // Session / identity (from localStorage mirrors used by the app + session)
  // ------------------------------------------------------------------
  function loadIdentity() {
    let name = '', avatar = '', uid = '';
    try {
      const p = localStorage.getItem('thwProfile');
      if (p) { const o = JSON.parse(p); name = o.name || o.display_name || ''; avatar = o.avatar || ''; uid = o.uid || ''; }
    } catch (_) {}
    try { if (!uid) uid = localStorage.getItem('wantedUserId') || ''; } catch (_) {}
    if (!name) { try { name = localStorage.getItem('thwUserName') || ''; } catch (_) {} }
    if (name && !uid) { try { uid = localStorage.getItem('thwUserUid') || ''; } catch (_) {} }
    STATE.myName = name || 'Guest';
    STATE.myAvatar = avatar || '';
    STATE.uid = uid || '';
  }

  // ------------------------------------------------------------------
  // Community page mount + render
  // ------------------------------------------------------------------
  function ensurePage() {
    root = $id('page-section-community');
    if (!root) { console.warn('Community: page-section-community missing'); return false; }
    if (!root.dataset.mounted) {
      root.dataset.mounted = '1';
      root.innerHTML = buildShell();
      bindShell();
    }
    return true;
  }

  function buildShell() {
    return `
    <div class="community-app" data-theme="cyberglass">
      <div class="comm-header">
        <button class="comm-back hidden" id="commBack" title="Back to posts"><i class="fas fa-arrow-left"></i></button>
        <h2 class="comm-title"><i class="fas fa-users"></i> Community</h2>
        <span class="comm-live hidden" id="commLive"><span class="dot"></span> LIVE</span>
      </div>

      <div id="commPostsView" class="comm-view">
        <div class="comm-compose pinned">
          <input data-i18n="communityPostPlaceholder" id="commPostInput" class="comm-input" maxlength="140" placeholder="Start a discussion...">
          <button id="commPostBtn" class="comm-btn primary" disabled><i class="fas fa-paper-plane"></i></button>
        </div>
        <div id="commPostList" class="comm-list"></div>
      </div>

      <div id="commThreadView" class="comm-view hidden">
        <div id="commThreadMeta" class="comm-thread-meta"></div>
        <div id="commReplyList" class="comm-list"></div>
        <div id="commTyping" class="comm-typing hidden"></div>
        <div class="comm-compose">
          <input data-i18n="communityReplyPlaceholder" id="commReplyInput" class="comm-input" maxlength="5000" placeholder="Write a reply...">
          <button id="commReplyBtn" class="comm-btn primary" disabled><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>

      <div id="commEmpty" class="comm-empty hidden">
        <p><i class="fas fa-comments"></i></p>
        <p>No posts yet — start the conversation!</p>
      </div>
    </div>`;
  }

  function bindShell() {
    $id('commPostBtn').addEventListener('click', () => submitPost());
    $id('commPostInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPost(); });
    $id('commPostInput').addEventListener('input', () => { $id('commPostBtn').disabled = !$id('commPostInput').value.trim(); });
    $id('commReplyBtn').addEventListener('click', () => { submitReply(); sendTypingStop(); });
    $id('commReplyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(); sendTypingStop(); } });
    $id('commReplyInput').addEventListener('input', () => { onReplyTyping(); });
    $id('commBack').addEventListener('click', () => showPostsView());
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function loadPosts() {
    const list = $id('commPostList'); if (!list) return;
    try {
      const data = await fetchJSON('/api/community/posts');
      STATE.posts.clear();
      const pinned = [], normal = [];
      (data.posts || []).forEach((p) => { STATE.posts.set(String(p.id), p); (p.pinned ? pinned : normal).push(p); });
      renderPosts([...pinned, ...normal]);
    } catch (err) {
      renderError(list, 'Could not load posts: ' + err.message);
    }
  }

  async function loadReplies(postId) {
    const list = $id('commReplyList'); if (!list) return;
    STATE.replies.clear();
    try {
      const data = await fetchJSON('/api/community/posts/' + postId + '/replies');
      (data.replies || []).forEach((r) => STATE.replies.set(String(r.id), r));
      renderReplies();
    } catch (err) {
      renderError(list, 'Could not load replies: ' + err.message);
    }
  }

  function renderError(el, msg) {
    if (el) { el.innerHTML = '<div class="comm-err">' + esc(msg) + '</div>'; }
  }

  // ------------------------------------------------------------------
  // Post list rendering
  // ------------------------------------------------------------------
  function renderPosts(posts) {
    const list = $id('commPostList'); if (!list) return;
    $id('commEmpty') && ($id('commEmpty').classList.toggle('hidden', !!posts.length));
    if (!posts.length) { list.innerHTML = ''; return; }
    list.innerHTML = posts.map((p) => {
      const isMine = p.author_uid && p.author_uid === STATE.uid;
      return `<div class="comm-post" data-post-id="${esc(p.id)}">
        <div class="comm-post-head">
          <img class="comm-ava" src="${esc(p.avatar) || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%2212%22 r=%2212%22 fill=%22%236366f1%22/><text x=%2212%22 y=%2216%22 font-size=%2210%22 text-anchor=%22middle%22 fill=%22white%22>?</text></svg>'}" alt="">
          <div class="comm-post-who">
            <span class="comm-post-author"${(p.author_uid || p.user_name) ? ` data-profile-link="${esc(p.author_uid || p.user_name)}"` : ``}>${esc(p.user_name)}</span>
            <span class="comm-post-time">${timeAgo(p.created_at)}</span>
          </div>
          ${p.pinned ? '<span class="comm-pin"><i class="fas fa-thumbtack"></i></span>' : ''}
        </div>
        <div class="comm-post-title">${esc(p.title)}</div>
        ${p.body ? '<div class="comm-post-body">' + esc(p.body) + '</div>' : ''}
        <div class="comm-post-foot">
          <button class="comm-open" data-open-post="${esc(p.id)}"><i class="fas fa-comment-dots"></i> ${p.reply_count || 0}</button>
          ${isMine ? `<button class="comm-del" data-del-post="${esc(p.id)}" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-open-post]').forEach((b) => b.addEventListener('click', () => openPost(b.getAttribute('data-open-post'))));
    list.querySelectorAll('[data-del-post]').forEach((b) => b.addEventListener('click', () => deletePost(b.getAttribute('data-del-post'))));
  }

  function bootRender() {
    if (!ensurePage()) return;
    showPostsView(true);
    loadPosts();
  }

  // ------------------------------------------------------------------
  // Thread view
  // ------------------------------------------------------------------
  function openPost(postId) {
    STATE.activePostId = String(postId);
    const p = STATE.posts.get(STATE.activePostId);
    if (!p) return;
    document.getElementById('commPostsView').classList.add('hidden');
    document.getElementById('commThreadView').classList.remove('hidden');
    document.getElementById('commBack').classList.remove('hidden');
    document.getElementById('commLive').classList.remove('hidden');
    document.getElementById('commThreadMeta').innerHTML =
      `<div class="comm-thread-title">${esc(p.title)}</div>
       <div class="comm-thread-sub">${esc(p.user_name)} · ${timeAgo(p.created_at)}</div>`;
    STATE.replies.clear();
    renderReplies();
    loadReplies(STATE.activePostId);
    setTypingConversation('post-' + STATE.activePostId);
    showThreadEmpty();
  }

  function showPostsView(force) {
    STATE.activePostId = null;
    document.getElementById('commPostsView').classList.remove('hidden');
    document.getElementById('commThreadView').classList.add('hidden');
    document.getElementById('commBack').classList.add('hidden');
    document.getElementById('commLive').classList.add('hidden');
    setTypingConversation('community');
    if (force) return;
  }

  // ------------------------------------------------------------------
  // Replies rendering + optimistic updates
  // ------------------------------------------------------------------
  function renderReplies() {
    const list = $id('commReplyList'); if (!list) return;
    const arr = Array.from(STATE.replies.values()).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    showThreadEmpty();
    if (!arr.length) { list.innerHTML = ''; return; }
    list.innerHTML = arr.map((r) => replyHtml(r)).join('');
    list.querySelectorAll('[data-reply-del]').forEach((b) => b.addEventListener('click', () => deleteReply(b.getAttribute('data-reply-del'))));
    list.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', () => toggleReaction(b)));
    document.getElementById('commThreadView').scrollTop = document.getElementById('commThreadView').scrollHeight;
  }

  function replyHtml(r) {
    const isMine = r.author_uid && r.author_uid === STATE.uid;
    const tmp = !!r._optimistic;
    const dispName = isMine ? 'You' : (r.user_name || 'Guest');
    return `<div class="comm-reply${tmp ? ' optimistic' : ''}" data-reply-id="${esc(r.id)}">
      <div class="comm-reply-head">
        <img class="comm-ava" src="${esc(r.avatar) || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%2212%22 r=%2212%22 fill=%22%236366f1%22/></svg>'}" alt="">
        <div class="comm-reply-who">
          <span class="comm-reply-author"${(r.author_uid || dispName) ? ` data-profile-link="${esc(r.author_uid || dispName)}"` : ``}>${esc(dispName)}</span>
          <span class="comm-reply-time">${timeAgo(r.created_at)}${r.edited_at ? ' · edited' : ''}</span>
        </div>
        ${isMine ? `<button class="comm-del" data-reply-del="${esc(r.id)}" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
      ${r.reply_to ? '<div class="comm-reply-to">→ ' + esc(r.reply_to) + '</div>' : ''}
      <div class="comm-reply-body">${esc(r.body)}</div>
      <div class="comm-reply-foot">
        <button class="comm-react" data-react="${esc(r.id)}" data-emoji="❤️"><i class="fas fa-heart"></i></button>
      </div>
    </div>`;
  }

  function showThreadEmpty() {
    const e = $id('commEmpty');
    if (!e) return;
    const view = STATE.activePostId ? document.getElementById('commThreadView') : document.getElementById('commPostsView');
    const emptyText = STATE.activePostId ? 'No replies yet — say something!' : 'No posts yet — start the conversation!';
    e.querySelector('p:last-child').textContent = emptyText;
  }

  // ------------------------------------------------------------------
  // Optimistic + server submit
  // ------------------------------------------------------------------
  async function submitPost() {
    const input = $id('commPostInput'); if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const tempId = 'temp-post-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const tempPost = { id: tempId, title: text, body: '', user_name: STATE.myName, avatar: STATE.myAvatar, author_uid: STATE.uid, pinned: false, reply_count: 0, created_at: new Date().toISOString(), _optimistic: true };
    STATE.posts.set(tempId, tempPost);
    STATE.pendingPosts.set(tempId, true);
    input.value = '';
    $id('commPostBtn').disabled = true;
    renderPosts(Array.from(STATE.posts.values()));
    try {
      const data = await fetchJSON('/api/community/posts', { method: 'POST', body: JSON.stringify({ title: text, clientTempId: tempId }) });
      if (data && data.post) STATE.pendingPosts.delete(tempId);
    } catch (err) {
      STATE.posts.delete(tempId);
      STATE.pendingPosts.delete(tempId);
      renderPosts(Array.from(STATE.posts.values()));
      flashError(err.message);
    }
  }

  async function submitReply() {
    const input = $id('commReplyInput'); if (!input || !STATE.activePostId) return;
    const text = input.value.trim();
    if (!text) return;
    const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const tempReply = { id: tempId, post_id: STATE.activePostId, user_name: STATE.myName, avatar: STATE.myAvatar, author_uid: STATE.uid, body: text, created_at: new Date().toISOString(), edited_at: null, _optimistic: true };
    STATE.replies.set(tempId, tempReply);
    STATE.pendingReplies.set(tempId, { postId: STATE.activePostId });
    input.value = '';
    $id('commReplyBtn').disabled = true;
    renderReplies();
    try {
      const data = await fetchJSON('/api/community/posts/' + STATE.activePostId + '/replies', {
        method: 'POST',
        body: JSON.stringify({ text: text, clientTempId: tempId }),
      });
      if (data && data.reply) replaceTempReply(tempId, data.reply);
    } catch (err) {
      STATE.replies.delete(tempId);
      STATE.pendingReplies.delete(tempId);
      renderReplies();
      flashError(err.message);
    }
  }

  function replaceTempReply(tempId, reply) {
    const pending = STATE.pendingReplies.get(tempId);
    if (pending && pending.postId === STATE.activePostId) {
      STATE.replies.delete(tempId);
      STATE.replies.set(String(reply.id), reply);
    }
    STATE.pendingReplies.delete(tempId);
    // bump post reply count
    const p = STATE.activePostId && STATE.posts.get(String(STATE.activePostId));
    if (p) { p.reply_count = (p.reply_count || 0); renderPostCount(p); }
    renderReplies();
  }

  function renderPostCount(p) {
    document.querySelectorAll('#commPostList .comm-post[data-post-id="' + esc(p.id) + '"] .comm-open').forEach((b) => { b.innerHTML = '<i class="fas fa-comment-dots"></i> ' + (p.reply_count || 0); });
  }

  // ------------------------------------------------------------------
  // Edits / deletes
  // ------------------------------------------------------------------
  async function deletePost(postId) {
    if (!window.confirm('Delete this post?')) return;
    try {
      await fetchJSON('/api/community/posts/' + postId, { method: 'DELETE' });
      STATE.posts.delete(String(postId));
      renderPosts(Array.from(STATE.posts.values()));
    } catch (err) { flashError(err.message); }
  }

  async function deleteReply(replyId) {
    if (!window.confirm('Delete this reply?')) return;
    try {
      await fetchJSON('/api/community/replies/' + replyId, { method: 'DELETE' });
      STATE.replies.delete(String(replyId));
      renderReplies();
    } catch (err) { flashError(err.message); }
  }

  async function toggleReaction(btn) {
    const replyId = btn.getAttribute('data-react');
    const emoji = btn.getAttribute('data-emoji') || '❤️';
    try {
      await fetchJSON('/api/community/replies/' + replyId + '/reactions', { method: 'POST', body: JSON.stringify({ emoji }) });
    } catch (err) { flashError(err.message); }
  }

  function flashError(msg) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg, 'error'); return; }
    } catch (_) {}
    const e = $id('commEmpty');
    if (e) { e.classList.remove('hidden'); e.querySelector('p:last-child').textContent = 'Error: ' + msg; }
  }

  // ------------------------------------------------------------------
  // Typing (WebSocket, never persisted)
  // ------------------------------------------------------------------
  function setTypingConversation(cid) {
    STATE.typingConversation = cid;
    if (STATE.ws && STATE.ws.readyState === WebSocket.OPEN) sendTypingStop();
    updateTypingUI();
  }

  function onReplyTyping() {
    if (!STATE.ws || STATE.ws.readyState !== WebSocket.OPEN) return;
    if (!STATE.isTyping) {
      STATE.isTyping = true;
      sendWs({ type: 'typing:start', conversationId: STATE.typingConversation });
    }
    if (STATE.typingStopTimer) clearTimeout(STATE.typingStopTimer);
    STATE.typingStopTimer = setTimeout(() => sendTypingStop(), 2000);
  }

  function sendTypingStop() {
    if (STATE.typingStopTimer) { clearTimeout(STATE.typingStopTimer); STATE.typingStopTimer = null; }
    if (!STATE.isTyping) return;
    STATE.isTyping = false;
    sendWs({ type: 'typing:stop', conversationId: STATE.typingConversation });
  }

  function updateTypingUI() {
    const el = $id('commTyping'); if (!el) return;
    const now = Date.now();
    const list = [];
    for (const [uid, t] of STATE.typing) {
      if (uid === STATE.uid) continue;
      if (t.until <= now) { STATE.typing.delete(uid); continue; }
      if (STATE.typingConversation && t.conversationId !== STATE.typingConversation) continue;
      if (!list.includes(t.name)) list.push(t.name);
    }
    if (!list.length) { el.classList.add('hidden'); el.textContent = ''; return; }
    let text = '';
    if (list.length === 1) text = list[0] + ' is typing…';
    else if (list.length === 2) text = list[0] + ' and ' + list[1] + ' are typing…';
    else text = list.length + ' people are typing…';
    el.textContent = text;
    el.classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  // WebSocket
  // ------------------------------------------------------------------
  function hubUrl() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/realtime' + (STATE.uid ? '?uid=' + encodeURIComponent(STATE.uid) : '');
  }

  function connect() {
    if (STATE.ws && (STATE.ws.readyState === WebSocket.CONNECTING || STATE.ws.readyState === WebSocket.OPEN)) return;
    try { STATE.ws = new WebSocket(hubUrl()); } catch (_) { scheduleReconnect(); return; }

    STATE.ws.onopen = () => {
      STATE.attempts = 0;
      if (STATE.reconnectTimer) { clearTimeout(STATE.reconnectTimer); STATE.reconnectTimer = null; }
      $id('commLive') && $id('commLive').classList.remove('hidden');
      sendWs({ type: 'hello', uid: STATE.uid, conversationId: STATE.typingConversation || 'community' });
      if (STATE.heartbeat) clearInterval(STATE.heartbeat);
      STATE.heartbeat = setInterval(() => sendWs({ type: 'heartbeat' }), 25000);
    };

    STATE.ws.onmessage = (ev) => { try { handleMsg(JSON.parse(ev.data)); } catch (_) {} };
    STATE.ws.onclose = () => { stopHb(); $id('commLive') && $id('commLive').classList.add('hidden'); scheduleReconnect(); };
    STATE.ws.onerror = () => {};
  }

  function stopHb() { if (STATE.heartbeat) { clearInterval(STATE.heartbeat); STATE.heartbeat = null; } }

  function scheduleReconnect() {
    if (STATE.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, STATE.attempts), 20000);
    STATE.attempts++;
    STATE.reconnectTimer = setTimeout(() => { STATE.reconnectTimer = null; connect(); }, delay);
  }

  function sendWs(obj) {
    if (STATE.ws && STATE.ws.readyState === WebSocket.OPEN) { try { STATE.ws.send(JSON.stringify(obj)); } catch (_) {} }
  }

  function handleMsg(msg) {
    switch (msg.type) {
      case 'hello:ok': break;
      case 'typing:start': {
        if (msg.userId && msg.userName) STATE.typing.set(String(msg.userId), { name: msg.userName, conversationId: msg.conversationId, until: Date.now() + 3000 });
        updateTypingUI();
        break;
      }
      case 'typing:stop': {
        if (msg.userId) STATE.typing.delete(String(msg.userId));
        updateTypingUI();
        break;
      }
      case 'post:created': {
        if (msg.post && msg.post.id) {
          const exists = STATE.posts.has(String(msg.post.id));
          STATE.posts.set(String(msg.post.id), msg.post);
          if (!exists && !$id('commThreadView').classList.contains('hidden') === false) renderPosts(Array.from(STATE.posts.values()));
        }
        break;
      }
      case 'reply:created': {
        onReplyCreated(msg);
        break;
      }
      case 'reply:updated': {
        const r = STATE.replies.get(String(msg.replyId));
        if (r) { r.body = msg.text; r.edited_at = msg.edited_at; renderReplies(); }
        break;
      }
      case 'reply:deleted': {
        STATE.replies.delete(String(msg.replyId));
        renderReplies();
        break;
      }
      case 'reaction:added':
      case 'reaction:removed':
        break;
      case 'notification:created':
        try { if (typeof window.notifyLive === 'function') window.notifyLive(msg.notification); } catch (_) {}
        break;
      default:
        break;
    }
  }

  function onReplyCreated(msg) {
    const r = msg && msg.reply;
    if (!r) return;
    const convo = 'post-' + r.post_id;
    // dedup: if we optimistically showed it and it belongs to the active thread
    if (STATE.pendingReplies.size) {
      for (const [tempId, pinfo] of STATE.pendingReplies) {
        if (pinfo.postId === r.post_id && r.author_uid && r.author_uid === STATE.uid) {
          // our own reply broadcast -> reconcile
          STATE.pendingReplies.delete(tempId);
          if (STATE.activePostId === String(r.post_id)) {
            STATE.replies.delete(tempId);
            STATE.replies.set(String(r.id), r);
            renderReplies();
          } else {
            STATE.replies.set(String(r.id), r);
          }
          return;
        }
      }
    }
    if (STATE.activePostId === String(r.post_id)) {
      // NEW reply on the currently-open thread
      if (!STATE.replies.has(String(r.id))) {
        STATE.replies.set(String(r.id), r);
        renderReplies();
      } else {
        STATE.replies.set(String(r.id), r);
      }
    } else {
      // reply on another thread -> increment hidden post count
      const p = STATE.posts.get(String(r.post_id));
      if (p) { p.reply_count = (p.reply_count || 0); renderPostCount(p); }
    }
  }

  // ------------------------------------------------------------------
  // Public API / init
  // ------------------------------------------------------------------
  function init() {
    loadIdentity();
    if (!ensurePage()) return;
    bootRender();
    connect();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') connect();
    });
    window.addEventListener('beforeunload', () => { try { STATE.ws && STATE.ws.close(); } catch (_) {} stopHb(); });
  }

  window.initCommunityRealtime = function () {
    if (!STATE.initialized) { STATE.initialized = true; init(); }
    else { ensurePage(); loadPosts(); }
  };
})();
