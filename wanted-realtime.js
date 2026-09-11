/* TheHighWRLD Wanted Vault — merged: wantedSeed tracks + D1 posts, with replies & voting */
(function () {
  'use strict';

  var API_POSTS = '/api/wanted-posts';
  var API_OLD = '/api/wanted';
  var STATUS_MAP = {
    wanted: ['\uD83D\uDD34 Wanted', 'bg-red-500/10 border-red-500/30 text-red-300'],
    searching: ['\uD83D\uDFE1 Searching', 'bg-amber-500/10 border-amber-500/30 text-amber-300'],
    found: ['\uD83D\uDFE2 Found', 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'],
    closed: ['\u26AB Closed', 'bg-gray-500/10 border-gray-500/30 text-gray-400'],
  };
  var CAT_MAP = { leak: 'Leak', sess: 'Sessions', nom: 'Nom' };

  var state = {
    posts: [], isOwner: false, total: 0,
    oldServer: { tracks: [], votes: {}, replies: {}, myVotes: {}, me: {} },
    sorted: [], openThreads: {}, collapsed: {}
  };
  var filters = { status: 'all', sort: 'newest', category: 'all', q: '' };
  var debounceTimer = null;

  function getUid() { try { return localStorage.getItem('wantedUserId') || ''; } catch (e) { return ''; } }
  function hasLinkedDiscord() { return !!getUid() && !!(state.oldServer.me && state.oldServer.me.discord); }
  function normVote(v) { return v === -1 ? -1 : (v ? 1 : 0); }
  function showGateModal(title, message) {
    if (window.showGateModal) { window.showGateModal(title, message); return; }
    alert((title ? title + ': ' : '') + (message || 'This action requires a LINKED Discord Account'));
  }
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

  async function apiPost(action, data) {
    var uid = getUid();
    var body = { action: action, user: uid };
    if (data) Object.assign(body, data);
    var r = await fetch(API_POSTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  function apiOld(action, payload) {
    payload = payload || {};
    payload.action = action;
    payload.user = getUid();
    return fetch(API_OLD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }

  async function load() {
    var uid = getUid();
    try {
      var params = new URLSearchParams();
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.sort) params.set('sort', filters.sort);
      if (filters.q) params.set('q', filters.q);
      if (uid) params.set('user', uid);
      var r = await fetch(API_POSTS + '?' + params.toString(), { cache: 'no-store' });
      var d = await r.json();
      state.posts = d.posts || [];
      state.isOwner = !!d.isOwner;
      state.total = d.total || 0;
    } catch (e) {}

    try {
      var r2 = await fetch(API_OLD + '?user=' + encodeURIComponent(uid), { cache: 'no-store' });
      var d2 = await r2.json();
      if (!d2.error) state.oldServer = d2;
    } catch (e) {}

    buildMerged();
    render();
  }

  function seedScore(s) { return (s.id ? 2000 : 0) + String(s.n || '').length; }

  function buildMerged() {
    var sv = state.oldServer;
    var items = [];
    var seen = {};
    function pushSeed(t, n, id, c) {
      var key = String(t || '').trim().toLowerCase();
      if (!key) return;
      var entry = { type: 'seed', t: t, n: n, v: sv.votes[t] || 0, id: id || '', c: c || 'leak', replies: sv.replies[t] || [], myVote: normVote(sv.myVotes && sv.myVotes[t]) };
      if (seen[key] !== undefined) {
        var prev = items[seen[key]];
        if (seedScore(entry) > seedScore(prev)) {
          prev.t = entry.t; prev.n = entry.n; prev.id = entry.id; prev.c = entry.c;
          prev.v = entry.v; prev.replies = entry.replies; prev.myVote = entry.myVote;
        }
        return;
      }
      seen[key] = items.length;
      items.push(entry);
    }
    if (typeof wantedSeed !== 'undefined') {
      for (var t = 0; t < wantedSeed.length; t++) {
        var o = wantedSeed[t];
        pushSeed(o.t, o.n, o.id, o.c);
      }
    }
    for (var c = 0; c < (sv.tracks || []).length; c++) {
      var g = sv.tracks[c];
      pushSeed(g.t, g.n, '', 'nom');
    }
    for (var p = 0; p < state.posts.length; p++) {
      var post = state.posts[p];
      var st = STATUS_MAP[post.status] || STATUS_MAP.wanted;
      items.push({ type: 'post', post: post, statusLabel: st[0], statusClass: st[1] });
    }

    var q = (filters.q || '').toLowerCase();
    if (q) {
      items = items.filter(function (x) {
        if (x.type === 'seed') return x.t.toLowerCase().indexOf(q) >= 0 || x.n.toLowerCase().indexOf(q) >= 0;
        var p2 = x.post;
        return (p2.title || '').toLowerCase().indexOf(q) >= 0 || (p2.altName || '').toLowerCase().indexOf(q) >= 0 || (p2.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    var seedItems = items.filter(function (x) { return x.type === 'seed'; });
    var postItems = items.filter(function (x) { return x.type === 'post'; });
    seedItems.sort(function (a, b) { return b.v - a.v; });
    if (filters.sort === 'oldest') postItems.reverse();
    state.sorted = seedItems.concat(postItems);
  }

  function render() {
    renderFilters();
    renderList();
    renderForm();
  }

  function renderForm() {
    var uid = getUid();
    var title = document.getElementById('wanted-title');
    var alt = document.getElementById('wanted-alt');
    var desc = document.getElementById('wanted-desc');
    var era = document.getElementById('wanted-era');
    var btn = document.getElementById('wanted-submit');
    var result = document.getElementById('wanted-result');
    if (!title) return;
    if (!uid || !(state.oldServer.me && state.oldServer.me.discord)) {
      [title, alt, desc, era].forEach(function (el) { if (el) el.disabled = true; });
      if (btn) btn.disabled = true;
      if (result) { result.textContent = 'Link Discord to submit a wanted request.'; result.className = 'text-xs text-amber-400 mt-2'; result.style.display = ''; }
      return;
    }
    [title, alt, desc, era].forEach(function (el) { if (el) el.disabled = false; });
    if (btn) btn.disabled = false;
  }

  function renderFilters() {
    document.querySelectorAll('[data-wanted-filter]').forEach(function (btn) {
      var f = btn.getAttribute('data-wanted-filter');
      var v = btn.getAttribute('data-wanted-val');
      var isActive = (f === 'status' && filters.status === v) || (f === 'sort' && filters.sort === v) || (f === 'category' && filters.category === v);
      btn.classList.toggle('active', isActive);
    });
    var ct = document.getElementById('wanted-count');
    if (ct) ct.textContent = state.sorted.length + ' item' + (state.sorted.length !== 1 ? 's' : '');
  }

  function renderList() {
    var el = document.getElementById('wanted-list');
    if (!el) return;
    if (!state.sorted.length) {
      el.innerHTML = '<p class="text-xs text-gray-500 py-4 text-center">No wanted requests yet \u2014 submit the first one above.</p>';
      return;
    }
    var h = '';
    for (var i = 0; i < state.sorted.length; i++) {
      var item = state.sorted[i];
      if (item.type === 'seed') {
        h += renderSeedItem(item, i);
      } else {
        h += renderPostItem(item, i);
      }
    }
    el.innerHTML = h;
    bindEvents(el);
  }

  function renderReply(r, depth, allReplies) {
    depth = depth || 0;
    allReplies = allReplies || [];
    var v = r.v || 0;
    var isOwner = r.d && state.isOwner;
    var isAuthor = r.d && getUid() && state.oldServer.me && r.d === state.oldServer.me.id;
    var canDelete = isOwner || isAuthor;
    var avatarHtml = r.a ? '<img class="wanted-reply-avatar" src="' + esc(r.a) + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="wanted-reply-avatar wanted-reply-avatar-fallback"><i class="fas fa-user"></i></div>';
    var editedBadge = r.e ? '<span class="wanted-edited-badge">edited</span>' : '';

    var replyTo = '';
    if (r.p || r.at) {
      var parentReply = null;
      if (r.p) {
        for (var pi = 0; pi < allReplies.length; pi++) {
          if (allReplies[pi].id === r.p) { parentReply = allReplies[pi]; break; }
        }
      }
      var replyToName = r.at || (parentReply ? parentReply.u : '');
      var replyToSnippet = '';
      if (parentReply && parentReply.r) {
        var raw = parentReply.r;
        replyToSnippet = raw.length > 80 ? raw.slice(0, 80) + '...' : raw;
      }
      if (replyToName) {
        replyTo = '<span class="wanted-reply-to" data-scrollto="' + (r.p || '') + '" title="Click to jump to original">' +
          '<i class="fas fa-reply text-[8px] mr-0.5"></i>Replied to ' + esc(replyToName) +
          (replyToSnippet ? '<span class="wanted-reply-to-text">"' + esc(replyToSnippet) + '"</span>' : '') +
          '</span>';
      }
    }

    var html = '<div class="wanted-reply' + (depth > 0 ? ' wanted-reply-nested' : '') + '" data-rid="' + r.id + '">' +
      '<div class="wanted-vote-box">' +
        '<button class="wanted-vote-arrow' + (r.myVote === 1 ? ' on' : '') + '" data-rvote="' + r.id + '" data-rval="1"><i class="fas fa-caret-up"></i></button>' +
        '<span class="wanted-vote-score' + (v !== 0 ? ' voted' : '') + '">' + v + '</span>' +
        '<button class="wanted-vote-arrow down' + (r.myVote === -1 ? ' on' : '') + '" data-rvote="' + r.id + '" data-rval="-1"><i class="fas fa-caret-down"></i></button>' +
      '</div>' +
      avatarHtml +
      '<div class="wanted-reply-main">' +
        '<div class="wanted-reply-head">' +
          '<span class="wanted-reply-user"' + (r.d ? ' data-profile-link="' + esc(r.d) + '" data-profile-discord="1"' : ((r.u && r.u !== 'Anonymous') ? ' data-profile-link="' + esc(r.u) + '"' : '')) + '>' + esc((r.u && r.u !== 'Anonymous') ? r.u : '🖥️System') + '</span>' +
          replyTo +
          '<span class="wanted-reply-time">' + relTime(r.t) + '</span>' +
          editedBadge +
        '</div>' +
        '<p class="wanted-reply-text">' + esc(r.r) + '</p>' +
        '<div class="wanted-reply-actions">' +
          '<button class="wanted-reply-action" data-replyto="' + r.id + '" title="Reply"><i class="fas fa-reply"></i></button>' +
          (canDelete ? '<button class="wanted-reply-action wanted-reply-action-del" data-deletereply="' + r.id + '" title="Delete"><i class="fas fa-trash"></i></button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
    return html;
  }

  function renderReplyThread(replies, parentId, depth) {
    var kids = replies.filter(function (r) { return (r.p || null) === parentId; });
    if (!kids.length) return '';
    var h = '';
    for (var i = 0; i < kids.length; i++) {
      h += renderReply(kids[i], depth, replies);
      var childHtml = renderReplyThread(replies, kids[i].id, depth + 1);
      if (childHtml) {
        h += '<div class="wanted-thread-children" style="margin-left:' + (depth * 16 + 20) + 'px">' + childHtml + '</div>';
      }
    }
    return h;
  }

  function renderReplySection(replies, trackKey, isPost, postId) {
    var rootReplies = (replies || []).filter(function (r) { return !r.p; });
    var totalCount = (replies || []).length;
    var replyListHtml = '';
    if (rootReplies.length) {
      replyListHtml = renderReplyThread(replies, null, 0);
    } else {
      replyListHtml = '<p class="text-gray-600 text-[10px] py-2 italic">No replies yet \u2014 start the thread.</p>';
    }

    var cid = isPost ? 'post-' + postId : trackKey;
    var hasDiscord = state.oldServer.me && state.oldServer.me.discord;
    var replyForm = '';
    if (isPost) {
      if (getUid()) {
        replyForm = '<div class="wanted-reply-form">' +
          '<input id="wanted-post-reply-' + postId + '" placeholder="Write a reply..." maxlength="200" class="wanted-reply-input">' +
          '<button class="wanted-reply-send" data-preply="' + postId + '"><i class="fas fa-paper-plane"></i></button>' +
        '</div>';
      } else {
        replyForm = '<div class="wanted-reply-form"><p class="text-gray-500 text-[10px]">Sign in to reply</p></div>';
      }
    } else {
      if (hasDiscord) {
        replyForm = '<div class="wanted-reply-form">' +
          '<div class="wanted-reply-avatar wanted-reply-avatar-sm"><i class="fab fa-discord text-[10px]"></i></div>' +
          '<input id="wanted-reply-input-' + esc(trackKey) + '" placeholder="Write a reply..." maxlength="200" class="wanted-reply-input">' +
          '<button class="wanted-reply-send" data-rsend="' + esc(trackKey) + '"><i class="fas fa-paper-plane"></i></button>' +
        '</div>';
      } else {
        replyForm = '<div class="wanted-reply-form"><p class="text-gray-500 text-[10px]">Link Discord to reply</p></div>';
      }
    }

    return '<div class="wanted-reply-list">' + replyListHtml + '</div>' +
      '<div class="wanted-typing-zone" data-typing-cid="' + esc(cid) + '" style="display:none"></div>' +
      replyForm;
  }

  function renderSeedItem(item, idx) {
    var sv = state.oldServer;
    var isOwner = sv.owner || state.isOwner;
    var mv = normVote(item.myVote);
    var lnk = item.id ? '<a href="https://juicevault.xyz/archive/' + item.id + '" target="_blank" rel="noopener" class="wanted-listen"><i class="fas fa-music mr-1 text-[9px]"></i>Listen on JuiceVault</a>' : '';
    var badge = item.c === 'sess' ? '<span class="wanted-badge sess">Sessions</span>' : item.c === 'nom' ? '<span class="wanted-badge nom">Nom</span>' : '<span class="wanted-badge leak">Leak</span>';
    var open = state.openThreads[idx] === true || (state.openThreads[idx] !== false && item.replies.length > 0);
    var rp = item.replies || [];
    var replySection = renderReplySection(rp, item.t, false, null);
    var nomText = esc(item.n);
    if (sv.me && sv.me.discord) {
      nomText = nomText.replace(/you$/i, sv.me.discord);
    }
    nomText = nomText.replace(/^nominated by/i, 'Nominated by');
    var adminBtns = isOwner ? '<button class="wanted-delete-track-btn" data-deletetrack="' + esc(item.t) + '" title="Delete track"><i class="fas fa-trash text-[10px]"></i></button>' : '';

    return '<div class="wanted-item wanted-item-v2 hub-panel" data-idx="' + idx + '" data-cat="' + item.c + '">' +
      '<div class="wanted-item-top">' +
        '<div class="wanted-rank">' + (idx + 1) + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="wanted-title-row">' +
            '<p class="wanted-song-title">' + esc(item.t) + '</p>' + badge + adminBtns +
          '</div>' +
          '<p class="wanted-song-sub">' + nomText + '</p>' +
        '</div>' +
        '<div class="wanted-vote-pill">' +
          '<button class="wanted-vote-arrow' + (mv === 1 ? ' on' : '') + '" data-wvote="' + idx + '" data-wvkey="' + esc(item.t) + '" data-wval="1" title="Upvote"><i class="fas fa-caret-up"></i></button>' +
          '<span class="wanted-vote-score' + (item.v !== 0 ? ' voted' : '') + '">' + item.v + '</span>' +
          '<button class="wanted-vote-arrow down' + (mv === -1 ? ' on' : '') + '" data-wvote="' + idx + '" data-wvkey="' + esc(item.t) + '" data-wval="-1" title="Downvote"><i class="fas fa-caret-down"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="wanted-item-bar">' + lnk +
        '<button class="wanted-reply-toggle' + (open ? ' open' : '') + '" data-togglethread="' + idx + '">' +
          '<i class="fas fa-comment-dots mr-1 text-[9px]"></i>' + rp.length + ' ' + (rp.length === 1 ? 'reply' : 'replies') +
        '</button>' +
      '</div>' +
      '<div class="wanted-replies" id="wanted-replies-' + idx + '" style="display:' + (open ? 'block' : 'none') + '">' +
        replySection +
      '</div>' +
    '</div>';
  }

  function renderPostItem(item, idx) {
    var p = item.post;
    var stClass = item.statusClass;
    var stLabel = item.statusLabel;
    var open = state.openThreads['p' + p.id] === true;
    var adminBtns = state.isOwner ? '<div class="wanted-admin-btns">' +
      '<select data-wadmin-status="' + p.id + '" class="admin-select">' +
      Object.keys(STATUS_MAP).map(function (k) { return '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + STATUS_MAP[k][0] + '</option>'; }).join('') +
      '</select>' +
      '<button data-wadmin-edit="' + p.id + '" class="admin-edit-btn" title="Edit"><i class="fas fa-pen"></i></button>' +
      '<button data-wadmin-delete="' + p.id + '" class="admin-delete-btn" title="Delete"><i class="fas fa-trash"></i></button>' +
      '</div>' : '';

    var replySection = renderReplySection([], null, true, p.id);

    return '<div class="wanted-card" data-wid="' + p.id + '">' +
      '<div class="wanted-card-main">' +
        '<div class="wanted-card-header">' +
          '<span class="wanted-status-badge ' + stClass + '">' + stLabel + '</span>' +
           (p.era ? '<span class="wanted-era-badge">' + esc(p.era) + '</span>' : '') +
          '<span class="wanted-time">' + relTime(p.createdAt) + '</span>' +
        '</div>' +
        '<h3 class="wanted-card-title">' + esc(p.title) + '</h3>' +
        (p.altName ? '<p class="wanted-card-alt">Also known as: ' + esc(p.altName) + '</p>' : '') +
        (p.description ? '<p class="wanted-card-desc">' + esc(p.description) + '</p>' : '') +
        '<div class="wanted-card-footer">' +
          '<span class="wanted-author"' + (((p.authorUid || p.authorName) && p.authorName !== 'Anonymous') ? ' data-profile-link="' + esc(p.authorUid || p.authorName) + '"' : '') + '>' + esc((p.authorName && p.authorName !== 'Anonymous') ? p.authorName : '🖥️System') + '</span>' +
          adminBtns +
        '</div>' +
      '</div>' +
      '<div class="wanted-item-bar">' +
        '<button class="wanted-reply-toggle' + (open ? ' open' : '') + '" data-togglepostthread="' + p.id + '">' +
          '<i class="fas fa-comment-dots mr-1 text-[9px]"></i>Replies' +
        '</button>' +
      '</div>' +
      '<div class="wanted-replies" id="wanted-post-replies-' + p.id + '" style="display:' + (open ? 'block' : 'none') + '">' +
        replySection +
      '</div>' +
    '</div>';
  }

  function bindEvents(el) {
    el.querySelectorAll('[data-wvote]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!hasLinkedDiscord()) { showGateModal('Discord Required', 'Voting in the Wanted Vault requires a LINKED Discord Account'); return; }
        var key = btn.getAttribute('data-wvkey');
        var val = parseInt(btn.getAttribute('data-wval') || '1', 10);
        val = (val === -1) ? -1 : 1;
        apiOld('vote', { track: key, value: val }).then(function (r) {
          if (r && r.error) showGateModal('Discord Required', r.message || 'Voting in the Wanted Vault requires a LINKED Discord Account');
          load();
        });
      });
    });
    el.querySelectorAll('[data-rvote]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!hasLinkedDiscord()) { showGateModal('Discord Required', 'Voting in the Wanted Vault requires a LINKED Discord Account'); return; }
        var id = parseInt(btn.getAttribute('data-rvote'), 10);
        var val = parseInt(btn.getAttribute('data-rval'), 10);
        apiOld('voteReply', { id: id, value: val }).then(function (r) {
          if (r && r.error) showGateModal('Discord Required', r.message || 'Voting in the Wanted Vault requires a LINKED Discord Account');
          load();
        });
      });
    });
    el.querySelectorAll('[data-togglethread]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = btn.getAttribute('data-togglethread');
        state.openThreads[idx] = !(state.openThreads[idx] === true);
        renderList();
      });
    });
    el.querySelectorAll('[data-togglepostthread]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-togglepostthread');
        state.openThreads['p' + pid] = !(state.openThreads['p' + pid] === true);
        renderList();
      });
    });

    el.querySelectorAll('.wanted-reply-input').forEach(function (inp) {
      var cid = '';
      var seedItem = inp.closest('[data-idx]');
      var postItem = inp.closest('[data-wid]');
      if (seedItem) {
        var idx = parseInt(seedItem.getAttribute('data-idx'), 10);
        var item = state.sorted[idx];
        if (item && item.type === 'seed') cid = item.t;
      } else if (postItem) {
        cid = 'post-' + postItem.getAttribute('data-wid');
      }
      if (cid) setupTypingInput(inp, cid);
    });
    el.querySelectorAll('[data-rsend]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var trackKey = btn.getAttribute('data-rsend');
        var inp = document.getElementById('wanted-reply-input-' + trackKey);
        if (!inp || !inp.value.trim()) return;
        var parent = inp.getAttribute('data-parent');
        var payload = { track: trackKey, text: inp.value.trim() };
        if (parent) payload.parent = parseInt(parent, 10);
        sendTypingStop(trackKey);
        apiOld('reply', payload).then(function () {
          inp.value = '';
          inp.placeholder = 'Write a reply...';
          inp.removeAttribute('data-parent');
          btn.removeAttribute('data-parent');
          load();
        });
      });
    });
    el.querySelectorAll('[data-preply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-preply');
        var inp = document.getElementById('wanted-post-reply-' + pid);
        if (!inp || !inp.value.trim()) return;
        sendTypingStop('post-' + pid);
        apiPost('reply', { id: parseInt(pid, 10), text: inp.value.trim() }).then(function () { inp.value = ''; load(); });
      });
    });
    el.querySelectorAll('[data-replyto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rid = btn.getAttribute('data-replyto');
        var replyCard = btn.closest('.wanted-reply');
        var mainSection = replyCard ? replyCard.closest('.wanted-replies') : null;
        if (!mainSection) return;
        var input = mainSection.querySelector('.wanted-reply-input');
        var sendBtn = mainSection.querySelector('.wanted-reply-send');
        if (input) {
          input.focus();
          input.placeholder = 'Replying to #' + rid + '...';
          input.setAttribute('data-parent', rid);
          if (sendBtn) sendBtn.setAttribute('data-parent', rid);
        }
      });
    });
    el.querySelectorAll('[data-scrollto]').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var targetId = pill.getAttribute('data-scrollto');
        if (!targetId) return;
        var target = el.querySelector('[data-rid="' + targetId + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.transition = 'box-shadow .3s, background .3s';
          target.style.boxShadow = '0 0 0 2px rgba(212,165,116,.4)';
          target.style.background = 'rgba(212,165,116,.08)';
          setTimeout(function () {
            target.style.boxShadow = '';
            target.style.background = '';
          }, 1500);
        }
      });
    });
    el.querySelectorAll('[data-deletereply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Delete this reply?')) {
          apiOld('deleteReply', { id: parseInt(btn.getAttribute('data-deletereply'), 10) }).then(load);
        }
      });
    });
    el.querySelectorAll('[data-deletetrack]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Delete this track from the vault?')) {
          apiOld('deleteTrack', { track: btn.getAttribute('data-deletetrack') }).then(load);
        }
      });
    });
    el.querySelectorAll('.wanted-reply-send').forEach(function (btn) {
      var origHandler = btn.onclick;
      btn.addEventListener('click', function (e) {
        var parent = btn.getAttribute('data-parent');
        if (parent) {
          e.stopPropagation();
          var input = btn.closest('.wanted-replies').querySelector('.wanted-reply-input');
          if (!input || !input.value.trim()) return;
          var trackKey = null;
          var seedIdx = btn.closest('[data-idx]');
          if (seedIdx) {
            var item = state.sorted[parseInt(seedIdx.getAttribute('data-idx'), 10)];
            if (item && item.type === 'seed') trackKey = item.t;
          }
          if (trackKey) {
            apiOld('reply', { track: trackKey, text: input.value.trim(), parent: parseInt(parent, 10) }).then(function () {
              input.value = '';
              input.placeholder = 'Write a reply...';
              input.removeAttribute('data-parent');
              btn.removeAttribute('data-parent');
              load();
            });
          }
        }
      });
    });
    el.querySelectorAll('[data-wadmin-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        apiPost('updateStatus', { id: parseInt(sel.getAttribute('data-wadmin-status'), 10), status: sel.value }).then(load);
      });
    });
    el.querySelectorAll('[data-wadmin-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Delete this wanted request?')) {
          apiPost('delete', { id: parseInt(btn.getAttribute('data-wadmin-delete'), 10) }).then(load);
        }
      });
    });
    el.querySelectorAll('[data-wadmin-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditModal(parseInt(btn.getAttribute('data-wadmin-edit'), 10)); });
    });
  }

  function openEditModal(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;
    var titleEl = document.getElementById('wanted-edit-title');
    var altEl = document.getElementById('wanted-edit-alt');
    var descEl = document.getElementById('wanted-edit-desc');
    var eraEl = document.getElementById('wanted-edit-era');
    var idEl = document.getElementById('wanted-edit-id');
    if (titleEl) titleEl.value = post.title || '';
    if (altEl) altEl.value = post.altName || '';
    if (descEl) descEl.value = post.description || '';
    if (eraEl) eraEl.value = post.era || '';
    if (idEl) idEl.value = id;
    var modal = document.getElementById('wanted-edit-modal');
    if (modal) modal.style.display = 'flex';
  }

  function renderFormHandlers() {
    var titleEl = document.getElementById('wanted-title');
    var altEl = document.getElementById('wanted-alt');
    var descEl = document.getElementById('wanted-desc');
    var eraEl = document.getElementById('wanted-era');
    var btn = document.getElementById('wanted-submit');

    if (btn) {
      btn.addEventListener('click', async function () {
        if (!hasLinkedDiscord()) { showGateModal('Discord Required', 'Submitting a Wanted request requires a LINKED Discord Account'); return; }
        var t = titleEl ? titleEl.value.trim() : '';
        var a = altEl ? altEl.value.trim() : '';
        var d = descEl ? descEl.value.trim() : '';
        var e = eraEl ? eraEl.value.trim() : '';
        if (!t) { showResult('Title is required.', false); return; }
        btn.disabled = true;
        var r = await apiPost('create', { title: t, altName: a, description: d, era: e });
        btn.disabled = false;
        if (r.ok) {
          showResult('Wanted request submitted!', true);
          if (titleEl) titleEl.value = '';
          if (altEl) altEl.value = '';
          if (descEl) descEl.value = '';
          if (eraEl) eraEl.value = '';
          load();
        } else if (r.error === 'discord_link_required') {
          showGateModal('Discord Required', r.message || 'Submitting a Wanted request requires a LINKED Discord Account');
        } else {
          showResult(r.error || 'Could not submit.', false);
        }
      });
    }

    document.querySelectorAll('[data-wanted-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-wanted-filter');
        var v = btn.getAttribute('data-wanted-val');
        if (f === 'status') filters.status = v;
        else if (f === 'sort') filters.sort = v;
        else if (f === 'category') filters.category = v;
        state.page = 1;
        load();
      });
    });

    var searchEl = document.getElementById('wanted-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { filters.q = searchEl.value.trim(); state.page = 1; load(); }, 300);
      });
    }

    var editBtn = document.getElementById('wanted-edit-save');
    if (editBtn) {
      editBtn.addEventListener('click', async function () {
        var idEl = document.getElementById('wanted-edit-id');
        var t = document.getElementById('wanted-edit-title');
        var a = document.getElementById('wanted-edit-alt');
        var d = document.getElementById('wanted-edit-desc');
        var e = document.getElementById('wanted-edit-era');
        var id = idEl ? parseInt(idEl.value, 10) : 0;
        if (!id) return;
        editBtn.disabled = true;
        await apiPost('edit', { id: id, title: t ? t.value.trim() : '', altName: a ? a.value.trim() : '', description: d ? d.value.trim() : '', era: e ? e.value.trim() : '' });
        editBtn.disabled = false;
        var modal = document.getElementById('wanted-edit-modal');
        if (modal) modal.style.display = 'none';
        load();
      });
    }
    var editCancel = document.getElementById('wanted-edit-cancel');
    if (editCancel) {
      editCancel.addEventListener('click', function () {
        var modal = document.getElementById('wanted-edit-modal');
        if (modal) modal.style.display = 'none';
      });
    }
  }

  function showResult(msg, ok) {
    var r = document.getElementById('wanted-result');
    if (!r) return;
    r.textContent = msg || '';
    r.style.display = msg ? '' : 'none';
    r.className = 'text-xs font-semibold mt-2 ' + (ok ? 'text-emerald-400' : 'text-red-400');
    if (msg && ok) setTimeout(function () { r.style.display = 'none'; }, 4000);
  }

  /* ---- Realtime via WebSocket ---- */
  var ws = null, wsAttempts = 0, wsHeartbeat = null;
  var typingTimers = {};
  var typingState = {}; // conversationId -> [{userId, userName}]

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  }

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
        if (msg.type === 'typing:start' || msg.type === 'typing:stop') {
          typingState[msg.conversationId || ''] = msg.typing || [];
          renderTypingIndicators();
        }
        if (msg.type && (msg.type.indexOf('wanted:') === 0 || msg.type.indexOf('reply:') === 0)) load();
      } catch (e) {}
    };
    ws.onclose = function () { if (wsHeartbeat) { clearInterval(wsHeartbeat); wsHeartbeat = null; } wsScheduleReconnect(); };
  }

  function sendTypingStart(conversationId) {
    wsSend({ type: 'typing:start', conversationId: conversationId });
  }

  function sendTypingStop(conversationId) {
    wsSend({ type: 'typing:stop', conversationId: conversationId });
  }

  function setupTypingInput(inputEl, conversationId) {
    var debounceId = null;
    inputEl.addEventListener('input', function () {
      sendTypingStart(conversationId);
      clearTimeout(debounceId);
      debounceId = setTimeout(function () { sendTypingStop(conversationId); }, 3000);
    });
    inputEl.addEventListener('blur', function () {
      clearTimeout(debounceId);
      sendTypingStop(conversationId);
    });
    inputEl.addEventListener('focus', function () {
      if (inputEl.value.trim()) sendTypingStart(conversationId);
    });
  }

  function renderTypingIndicators() {
    document.querySelectorAll('[data-typing-cid]').forEach(function (el) {
      var cid = el.getAttribute('data-typing-cid');
      var people = (typingState[cid] || []).filter(function (p) { return p.userId !== getUid(); });
      if (people.length) {
        var names = people.map(function (p) { return p.userName || 'Someone'; });
        var text = names.length === 1 ? names[0] + ' is typing' : names.slice(0, 2).join(' and ') + ' are typing';
        el.innerHTML = '<div class="wanted-typing-indicator"><span class="wanted-typing-dots"><span></span><span></span><span></span></span><span class="wanted-typing-text">' + esc(text) + '</span></div>';
        el.style.display = '';
      } else {
        el.innerHTML = '';
        el.style.display = 'none';
      }
    });
  }

  function wsScheduleReconnect() {
    var delay = Math.min(1000 * Math.pow(2, wsAttempts), 20000);
    wsAttempts++;
    setTimeout(wsConnect, delay);
  }

  var _wantedInitialized = false;

  function init() {
    if (_wantedInitialized) { load(); return; }
    _wantedInitialized = true;
    renderFormHandlers();
    load();
    setTimeout(wsConnect, 4000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { wsConnect(); load(); }
    });
  }

  window.renderWanted = load;
  window._wantedInit = init;

  window._wantedNewRender = init;
  window._wantedNewInit = init;
  window._wantedGet = load;
  window._wantedPost = function () {};
  window.addWantedTrack = function () {};
  window.voteWantedIdx = function () {};
  window.replyWantedIdx = function () {};
  window.toggleWantedThread = function () {};
  window.linkDiscord = function () {};
  window.disconnectDiscord = function () {};
  window.wantedSearch = function (v) { filters.q = v || ''; state.page = 1; load(); };
  window.setWantedFilter = function (f) { filters.status = f; state.page = 1; load(); };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    var sec = document.getElementById('page-section-wanted');
    if (sec && sec.classList.contains('active')) init();
  }
  document.addEventListener('DOMContentLoaded', function () {
    var sec = document.getElementById('page-section-wanted');
    if (sec && sec.classList.contains('active')) init();
  });
})();
