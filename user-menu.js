/* TheHighWRLD "⋯" user menu — Block / Mute / Report / Copy link on another
   user's profile. Delegation-based (no MutationObserver, no polling).
   Auth gate: server derives identity from the session; this UI only offers
   sign-in/Discord prompts when needed. */
(function () {
  'use strict';

  var menuel = null;      // the open dropdown (null when closed)
  var openBtn = null;     // the ⋯ button that opened it
  var statusCache = {};   // uid -> { st, at }
  var STATUS_TTL = 30000;
  var confirmOv = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function signedIn() {
    try { return !!localStorage.getItem('wantedAuthUser'); } catch (e) { return false; }
  }

  function selfUid() {
    try { return localStorage.getItem('wantedUserId') || ''; } catch (e) { return ''; }
  }

  function toast(msg, type) {
    if (window.showToast) { try { window.showToast(msg, type || 'info'); return; } catch (e) {} }
  }

  function authOk() {
    if (signedIn()) return true;
    if (window.showGateModal) {
      window.showGateModal('Sign In Required', 'Sign in to block or mute other users.');
    } else {
      toast('Please connect Discord first.', 'error');
    }
    return false;
  }

  /* ---------------- menu open/close/position ---------------- */

  function closeMenu() {
    if (menuel) { try { menuel.remove(); } catch (e) {} menuel = null; }
    if (openBtn) { try { openBtn.classList.remove('um-open'); } catch (e) {} openBtn = null; }
  }

  function positionMenu(btn, menu) {
    var r = btn.getBoundingClientRect();
    var w = menu.offsetWidth || 220;
    var h = menu.offsetHeight || 80;
    var vw = window.innerWidth || 360;
    var vh = window.innerHeight || 600;
    menu.style.position = 'fixed';
    menu.style.left = '0px';
    menu.style.top = '0px';
    var left = r.left;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    var top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    if (top < 8 && r.bottom + h <= vh - 8) top = r.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.maxHeight = (vh - 16) + 'px';
    menu.style.overflowY = 'auto';
  }

  async function loadStatus(uidv) {
    var hit = statusCache[uidv];
    if (hit && Date.now() - hit.at < STATUS_TTL) return hit.st;
    try {
      var r = await fetch('/api/users/' + encodeURIComponent(String(uidv)), { cache: 'no-store' });
      var d = await r.json().catch(function () { return {}; });
      var st = (r.ok && d) ? {
        blocked: !!d.blocked, muted: !!d.muted, self: !!d.self,
        signedIn: !!d.signedIn, linked: !!d.linked,
      } : { blocked: false, muted: false, self: false, signedIn: true, linked: false };
      statusCache[uidv] = { at: Date.now(), st: st };
      return st;
    } catch (e) {
      return { blocked: false, muted: false, self: false, signedIn: true, linked: false };
    }
  }

  function menuHtml(uidv, name, st) {
    var blocked = !!(st && st.blocked);
    var muted = !!(st && st.muted);
    return '' +
      '<div class="user-menu-group">USER ACTIONS</div>' +
      '<button type="button" class="user-menu-item danger" data-act="' + (blocked ? 'unblock' : 'block') + '"><i class="fas fa-ban"></i>' + esc(blocked ? 'Unblock User' : 'Block User') + '</button>' +
      '<button type="button" class="user-menu-item" data-act="' + (muted ? 'unmute' : 'mute') + '"><i class="fas fa-volume-mute"></i>' + esc(muted ? 'Unmute User' : 'Mute User') + '</button>' +
      '<button type="button" class="user-menu-item" data-act="report"><i class="fas fa-flag"></i>Report User</button>' +
      '<button type="button" class="user-menu-item" data-act="copy"><i class="fas fa-link"></i>Copy Profile Link</button>';
  }

  async function openMenu(btn) {
    if (openBtn === btn) { closeMenu(); return; }
    closeMenu();
    openBtn = btn;
    try { btn.classList.add('um-open'); } catch (e) {}
    var uidv = btn.getAttribute('data-uid');
    var name = btn.getAttribute('data-name') || 'this user';
    if (!uidv) { closeMenu(); return; }
    var st = await loadStatus(uidv);
    if (openBtn !== btn && menuel) { closeMenu(); return; }
    if (st.self) { closeMenu(); return; }
    menuel = document.createElement('div');
    menuel.className = 'user-menu';
    menuel.setAttribute('role', 'menu');
    menuel.setAttribute('aria-label', 'More user actions');
    menuel.innerHTML = menuHtml(uidv, name, st);
    document.body.appendChild(menuel);
    positionMenu(btn, menuel);
    // Reflect current state on the profile (pill + presence hiding).
    reflectProfileState(uidv, st);
  }

  /* ---------------- profile state (pill / presence) ---------------- */

  function reflectProfileState(uidv, st) {
    var pill = document.querySelector('.um-profile-status[data-uid="' + String(uidv) + '"]');
    if (!pill) return;
    var inner = '';
    if (st && st.blocked) inner += '<span class="um-pill um-pill-blocked">Blocked</span>';
    if (st && st.muted) inner += '<span class="um-pill um-pill-muted">Muted</span>';
    pill.innerHTML = inner;
    var body = pill.closest('.pv-body');
    if (body) {
      try { body.classList[st && st.blocked ? 'add' : 'remove']('um-is-blocked'); } catch (e) {}
    }
  }

  window.userMenu = {
    profileRendered: function (d) {
      if (!d || !d.uid) return;
      if (!signedIn()) return;
      var uidv = String(d.uid);
      loadStatus(uidv).then(function (st) {
        reflectProfileState(uidv, st);
        var host = document.querySelector('[data-user-menu][data-uid="' + uidv + '"]');
        if (host) host.setAttribute('aria-label', st.blocked ? 'Blocked - more user actions' : 'More user actions');
      });
    },
    refreshProfile: function (uidv) {
      var key = String(uidv);
      statusCache[key] = null;
      if (signedIn()) {
        loadStatus(key).then(function (st) { reflectProfileState(key, st); });
      }
    },
  };

  /* ---------------- actions ---------------- */

  async function apiDo(method, path) {
    try {
      var r = await fetch(path, { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
      var d = await r.json().catch(function () { return {}; });
      return { status: r.status, ok: r.ok && d && d.ok !== false, data: d };
    } catch (e) {
      return { status: 0, ok: false, data: {} };
    }
  }

  function runAction(it) {
    var btn = openBtn;
    var uidv = btn && btn.getAttribute('data-uid');
    var name = btn && (btn.getAttribute('data-name') || 'this user');
    var act = it.getAttribute('data-act');
    closeMenu();
    if (!uidv) return;
    if (act === 'block') { blockFlow(uidv, name); return; }
    if (act === 'unblock') { unblockFlow(uidv, name); return; }
    if (act === 'mute') { muteFlow(uidv, name); return; }
    if (act === 'unmute') { unmuteFlow(uidv, name); return; }
    if (act === 'report') { reportFlow(uidv, name); return; }
    if (act === 'copy') { copyLink(uidv); }
  }

  function confirmModal(title, msg, okLabel, okClass, onOk, dismissLabel) {
    if (confirmOv) { try { confirmOv.remove(); } catch (e) {} }
    var ov = document.createElement('div');
    ov.className = 'um-confirm-overlay';
    ov.innerHTML =
      '<div class="um-confirm" role="alertdialog" aria-modal="true">' +
        '<h3>' + esc(title) + '</h3>' +
        '<p>' + esc(msg) + '</p>' +
        '<p class="um-confirm-error" style="display:none"></p>' +
        '<div class="um-confirm-actions">' +
          '<button type="button" class="um-confirm-btn" data-um-cancel="1">' + esc(dismissLabel || 'Cancel') + '</button>' +
          '<button type="button" class="um-confirm-btn ' + (okClass || '') + '" data-um-ok="1">' + esc(okLabel) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    confirmOv = ov;
    document.documentElement.classList.add('scroll-locked');
    var escH = null;
    var done = function () { try { ov.remove(); } catch (e) {} if (confirmOv === ov) confirmOv = null; document.documentElement.classList.remove('scroll-locked'); if (escH) { document.removeEventListener('keydown', escH); escH = null; } };
    var errEl = function () { return ov.querySelector('.um-confirm-error'); };
    var running = false;
    ov.addEventListener('click', function (e) {
      if (e.target === ov) { done(); return; }
      if (e.target.closest('[data-um-cancel]')) { done(); return; }
      if (e.target.closest('[data-um-ok]')) {
        if (running) return;
        running = true;
        var okBtn = ov.querySelector('[data-um-ok]');
        var orig = okBtn ? okBtn.textContent : '';
        if (okBtn) { okBtn.disabled = true; okBtn.textContent = okLabel.indexOf('...') >= 0 ? okLabel : (okPrefix(okLabel) + '...'); }
        onOk({
          done: function () { runDone(done, okBtn, orig); },
          fail: function (msg) {
            var el = errEl();
            if (el) { el.textContent = msg; el.style.display = 'block'; }
            if (okBtn) { okBtn.disabled = false; okBtn.textContent = orig; }
            running = false;
          },
          label: okLabel,
        });
      }
    });
    escH = function (e) {
      if (e.key === 'Escape' && document.body.contains(ov)) { done(); }
    };
    document.addEventListener('keydown', escH);
    var runDone = function (d, b, o) { d(); if (b) { b.disabled = false; b.textContent = o; } };
  }

  function okPrefix(label) {
    return String(label).replace(/\.\.\.$/g, '').trim();
  }

  async function blockFlow(uidv, name) {
    if (!authOk()) return;
    confirmModal('Block @' + String(name).replace(/^@/, '') + '?', 'Blocking this user will hide their content and activity from you.', 'Block User', 'danger', function (ctx) {
      apiDo('POST', '/api/users/' + encodeURIComponent(uidv) + '/block').then(function (res) {
        if (res.ok) {
          ctx.done();
          toast('Blocked @' + String(name).replace(/^@/, ''), 'success');
          if (window.userRelations && window.userRelations.refresh) window.userRelations.refresh();
          window.userMenu.refreshProfile(uidv);
          refreshContent();
        } else if (res.data && res.data.error === 'already_blocked') {
          ctx.fail("You're already blocking this user.");
        } else if (res.data && res.data.error === 'cannot_perform_on_self') {
          ctx.fail('You cannot perform this action on yourself.');
        } else {
          ctx.fail('Unable to block this user.');
        }
      });
    });
  }

  async function muteFlow(uidv, name) {
    if (!authOk()) return;
    confirmModal('Mute @' + String(name).replace(/^@/, '') + '?', 'Mute this user without blocking them?', 'Mute User', '', function (ctx) {
      apiDo('POST', '/api/users/' + encodeURIComponent(uidv) + '/mute').then(function (res) {
        if (res.ok) {
          ctx.done();
          toast('Muted @' + String(name).replace(/^@/, ''), 'success');
          if (window.userRelations && window.userRelations.refresh) window.userRelations.refresh();
          window.userMenu.refreshProfile(uidv);
        } else if (res.data && res.data.error === 'already_muted') {
          ctx.fail("You're already muting this user.");
        } else if (res.data && res.data.error === 'cannot_perform_on_self') {
          ctx.fail('You cannot perform this action on yourself.');
        } else {
          ctx.fail('Unable to mute this user.');
        }
      });
    });
  }

  async function unblockFlow(uidv, name) {
    if (!authOk()) return;
    confirmModal('Unblock @' + String(name).replace(/^@/, '') + '?', 'Unblocking will show their content and activity to you again.', 'Unblock User', '', function (ctx) {
      apiDo('DELETE', '/api/users/' + encodeURIComponent(uidv) + '/block').then(function (res) {
        if (res.ok) {
          ctx.done();
          toast('Unblocked @' + String(name).replace(/^@/, ''), 'success');
          if (window.userRelations && window.userRelations.refresh) window.userRelations.refresh();
          window.userMenu.refreshProfile(uidv);
          refreshContent();
        } else if (res.data && res.data.error === 'not_blocked') {
          ctx.fail('This user is not blocked.');
        } else {
          ctx.fail('Unable to unblock this user.');
        }
      });
    });
  }

  async function unmuteFlow(uidv, name) {
    if (!authOk()) return;
    confirmModal('Unmute @' + String(name).replace(/^@/, '') + '?', 'Unmuting restores their activity and notifications.', 'Unmute User', '', function (ctx) {
      apiDo('DELETE', '/api/users/' + encodeURIComponent(uidv) + '/mute').then(function (res) {
        if (res.ok) {
          ctx.done();
          toast('Unmuted @' + String(name).replace(/^@/, ''), 'success');
          if (window.userRelations && window.userRelations.refresh) window.userRelations.refresh();
          window.userMenu.refreshProfile(uidv);
        } else if (res.data && res.data.error === 'not_muted') {
          ctx.fail('This user is not muted.');
        } else {
          ctx.fail('Unable to unmute this user.');
        }
      });
    });
  }

  async function reportFlow(uidv, name) {
    if (!authOk()) return;
    if (!(window.userRelations && window.userRelations.linked())) {
      if (window.showGateModal) {
        window.showGateModal('Discord Required', 'You must be connected with Discord to report a user.');
      } else {
        toast('Please connect Discord first.', 'error');
      }
      return;
    }
    if (window.openReportModal) {
      window.openReportModal('USER', 'u:' + uidv, '@' + String(name).replace(/^@/, ''));
    }
  }

  function copyLink(uidv) {
    var url = location.origin + '/profile/' + encodeURIComponent(uidv);
    var done = function () { toast('Profile link copied', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else { fallbackCopy(url, done); }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { toast('Unable to copy link.', 'error'); }
  }

  function refreshContent() {
    if (window.dispatchEvent) {
      try { window.dispatchEvent(new CustomEvent('thw:relations-changed')); } catch (e) {}
    }
  }

  /* ---------------- delegation + close semantics ---------------- */

  document.addEventListener('click', function (e) {
    var btn = (e.target && e.target.closest) ? e.target.closest('[data-user-menu]') : null;
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(btn);
      return;
    }
    var it = (e.target && e.target.closest) ? e.target.closest('.user-menu-item') : null;
    if (it) {
      runAction(it);
      return;
    }
    if (menuel && (e.target.closest ? e.target.closest('.user-menu') : null)) return;
    closeMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  window.addEventListener('resize', function () {
    if (menuel && openBtn) positionMenu(openBtn, menuel);
  });

  window.addEventListener('scroll', function () {
    if (menuel && openBtn) positionMenu(openBtn, menuel);
  }, true);

  /* Unblock-to-view links rendered inside blocked content cards. */
  document.addEventListener('click', function (e) {
    var link = (e.target && e.target.closest) ? e.target.closest('[data-ubkey]') : null;
    if (!link) return;
    e.preventDefault();
    var key = link.getAttribute('data-ubkey');
    var uid = '';
    if (window.userRelations) {
      // Discord snowflakes are all digits; prefer resolving to a site uid.
      uid = window.userRelations.uidForDiscord(key);
    }
    if (!uid && !/^\d{10,25}$/.test(key)) uid = key;
    if (uid && !/^[A-Za-z0-9_-]{4,64}$/.test(uid)) uid = '';
    if (!uid) {
      toast('Could not unblock this user.', 'error');
      return;
    }
    link.disabled = true;
    link.textContent = 'Unblocking...';
    (window.userRelations ? window.userRelations.unblock(uid) : Promise.reject()).then(function (res) {
      if (res && res.ok) {
        toast('Unblocked. Updating content...', 'success');
        refreshContent();
      } else {
        toast('Unable to unblock this user.', 'error');
        link.textContent = 'Unblock to view';
        link.disabled = false;
      }
    });
  });
})();