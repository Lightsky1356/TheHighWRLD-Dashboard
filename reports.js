/* TheHighWRLD Reports — user content reporting + staff moderation.
   No polling: the staff view refreshes from live hub events. */
(function () {
  'use strict';

  var API = '/api/reports';
  var REASONS = ['Spam', 'Duplicate', 'Incorrect Information', 'Harassment', 'Inappropriate Content', 'Copyright Concern', 'Scam / Malicious Content', 'Other'];
  var NEEDS_DETAILS = { 'Other': true, 'Copyright Concern': true };
  var MAX_DETAILS = 1000;

  function getUid() { try { return localStorage.getItem('wantedUserId') || ''; } catch (e) { return ''; } }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function relTime(ts) {
    if (!ts) return '';
    var d = Date.now() - Date.parse(String(ts).replace(' ', 'T'));
    if (isNaN(d)) return '';
    var s = Math.floor(d / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function toast(msg, type) {
    if (window.showToast) { try { window.showToast(msg, type || 'info'); return; } catch (e) {} }
  }

  /* ================= report modal ================= */

  var cur = { type: null, id: '', title: '' };

  function ensureModal() {
    var ov = document.getElementById('report-modal-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'report-modal-overlay';
    ov.className = 'report-modal-overlay';
    ov.style.display = 'none';
    var opts = REASONS.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('');
    ov.innerHTML =
      '<div class="report-modal" role="dialog" aria-modal="true" aria-label="Report content">' +
        '<div class="report-modal-head"><h3>Report Content</h3>' +
        '<button type="button" class="report-modal-x" aria-label="Close">x</button></div>' +
        '<div class="report-modal-body">' +
          '<div class="report-gate" style="display:none">' +
            '<div class="gate-modal-icon"><i class="fab fa-discord"></i></div>' +
            '<p class="report-gate-msg">You must be connected with Discord to report content.</p>' +
            '<div class="gate-modal-actions">' +
              '<button type="button" class="gate-modal-link report-login-btn"><i class="fab fa-discord"></i> Login with Discord</button>' +
              '<button type="button" class="gate-modal-close report-cancel-btn">Cancel</button>' +
            '</div>' +
          '</div>' +
          '<div class="report-form">' +
            '<p class="report-target-label">Target</p>' +
            '<p class="report-target-title"></p>' +
            '<p class="report-loading" style="display:none">Checking Discord link...</p>' +
            '<label class="report-label" for="report-reason">Reason</label>' +
            '<select id="report-reason" class="report-select">' + opts + '</select>' +
            '<label class="report-label" for="report-details">Additional Details <span class="report-opt">(optional)</span></label>' +
            '<textarea id="report-details" class="report-textarea" rows="4" maxlength="1000" placeholder="Anything staff should know..."></textarea>' +
            '<p class="report-error" style="display:none"></p>' +
            '<p class="report-success" style="display:none">Report submitted successfully.</p>' +
            '<div class="report-actions">' +
              '<button type="button" class="gate-modal-close report-cancel-btn">Cancel</button>' +
              '<button type="button" class="report-submit-btn">Submit Report</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) { closeModal(); return; }
      if (e.target.closest('.report-modal-x') || e.target.closest('.report-cancel-btn')) { closeModal(); return; }
      if (e.target.closest('.report-login-btn')) {
        try { window.location.href = '/api/discord/login?mode=login'; } catch (err) {}
        return;
      }
      if (e.target.closest('.report-submit-btn')) { submitReport(); return; }
    });
    var sel = ov.querySelector('#report-reason');
    if (sel) sel.addEventListener('change', function () {
      var lab = ov.querySelector('.report-opt');
      if (lab) lab.textContent = NEEDS_DETAILS[sel.value] ? '(required)' : '(optional)';
    });
    return ov;
  }

  function closeModal() {
    var ov = document.getElementById('report-modal-overlay');
    if (ov) ov.style.display = 'none';
  }

  function showGate() {
    var ov = ensureModal();
    ov.querySelector('.report-gate').style.display = '';
    ov.querySelector('.report-form').style.display = 'none';
    ov.style.display = 'flex';
  }

  function showError(msg) {
    var ov = ensureModal();
    var el = ov.querySelector('.report-error');
    if (el) { el.textContent = msg || ''; el.style.display = msg ? '' : 'none'; }
  }

  function typeLabel(ty) {
    if (ty === 'WANTED') return 'Wanted: ';
    if (ty === 'REPLY') return 'Reply: ';
    if (ty === 'NOM') return 'Nomination: ';
    return 'Suggestion: ';
  }

  function showFormLoading(on) {
    var ov = ensureModal();
    var l = ov.querySelector('.report-loading');
    if (l) l.style.display = on ? '' : 'none';
    var f = ov.querySelector('.report-form');
    if (f) f.style.visibility = on ? 'hidden' : '';
  }

  async function checkLinked() {
    var uid = getUid();
    if (!uid) return false;
    try {
      const r = await fetch(API + '?check=1&user=' + encodeURIComponent(uid), { cache: 'no-store' });
      const d = await r.json().catch(function () { return {}; });
      return !!(d && d.linked);
    } catch (e) {
      return true;
    }
  }

  async function openReportModal(type, id, title) {
    cur = { type: type, id: String(id), title: title || '' };
    var ov = ensureModal();
    ov.querySelector('.report-target-title').textContent =
      typeLabel(type) + (title || ('#' + id));
    ov.querySelector('#report-reason').selectedIndex = 0;
    ov.querySelector('#report-details').value = '';
    ov.querySelector('.report-opt').textContent = '(optional)';
    showError('');
    ov.querySelector('.report-success').style.display = 'none';
    ov.querySelector('.report-gate').style.display = 'none';
    ov.querySelector('.report-form').style.display = '';
    ov.style.display = 'flex';
    if (!getUid()) { showGate(); return; }
    showFormLoading(true);
    var linked = await checkLinked();
    showFormLoading(false);
    if (!linked) showGate();
  }

  async function submitReport() {
    var ov = ensureModal();
    var btn = ov.querySelector('.report-submit-btn');
    var reason = ov.querySelector('#report-reason').value;
    var details = ov.querySelector('#report-details').value.trim();
    if (!reason) { showError('Please select a reason.'); return; }
    if (NEEDS_DETAILS[reason] && details.length < 10) {
      showError('Please add a few words of detail for this reason.');
      return;
    }
    showError('');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: cur.type,
          target_id: cur.id,
          reason: reason,
          details: details.slice(0, MAX_DETAILS),
          user: getUid(),
        }),
      });
      const d = await r.json().catch(function () { return {}; });
      if (r.ok && d && d.ok) {
        ov.querySelector('.report-success').style.display = '';
        toast('Report submitted successfully.', 'success');
        setTimeout(closeModal, 1500);
        return;
      }
      if (d && d.error === 'discord_link_required') { showGate(); return; }
      if (d && d.error === 'duplicate') { showError('This report has already been submitted.'); return; }
      if (r.status === 429) { showError('Too many reports recently - please slow down.'); return; }
      showError((d && (d.message || d.error)) || 'Unable to submit the report. Please try again.');
    } catch (e) {
      showError('Unable to submit the report. Please try again.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindButtons() {
    if (window.__reportsBound) return;
    window.__reportsBound = true;
    document.addEventListener('click', function (e) {
      var b = (e.target && e.target.closest) ? e.target.closest('[data-report]') : null;
      if (!b) return;
      e.preventDefault();
      var parts = (b.getAttribute('data-report') || '').split(':');
      var type = (parts[0] || '').toUpperCase() === 'WANTED' ? 'WANTED' : 'SUGGESTION';
      var id = parts.slice(1).join(':');
      if (!id) return;
      var title = '';
      var card = b.closest('.sugg-card, .wanted-card');
      if (card) {
        var h = card.querySelector('.sugg-card-title, .wanted-card-title');
        if (h) title = h.textContent.trim().slice(0, 120);
      }
      openReportModal(type, id, title);
    });
  }
  bindButtons();
  window.openReportModal = openReportModal;

  /* ================= staff moderation ================= */

  var staff = { page: 1, pages: 1, total: 0, status: 'OPEN', type: 'all' };
  var STATUS_OPTS = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED', 'ALL'];

  function isReportsView() {
    var v = document.getElementById('owner-reports');
    return !!(v && v.style.display !== 'none');
  }

  function statusBadge(st) {
    var cls = { OPEN: 'rep-st-open', REVIEWING: 'rep-st-reviewing', RESOLVED: 'rep-st-resolved', DISMISSED: 'rep-st-dismissed' }[st] || 'rep-st-open';
    return '<span class="report-status-badge ' + cls + '">' + esc(st) + '</span>';
  }

  function typeBadge(ty) {
    return '<span class="report-type-badge ' + (ty === 'WANTED' ? 'rep-t-wanted' : 'rep-t-sugg') + '">' + esc(ty === 'WANTED' ? 'Wanted' : 'Suggestion') + '</span>';
  }

  async function apiCall(method, url, body) {
    const opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const d = await r.json().catch(function () { return {}; });
    return { status: r.status, ok: r.ok && d && d.ok !== false && !d.error, data: d };
  }

  async function loadReports(page) {
    var box = document.getElementById('owner-reports');
    if (!box) return;
    staff.page = page || 1;
    var stSel = document.getElementById('report-filter-status');
    var tySel = document.getElementById('report-filter-type');
    if (stSel) staff.status = stSel.value;
    if (tySel) tySel.value = staff.type;
    if (tySel) staff.type = tySel.value;
    box.innerHTML =
      '<div class="report-filter-bar">' +
        '<select id="report-filter-status" class="report-select report-filter">' +
          STATUS_OPTS.map(function (s) {
            return '<option value="' + s + '"' + (staff.status === s ? ' selected' : '') + '>' + s.charAt(0) + s.slice(1).toLowerCase() + '</option>';
          }).join('') +
        '</select>' +
        '<select id="report-filter-type" class="report-select report-filter">' +
          '<option value="all"' + (staff.type === 'all' ? ' selected' : '') + '>All types</option>' +
          '<option value="WANTED"' + (staff.type === 'WANTED' ? ' selected' : '') + '>Wanted</option>' +
          '<option value="SUGGESTION"' + (staff.type === 'SUGGESTION' ? ' selected' : '') + '>Suggestions</option>' +
        '</select>' +
        '<span class="report-count"></span>' +
      '</div>' +
      '<div class="report-list"><p class="report-empty">Loading reports...</p></div>' +
      '<div class="report-pager"></div>';
    box.querySelector('#report-filter-status').addEventListener('change', function () { loadReports(1); });
    box.querySelector('#report-filter-type').addEventListener('change', function () { loadReports(1); });
    try {
      const q = new URLSearchParams({
        status: staff.status, type: staff.type,
        page: String(staff.page), limit: '20', user: getUid(),
      });
      const r = await fetch(API + '?' + q.toString(), { cache: 'no-store' });
      const d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d || !d.ok) {
        box.querySelector('.report-list').innerHTML =
          '<p class="report-empty">' + esc(r.status === 403 ? 'Unlock the panel as staff to view reports.' : 'Could not load reports.') + '</p>';
        return;
      }
      staff.total = d.total || 0;
      staff.pages = d.pages || 1;
      renderReportList(box, d.reports || []);
      updateBadge();
    } catch (e) {
      var l = box.querySelector('.report-list');
      if (l) l.innerHTML = '<p class="report-empty">Could not load reports.</p>';
    }
  }

  function renderReportList(box, rows) {
    var list = box.querySelector('.report-list');
    var cnt = box.querySelector('.report-count');
    if (cnt) cnt.textContent = staff.total + ' report' + (staff.total === 1 ? '' : 's');
    if (!rows.length) {
      list.innerHTML = '<p class="report-empty">No reports match these filters.</p>';
    } else {
      list.innerHTML = rows.map(function (r) {
        return '<div class="report-row" data-rid="' + r.id + '">' +
          '<div class="report-row-head"><span class="report-id">#' + r.id + '</span>' +
          typeBadge(r.targetType) + statusBadge(r.status) +
          '<span class="report-time">' + esc(relTime(r.createdAt)) + '</span></div>' +
          '<div class="report-row-title">' + esc(r.snapshotTitle || ('#' + r.targetId)) + '</div>' +
          '<div class="report-row-meta">Reason: <b>' + esc(r.reason) + '</b> &middot; By: ' + esc(r.reporterName || r.reporterDiscordId) + '</div>' +
          (r.details ? '<div class="report-row-details">' + esc(r.details) + '</div>' : '') +
          (r.snapshotBody ? '<div class="report-row-snap">' + esc(r.snapshotBody) + '</div>' : '') +
          '<label class="report-label">Staff notes</label>' +
          '<textarea class="report-notes-input" rows="2" maxlength="1000" placeholder="Internal notes (staff only)...">' + esc(r.notes || '') + '</textarea>' +
          '<div class="report-row-actions">' +
            '<button type="button" class="report-act-btn" data-raction="REVIEWING" data-rid="' + r.id + '">Reviewing</button>' +
            '<button type="button" class="report-act-btn ok" data-raction="RESOLVED" data-rid="' + r.id + '">Resolve</button>' +
            '<button type="button" class="report-act-btn" data-raction="DISMISSED" data-rid="' + r.id + '">Dismiss</button>' +
            '<button type="button" class="report-act-btn" data-rnote="' + r.id + '">Save notes</button>' +
            '<button type="button" class="report-act-btn danger" data-rdel="' + r.id + '">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    var pg = box.querySelector('.report-pager');
    pg.innerHTML =
      '<button type="button" class="report-page-btn" data-rpage="prev"' + (staff.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
      '<span class="report-page-info">Page ' + staff.page + ' of ' + Math.max(1, staff.pages) + '</span>' +
      '<button type="button" class="report-page-btn" data-rpage="next"' + (staff.page >= staff.pages ? ' disabled' : '') + '>Next</button>';
  }

  async function updateBadge() {
    var badge = document.getElementById('owner-report-badge');
    if (!badge) return;
    try {
      const q = new URLSearchParams({ status: 'OPEN', limit: '1', user: getUid() });
      const r = await fetch(API + '?' + q.toString(), { cache: 'no-store' });
      const d = await r.json().catch(function () { return {}; });
      if (r.ok && d && d.ok && d.total > 0) {
        badge.textContent = d.total > 99 ? '99+' : String(d.total);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch (e) {}
  }

  function bindStaff() {
    if (window.__reportsStaffBound) return;
    window.__reportsStaffBound = true;
    document.addEventListener('click', function (e) {
      var tab = (e.target && e.target.closest) ? e.target.closest('[data-otab]') : null;
      if (tab) {
        var which = tab.getAttribute('data-otab');
        document.querySelectorAll('[data-otab]').forEach(function (b) {
          b.classList.toggle('on', b === tab);
        });
        var st = document.getElementById('owner-stats');
        var rp = document.getElementById('owner-reports');
        if (st) st.style.display = which === 'reports' ? 'none' : '';
        if (rp) rp.style.display = which === 'reports' ? '' : 'none';
        if (which === 'reports') loadReports(1);
        return;
      }
      var act = (e.target && e.target.closest) ? e.target.closest('[data-raction]') : null;
      if (act) {
        var id = parseInt(act.getAttribute('data-rid'), 10);
        var to = act.getAttribute('data-raction');
        act.disabled = true;
        apiCall('PATCH', API + '/' + id, { status: to, user: getUid() }).then(function (res) {
          if (!res.ok) toast('Could not update report.', 'error');
          loadReports(staff.page);
        });
        return;
      }
      var note = (e.target && e.target.closest) ? e.target.closest('[data-rnote]') : null;
      if (note) {
        var nid = parseInt(note.getAttribute('data-rnote'), 10);
        var row = note.closest('.report-row');
        var ta = row ? row.querySelector('.report-notes-input') : null;
        note.disabled = true;
        apiCall('PATCH', API + '/' + nid, { notes: ta ? ta.value : '', user: getUid() }).then(function (res) {
          toast(res.ok ? 'Notes saved.' : 'Could not save notes.', res.ok ? 'success' : 'error');
          if (res.ok) loadReports(staff.page);
          else { note.disabled = false; }
        });
        return;
      }
      var del = (e.target && e.target.closest) ? e.target.closest('[data-rdel]') : null;
      if (del) {
        if (!window.confirm('Delete this report?')) return;
        var did = parseInt(del.getAttribute('data-rdel'), 10);
        del.disabled = true;
        apiCall('DELETE', API + '/' + did, { user: getUid() }).then(function (res) {
          if (!res.ok) toast('Could not delete report.', 'error');
          loadReports(staff.page);
        });
        return;
      }
      var pg = (e.target && e.target.closest) ? e.target.closest('[data-rpage]') : null;
      if (pg && !pg.disabled) {
        loadReports(pg.getAttribute('data-rpage') === 'next' ? staff.page + 1 : Math.max(1, staff.page - 1));
        return;
      }
    });
    window.addEventListener('thw:report', function () {
      updateBadge();
      if (isReportsView()) loadReports(staff.page);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isReportsView()) loadReports(staff.page);
    });
  }
  bindStaff();

  function isReportsView() {
    var v = document.getElementById('owner-reports');
    return !!(v && v.style.display !== 'none');
  }

  window.ownerReportsRefresh = function () { if (isReportsView()) loadReports(staff.page); else updateBadge(); };
})();
