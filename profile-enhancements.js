/* ============================================================================
   Profile Enhancements - your profile, tidied up.

   Your profile page shows three things:

     1. Recent activity - your own activity feed (plays, favorites, playlists,
        votes, downloads, profile + security changes), read from the real
        activity table.
     2. A settings cog in the header that opens one panel holding everything
        you can change about yourself: picture, name, status, bio, social and
        custom links, and profile visibility.
     3. Nothing else. The picture / links / visibility blocks that used to be
        scattered down the page now live behind that cog.

   The pencil beside your name opens the same panel - it is the quick way in.

   Self profiles only: on anyone else's profile this file does nothing.

   Loaded as `<script src="./profile-enhancements.js" defer>` from index.html.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__profileEnhancementsMounted) return;
  window.__profileEnhancementsMounted = true;

  var WID = "profile-enhancements";
  var PANEL_ID = "pe-settings";
  var STATUSES = ["Online", "Idle", "Do Not Disturb", "Invisible"];
  var PRIVACY_ITEMS = [
    ["show_stats", "Listening stats", "Plays, streak, top tracks & charts"],
    ["show_playlists", "Playlists", "Your public playlists list"],
    ["show_favorites", "Favorites", "Your favorited tracks"],
    ["show_activity", "Activity", "Votes, replies & recent actions"],
  ];

  /* Platforms the API accepts (see functions/api/profile.js). Mirrored here
     only to build the right base URL as you type - the server re-validates. */
  var PLATFORMS = [
    { key: "twitter", label: "X / Twitter", icon: "fab fa-twitter", base: "https://twitter.com/" },
    { key: "instagram", label: "Instagram", icon: "fab fa-instagram", base: "https://instagram.com/" },
    { key: "youtube", label: "YouTube", icon: "fab fa-youtube", base: "https://youtube.com/@" },
    { key: "soundcloud", label: "SoundCloud", icon: "fab fa-soundcloud", base: "https://soundcloud.com/" },
    { key: "spotify", label: "Spotify", icon: "fab fa-spotify", base: "https://open.spotify.com/user/" },
    { key: "tiktok", label: "TikTok", icon: "fab fa-tiktok", base: "https://tiktok.com/@" },
    { key: "facebook", label: "Facebook", icon: "fab fa-facebook", base: "https://facebook.com/" },
    { key: "website", label: "Website", icon: "fas fa-globe", base: "" },
  ];
  var PLATFORM_BY_KEY = {};
  PLATFORMS.forEach(function (p) { PLATFORM_BY_KEY[p.key] = p; });

  /* Matches the icons the account page uses for the activity table. */
  var ACT_ICON = {
    vote: "fa-vote-yea", reply: "fa-comment", favorite: "fa-heart",
    download: "fa-download", profile: "fa-user-pen", security: "fa-shield-halved",
    listen: "fa-headphones", playlist: "fa-list-music", bookmark: "fa-bookmark",
    community: "fa-users", link: "fa-link",
  };

  /* Latest known profile state, so the panel can pre-fill and save safely. */
  var state = { uid: "", name: "", bio: "", status: "Online", avatar: "", banner: "", links: [], activity: [], privacy: null };
  var avatarDraft = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initial(name) {
    var s = String(name || "9").trim();
    return s ? s.charAt(0).toUpperCase() : "9";
  }

  function tt(key, fallback) {
    try {
      var lang = localStorage.getItem("wantedLang") || "en";
      var D = window.SiteChromeI18N;
      if (D && D[lang] && D[lang][key]) return D[lang][key];
    } catch (e) {}
    return fallback;
  }

  function toast(msg, kind) {
    if (typeof window.toast === "function") window.toast(msg, kind || "info");
  }

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d || {} }; }); })
      .catch(function () { return { status: 0, data: {} }; });
  }

  function getJson(path) {
    return fetch(path, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  /* ---------------------------------------------------------------- guards */
  function isSelfProfile() {
    try {
      if (/^\/profile\/.+/.test(location.pathname || "")) return false;   /* someone else's */
      return !!document.getElementById("profilePageBody");
    } catch (e) { return false; }
  }

  function onProfilePage() {
    try {
      var sec = document.getElementById("page-section-profile");
      return !!(sec && sec.classList.contains("active")) && isSelfProfile();
    } catch (e) { return false; }
  }

  function myUid() {
    try { return localStorage.getItem("wantedUserId") || ""; } catch (e) { return ""; }
  }

  /* ------------------------------------------------------------------ css */
  function css() {
    if (document.getElementById("profile-enh-style")) return;
    var st = document.createElement("style");
    st.id = "profile-enh-style";
    st.textContent =
      /* ---- header panel + the two header buttons ---- */
      /* The card renders no panel of its own, so the header gets one here. */
      "#profilePageBody .cmp-head{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--ac-border,rgba(255,255,255,.08));background:linear-gradient(150deg,rgba(255,255,255,.05),rgba(255,255,255,.015));box-shadow:0 18px 44px rgba(0,0,0,.28);padding:16px 18px 14px;margin-bottom:14px}" +
      "#profilePageBody .cmp-head .pe-cover{display:block;position:absolute;inset:0;z-index:0;opacity:.3;background-size:cover;background-position:center 30%;pointer-events:none}" +
      "#profilePageBody .cmp-head>*:not(.pe-cover){position:relative;z-index:1}" +
      "#profilePageBody .cmp-head .cmp-actions{display:none}" +
      /* privacy.js mounts its own block on this page; the toggles live in the
         settings panel now, so its copy stays out of the way */
      "#profilePageBody #ws-privacy{display:none!important}" +
      "#profilePageBody .pe-headbtns{display:inline-flex;gap:6px;margin-left:8px}" +
      /* on a narrow card the name row wraps, so the buttons move to the free
         top-right corner instead of sitting between the name and the handle */
      "@media(max-width:560px){#profilePageBody .cmp-head .cmp-name-row{position:static}#profilePageBody .cmp-head .pe-headbtns{position:absolute;top:14px;right:14px;z-index:2;margin-left:0}}" +
      "#profilePageBody .pe-iconbtn{width:30px;height:30px;flex:0 0 30px;border-radius:9px;border:1px solid var(--ac-border,rgba(255,255,255,.12));background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s,border-color .15s}" +
      "#profilePageBody .pe-iconbtn:hover{background:rgba(212,165,116,.16);border-color:rgba(212,165,116,.4);color:#e8c89a}" +
      "#profilePageBody .pe-iconbtn:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}" +
      /* ---- activity feed ---- */
      ".pe-act-item{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}" +
      ".pe-act-item:last-child{border-bottom:none}" +
      ".pe-act-ico{width:28px;height:28px;border-radius:9px;flex:0 0 28px;display:flex;align-items:center;justify-content:center;font-size:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);color:var(--ac-gold,rgba(212,165,116,.9))}" +
      /* the text and the timestamp stack, they must not share a line */
      ".pe-act-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}" +
      ".pe-act-txt{display:block;font-size:12.5px;line-height:1.45;color:var(--ac-text,rgba(255,255,255,.9));overflow-wrap:anywhere}" +
      ".pe-act-time{display:block;font-size:10px;color:var(--ac-dim,rgba(255,255,255,.45));font-variant-numeric:tabular-nums}" +
      /* ---- settings panel (lives on <body>, so no page section can hide it) ---- */
      "#pe-settings{position:fixed;inset:0;z-index:420;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(5,2,12,.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}" +
      "#pe-settings.open{display:flex}" +
      "#pe-settings .pe-panel{width:100%;max-width:540px;max-height:calc(100vh - 36px);overflow-y:auto;box-sizing:border-box;border-radius:22px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(22,18,40,.98),rgba(12,10,24,.98));box-shadow:0 30px 90px rgba(0,0,0,.6);padding:22px}" +
      "#pe-settings .pe-phead{display:flex;align-items:center;gap:10px}" +
      "#pe-settings h3{margin:0;font-size:17px;font-weight:800;color:rgba(255,255,255,.95);display:flex;align-items:center;gap:9px;min-width:0}" +
      "#pe-settings h3 i{color:var(--ac-gold,#d4a574);font-size:13px}" +
      "#pe-settings .pe-x{margin-left:auto;width:32px;height:32px;flex:0 0 32px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}" +
      "#pe-settings .pe-x:hover{color:#fff;background:rgba(255,255,255,.1)}" +
      "#pe-settings .pe-fld{margin-top:16px;display:flex;flex-direction:column;gap:6px;min-width:0}" +
      "#pe-settings .pe-lbl{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ac-dim,rgba(255,255,255,.5))}" +
      "#pe-settings input[type=text],#pe-settings select,#pe-settings textarea{width:100%;box-sizing:border-box;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font:400 13px/1.4 inherit;padding:11px 12px;outline:none}" +
      "#pe-settings input[type=text]:focus,#pe-settings select:focus,#pe-settings textarea:focus{border-color:rgba(34,211,238,.5)}" +
      "#pe-settings textarea{resize:vertical;min-height:82px}" +
      "#pe-settings select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,rgba(255,255,255,.5) 50%),linear-gradient(135deg,rgba(255,255,255,.5) 50%,transparent 50%);background-position:calc(100% - 17px) 19px,calc(100% - 12px) 19px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}" +
      "#pe-settings .pe-count{font-size:10px;color:rgba(255,255,255,.4);text-align:right;font-variant-numeric:tabular-nums}" +
      "#pe-settings .pe-avrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}" +
      "#pe-settings .pe-avprev{width:72px;height:72px;flex:0 0 72px;border-radius:20px;object-fit:cover;background:#1c1530;border:1px solid rgba(255,255,255,.12)}" +
      "#pe-settings .pe-avbtns{display:flex;gap:8px;flex-wrap:wrap}" +
      "#pe-settings .pe-hint{font-size:10px;color:rgba(255,255,255,.42);line-height:1.5;margin-top:7px}" +
      "#pe-settings .pe-foot{display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap}" +
      "#pe-settings .pe-foot .pe-msg{font-size:11px;flex:1;min-width:120px}" +
      "#pe-settings .pe-save{margin-left:auto;min-height:44px;padding:10px 22px;border-radius:11px;border:1px solid rgba(212,165,116,.45);background:linear-gradient(135deg,rgba(212,165,116,.28),rgba(245,158,11,.2));color:#f0d5a8;font:700 13px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}" +
      "#pe-settings .pe-save:hover{background:linear-gradient(135deg,rgba(212,165,116,.4),rgba(245,158,11,.3))}" +
      "#pe-settings .pe-cancel{min-height:44px;padding:10px 18px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);font:600 13px/1 inherit;cursor:pointer}" +
      "#pe-settings .pe-cancel:hover{background:rgba(255,255,255,.1);color:#fff}" +
      "#pe-settings .pe-save:disabled{opacity:.55;cursor:not-allowed}" +
      "#pe-settings .pe-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 14px;border-radius:10px;border:1px solid var(--ac-border,rgba(255,255,255,.12));background:rgba(255,255,255,.05);color:rgba(255,255,255,.82);font:600 12px/1 inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s}" +
      "#pe-settings .pe-btn:hover{background:rgba(255,255,255,.1);color:#fff}" +
      "#pe-settings .pe-btn-gold{border-color:rgba(212,165,116,.4);background:rgba(212,165,116,.12);color:#e8c89a}" +
      "#pe-settings .pe-btn-gold:hover{background:rgba(212,165,116,.2)}" +
      "#pe-settings .pe-sep{height:1px;background:rgba(255,255,255,.07);margin:20px 0 4px}" +
      /* social + custom links */
      "#pe-settings .pe-socialgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:7px}" +
      "#pe-settings .pe-socrow{display:flex;align-items:center;gap:8px;min-height:42px;padding:5px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}" +
      "#pe-settings .pe-socrow i{width:17px;text-align:center;font-size:11px;color:var(--ac-dim,rgba(255,255,255,.55))}" +
      "#pe-settings .pe-socrow input{flex:1;min-width:0;border:none;background:transparent;outline:none;color:#fff;font:400 12px/1.3 inherit;padding:6px 0}" +
      "#pe-settings .pe-socrow input::placeholder{color:rgba(255,255,255,.3)}" +
      "#pe-settings .pe-links{display:flex;flex-direction:column;gap:8px}" +
      "#pe-settings .pe-linkrow{display:flex;align-items:center;gap:7px}" +
      "#pe-settings .pe-linkrow input[type=text]{flex:1;min-width:0}" +
      "#pe-settings .pe-linkrow input.pe-linklab{flex:0 0 120px}" +
      "#pe-settings .pe-linkdel,#pe-settings .pe-addlink i{pointer-events:none}" +
      "#pe-settings .pe-linkdel{width:36px;height:36px;flex:0 0 36px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center}" +
      "#pe-settings .pe-linkdel:hover{color:#fca5a5;border-color:rgba(252,165,165,.35);background:rgba(252,165,165,.1)}" +
      "#pe-settings .pe-addlink{align-self:flex-start;min-height:38px;padding:8px 14px;border-radius:10px;border:1px dashed rgba(255,255,255,.2);background:rgba(255,255,255,.03);color:rgba(255,255,255,.7);font:600 11px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px}" +
      "#pe-settings .pe-addlink:hover{background:rgba(255,255,255,.08);color:#fff}" +
      /* visibility toggles */
      "#pe-settings .pe-priv{display:flex;flex-direction:column;gap:2px}" +
      "#pe-settings .pe-privrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}" +
      "#pe-settings .pe-privrow:first-child{border-top:none}" +
      "#pe-settings .pe-privtxt{flex:1;min-width:0}" +
      "#pe-settings .pe-privtxt b{display:block;font-size:12.5px;color:rgba(255,255,255,.92);font-weight:600}" +
      "#pe-settings .pe-privtxt span{display:block;font-size:10.5px;color:rgba(255,255,255,.45);margin-top:2px}" +
      "#pe-settings .pe-switch{position:relative;width:44px;height:24px;flex:0 0 44px}" +
      "#pe-settings .pe-switch input{opacity:0;width:0;height:0;position:absolute}" +
      "#pe-settings .pe-switch .slider{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.12);transition:background .2s;cursor:pointer}" +
      "#pe-settings .pe-switch .slider::before{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s cubic-bezier(.16,1,.3,1);box-shadow:0 2px 6px rgba(0,0,0,.3)}" +
      "#pe-settings .pe-switch input:checked + .slider{background:linear-gradient(135deg,#d4a574,#f59e0b)}" +
      "#pe-settings .pe-switch input:checked + .slider::before{transform:translateX(20px)}" +
      "#pe-settings .pe-switch input:focus-visible + .slider{outline:2px solid #22d3ee;outline-offset:2px}" +
      "@media(max-width:560px){#pe-settings{padding:12px;align-items:flex-end}#pe-settings .pe-panel{max-height:88vh;border-radius:20px;padding:18px}#pe-settings .pe-linkrow{flex-wrap:wrap}#pe-settings .pe-linkrow input.pe-linklab{flex:1 1 100%}#pe-settings .pe-socialgrid{grid-template-columns:1fr}}" +
      /* visually hidden but read out by screen readers */
      ".pe-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* --------------------------------------------------------------- helpers */
  function relTime(ts) {
    if (!ts) return "";
    var d = Date.now() - Date.parse(ts);
    if (isNaN(d) || d < 0) return "";
    var s = Math.floor(d / 1000);
    if (s < 60) return tt("justNow", "just now");
    if (s < 3600) return Math.floor(s / 60) + tt("minAgo", "m ago");
    if (s < 86400) return Math.floor(s / 3600) + tt("hourAgo", "h ago");
    if (s < 604800) return Math.floor(s / 86400) + tt("dayAgo", "d ago");
    return new Date(ts).toLocaleDateString();
  }

  function block(title, inner, id) {
    return '<div class="pv-block"' + (id ? ' id="' + id + '"' : "") + '><div class="pv-block-title">' + esc(title) + "</div>" + inner + "</div>";
  }

  /* Existing links reduced to a handle per platform, so the form is friendly. */
  function currentLinks() {
    var out = {};
    (state.links || []).forEach(function (l) {
      if (!l || !l.url) return;
      var key = String(l.label || "").trim().toLowerCase();
      var def = PLATFORM_BY_KEY[key];
      if (!def) return;                       /* unknown platform: not ours to edit */
      var value = l.url;
      if (def.base && value.indexOf(def.base) === 0) value = value.slice(def.base.length);
      else {
        var m = /^https?:\/\/(?:www\.)?[^/]+\/(.+)$/i.exec(value);
        if (m) value = m[1];
      }
      out[key] = value.replace(/\/+$/, "");
    });
    return out;
  }

  function updateStateLink(key, url) {
    var next = (state.links || []).filter(function (l) {
      return String((l && l.label) || "").trim().toLowerCase() !== key;
    });
    if (url) next.push({ label: key, url: url });
    state.links = next;
  }

  /* --------------------------------------------------------------- markup */
  function activityHtml(rows) {
    if (!rows || !rows.length) {
      return '<p class="pv-none">' + esc(tt("peNoActivity", "No activity yet - play some tracks, vote or reply in the Wanted Vault.")) + "</p>";
    }
    return rows.map(function (a) {
      var ico = ACT_ICON[a.type] || "fa-bolt";
      return '<div class="pe-act-item">'
        + '<span class="pe-act-ico"><i class="fas ' + ico + '" aria-hidden="true"></i></span>'
        + '<span class="pe-act-body">'
        + '<span class="pe-act-txt">' + esc(a.label || a.text || "Activity") + "</span>"
        + '<span class="pe-act-time">' + esc(a.time || relTime(a.ts)) + "</span>"
        + "</span></div>";
    }).join("");
  }

  function socialsHtml() {
    var have = currentLinks();
    return '<div class="pe-socialgrid">' + PLATFORMS.map(function (p) {
      return '<span class="pe-socrow"><i class="' + p.icon + '" aria-hidden="true"></i>'
        + '<input type="text" data-pe-soc="' + p.key + '" maxlength="300" spellcheck="false" autocomplete="off" aria-label="' + esc(p.label) + '" placeholder="' + esc(p.base ? p.label : "https:// link") + '" value="' + esc(have[p.key] || "") + '">'
        + "</span>";
    }).join("") + "</div>"
      + '<div class="pe-links" id="pe-links"></div>'
      + '<button type="button" class="pe-addlink" id="pe-addlink"><i class="fas fa-plus" aria-hidden="true"></i> ' + esc(tt("peAddCustomLink", "Add custom link")) + "</button>"
      + '<p class="pe-hint">' + esc(tt("peLinksHint", "Social handles are expanded to full links for you. Custom links need a label and a full https:// address.")) + "</p>";
  }

  function privacyHtml(flags) {
    var f = flags || {};
    return '<div class="pe-priv">' + PRIVACY_ITEMS.map(function (it) {
      var on = f[it[0]] == null ? true : Number(f[it[0]]) !== 0;
      return '<label class="pe-privrow"><span class="pe-privtxt"><b>' + esc(it[1]) + "</b><span>" + esc(it[2]) + "</span></span>"
        + '<span class="pe-switch"><input type="checkbox" data-pe-priv="' + it[0] + '"' + (on ? " checked" : "") + '><span class="slider"></span></span></label>';
    }).join("") + "</div>"
      + '<p class="pe-hint">' + esc(tt("pePrivacyHint", "Turn a section off and nobody else can see it on your profile.")) + "</p>";
  }

  function customLinkRowHtml(label, url) {
    return '<span class="pe-linkrow">'
      + '<input type="text" class="pe-linklab" data-pe-link-label maxlength="40" placeholder="' + esc(tt("peLinkLabel", "Label")) + '" value="' + esc(label || "") + '" aria-label="' + esc(tt("peLinkLabel", "Label")) + '">'
      + '<input type="text" data-pe-link-url maxlength="500" spellcheck="false" autocomplete="off" placeholder="https://" value="' + esc(url || "") + '" aria-label="' + esc(tt("peLinkUrl", "Link address")) + '">'
      + '<button type="button" class="pe-linkdel" aria-label="' + esc(tt("peRemoveLink", "Remove link")) + '" title="' + esc(tt("peRemoveLink", "Remove link")) + '"><i class="fas fa-trash" aria-hidden="true"></i></button>'
      + "</span>";
  }

  function addCustomLinkRow(label, url) {
    var host = document.getElementById("pe-links");
    if (!host) return;
    host.insertAdjacentHTML("beforeend", customLinkRowHtml(label, url));
    var rows = host.querySelectorAll("[data-pe-link-label]");
    if (rows.length) rows[rows.length - 1].focus();
  }

  /* Links that are not one of the known platforms are shown as custom rows, so
     nothing already saved can be lost by editing here. */
  function fillCustomLinks() {
    var host = document.getElementById("pe-links");
    if (host) host.innerHTML = "";
    var known = {};
    PLATFORMS.forEach(function (p) { known[p.key] = true; });
    (state.links || []).forEach(function (l) {
      if (!l || !l.url) return;
      var key = String(l.label || "").trim().toLowerCase();
      if (known[key]) return;
      addCustomLinkRow(String(l.label || ""), String(l.url || ""));
    });
  }

  /* Turn the link fields into the payload /api/account expects. Anything
     half-filled is reported instead of silently dropped. */
  function collectLinks() {
    var out = [];
    var problem = "";
    PLATFORMS.forEach(function (p) {
      var input = document.querySelector('[data-pe-soc="' + p.key + '"]');
      var v = input ? String(input.value || "").trim().replace(/^@+/, "") : "";
      if (!v) return;
      if (/^https?:\/\//i.test(v)) { out.push({ label: p.key, url: v.slice(0, 500) }); return; }
      if (!p.base) { if (!problem) problem = tt("peWebsiteNeedsLink", "Website needs a full link."); return; }
      if (!/^[A-Za-z0-9._-]+$/.test(v)) { if (!problem) problem = p.label + ": " + tt("peBadHandle", "that handle does not look right"); return; }
      out.push({ label: p.key, url: (p.base + v).slice(0, 500) });
    });
    var rows = document.querySelectorAll("#pe-links .pe-linkrow");
    for (var i = 0; i < rows.length; i++) {
      var lab = rows[i].querySelector("[data-pe-link-label]");
      var url = rows[i].querySelector("[data-pe-link-url]");
      var label = lab ? String(lab.value || "").trim().slice(0, 40) : "";
      var link = url ? String(url.value || "").trim().slice(0, 500) : "";
      if (!label && !link) continue;
      if (!label) { if (!problem) problem = tt("peLinkNeedsLabel", "A custom link needs a label."); continue; }
      if (!/^https?:\/\//i.test(link)) { if (!problem) problem = label + ": " + tt("peLinkNeedsUrl", "needs a full https:// link"); continue; }
      out.push({ label: label, url: link });
    }
    if (out.length > 12 && !problem) problem = tt("peTooManyLinks", "You can save up to 12 links.");
    return { links: out.slice(0, 12), problem: problem };
  }

  /* ---------------------------------------------------------------- mount */
  function mount() {
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile() || !state.uid) return;
    css();

    var old = document.getElementById(WID);
    if (old) old.remove();

    dressHeader(body);

    /* The page keeps one block: your activity. Everything else you can change
       lives behind the settings cog. */
    var wrap = document.createElement("div");
    wrap.id = WID;
    wrap.innerHTML = block(tt("peActivity", "Recent activity"), '<div class="pv-act">' + activityHtml(state.activity) + "</div>", "pe-activity");
    body.appendChild(wrap);
  }

  /* The card used to ship a row of buttons (WRLD Player, The Vault, Edit
     Profile, Sign Out). They are gone: the cog in the header replaces Edit
     Profile, and Sign Out is in the account menu and mobile profile popup. */
  function dressHeader(body) {
    var row = body.querySelector(".cmp-actions");
    if (row && row.parentNode) row.parentNode.removeChild(row);

    var head = body.querySelector(".cmp-head");
    if (!head) return;

    /* cover art behind the header, when a banner is set */
    var oldCover = head.querySelector(".pe-cover");
    if (oldCover) oldCover.parentNode.removeChild(oldCover);
    if (state.banner) {
      var cover = document.createElement("span");
      cover.className = "pe-cover";
      cover.setAttribute("aria-hidden", "true");
      cover.style.backgroundImage = 'url("' + String(state.banner).replace(/"/g, "%22") + '")';
      head.insertBefore(cover, head.firstChild);
    }

    var nameRow = head.querySelector(".cmp-name-row");
    if (!nameRow) return;

    var oldBtns = nameRow.querySelector(".pe-headbtns");
    if (oldBtns) oldBtns.parentNode.removeChild(oldBtns);

    var btns = document.createElement("span");
    btns.className = "pe-headbtns";

    var pen = document.createElement("button");
    pen.type = "button";
    pen.className = "pe-iconbtn";
    pen.title = tt("peSettings", "Profile settings");
    pen.setAttribute("aria-label", tt("peSettings", "Profile settings"));
    pen.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i>';
    pen.addEventListener("click", function (e) { e.preventDefault(); openPanel(); });

    var cog = document.createElement("button");
    cog.type = "button";
    cog.className = "pe-iconbtn";
    cog.id = "pe-header-settings";
    cog.title = tt("peSettings", "Profile settings");
    cog.setAttribute("aria-label", tt("peSettings", "Profile settings"));
    cog.innerHTML = '<i class="fas fa-gear" aria-hidden="true"></i>';
    cog.addEventListener("click", function (e) { e.preventDefault(); openPanel(); });

    btns.appendChild(pen);
    btns.appendChild(cog);
    nameRow.appendChild(btns);
  }

  /* ============================================================== PANEL === */
  /* Owns the pencil and the cog. Built on <body> so it can never be hidden by a
     page section, and it saves through the same endpoints the Account Settings
     editor uses. */

  function buildPanel() {
    css();
    var ov = document.getElementById(PANEL_ID);
    if (ov) return ov;

    ov = document.createElement("div");
    ov.id = PANEL_ID;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "pe-panel-title");
    ov.innerHTML =
      '<div class="pe-panel">'
      + '<div class="pe-phead">'
      + '<h3 id="pe-panel-title"><i class="fas fa-gear" aria-hidden="true"></i> ' + esc(tt("peSettings", "Profile settings")) + "</h3>"
      + '<button type="button" class="pe-x" data-pe-close aria-label="' + esc(tt("cancel", "Close")) + '"><i class="fas fa-xmark" aria-hidden="true"></i></button>'
      + "</div>"
      /* picture */
      + '<div class="pe-fld"><span class="pe-lbl">' + esc(tt("pePicture", "Profile picture")) + "</span>"
      + '<div class="pe-avrow">'
      + '<img class="pe-avprev" id="pe-av" alt="">'
      + '<div class="pe-avbtns">'
      + '<button type="button" class="pe-btn pe-btn-gold" id="pe-av-btn"><i class="fas fa-camera" aria-hidden="true"></i> ' + esc(tt("peChangePic", "Change picture")) + "</button>"
      + '<button type="button" class="pe-btn" id="pe-av-remove"><i class="fas fa-eraser" aria-hidden="true"></i> ' + esc(tt("peRemovePic", "Remove")) + "</button>"
      + '<input type="file" id="pe-av-file" accept="image/jpeg,image/png,image/webp" style="display:none">'
      + "</div></div>"
      + '<p class="pe-hint">' + esc(tt("pePicNote", "JPG, PNG or WebP. Resized to 256x256 in your browser before upload.")) + "</p></div>"
      /* name */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-name">' + esc(tt("name", "Name")) + "</label>"
      + '<input type="text" id="pe-name" maxlength="24" autocomplete="off" spellcheck="false"></div>'
      /* status */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-status">' + esc(tt("status", "Status")) + "</label>"
      + '<select id="pe-status">' + STATUSES.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("") + "</select></div>"
      /* bio */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-bio">' + esc(tt("bio", "Bio")) + "</label>"
      + '<textarea id="pe-bio" rows="3" maxlength="300" placeholder="' + esc(tt("peBioPh", "Tell the 999s who you are")) + '"></textarea>'
      + '<span class="pe-count" id="pe-count">0/300</span></div>'
      /* links */
      + '<div class="pe-sep" role="presentation"></div>'
      + '<div class="pe-fld"><span class="pe-lbl">' + esc(tt("peLinks", "Links")) + "</span>"
      + socialsHtml()
      + "</div>"
      /* visibility */
      + '<div class="pe-sep" role="presentation"></div>'
      + '<div class="pe-fld"><span class="pe-lbl">' + esc(tt("peVisibility", "Profile visibility")) + "</span>"
      + '<div id="pe-priv">' + privacyHtml(state.privacy) + "</div></div>"
      /* footer */
      + '<div class="pe-foot">'
      + '<span class="pe-msg" id="pe-msg" aria-live="polite"></span>'
      + '<button type="button" class="pe-cancel" data-pe-close>' + esc(tt("cancel", "Cancel")) + "</button>"
      + '<button type="button" class="pe-save" id="pe-save"><i class="fas fa-check" aria-hidden="true"></i> ' + esc(tt("save", "Save")) + "</button>"
      + "</div></div>";

    document.body.appendChild(ov);

    ov.addEventListener("click", function (e) {
      if (e.target === ov) { closePanel(); return; }
      if (e.target.closest && e.target.closest("[data-pe-close]")) { closePanel(); return; }
      if (e.target.closest && e.target.closest("#pe-av-btn")) { var f = document.getElementById("pe-av-file"); if (f) f.click(); return; }
      if (e.target.closest && e.target.closest("#pe-av-remove")) { avatarDraft = ""; paintPanelAvatar(); setMsg(tt("pePicWillClear", "Picture will be removed when you save."), ""); return; }
      if (e.target.closest && e.target.closest("#pe-addlink")) { addCustomLinkRow(); return; }
      var del = e.target.closest ? e.target.closest(".pe-linkdel") : null;
      if (del) { var row = del.closest(".pe-linkrow"); if (row && row.parentNode) row.parentNode.removeChild(row); return; }
      var sw = e.target.closest ? e.target.closest("[data-pe-priv]") : null;
      if (sw) togglePrivacy(sw);
    });

    ov.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closePanel(); return; }
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT" && e.target.type === "text" && e.target.hasAttribute("data-pe-soc")) {
        e.preventDefault();
        savePanel();
        return;
      }
      if (e.key !== "Tab") return;
      var f = ov.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    var bio = document.getElementById("pe-bio");
    var count = document.getElementById("pe-count");
    if (bio && count) bio.addEventListener("input", function () { count.textContent = bio.value.length + "/300"; });

    var fileIn = document.getElementById("pe-av-file");
    if (fileIn) fileIn.addEventListener("change", function (e) { panelAvatarFile(e.target.files && e.target.files[0]); });

    var save = document.getElementById("pe-save");
    if (save) save.addEventListener("click", savePanel);

    return ov;
  }

  function paintPanelAvatar() {
    var img = document.getElementById("pe-av");
    if (!img) return;
    var src = avatarDraft || state.avatar;
    if (src) img.src = src;
    else img.removeAttribute("src");
  }

  function panelAvatarFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setMsg(tt("pePicType", "Only JPG, PNG and WebP images are allowed."), "err"); return; }
    if (file.size > 8 * 1024 * 1024) { setMsg(tt("pePicBig", "That image is too large (max 8MB)."), "err"); return; }
    setMsg(tt("pePicResizing", "Resizing..."), "");
    resize(file, function (dataUrl) {
      if (!dataUrl) { setMsg(tt("pePicBad", "That image could not be read."), "err"); return; }
      avatarDraft = dataUrl;
      paintPanelAvatar();
      setMsg(tt("pePicReady", "Picture ready - press Save to keep it."), "ok");
    });
  }

  function setMsg(text, kind) {
    var el = document.getElementById("pe-msg");
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === "err" ? "#fca5a5" : kind === "ok" ? "#86efac" : "rgba(255,255,255,.45)";
  }

  /* Visibility toggles save on their own, so flipping one never waits for
     (or gets rolled back by) the rest of the panel. */
  function togglePrivacy(box) {
    var key = box.getAttribute("data-pe-priv");
    var payload = {};
    payload[key] = box.checked ? 1 : 0;
    api("/api/privacy", payload)
      .then(function (r) {
        var d = r.data || {};
        if (r.status < 200 || r.status >= 300 || d.ok === false) {
          box.checked = !box.checked;             /* put it back */
          setMsg((d.error || tt("peSaveFailed", "Could not save that")) + ".", "err");
          return;
        }
        var flags = d.privacy || (state.privacy || {});
        state.privacy = flags;
        toast(tt("peVisibilitySaved", "Visibility saved"), "success");
      });
  }

  var lastFocus = null;

  function openPanel() {
    var ov = buildPanel();
    var name = document.getElementById("pe-name");
    var status = document.getElementById("pe-status");
    var bio = document.getElementById("pe-bio");
    var count = document.getElementById("pe-count");
    if (name) name.value = state.name || "";
    if (status) status.value = STATUSES.indexOf(state.status) >= 0 ? state.status : "Online";
    if (bio) bio.value = state.bio || "";
    if (count) count.textContent = (state.bio || "").length + "/300";
    PLATFORMS.forEach(function (p) {
      var input = document.querySelector('[data-pe-soc="' + p.key + '"]');
      if (input) input.value = currentLinks()[p.key] || "";
    });
    fillCustomLinks();
    paintVisibility();
    avatarDraft = state.avatar || "";
    paintPanelAvatar();
    setMsg("", "");
    var btn = document.getElementById("pe-save");
    if (btn) btn.disabled = false;
    lastFocus = document.activeElement;
    ov.classList.add("open");
    try { document.documentElement.classList.add("scroll-locked"); } catch (e) {}
    if (name) setTimeout(function () { name.focus(); }, 30);
  }

  function paintVisibility() {
    var host = document.getElementById("pe-priv");
    if (host) host.innerHTML = privacyHtml(state.privacy);
  }

  function closePanel() {
    var ov = document.getElementById(PANEL_ID);
    if (!ov) return;
    ov.classList.remove("open");
    try { document.documentElement.classList.remove("scroll-locked"); } catch (e) {}
    avatarDraft = "";
    var btn = document.getElementById("pe-save");
    if (btn) btn.disabled = false;                 /* always re-arm Save */
    var msg = document.getElementById("pe-msg");
    if (msg) { msg.textContent = ""; msg.style.color = "rgba(255,255,255,.45)"; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function panelOpen() {
    var ov = document.getElementById(PANEL_ID);
    return !!(ov && ov.classList.contains("open"));
  }

  function savePanel() {
    if (!state.uid) return;
    var btn = document.getElementById("pe-save");
    if (btn) btn.disabled = true;
    setMsg(tt("peSaving", "Saving..."), "");

    var nameEl = document.getElementById("pe-name");
    var statusEl = document.getElementById("pe-status");
    var bioEl = document.getElementById("pe-bio");
    var name = nameEl ? nameEl.value.trim().slice(0, 24) : "";
    var status = statusEl ? statusEl.value : "Online";
    var bio = bioEl ? bioEl.value.trim().slice(0, 300) : "";
    /* An empty name would blank the profile, so keep the current one. */
    if (!name) name = state.name;

    /* avatar + banner go through the same action the Account Settings editor
       uses. banner is echoed back so saving never clears it. */
    var avatar = avatarDraft || state.avatar || "";

    var linkData = collectLinks();
    if (linkData.problem) {
      setMsg(linkData.problem, "err");
      if (btn) btn.disabled = false;
      return;
    }

    api("/api/account", { action: "updateProfile", name: name, status: status, bio: bio, avatar: avatar, banner: state.banner || "" })
      .then(function (r) {
        var d = r.data || {};
        if (r.status < 200 || r.status >= 300 || d.ok === false) {
          setMsg((d.error || tt("peSaveFailed", "Could not save your profile")) + ".", "err");
          if (btn) btn.disabled = false;
          return;
        }
        state.name = name;
        state.status = status;
        state.bio = bio;
        state.avatar = avatar;
        applyProfileEverywhere();
        setMsg(tt("peSaved", "Saved"), "ok");
        /* Links are a second write so a link problem never costs you the bio. */
        return api("/api/account", { action: "saveLinks", links: linkData.links }).then(function (lr) {
          var ld = lr.data || {};
          if (lr.status >= 200 && lr.status < 300 && ld.ok !== false) state.links = linkData.links;
          setTimeout(function () {
            closePanel();
            toast(tt("peProfileSaved", "Profile updated"), "success");
            load();
          }, 450);
        });
      });
  }

  /* ------------------------------------------------------- profile picture */
  function resize(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        /* Square centre crop, then downscale - same shape as the account page. */
        var side = Math.min(img.width, img.height);
        var canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        cb(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  /* Mirrors the markup account.js uses, so a picture change shows up in the
     profile card, the nav pill and the mobile tab without a reload. */
  function paintAvatar(container, src, name, radius) {
    if (!container) return;
    container.innerHTML = src
      ? '<img src="' + esc(src) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:' + (radius || "inherit") + '">'
      : esc(initial(name));
  }

  function applyAvatarEverywhere(src) {
    var nameNode = document.querySelector("#profilePageBody .cmp-name");
    var name = (nameNode && nameNode.textContent) || "";
    paintAvatar(document.getElementById("profileAvatarInner"), src, name, "inherit");
    paintAvatar(document.getElementById("navAvatarInner"), src, name, "inherit");
    paintAvatar(document.getElementById("mbnAvatarInner"), src, name, "50%");
    var card = document.querySelector("#profilePageBody .cmp-avatar");
    if (card) card.innerHTML = src ? '<img src="' + esc(src) + '" alt="">' : esc(initial(name));
  }

  /* Push the new values into the profile card, the nav and the mobile tab. */
  function applyProfileEverywhere() {
    var card = document.getElementById("profilePageBody");
    if (!card) return;
    var nameNode = card.querySelector(".cmp-name");
    if (nameNode && state.name) nameNode.textContent = state.name;
    var bioNode = card.querySelector(".cmp-bio");
    if (bioNode) bioNode.textContent = state.bio || tt("cmpNoBio", "No bio yet - let the 999s know who you are.");
    var handle = card.querySelector(".cmp-handle");
    if (handle) handle.textContent = "@" + String(state.name || state.uid).toLowerCase();
    var dot = card.querySelector(".cmp-online");
    if (dot) {
      var c = state.status === "Online" ? "#10b981" : state.status === "Idle" ? "#f59e0b" : state.status === "Do Not Disturb" ? "#ef4444" : "#64748b";
      dot.style.background = c;
      dot.style.boxShadow = "0 0 10px " + c;
    }
    applyAvatarEverywhere(state.avatar || "");
    var navName = document.getElementById("profileName");
    if (navName && state.name) navName.textContent = state.name;
    var navHandle = document.getElementById("profileHandle");
    if (navHandle && state.name) navHandle.textContent = "@" + String(state.name).toLowerCase();
  }

  /* Take over the pencil button. The old handler opened #editProfileModal,
     which lives inside the (hidden) Account section, so nothing appeared. */
  function installEditorButton() {
    var orig = window.openEditProfile;
    var wrapped = function () {
      if (onProfilePage() && !panelOpen()) { openPanel(); return; }
      /* Anywhere else that modal is trapped, so send the visitor to the page
         that actually owns it first. */
      var sec = document.getElementById("page-section-account");
      var active = sec && sec.classList.contains("active");
      if (!active) {
        if (window.switchAppPage) window.switchAppPage("account");
        setTimeout(function () { if (orig) orig(); else toast(tt("peGoToAccount", "Open Account Settings to edit your profile"), "info"); }, 260);
        return;
      }
      if (orig) orig();
    };
    window.openEditProfile = wrapped;
    window.openProfileEditor = openPanel;   /* also callable directly */
  }

  /* ----------------------------------------------------------------- load */
  var loading = false;
  function load(cb) {
    if (loading) { if (cb) setTimeout(cb, 300); return; }
    if (!isSelfProfile()) return;
    var uid = myUid();
    if (!uid) return;
    loading = true;

    fetch("/api/account?user=" + encodeURIComponent(uid), { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) {
        loading = false;
        /* Editing tools need a real session: guests get a uid too, but every
           save would come back 401. isSessionOwner is decided by the server. */
        if (!d || !d.ok || !d.isSessionOwner) return;
        var prof = d.profile || {};
        state = {
          uid: uid,
          name: prof.name || "",
          bio: prof.bio || "",
          status: prof.status || "Online",
          avatar: prof.avatar || ((d.discord && d.discord.avatar) || ""),
          banner: prof.banner || "",
          links: d.links || [],
          activity: d.activity || [],
          privacy: d.privacy || null,
        };
        mount();
        if (cb) cb();
        /* visibility lives in its own endpoint; fill it in when it answers */
        if (!state.privacy) {
          getJson("/api/privacy").then(function (p) {
            if (p && p.ok) {
              state.privacy = p.privacy || {};
              if (panelOpen()) paintVisibility();
            }
          });
        }
      });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    installEditorButton();

    /* account.js re-renders the profile body, so mount again after each render. */
    try {
      var orig = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (orig) orig(); } catch (e) {}
        setTimeout(load, 400);
      };
    } catch (e) {}

    /* Matches how the other profile widgets attach: watch the profile section
       become active. */
    var section = document.getElementById("page-section-profile");
    if (section && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (!section.classList.contains("active")) return;
        try { observer.disconnect(); } catch (e) {}
        setTimeout(load, 300);
      });
      observer.observe(section, { attributes: true, attributeFilter: ["class"] });
    }

    window.refreshProfileEnhancements = load;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();