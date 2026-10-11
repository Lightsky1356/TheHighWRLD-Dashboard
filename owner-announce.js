/* Owner: site announcement composer inside #owner-panel.
 * Appears when unlocked (localStorage.ownerCode). POSTs to /api/announcements
 * with the owner code. Announcements surface in every user's bell. */
(function () {
  "use strict";
  if (window.__announceMounted) return;
  window.__announceMounted = true;

  function css() {
    if (document.getElementById("announce-style")) return;
    var st = document.createElement("style");
    st.id = "announce-style";
    st.textContent =
      ".ann-form{margin-top:12px;border:1px dashed rgba(255,255,255,.2);border-radius:12px;padding:12px}" +
      ".ann-form h4{font-size:11px;color:#fbbf24;margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em}" +
      ".ann-form input,.ann-form textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-size:12px;padding:8px;margin-bottom:8px;outline:none}" +
      ".ann-form button{border:1px solid rgba(251,191,36,.45);background:rgba(251,191,36,.12);color:#fbbf24;border-radius:9px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer}";
    (document.head || document.documentElement).appendChild(st);
  }

  function mount() {
    if (document.getElementById("ann-create")) return;
    var panel = document.getElementById("owner-panel");
    if (!panel) return;
    var code = "";
    try { code = localStorage.getItem("ownerCode") || ""; } catch (e) {}
    if (!code && !window.__ownerStatsURL) return;
    css();
    var f = document.createElement("div");
    f.className = "ann-form";
    f.id = "ann-create";
    f.innerHTML = "<h4>Post announcement</h4>" +
      '<input id="ann-f-title" maxlength="120" placeholder="Title (optional)">' +
      '<textarea id="ann-f-msg" rows="2" maxlength="500" placeholder="Announcement message…"></textarea>' +
      '<button type="button" id="ann-f-go"><i class="fas fa-bullhorn"></i> Announce</button>';
    panel.appendChild(f);
    document.getElementById("ann-f-go").addEventListener("click", function () {
      var t = document.getElementById("ann-f-title");
      var m = document.getElementById("ann-f-msg");
      var msg = m ? m.value.trim() : "";
      if (!msg) { if (m) m.focus(); return; }
      var c = "";
      try { c = localStorage.getItem("ownerCode") || ""; } catch (e) {}
      fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c, title: t ? t.value.trim() : "", message: msg })
      }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
        .then(function (d) {
          if (d && d.ok) {
            if (t) t.value = "";
            if (m) m.value = "";
            if (window.toast) window.toast("Announcement posted", "success");
          } else if (window.toast) window.toast("Could not post", "error");
        });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  setInterval(mount, 10000);
})();
