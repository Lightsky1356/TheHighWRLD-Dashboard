/* Profile visibility — privacy toggles on the self profile page.
 * Reads/writes /api/privacy (session-authed). Reuses the native
 * .psp-toggle slider styles. Self profile only. */
(function () {
  "use strict";
  if (window.__privacyMounted) return;
  window.__privacyMounted = true;

  var WID = "ws-privacy";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isSelfProfile() {
    try {
      if (typeof window.isOtherProfilePath === "function" ? window.isOtherProfilePath() : false) return false;
      var body = document.getElementById("profilePageBody");
      return !!(body && body.textContent);
    } catch (e) { return false; }
  }

  var ITEMS = [
    ["show_stats", "Listening stats", "Plays, streak, top tracks & charts"],
    ["show_playlists", "Playlists", "Your public playlists list"],
    ["show_favorites", "Favorites", "Your favorited tracks"],
    ["show_activity", "Activity", "Votes, replies & recent actions"]
  ];

  function css() {
    if (document.getElementById("privacy-style")) return;
    var st = document.createElement("style");
    st.id = "privacy-style";
    st.textContent =
      ".ws-priv{margin:12px 0}" +
      ".ws-priv-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid rgba(255,255,255,.06)}" +
      ".ws-priv-row:first-of-type{border-top:none}" +
      ".ws-priv-txt{flex:1;min-width:0}.ws-priv-txt b{display:block;font-size:12px;color:#fff}" +
      ".ws-priv-txt span{font-size:10px;color:rgba(255,255,255,.5)}" +
      ".ws-priv-note{font-size:10px;color:rgba(255,255,255,.4);margin-top:6px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function mount(flags) {
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile()) return;
    var old = document.getElementById(WID);
    if (old) old.remove();
    css();
    var h = '<div class="pv-block" id="' + WID + '"><div class="pv-block-title">Profile visibility</div>';
    ITEMS.forEach(function (it) {
      var on = Number(flags[it[0]]) !== 0;
      h += '<label class="ws-priv-row"><span class="ws-priv-txt"><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></span>' +
        '<span class="psp-toggle"><input type="checkbox" data-priv="' + it[0] + '"' + (on ? " checked" : "") + '><span class="slider"></span></span></label>';
    });
    h += '<p class="ws-priv-note">Hidden sections are invisible to everyone else.</p></div>';
    var div = document.createElement("div");
    div.innerHTML = h;
    var el = div.firstChild;
    body.appendChild(el);
    el.addEventListener("change", function (e) {
      var box = e.target.closest ? e.target.closest("[data-priv]") : null;
      if (!box) return;
      var payload = {};
      el.querySelectorAll("[data-priv]").forEach(function (b) {
        payload[b.getAttribute("data-priv")] = b.checked ? 1 : 0;
      });
      fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
        .then(function (d) {
          if (window.toast) window.toast(d && d.ok ? "Visibility saved" : "Could not save", d && d.ok ? "success" : "error");
        });
    });
  }

  function load() {
    if (window.__THW_PROFILE_V2) return;
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile()) return;
    if (document.getElementById(WID)) return;
    /* The privacy record comes with the bootstrap - one request carrying
       several answers rather than one request each. */
    var take = window.THWBootstrap && window.THWBootstrap.take;
    var ask = function () {
      return fetch("/api/privacy", { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; })
        .then(function (d) { return d && d.ok ? d : null; });
    };
    (take ? take("privacy", ask) : ask()).then(function (d) {
      if (!d || !d.privacy) return;
      mount(d.privacy);
    });
  }

  function boot() {
    try {
      var orig = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (orig) orig(); } catch (e) {}
        setTimeout(load, 700);
      };
    } catch (e) {}
    var body = document.getElementById("profilePageBody");
    if (body && window.MutationObserver) {
      new MutationObserver(function () {
        if (!document.getElementById(WID)) load();
      }).observe(body, { childList: true });
    }
    window.refreshPrivacy = load;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
