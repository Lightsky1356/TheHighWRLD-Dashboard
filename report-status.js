/* "My Reports" — account page section (Phase 6D).
 * Shows the signed-in member the status of reports they filed, using the
 * `mine=1` view of /api/reports. The server scopes the list to the caller's
 * own linked Discord id and returns no staff notes, reviewer or target detail,
 * so nothing private can leak into this list. */
(function () {
  "use strict";
  if (window.__reportStatusMounted) return;
  window.__reportStatusMounted = true;

  var API = "/api/reports?mine=1";
  var loaded = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function when(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (isNaN(t)) return String(iso).slice(0, 10);
    return new Date(t).toLocaleDateString();
  }

  var STATUS = {
    OPEN: ["Under review", "rs-open"],
    REVIEWING: ["Under review", "rs-open"],
    RESOLVED: ["Action taken", "rs-ok"],
    DISMISSED: ["No action taken", "rs-mut"]
  };

  function css() {
    if (document.getElementById("report-status-style")) return;
    var st = document.createElement("style");
    st.id = "report-status-style";
    st.textContent =
      ".rs-list{display:flex;flex-direction:column;gap:8px}" +
      ".rs-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);border-radius:10px;padding:9px 12px}" +
      ".rs-type{font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.45);border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);border-radius:9999px;padding:2px 8px;flex-shrink:0}" +
      ".rs-reason{font-size:12px;font-weight:700;color:#fff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rs-date{font-size:10.5px;color:rgba(255,255,255,.4)}" +
      ".rs-badge{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:3px 10px;border-radius:9999px;flex-shrink:0}" +
      ".rs-badge.rs-open{background:rgba(251,191,36,.13);color:#fcd34d;border:1px solid rgba(251,191,36,.32)}" +
      ".rs-badge.rs-ok{background:rgba(74,222,128,.12);color:#86efac;border:1px solid rgba(74,222,128,.3)}" +
      ".rs-badge.rs-mut{background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.12)}" +
      ".rs-empty{font-size:12px;color:rgba(255,255,255,.45);padding:14px 0;text-align:center}" +
      ".rs-note{margin:9px 0 0;font-size:.64rem;color:rgba(255,255,255,.3);line-height:1.5}";
    document.head.appendChild(st);
  }

  function host() {
    return document.getElementById("myReportsBody");
  }

  async function load() {
    var box = host();
    if (!box) return;
    css();
    loaded = true;
    box.innerHTML = '<div class="ac-loading"><i class="fas fa-circle-notch fa-spin"></i> Loading reports&hellip;</div>';
    try {
      var r = await fetch(API, { cache: "no-store", credentials: "same-origin" });
      if (r.status === 401) {
        box.innerHTML = '<p class="rs-empty">Sign in to see your reports.</p>';
        return;
      }
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d || !d.ok) {
        box.innerHTML = '<p class="rs-empty">Could not load your reports.</p>';
        return;
      }
      render(d.reports || []);
    } catch (e) {
      box.innerHTML = '<p class="rs-empty">Could not load your reports.</p>';
    }
  }

  function render(rows) {
    var box = host();
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<p class="rs-empty">You have not reported anything yet.</p>' +
        '<p class="rs-note">Use the flag button on a post, reply or profile to report something to staff.</p>';
      return;
    }
    var html = '<div class="rs-list">' + rows.map(function (r) {
      var s = STATUS[String(r.status || "").toUpperCase()] || ["In progress", "rs-open"];
      return '<div class="rs-row">' +
        '<span class="rs-type">' + esc(r.target_type) + '</span>' +
        '<span class="rs-reason">' + esc(r.reason) + '</span>' +
        '<span class="rs-date">' + esc(when(r.created_at)) + '</span>' +
        '<span class="rs-badge ' + s[1] + '">' + esc(s[0]) + '</span>' +
      "</div>";
    }).join("") + "</div>";
    box.innerHTML = html +
      '<p class="rs-note">Staff review reports in order. "Action taken" means the content was removed or restricted; "No action taken" means it was reviewed and found acceptable.</p>';
  }

  function bind() {
    if (window.__reportStatusBound) return;
    window.__reportStatusBound = true;
    // The section is collapsed by default; load the first time it is opened.
    document.addEventListener("click", function (e) {
      var head = (e.target && e.target.closest) ? e.target.closest("#myReports .sec-head") : null;
      if (!head) return;
      var sec = head.closest("#myReports");
      if (sec && sec.classList.contains("collapsed") && !loaded) {
        setTimeout(load, 120);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", bind);
  if (document.readyState !== "loading") bind();
  window.loadMyReports = load;
})();
