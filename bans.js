/* Ban Management — owner panel "Bans" tab.
 * User search, ban modal (server-computed durations), active list with
 * search + pagination, history view, revoke with confirm. Staff-only;
 * every action re-verified server-side. Mirrors reports.js conventions. */
(function () {
  "use strict";
  if (window.__bansMounted) return;
  window.__bansMounted = true;

  var API = "/api/bans";
  var state = { page: 1, total: 0, q: "", selUid: "", selName: "" };
  var apage = 1, atotal = 0, astatus = "pending";
  var DURATIONS = [
    ["3600", "1 hour"], ["21600", "6 hours"], ["43200", "12 hours"],
    ["86400", "1 day"], ["259200", "3 days"], ["604800", "7 days"],
    ["2592000", "30 days"], ["permanent", "Permanent"]
  ];

  function getUid() {
    try { return localStorage.getItem("wantedUserId") || ""; }
    catch (e) { return ""; }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, type) {
    if (window.toast) { try { window.toast(msg, type || "info"); return; } catch (e) {} }
    var box = document.getElementById("toasts");
    if (!box) return;
    var el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  function css() {
    if (document.getElementById("bans-style")) return;
    var st = document.createElement("style");
    st.id = "bans-style";
    st.textContent =
      ".ban-user-row{display:flex;align-items:center;gap:9px;font-size:12px;color:#fff;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.06)}" +
      ".ban-user-row b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".ban-user-row code{font-size:10px;color:rgba(255,255,255,.4);font-family:monospace}" +
      ".ban-mini{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:8px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0}" +
      ".ban-mini:hover{border-color:rgba(251,191,36,.5);color:#fbbf24}" +
      ".ban-mini.danger:hover{border-color:rgba(244,63,94,.55);color:#fb7185}" +
      ".ban-mini:disabled{opacity:.45;cursor:default}" +
      ".ban-status{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;padding:2px 9px;border-radius:9999px;flex-shrink:0}" +
      ".ban-status.active{background:rgba(244,63,94,.16);color:#fca5a5;border:1px solid rgba(244,63,94,.4)}" +
      ".ban-status.expired{background:rgba(255,255,255,.06);color:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.14)}" +
      ".ban-status.revoked{background:rgba(251,191,36,.12);color:#fcd34d;border:1px solid rgba(251,191,36,.35)}" +
      ".ban-hist{border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:11px 13px;margin-bottom:9px;background:rgba(255,255,255,.02)}" +
      ".ban-hist-head{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap}" +
      ".ban-hist-meta{font-size:11px;color:rgba(255,255,255,.6);line-height:1.7}" +
      ".ban-hist-meta b{color:#fff}" +
      ".ban-hist-notes{font-size:11px;color:rgba(252,211,77,.85);background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:6px 9px;margin-top:7px}" +
      ".ban-ov{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(4,2,12,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:16px}" +
      ".ban-box{width:min(430px,94vw);background:#14101f;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px}" +
      ".ban-box h3{font-size:15px;color:#fff;margin:0 0 12px}" +
      ".ban-box label{display:block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5);margin:10px 0 5px}" +
      ".ban-box input,.ban-box select,.ban-box textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:9px;color:#fff;font-size:13px;padding:9px 11px;outline:none;font-family:inherit}" +
      ".ban-box textarea{resize:vertical;min-height:56px}" +
      ".ban-box-actions{display:flex;gap:8px;margin-top:14px}" +
      ".ban-box-actions .ban-mini{flex:1;padding:9px;font-size:12px}" +
      ".ban-box-actions .go{border-color:rgba(244,63,94,.5);background:rgba(244,63,94,.12);color:#fca5a5}";
    (document.head || document.documentElement).appendChild(st);
  }

  async function apiGet(params) {
    params.user = getUid();
    const q = new URLSearchParams(params);
    const r = await fetch(API + "?" + q.toString(), { cache: "no-store" });
    const d = await r.json().catch(function () { return {}; });
    return { status: r.status, ok: r.ok && d && d.ok !== false && !d.error, data: d };
  }

  async function apiPost(body) {
    body.user = getUid();
    const r = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(function () { return {}; });
    return { status: r.status, ok: r.ok && d && d.ok !== false && !d.error, data: d };
  }

  function durLabel(d) {
    if (!d) return "";
    for (var i = 0; i < DURATIONS.length; i++) {
      if (DURATIONS[i][0] === d) return DURATIONS[i][1];
    }
    return d;
  }

  function fmtDate(iso) {
    try {
      var dt = new Date(String(iso).replace(" ", "T") + "Z");
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) { return String(iso || "").slice(0, 10); }
  }

  /* ---------------- user search + selected user panel ---------------- */

  async function searchUsers(query) {
    var list = document.getElementById("ban-user-list");
    if (!list) return;
    if (query.length < 2) {
      list.innerHTML = '<p class="report-empty">Type at least 2 characters to find a user.</p>';
      return;
    }
    list.innerHTML = '<p class="report-empty">Searching…</p>';
    const res = await apiGet({ action: "search", username: query });
    if (!res.ok) {
      list.innerHTML = '<p class="report-empty">' + esc(res.status === 403 ? "Unlock the panel as staff to manage bans." : "Search failed.") + "</p>";
      return;
    }
    var users = (res.data && res.data.users) || [];
    if (!users.length) {
      list.innerHTML = '<p class="report-empty">No users found.</p>';
      return;
    }
    list.innerHTML = users.map(function (u) {
      return '<div class="ban-user-row"><b>' + esc(u.name || u.uid) + "</b><code>" + esc(String(u.uid).slice(0, 14)) + '</code>' +
        '<button type="button" class="ban-mini" data-ban-sel="' + esc(u.uid) + '" data-ban-name="' + esc(u.name || u.uid) + '">Select</button></div>';
    }).join("");
  }

  async function selectUser(uid, name) {
    state.selUid = uid;
    state.selName = name;
    var sel = document.getElementById("ban-sel");
    if (!sel) return;
    sel.innerHTML = '<p class="report-empty">Loading ' + esc(name) + "…</p>";
    const res = await apiGet({ action: "history", uid: uid });
    if (!res.ok) {
      sel.innerHTML = '<p class="report-empty">Could not load user.</p>';
      return;
    }
    var d = res.data || {};
    var h = '<div class="ban-user-row" style="border:1px solid rgba(251,191,36,.3);border-radius:10px;padding:9px 11px;margin:10px 0"><b>' + esc(d.name || name) + "</b>";
    if (d.active) {
      h += '<span class="ban-status active">Banned</span>' +
        '<button type="button" class="ban-mini danger" data-ban-revoke="' + d.active.id + '">Revoke</button>';
    } else {
      h += '<span class="ban-status expired">Clear</span>' +
        '<button type="button" class="ban-mini" data-ban-new="1">Ban user</button>';
    }
    h += "</div>";
    h += '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.5);margin:10px 0 6px">History (' + ((d.history || []).length) + ")</div>";
    (d.history || []).forEach(function (b) {
      h += '<div class="ban-hist"><div class="ban-hist-head"><span class="ban-status ' + b.status + '">' + esc(b.status) + "</span>" +
        "<span style=\"font-size:11px;color:rgba(255,255,255,.6)\">" + esc(b.permanent ? "Permanent" : durLabel("")) + "</span></div>" +
        '<div class="ban-hist-meta">Reason: <b>' + esc(b.reason || "—") + "</b><br>" +
        "Issued: " + esc(fmtDate(b.created_at)) +
        (b.expires_at ? " · Expires: " + esc(fmtDate(b.expires_at)) : " · Never expires") +
        (b.revoked_at ? "<br>Revoked: " + esc(fmtDate(b.revoked_at)) : "") +
        (b.moderator_name ? "<br>By: " + esc(b.moderator_name) : "") + "</div>";
      if (b.moderator_notes) h += '<div class="ban-hist-notes">Mod notes: ' + esc(b.moderator_notes) + "</div>";
      h += "</div>";
    });
    if (!(d.history || []).length) h += '<p class="report-empty">No bans on record.</p>';
    sel.innerHTML = h;
  }

  /* ---------------- ban modal ---------------- */

  function openBanModal() {
    closeBanModal();
    css();
    var ov = document.createElement("div");
    ov.className = "ban-ov";
    ov.id = "ban-ov";
    ov.innerHTML = '<div class="ban-box"><h3>Ban User</h3>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.7);margin-bottom:4px">User: <b>' + esc(state.selName) + "</b></div>" +
      "<label>Duration</label>" +
      '<select id="ban-duration">' + DURATIONS.map(function (x) {
        return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>";
      }).join("") + "</select>" +
      "<label>Reason (required, shown to user)</label>" +
      '<input id="ban-reason" maxlength="200" placeholder="e.g. Spam">' +
      "<label>Moderator notes (staff only)</label>" +
      '<textarea id="ban-notes" maxlength="500" placeholder="Internal context…"></textarea>' +
      '<div class="ban-box-actions"><button type="button" class="ban-mini" data-ban-x>Cancel</button>' +
      '<button type="button" class="ban-mini go" data-ban-go>Ban User</button></div></div>';
    ov.addEventListener("click", async function (e) {
      if (e.target === ov || (e.target.closest && e.target.closest("[data-ban-x]"))) { closeBanModal(); return; }
      var go = e.target.closest ? e.target.closest("[data-ban-go]") : null;
      if (!go) return;
      var reason = document.getElementById("ban-reason");
      if (!reason || !reason.value.trim()) {
        if (window.toast) window.toast("A reason is required", "error");
        else if (reason) reason.focus();
        return;
      }
      go.disabled = true;
      var dur = document.getElementById("ban-duration");
      var notes = document.getElementById("ban-notes");
      const res = await apiPost({
        action: "ban", uid: state.selUid,
        duration: dur ? dur.value : "permanent",
        reason: reason.value.trim(),
        notes: notes ? notes.value.trim() : ""
      });
      if (res.ok) {
        closeBanModal();
        if (window.toast) window.toast("User banned", "success");
        selectUser(state.selUid, state.selName);
        loadBans(state.page);
      } else {
        go.disabled = false;
        const msg = res.data && (res.data.error === "already banned" ? "User already has an active ban." : res.data.error);
        if (window.toast) window.toast(msg || "Could not ban user", "error");
        if (res.data && res.data.error === "already banned") {
          closeBanModal();
          selectUser(state.selUid, state.selName);
        }
      }
    });
    document.body.appendChild(ov);
  }

  function closeBanModal() {
    var ov = document.getElementById("ban-ov");
    if (ov) ov.remove();
  }

  /* ---------------- active list ---------------- */

  async function loadBans(page) {
    var box = document.getElementById("owner-bans");
    if (!box) return;
    if (!document.getElementById("ban-active-list")) renderShell(box);
    state.page = page || 1;
    var list = document.getElementById("ban-active-list");
    var pager = document.getElementById("ban-pager");
    list.innerHTML = '<p class="report-empty">Loading…</p>';
    const res = await apiGet({ action: "list", status: "active", q: state.q, page: String(state.page), limit: "20" });
    if (!res.ok) {
      list.innerHTML = '<p class="report-empty">' + esc(res.status === 403 ? "Unlock the panel as staff to manage bans." : "Could not load bans.") + "</p>";
      if (pager) pager.innerHTML = "";
      return;
    }
    var d = res.data || {};
    state.total = d.total || 0;
    var bans = d.bans || [];
    if (!bans.length) {
      list.innerHTML = '<p class="report-empty">No active bans.</p>';
    } else {
      list.innerHTML = bans.map(function (b) {
        return '<div class="ban-user-row"><b>' + esc(b.name || b.user_id) + "</b>" +
          '<span class="ban-status active">' + esc(b.permanent ? "Permanent" : "Timed") + "</span>" +
          '<span style="font-size:10px;color:rgba(255,255,255,.45)">' + esc(b.reason || "").slice(0, 40) + "</span>" +
          '<button type="button" class="ban-mini" data-ban-view="' + esc(b.user_id) + '" data-ban-name="' + esc(b.name || b.user_id) + '">View</button>' +
          '<button type="button" class="ban-mini danger" data-ban-revoke="' + b.id + '">Revoke</button></div>';
      }).join("");
    }
    if (pager) {
      var pages = Math.max(1, Math.ceil(state.total / 20));
      pager.innerHTML = state.total > 20
        ? '<button type="button" class="ban-mini" data-ban-page="prev"' + (state.page <= 1 ? " disabled" : "") + '>Prev</button>' +
          '<span style="font-size:11px;color:rgba(255,255,255,.5)">Page ' + state.page + " of " + pages + "</span>" +
          '<button type="button" class="ban-mini" data-ban-page="next"' + (state.page >= pages ? " disabled" : "") + ">Next</button>"
        : "";
    }
  }

  function renderShell(box) {
    css();
    box.innerHTML =
      '<div class="report-filter-bar" style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55)">Find user</div>' +
      '<div class="report-filter-bar">' +
      '<input id="ban-user-q" class="report-select report-filter" style="flex:1;min-width:140px" maxlength="40" placeholder="Search user…" autocomplete="off">' +
      "</div>" +
      '<div class="report-list" id="ban-user-list"><p class="report-empty">Type at least 2 characters to find a user.</p></div>' +
      '<div id="ban-sel"></div>' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);margin:16px 0 8px">Active bans</div>' +
      '<div class="report-filter-bar">' +
      '<input id="ban-list-q" class="report-select report-filter" style="flex:1;min-width:140px" maxlength="40" placeholder="Filter bans…" value="' + esc(state.q) + '">' +
      "</div>" +
      '<div class="report-list" id="ban-active-list"><p class="report-empty">Loading…</p></div>' +
      '<div class="report-pager" id="ban-pager"></div>' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);margin:16px 0 8px">Appeals</div>' +
      '<div class="report-filter-bar">' +
      '<select id="ban-appeal-filter" class="report-select report-filter">' +
      '<option value="pending">Pending</option><option value="all">All</option>' +
      "</select></div>" +
      '<div class="report-list" id="ban-appeal-list"><p class="report-empty">Loading…</p></div>' +
      '<div class="report-pager" id="ban-appeal-pager"></div>' +
      '<div id="ban-appeal-view"></div>';
    var q = box.querySelector("#ban-user-q");
    var deb = null;
    q.addEventListener("input", function () {
      if (deb) clearTimeout(deb);
      deb = setTimeout(function () { searchUsers(q.value.trim()); }, 280);
    });
    var lq = box.querySelector("#ban-list-q");
    var lt = null;
    lq.addEventListener("input", function () {
      if (lt) clearTimeout(lt);
      lt = setTimeout(function () { state.q = lq.value.trim(); loadBans(1); }, 350);
    });
    var af = box.querySelector("#ban-appeal-filter");
    if (af) af.addEventListener("change", function () { astatus = af.value; loadAppeals(1); });
  }

  /* ---------------- appeals queue + review ---------------- */

  async function loadAppeals(page) {
    var list = document.getElementById("ban-appeal-list");
    if (!list) return;
    apage = page || 1;
    list.innerHTML = '<p class="report-empty">Loading…</p>';
    var pager = document.getElementById("ban-appeal-pager");
    const res = await apiGet({ action: "queue", status: astatus, page: String(apage), limit: "20" });
    if (!res.ok) {
      list.innerHTML = '<p class="report-empty">' + esc(res.status === 403 ? "Unlock the panel as staff to review appeals." : "Could not load appeals.") + "</p>";
      if (pager) pager.innerHTML = "";
      return;
    }
    var d = res.data || {};
    atotal = d.total || 0;
    var items = d.appeals || [];
    if (!items.length) {
      list.innerHTML = '<p class="report-empty">No appeals.</p>';
    } else {
      list.innerHTML = items.map(function (a) {
        return '<div class="ban-user-row"><b>Appeal #' + a.id + " — " + esc(a.user_id.slice(0, 14)) + "</b>" +
          '<span class="ban-status ' + (a.status === "pending" ? "active" : a.status === "approved" ? "expired" : "revoked") + '">' + esc(a.status) + "</span>" +
          '<button type="button" class="ban-mini" data-ap-view="' + a.id + '">Review</button></div>';
      }).join("");
    }
    if (pager) {
      var pages = Math.max(1, Math.ceil(atotal / 20));
      pager.innerHTML = atotal > 20
        ? '<button type="button" class="ban-mini" data-ap-page="prev"' + (apage <= 1 ? " disabled" : "") + '>Prev</button>' +
          '<span style="font-size:11px;color:rgba(255,255,255,.5)">Page ' + apage + " of " + pages + "</span>" +
          '<button type="button" class="ban-mini" data-ap-page="next"' + (apage >= pages ? " disabled" : "") + ">Next</button>"
        : "";
    }
  }

  async function openAppeal(id) {
    var view = document.getElementById("ban-appeal-view");
    if (!view) return;
    view.innerHTML = '<p class="report-empty">Loading appeal…</p>';
    const res = await apiGet({ action: "get", id: String(id) });
    if (!res.ok) {
      view.innerHTML = '<p class="report-empty">Could not load appeal.</p>';
      return;
    }
    var a = res.data && res.data.appeal;
    if (!a) { view.innerHTML = '<p class="report-empty">Not found.</p>'; return; }
    var h = '<div class="ban-hist"><div class="ban-hist-head"><span class="ban-status ' +
      (a.status === "pending" ? "active" : a.status === "approved" ? "expired" : "revoked") + '">' + esc(a.status) + "</span>" +
      "<span style=\"font-size:11px;color:rgba(255,255,255,.6)\">Appeal #" + a.id + " · Ban #" + (a.ban_id || "?") + "</span></div>" +
      '<div class="ban-hist-meta">User: <b>' + esc(a.user_id) + "</b><br>" +
      "Ban reason: <b>" + esc(a.ban_reason || "—") + "</b><br>" +
      "Submitted: " + esc(fmtDate(a.created_at)) + "</div>" +
      '<div class="ban-hist-notes" style="border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(255,255,255,.8)">“' + esc(a.body || "") + "”</div>";
    if (a.status === "pending") {
      h += '<label style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5);margin:10px 0 5px">Moderator Response' + " (required to deny)</label>" +
        '<textarea id="ban-ap-resp" maxlength="500" rows="2" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:9px;color:#fff;font-size:12px;padding:8px;outline:none;font-family:inherit"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button type="button" class="ban-mini go" data-ap-decide="approved" data-ap-id="' + a.id + '">Approve Appeal</button>' +
        '<button type="button" class="ban-mini danger" data-ap-decide="denied" data-ap-id="' + a.id + '">Deny Appeal</button></div>';
    } else {
      h += '<div class="ban-hist-meta" style="margin-top:8px">Decided: ' + esc(fmtDate(a.reviewed_at)) +
        (a.moderator_response ? "<br>Response: <b>" + esc(a.moderator_response) + "</b>" : "") + "</div>";
    }
    view.innerHTML = h + "</div>";
    try { view.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
  }

  async function decideAppeal(id, decision) {
    var resp = "";
    var ta = document.getElementById("ban-ap-resp");
    if (ta) resp = ta.value.trim();
    if (decision === "denied" && !resp) {
      if (window.toast) window.toast("A response is required to deny", "error");
      else if (ta) ta.focus();
      return;
    }
    var ok = false;
    try { ok = window.confirm(decision === "approved" ? "Approve this appeal? The ban will be revoked." : "Deny this appeal? The ban stays active."); } catch (e) {}
    if (!ok) return;
    const res = await apiPost({ action: "decide", id: id, decision: decision, response: resp });
    if (res.ok) {
      if (window.toast) window.toast(decision === "approved" ? "Appeal approved — ban revoked" : "Appeal denied", "success");
      openAppeal(id);
      loadAppeals(apage);
      loadBans(state.page);
    } else if (window.toast) {
      window.toast((res.data && res.data.error) || "Could not decide", "error");
      if (res.data && res.data.error === "already decided") openAppeal(id);
    }
  }

  async function revokeBan(id) {
    var ok = false;
    try { ok = window.confirm("Revoke this ban?"); } catch (e) {}
    if (!ok) return;
    const res = await apiPost({ action: "revoke", id: id });
    if (res.ok) {
      if (window.toast) window.toast("Ban revoked", "success");
      if (state.selUid) selectUser(state.selUid, state.selName);
      loadBans(state.page);
    } else if (window.toast) {
      window.toast((res.data && res.data.error) || "Could not revoke", "error");
    }
  }

  function boot() {
    css();
    window.loadBansView = function (page) { loadBans(page || 1); loadAppeals(1); };
    document.addEventListener("click", function (e) {
      var sel = e.target.closest ? e.target.closest("[data-ban-sel]") : null;
      if (sel) { selectUser(sel.getAttribute("data-ban-sel"), sel.getAttribute("data-ban-name") || ""); return; }
      var nb = e.target.closest ? e.target.closest("[data-ban-new]") : null;
      if (nb) { openBanModal(); return; }
      var rv = e.target.closest ? e.target.closest("[data-ban-revoke]") : null;
      if (rv) { revokeBan(Number(rv.getAttribute("data-ban-revoke"))); return; }
      var vw = e.target.closest ? e.target.closest("[data-ban-view]") : null;
      if (vw) { selectUser(vw.getAttribute("data-ban-view"), vw.getAttribute("data-ban-name") || ""); return; }
      var pg = e.target.closest ? e.target.closest("[data-ban-page]") : null;
      if (pg && !pg.disabled) {
        loadBans(pg.getAttribute("data-ban-page") === "next" ? state.page + 1 : Math.max(1, state.page - 1));
        return;
      }
      var ap = e.target.closest ? e.target.closest("[data-ap-view]") : null;
      if (ap) { openAppeal(Number(ap.getAttribute("data-ap-view"))); return; }
      var apg = e.target.closest ? e.target.closest("[data-ap-page]") : null;
      if (apg && !apg.disabled) {
        loadAppeals(apg.getAttribute("data-ap-page") === "next" ? apage + 1 : Math.max(1, apage - 1));
        return;
      }
      var dc = e.target.closest ? e.target.closest("[data-ap-decide]") : null;
      if (dc) { decideAppeal(Number(dc.getAttribute("data-ap-id")), dc.getAttribute("data-ap-decide")); return; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeBanModal();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
