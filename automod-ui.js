/* Automod review queue — owner panel "Automod" tab (Phase 6B).
 * Shows automated-mod flags (rules + optional AI) with live content,
 * filters, pagination, and human review actions. Staff-only; every action
 * is re-verified server-side. Never auto-bans from the client. */
(function () {
  "use strict";
  if (window.__automodMounted) return;
  window.__automodMounted = true;

  var API = "/api/automod";
  var state = { page: 1, total: 0, pages: 1, status: "pending", severity: "all" };

  function getUid() {
    try { return localStorage.getItem("wantedUserId") || ""; }
    catch (e) { return ""; }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function relTime(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (isNaN(t)) return String(iso).slice(0, 16);
    var d = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (d < 60) return d + "s ago";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return Math.floor(d / 86400) + "d ago";
  }

  /* Delegates to the shared toast in toast.js.

     The fallback that used to build a .toast inside #toasts is gone. That
     container was removed, because its CSS is scoped #account-page #toasts
     while the element is a direct child of <main> - so the rule never applied
     and every toast put in it rendered as an unstyled div in normal flow.
     toast.js renders the .gtoast style instead, which is styled site-wide. */
  function toast(msg, type) {
    if (window.toast) { try { window.toast(msg, type || "info"); } catch (e) {} }
  }

  function css() {
    if (document.getElementById("automod-style")) return;
    var st = document.createElement("style");
    st.id = "automod-style";
    st.textContent =
      ".am-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:11px}" +
      ".am-bar select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:5px 9px;font-size:11px}" +
      ".am-count{font-size:11px;color:rgba(255,255,255,.55)}" +
      ".am-flag{border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:11px 13px;margin-bottom:9px;background:rgba(255,255,255,.02)}" +
      ".am-flag.sev-high{border-color:rgba(244,63,94,.32);background:rgba(244,63,94,.05)}" +
      ".am-flag.sev-medium{border-color:rgba(251,191,36,.24)}" +
      ".am-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:6px}" +
      ".am-id{font-size:10px;font-weight:800;color:rgba(255,255,255,.45);font-family:monospace}" +
      ".am-badge{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;padding:2px 9px;border-radius:9999px}" +
      ".am-badge.high{background:rgba(244,63,94,.16);color:#fca5a5;border:1px solid rgba(244,63,94,.4)}" +
      ".am-badge.medium{background:rgba(251,191,36,.14);color:#fcd34d;border:1px solid rgba(251,191,36,.35)}" +
      ".am-badge.low{background:rgba(255,255,255,.06);color:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.14)}" +
      ".am-badge.cat{background:rgba(147,197,253,.12);color:#bfdbfe;border:1px solid rgba(147,197,253,.3)}" +
      ".am-badge.type{background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.12)}" +
      ".am-time{margin-left:auto;font-size:10px;color:rgba(255,255,255,.4)}" +
      ".am-content{font-size:12px;line-height:1.6;color:rgba(255,255,255,.85);background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;word-break:break-word;max-height:130px;overflow:auto}" +
      ".am-content.gone{color:rgba(255,255,255,.35);font-style:italic}" +
      ".am-meta{font-size:10.5px;color:rgba(255,255,255,.5);line-height:1.7}" +
      ".am-meta b{color:#fff}" +
      ".am-ai{font-size:10.5px;color:rgba(191,219,254,.75);margin-top:4px;word-break:break-word}" +
      ".am-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}" +
      ".am-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:8px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer}" +
      ".am-btn:hover{border-color:rgba(251,191,36,.5);color:#fbbf24}" +
      ".am-btn.danger:hover{border-color:rgba(244,63,94,.55);color:#fb7185}" +
      ".am-btn.ok:hover{border-color:rgba(74,222,128,.5);color:#4ade80}" +
      ".am-btn:disabled{opacity:.45;cursor:default}" +
      ".am-pager{display:flex;align-items:center;gap:9px;justify-content:center;margin-top:11px}" +
      ".am-page{font-size:10px;color:rgba(255,255,255,.45)}" +
      ".am-empty{font-size:12px;color:rgba(255,255,255,.45);padding:18px 0;text-align:center}";
    document.head.appendChild(st);
  }

  function box() {
    return document.getElementById("owner-automod");
  }

  function renderShell(b) {
    if (b.querySelector(".am-bar")) return;
    b.innerHTML =
      '<div class="am-bar">' +
        '<select id="am-filter-status">' +
          '<option value="pending">Pending</option>' +
          '<option value="all">All</option>' +
          '<option value="actioned">Actioned</option>' +
          '<option value="removed">Removed</option>' +
          '<option value="approved">Dismissed</option>' +
        '</select>' +
        '<select id="am-filter-sev">' +
          '<option value="all">Any severity</option>' +
          '<option value="high">High</option>' +
          '<option value="medium">Medium</option>' +
          '<option value="low">Low</option>' +
        '</select>' +
        '<button type="button" class="am-btn" id="am-refresh">Refresh</button>' +
        '<span class="am-count"></span>' +
      '</div>' +
      '<div class="am-list"><p class="am-empty">Loading flags...</p></div>' +
      '<div class="am-pager"></div>';
    b.querySelector("#am-filter-status").value = state.status;
    b.querySelector("#am-filter-sev").value = state.severity;
    b.querySelector("#am-filter-status").addEventListener("change", function () {
      state.status = this.value; load(1);
    });
    b.querySelector("#am-filter-sev").addEventListener("change", function () {
      state.severity = this.value; load(1);
    });
    b.querySelector("#am-refresh").addEventListener("click", function () { load(state.page); });
  }

  async function load(page) {
    css();
    var b = box();
    if (!b) return;
    state.page = Math.max(1, page || 1);
    renderShell(b);
    var list = b.querySelector(".am-list");
    list.innerHTML = '<p class="am-empty">Loading flags...</p>';
    try {
      var q = new URLSearchParams({
        status: state.status, severity: state.severity,
        page: String(state.page), limit: "20", user: getUid(),
      });
      var r = await fetch(API + "?" + q.toString(), { cache: "no-store" });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d || !d.ok) {
        list.innerHTML = '<p class="am-empty">' +
          esc(r.status === 403 ? "Unlock the panel as staff to view the queue." : "Could not load flags.") +
          "</p>";
        return;
      }
      state.total = d.total || 0;
      state.pages = Math.max(1, Math.ceil(state.total / 20));
      render(b, d.flags || []);
      updateBadge(d.counts || []);
    } catch (e) {
      list.innerHTML = '<p class="am-empty">Could not load flags.</p>';
    }
  }

  function render(b, rows) {
    var list = b.querySelector(".am-list");
    var cnt = b.querySelector(".am-count");
    if (cnt) cnt.textContent = state.total + " flag" + (state.total === 1 ? "" : "s");
    if (!rows.length) {
      list.innerHTML = '<p class="am-empty">Nothing in the queue. Clean.</p>';
    } else {
      list.innerHTML = rows.map(function (f) {
        var done = f.status !== "pending";
        var conf = Math.round(Number(f.confidence || 0) * 100);
        return '<div class="am-flag sev-' + esc(f.severity) + '" data-am-id="' + f.id + '">' +
          '<div class="am-head">' +
            '<span class="am-id">#' + f.id + '</span>' +
            '<span class="am-badge cat">' + esc(f.category) + '</span>' +
            '<span class="am-badge ' + esc(f.severity) + '">' + esc(f.severity) + '</span>' +
            '<span class="am-badge type">' + esc(f.target_type) + '</span>' +
            '<span class="am-time">' + esc(relTime(f.created_at)) + '</span>' +
          '</div>' +
          '<div class="am-content' + (f.content_exists ? "" : " gone") + '">' + esc(f.content) + "</div>" +
          '<div class="am-meta">Signal: <b>' + esc(f.detail) + '</b> &middot; Confidence: <b>' + conf + '%</b>' +
            (f.uid ? ' &middot; User: <b>' + esc(f.uid) + '</b>' : "") +
            (f.status !== "pending" ? ' &middot; <b>' + esc(f.status) + "</b>" : "") +
          "</div>" +
          (f.ai_verdict ? '<div class="am-ai">AI: ' + esc(f.ai_verdict) + "</div>" : "") +
          (done ? "" :
            '<div class="am-acts">' +
              '<button type="button" class="am-btn ok" data-am-act="dismiss">Dismiss</button>' +
              '<button type="button" class="am-btn" data-am-act="warn">Warn user</button>' +
              '<button type="button" class="am-btn" data-am-act="strike">Give strike</button>' +
              '<button type="button" class="am-btn danger" data-am-act="remove">Remove content</button>' +
              '<button type="button" class="am-btn danger" data-am-act="temp_ban">Temp ban 24h</button>' +
            "</div>") +
        "</div>";
      }).join("");
    }
    var pg = b.querySelector(".am-pager");
    pg.innerHTML =
      '<button type="button" class="am-btn" data-am-page="prev"' + (state.page <= 1 ? " disabled" : "") + '>Prev</button>' +
      '<span class="am-page">Page ' + state.page + " of " + state.pages + "</span>" +
      '<button type="button" class="am-btn" data-am-page="next"' + (state.page >= state.pages ? " disabled" : "") + '>Next</button>';
  }

  function updateBadge(counts) {
    var badge = document.getElementById("owner-automod-badge");
    if (!badge) return;
    var pending = 0;
    counts.forEach(function (c) { if (c.status === "pending") pending = Number(c.n) || 0; });
    if (pending > 0) {
      badge.textContent = pending > 99 ? "99+" : String(pending);
      badge.style.display = "";
    } else {
      badge.style.display = "none";
    }
  }

  async function act(id, action, btn) {
    if (action === "remove" && !confirm("Remove this content and notify the author?")) return;
    if (action === "temp_ban" && !confirm("Restrict this account for 24 hours?")) return;
    if (action === "strike" && !confirm("Issue a strike to this account? Escalation rules may apply.")) return;
    btn.disabled = true;
    try {
      var r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, action: action, user: getUid() }),
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d || !d.ok) {
        toast(d && d.error ? d.error : "Action failed.", "error");
        btn.disabled = false;
        return;
      }
      toast("Flag " + id + " → " + (d.status || action), "ok");
      load(state.page);
    } catch (e) {
      toast("Action failed.", "error");
      btn.disabled = false;
    }
  }

  function bind() {
    if (window.__automodBound) return;
    window.__automodBound = true;
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest("[data-am-act]");
      if (b) {
        var row = b.closest("[data-am-id]");
        if (row) act(parseInt(row.getAttribute("data-am-id"), 10), b.getAttribute("data-am-act"), b);
        return;
      }
      var p = t.closest("[data-am-page]");
      if (p) {
        var dir = p.getAttribute("data-am-page");
        load(dir === "next" ? state.page + 1 : state.page - 1);
      }
    });
  }

  bind();
  window.loadAutomodView = function (page) { load(page || 1); };
})();
