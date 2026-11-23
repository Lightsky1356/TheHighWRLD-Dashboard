/* TheHighWRLD Suggestions — full frontend with voting, filtering, realtime */
(function () {
  'use strict';

  const API = '/api/suggestions-v2';
  const CATS = { dashboard: 'Dashboard', player: 'WRLD Player', community: 'Community', bug_fix: 'Bug Fix', feature_request: 'Feature Request', other: 'Other' };
  const CAT_EMOJI = { dashboard: '\uD83C\uDFAE', player: '\uD83C\uDFB5', community: '\uD83D\uDC65', bug_fix: '\uD83D\uDD27', feature_request: '\uD83D\uDCA1', other: '\u2728' };
  const STATUS_MAP = {
    new: ['\uD83D\uDCA1 New', 'bg-blue-500/10 border-blue-500/30 text-blue-300'],
    under_review: ['\uD83D\uDC40 Under Review', 'bg-amber-500/10 border-amber-500/30 text-amber-300'],
    planned: ['\uD83D\uDEE0\uFE0F Planned', 'bg-purple-500/10 border-purple-500/30 text-purple-300'],
    in_progress: ['\uD83D\uDEA7 In Progress', 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'],
    completed: ['\u2705 Completed', 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'],
    declined: ['\u274C Declined', 'bg-red-500/10 border-red-500/30 text-red-300'],
  };

  let state = { suggestions: [], myVotes: {}, isOwner: false, linked: false, total: 0, page: 1, pages: 1 };
  let replyTo = { sid: 0, cid: 0, name: '' };
  let filters = { status: 'all', category: 'all', sort: 'newest', q: '' };
  let debounceTimer = null;

  function getUid() { try { return localStorage.getItem('wantedUserId') || ''; } catch (e) { return ''; } }
  function hasLinked() { return !!getUid() && !!state.linked; }

  if (!window.showGateModal) {
    window.showGateModal = function (title, message) {
      var ov = document.getElementById('gate-modal-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'gate-modal-overlay';
        ov.className = 'gate-modal-overlay';
        ov.style.display = 'none';
        ov.innerHTML = '<div class="gate-modal" role="dialog" aria-modal="true">' +
          '<div class="gate-modal-icon"><i class="fab fa-discord"></i></div>' +
          '<h3 class="gate-modal-title"></h3>' +
          '<p class="gate-modal-msg"></p>' +
          '<div class="gate-modal-actions">' +
          '<button type="button" class="gate-modal-link"><i class="fab fa-discord"></i> Link Discord</button>' +
          '<button type="button" class="gate-modal-close">Close</button>' +
          '</div></div>';
        document.body.appendChild(ov);
        var close = function () {
          ov.style.display = 'none';
          try {
            document.body.style.overflow = ov.dataset.prevOverflow || '';
            document.documentElement.classList.remove('scroll-locked');
          } catch (e) {}
        };
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        var closeBtn = ov.querySelector('.gate-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        var linkBtn = ov.querySelector('.gate-modal-link');
        if (linkBtn) linkBtn.addEventListener('click', function () {
          close();
          if (window.switchAppPage) { try { window.switchAppPage('account'); } catch (e) {} }
        });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && ov.style.display !== 'none') close();
        });
      }
      var t = ov.querySelector('.gate-modal-title');
      var m = ov.querySelector('.gate-modal-msg');
      if (t) t.textContent = title || 'Discord Required';
      if (m) m.textContent = message || 'This action requires a LINKED Discord Account';
      try {
        if (ov.style.display !== 'flex') ov.dataset.prevOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        document.documentElement.classList.add('scroll-locked');
      } catch (e) {}
      ov.style.display = 'flex';
    };
  }
  function showGateModal(title, message) { window.showGateModal(title, message); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function relTime(ts) {
    if (!ts) return '';
    var d = Date.now() - Date.parse(ts);
    if (isNaN(d)) return '';
    var s = Math.floor(d / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  async function api(action, data) {
    const uid = getUid();
    const body = { action, user: uid, ...data };
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  async function load() {
    const uid = getUid();
    const params = new URLSearchParams();
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.category !== 'all') params.set('category', filters.category);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.q) params.set('q', filters.q);
    if (uid) params.set('user', uid);
    try {
      const r = await fetch(API + '?' + params.toString(), { cache: 'no-store' });
      const d = await r.json();
      state.suggestions = d.suggestions || [];
      state.myVotes = d.myVotes || {};
      state.isOwner = !!d.isOwner;
      state.linked = !!d.linked;
      state.total = d.total || 0;
      state.page = d.page || 1;
      state.pages = d.pages || 1;
      render();
    } catch (e) {}
  }

  function render() {
    renderFilters();
    renderList();
    renderForm();
  }

  function renderForm() {
    const uid = getUid();
    const form = document.getElementById('sugg-form');
    const title = document.getElementById('sugg-title');
    const desc = document.getElementById('sugg-desc');
    const cat = document.getElementById('sugg-category');
    const btn = document.getElementById('sugg-submit');
    const result = document.getElementById('sugg-result');
    if (!form) return;
    if (!uid || !state.linked) {
      if (title) title.disabled = true;
      if (desc) desc.disabled = true;
      if (cat) cat.disabled = true;
      if (btn) btn.disabled = true;
      if (result) { result.textContent = 'Link Discord to submit suggestions.'; result.className = 'text-xs text-amber-400 mt-2'; result.style.display = ''; }
      return;
    }
    if (title) title.disabled = false;
    if (desc) desc.disabled = false;
    if (cat) cat.disabled = false;
    if (btn) btn.disabled = false;
  }

  function renderFilters() {
    document.querySelectorAll('[data-sugg-filter]').forEach(function (btn) {
      const f = btn.getAttribute('data-sugg-filter');
      const v = btn.getAttribute('data-sugg-val');
      const isActive = (f === 'status' && filters.status === v) || (f === 'category' && filters.category === v) || (f === 'sort' && filters.sort === v);
      btn.classList.toggle('active', isActive);
    });
    var ct = document.getElementById('sugg-count');
    if (ct) ct.textContent = state.total + ' suggestion' + (state.total !== 1 ? 's' : '');
  }

  function commentNode(c, sid, isReply) {
    var mine = c.authorUid === getUid();
    return '<div class="sugg-comment' + (isReply ? ' is-reply' : '') + '" data-cid="' + c.id + '">' +
      '<div class="sugg-comment-head">' +
        '<span class="sugg-comment-name"' + (c.authorUid ? ' data-profile-link="' + esc(c.authorUid) + '"' : '') + '>' + esc(c.authorName || 'Member') + '</span>' +
        '<span class="sugg-comment-time">' + relTime(c.createdAt) + '</span>' +
      '</div>' +
      (c.deleted ? '<p class="sugg-comment-gone">This reply was deleted.</p>' : '<p class="sugg-comment-text">' + esc(c.body) + '</p>') +
      (!c.deleted && hasLinked()
        ? '<div class="sugg-comment-actions">' +
            '<button type="button" class="sugg-comment-reply" data-sugg-reply="' + c.id + '" data-sid="' + sid + '" data-name="' + esc(c.authorName || 'Member') + '"><i class="fas fa-reply"></i> Reply</button>' +
            ((mine || state.isOwner) ? '<button type="button" class="sugg-comment-del" data-sugg-comment-del="' + c.id + '" data-sid="' + sid + '" title="Delete"><i class="fas fa-trash"></i></button>' : '') +
          '</div>'
        : '') +
      (c.replies || []).map(function (r) { return commentNode(r, sid, true); }).join('') +
      '</div>';
  }

  function commentsHTML(s) {
    var list = s.comments || [];
    var banner = '';
    if (replyTo.sid === s.id && replyTo.cid) {
      banner = '<div class="sugg-comment-replying"><span>Replying to ' + esc(replyTo.name) + '</span>' +
        '<button type="button" data-sugg-reply-cancel><i class="fas fa-xmark"></i></button></div>';
    }
    return '<div class="sugg-comments">' +
      '<button type="button" class="sugg-comments-toggle" data-sugg-toggle="' + s.id + '"><i class="fas fa-comments"></i> ' + list.length + ' repl' + (list.length === 1 ? 'y' : 'ies') + '</button>' +
      '<div class="sugg-comments-body"' + (list.length ? '' : ' hidden') + '>' +
        (list.length ? list.map(function (c) { return commentNode(c, s.id, false); }).join('') : '<p class="sugg-comment-empty">No replies yet.</p>') +
        banner +
        (hasLinked() ? '<div class="sugg-comment-compose"><input class="sugg-comment-input" type="text" maxlength="2000" placeholder="Write a reply\u2026" aria-label="Write a reply" data-sid="' + s.id + '"><button type="button" class="sugg-comment-send" data-sugg-send="' + s.id + '" aria-label="Send reply"><i class="fas fa-arrow-right"></i></button></div>' : '') +
      '</div></div>';
  }

  function renderList() {
    var el = document.getElementById('sugg-list');
    if (!el) return;
    if (!state.suggestions.length) {
      el.innerHTML = '<p class="text-xs text-gray-500 py-4 text-center">No suggestions yet \u2014 be the first to share an idea.</p>';
      return;
    }
    el.innerHTML = state.suggestions.map(function (s) {
      var st = STATUS_MAP[s.status] || STATUS_MAP.new;
      var catEmoji = CAT_EMOJI[s.category] || '\u2728';
      var catLabel = CATS[s.category] || 'Other';
      var myVote = state.myVotes[s.id] || 0;
      var upClass = myVote === 1 ? 'voted' : '';
      var downClass = myVote === -1 ? 'voted' : '';
      var isAuthor = s.authorUid === getUid();
      var adminBtns = state.isOwner ? '<div class="sugg-admin-btns">' +
        '<select data-admin-status="' + s.id + '" class="admin-select">' +
        Object.keys(STATUS_MAP).map(function (k) { return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + STATUS_MAP[k][0] + '</option>'; }).join('') +
        '</select>' +
        '<button data-admin-delete="' + s.id + '" class="admin-delete-btn" title="Delete"><i class="fas fa-trash"></i></button>' +
        '</div>' : '';

      return '<div class="sugg-card" data-id="' + s.id + '">' +
        '<div class="sugg-card-top">' +
          '<div class="sugg-vote-col">' +
            '<button class="sugg-upvote ' + upClass + '" data-vote="' + s.id + '" data-vval="1" title="Upvote"><i class="fas fa-arrow-up"></i></button>' +
            '<span class="sugg-vote-count">' + (s.voteCount || 0) + '</span>' +
            '<button class="sugg-downvote ' + downClass + '" data-vote="' + s.id + '" data-vval="-1" title="Downvote"><i class="fas fa-arrow-down"></i></button>' +
          '</div>' +
          '<div class="sugg-card-body">' +
            '<div class="sugg-card-header">' +
              '<span class="sugg-status-badge ' + st[1] + '">' + st[0] + '</span>' +
              '<span class="sugg-cat-badge">' + catEmoji + ' ' + esc(catLabel) + '</span>' +
              '<span class="sugg-time">' + relTime(s.createdAt) + '</span>' +
            '</div>' +
            '<h3 class="sugg-card-title">' + esc(s.title) + '</h3>' +
            (s.description ? '<p class="sugg-card-desc">' + esc(s.description) + '</p>' : '') +
            '<div class="sugg-card-footer">' +
              '<span class="sugg-author"' + (((s.authorUid || s.authorName) && s.authorName !== 'Anonymous') ? ' data-profile-link="' + esc(s.authorUid || s.authorName) + '"' : '') + '>' + esc((s.authorName && s.authorName !== 'Anonymous') ? s.authorName : '🖥️System') + '</span>' +
              adminBtns +
            (hasLinked() ? '<button class="report-flag-btn" data-report="suggestion:' + s.id + '" title="Report"><i class="fas fa-flag"></i></button>' : '') +
            '</div>' +
            commentsHTML(s) +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    el.querySelectorAll('[data-vote]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleVote(parseInt(btn.getAttribute('data-vote'), 10), parseInt(btn.getAttribute('data-vval') || '1', 10));
      });
    });
    el.querySelectorAll('[data-admin-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = parseInt(sel.getAttribute('data-admin-status'), 10);
        api('updateStatus', { id: id, status: sel.value }).then(load);
      });
    });
    el.querySelectorAll('[data-admin-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Delete this suggestion?')) {
          api('delete', { id: parseInt(btn.getAttribute('data-admin-delete'), 10) }).then(load);
        }
      });
    });

    el.querySelectorAll('[data-sugg-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var body = btn.parentElement.querySelector('.sugg-comments-body');
        if (body) body.hidden = !body.hidden;
      });
    });
    el.querySelectorAll('[data-sugg-reply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = parseInt(btn.getAttribute('data-sid'), 10);
        replyTo = { sid: sid, cid: parseInt(btn.getAttribute('data-sugg-reply'), 10), name: btn.getAttribute('data-name') || 'Member' };
        render();
        var input = document.querySelector('.sugg-card[data-id="' + sid + '"] .sugg-comment-input');
        var body = document.querySelector('.sugg-card[data-id="' + sid + '"] .sugg-comments-body');
        if (body) body.hidden = false;
        if (input) input.focus();
      });
    });
    el.querySelectorAll('[data-sugg-reply-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () { replyTo = { sid: 0, cid: 0, name: '' }; render(); });
    });
    el.querySelectorAll('[data-sugg-comment-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Delete this reply?')) return;
        api('commentDelete', { id: parseInt(btn.getAttribute('data-sugg-comment-del'), 10) }).then(function (d) {
          if (d && d.error) { if (window.showToastSimple) window.showToastSimple(d.message || d.error, { type: 'error' }); return; }
          load();
        });
      });
    });
    el.querySelectorAll('[data-sugg-send]').forEach(function (btn) {
      btn.addEventListener('click', function () { sendReply(parseInt(btn.getAttribute('data-sugg-send'), 10)); });
    });
    el.querySelectorAll('.sugg-comment-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendReply(parseInt(input.getAttribute('data-sid'), 10)); }
      });
    });
  }

  async function sendReply(sid) {
    if (!hasLinked()) { showGateModal('Discord Required', 'Replying requires a LINKED Discord Account'); return; }
    var input = document.querySelector('.sugg-card[data-id="' + sid + '"] .sugg-comment-input');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) return;
    var btn = document.querySelector('.sugg-card[data-id="' + sid + '"] [data-sugg-send]');
    if (btn) btn.disabled = true;
    var d = await api('commentCreate', { id: sid, body: text, parentId: replyTo.sid === sid ? replyTo.cid : 0 });
    if (d && d.error) {
      if (window.showToastSimple) window.showToastSimple(d.message || d.error, { type: 'error' });
      if (btn) btn.disabled = false;
      return;
    }
    replyTo = { sid: 0, cid: 0, name: '' };
    await load();
  }

  async function handleVote(id, val) {
    if (!hasLinked()) { showGateModal('Discord Required', 'Voting requires a LINKED Discord Account'); return; }
    val = (val === -1) ? -1 : 1;
    const current = state.myVotes[id] || 0;
    const newVal = (current === val) ? 0 : val;
    state.myVotes[id] = newVal;
    const card = document.querySelector('[data-id="' + id + '"]');
    if (card) {
      const up = card.querySelector('.sugg-upvote');
      const dn = card.querySelector('.sugg-downvote');
      const cnt = card.querySelector('.sugg-vote-count');
      if (up) up.classList.toggle('voted', newVal === 1);
      if (dn) dn.classList.toggle('voted', newVal === -1);
      if (cnt) cnt.textContent = (parseInt(cnt.textContent, 10) || 0) + (newVal - current);
    }
    try {
      const r = await api('vote', { id: id, value: newVal });
      if (r && r.error) showGateModal('Discord Required', r.message || 'Voting requires a LINKED Discord Account');
    } catch (e) {}
    load();
  }

  function renderFormHandlers() {
    var titleEl = document.getElementById('sugg-title');
    var descEl = document.getElementById('sugg-desc');
    var catEl = document.getElementById('sugg-category');
    var btn = document.getElementById('sugg-submit');
    var result = document.getElementById('sugg-result');
    var charCount = document.getElementById('sugg-charcount');

    if (descEl && charCount) {
      descEl.addEventListener('input', function () { charCount.textContent = descEl.value.length + ' / 600'; });
    }
    if (btn) {
      btn.addEventListener('click', async function () {
        if (!hasLinked()) { showGateModal('Discord Required', 'Creating a Suggestion requires a LINKED Discord Account'); return; }
        var t = titleEl ? titleEl.value.trim() : '';
        var d = descEl ? descEl.value.trim() : '';
        var c = catEl ? catEl.value : 'other';
        if (!t) { showResult('Title is required.', false); return; }
        btn.disabled = true;
        var r = await api('create', { title: t, description: d, category: c });
        btn.disabled = false;
        if (r.ok) {
          showResult('Suggestion submitted!', true);
          if (r.flagged && window.submissionRules) window.submissionRules.notice('suggestions', r.flagged);
          if (titleEl) titleEl.value = '';
          if (descEl) descEl.value = '';
          if (charCount) charCount.textContent = '0 / 600';
          load();
        } else if (r.error === 'discord_link_required') {
          showGateModal('Discord Required', r.message || 'Creating a Suggestion requires a LINKED Discord Account');
        } else {
          showResult(r.error || 'Could not submit.', false);
        }
      });
    }

    document.querySelectorAll('[data-sugg-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-sugg-filter');
        var v = btn.getAttribute('data-sugg-val');
        if (f === 'status') filters.status = v;
        else if (f === 'category') filters.category = v;
        else if (f === 'sort') filters.sort = v;
        state.page = 1;
        load();
      });
    });

    var searchEl = document.getElementById('sugg-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { filters.q = searchEl.value.trim(); state.page = 1; load(); }, 300);
      });
    }
  }

  function showResult(msg, ok) {
    var r = document.getElementById('sugg-result');
    if (!r) return;
    r.textContent = msg || '';
    r.style.display = msg ? '' : 'none';
    r.className = 'text-xs font-semibold mt-2 ' + (ok ? 'text-emerald-400' : 'text-red-400');
    if (msg && ok) setTimeout(function () { r.style.display = 'none'; }, 4000);
  }

  /* ---- Realtime via WebSocket ---- */
  var ws = null, wsAttempts = 0, wsHeartbeat = null;

  function wsConnect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    var uid = getUid();
    var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/realtime' + (uid ? '?uid=' + encodeURIComponent(uid) : '');
    try { ws = new WebSocket(url); } catch (e) { wsScheduleReconnect(); return; }
    ws.onopen = function () {
      wsAttempts = 0;
      if (wsHeartbeat) clearInterval(wsHeartbeat);
      wsHeartbeat = setInterval(function () { try { ws.send(JSON.stringify({ type: 'heartbeat' })); } catch (e) {} }, 25000);
    };
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'suggestion:created' || msg.type === 'suggestion:deleted' || msg.type === 'suggestion:status' || msg.type === 'suggestion:edited' || msg.type === 'suggestion:comment') load();
        if (msg.type === 'suggestion:voted') {
          var card = document.querySelector('[data-id="' + msg.suggestionId + '"]');
          if (card) { var cnt = card.querySelector('.sugg-vote-count'); if (cnt) cnt.textContent = msg.voteCount; }
        }
      } catch (e) {}
    };
    ws.onclose = function () { if (wsHeartbeat) { clearInterval(wsHeartbeat); wsHeartbeat = null; } wsScheduleReconnect(); };
  }

  function wsScheduleReconnect() {
    var delay = Math.min(1000 * Math.pow(2, wsAttempts), 20000);
    wsAttempts++;
    setTimeout(wsConnect, delay);
  }

  var _suggestionsInitialized = false;

  function init() {
    if (_suggestionsInitialized) { load(); return; }
    _suggestionsInitialized = true;
    renderFormHandlers();
    load();
    setTimeout(wsConnect, 3000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { wsConnect(); load(); }
    });
  }

  window.renderSuggestions = init;
  window._suggestionsInit = init;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    var sec = document.getElementById('page-section-suggestions');
    if (sec && sec.classList.contains('active')) init();
  }
  document.addEventListener('DOMContentLoaded', function () {
    var sec = document.getElementById('page-section-suggestions');
    if (sec && sec.classList.contains('active')) init();
  });
})();
