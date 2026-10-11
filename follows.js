/* Follow buttons + counts on other users' profiles.
 * Resolves the /profile/<key> slug to a site uid via /api/profile, then
 * drives /api/follows (counts, state, toggle). Self profiles skipped. */
(function () {
  "use strict";
  if (window.__followsMounted) return;
  window.__followsMounted = true;

  var WID = "ws-follow";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function slug() {
    try {
      var m = (location.pathname || "").match(/^\/profile\/(.+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) {}
    return "";
  }

  function css() {
    if (document.getElementById("follows-style")) return;
    var st = document.createElement("style");
    st.id = "follows-style";
    st.textContent =
      ".ws-follow-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}" +
      ".ws-follow-btn{border:1px solid rgba(103,232,249,.45);background:rgba(103,232,249,.1);color:#67e8f9;border-radius:9999px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".ws-follow-btn:hover{background:rgba(103,232,249,.22);color:#fff}" +
      ".ws-follow-btn.in{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:rgba(255,255,255,.75)}" +
      ".ws-follow-counts{font-size:11px;color:rgba(255,255,255,.55)}" +
      ".ws-follow-counts b{color:#fff;font-family:monospace}";
    (document.head || document.documentElement).appendChild(st);
  }

  function resolveUid(key) {
    var param = /^\d{15,25}$/.test(key) ? "discord" : "user";
    return fetch("/api/profile?" + param + "=" + encodeURIComponent(key), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) { return (d && d.ok && d.uid) ? d.uid : ""; });
  }

  function paint(box, uid, following, followers, followingCount) {
    box.innerHTML =
      '<button type="button" class="ws-follow-btn' + (following ? " in" : "") + '" data-follow-uid="' + esc(uid) + '" data-following="' + (following ? "1" : "") + '">' +
      (following ? '<i class="fas fa-check"></i> Following' : '<i class="fas fa-user-plus"></i> Follow') + "</button>" +
      '<span class="ws-follow-counts"><b>' + Number(followers || 0) + '</b> followers &middot; <b>' + Number(followingCount || 0) + "</b> following</span>";
  }

  function load() {
    var key = slug();
    if (!key) return;
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    var actions = body.querySelector(".cmp-actions");
    if (!actions || document.getElementById(WID)) return;
    css();
    resolveUid(key).then(function (uid) {
      if (!uid || document.getElementById(WID)) return;
      fetch("/api/follows?uid=" + encodeURIComponent(uid), { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; })
        .then(function (d) {
          if (!d || d.ok !== true || document.getElementById(WID)) return;
          var div = document.createElement("div");
          div.className = "ws-follow-row";
          div.id = WID;
          paint(div, uid, !!d.am_following, d.followers, d.following);
          actions.appendChild(div);
          div.addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("[data-follow-uid]") : null;
            if (!b) return;
            var isIn = b.getAttribute("data-following") === "1";
            fetch("/api/follows", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: isIn ? "unfollow" : "follow", uid: uid })
            }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
              .then(function (dd) {
                if (dd && dd.ok) {
                  paint(div, uid, !isIn,
                    Math.max(0, (d.followers || 0) + (isIn ? -1 : 1)), d.following || 0);
                  d.am_following = !isIn;
                  d.followers = Math.max(0, (d.followers || 0) + (isIn ? -1 : 1));
                } else if (window.toast) window.toast("Sign in to follow", "error");
              });
          });
        });
    });
  }

  function boot() {
    try {
      var orig = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (orig) orig(); } catch (e) {}
        setTimeout(load, 800);
      };
    } catch (e) {}
    var body = document.getElementById("profilePageBody");
    if (body && window.MutationObserver) {
      new MutationObserver(function () {
        if (slug() && !document.getElementById(WID)) load();
      }).observe(body, { childList: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
