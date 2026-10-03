/* ============================================================================
   Profile Enhancements - richer profiles + a working Edit profile button.

   Adds four things to your own profile page, all backed by real server state
   (nothing is stored in the browser):

     1. Edit profile   - the pencil button opens a real editor for name,
                        status, bio and picture. The existing Edit Profile
                        button used to call window.openEditProfile(), which
                        opens #editProfileModal - a modal that lives inside
                        #page-section-account and is therefore invisible from
                        anywhere else, so the button did nothing. This file
                        owns the button and opens an editor that is never
                        trapped.
     2. Recent activity - your own activity feed (plays, favorites, playlists,
                        votes, downloads, profile + security changes).
     3. Social links    - inline editor for your links, saved through
                        POST /api/profile { action: "update_social" } which
                        validates the platform and the URL server-side.
     4. Profile picture - change or remove it, resized in the browser and
                        saved through update_avatar.

   Self profiles only: on anyone else's profile this file does nothing.

   Loaded as `<script src="./profile-enhancements.js" defer>` from index.html.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__profileEnhancementsMounted) return;
  window.__profileEnhancementsMounted = true;

  var WID = "profile-enhancements";
  var EDITOR_ID = "pe-editor";
  var STATUSES = ["Online", "Idle", "Do Not Disturb", "Invisible"];

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

  /* Latest known profile state, so the editor can pre-fill and save safely. */
  var state = { uid: "", name: "", bio: "", status: "Online", avatar: "", banner: "", links: [], activity: [] };
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
      /* ---- editor overlay (lives on <body>, so it is never trapped) ---- */
      "#pe-editor{position:fixed;inset:0;z-index:420;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(5,2,12,.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}" +
      "#pe-editor.open{display:flex}" +
      "#pe-editor .pe-panel{width:100%;max-width:520px;max-height:calc(100vh - 36px);overflow-y:auto;box-sizing:border-box;border-radius:22px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(22,18,40,.98),rgba(12,10,24,.98));box-shadow:0 30px 90px rgba(0,0,0,.6);padding:22px}" +
      "#pe-editor h3{margin:0;font-size:17px;font-weight:800;color:rgba(255,255,255,.95);display:flex;align-items:center;gap:9px}" +
      "#pe-editor h3 i{color:var(--ac-gold,#d4a574);font-size:13px}" +
      "#pe-editor .pe-x{margin-left:auto;width:32px;height:32px;flex:0 0 32px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}" +
      "#pe-editor .pe-x:hover{color:#fff;background:rgba(255,255,255,.1)}" +
      "#pe-editor .pe-fld{margin-top:16px;display:flex;flex-direction:column;gap:6px;min-width:0}" +
      "#pe-editor .pe-lbl{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ac-dim,rgba(255,255,255,.5))}" +
      "#pe-editor input[type=text],#pe-editor select,#pe-editor textarea{width:100%;box-sizing:border-box;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font:400 13px/1.4 inherit;padding:11px 12px;outline:none}" +
      "#pe-editor input[type=text]:focus,#pe-editor select:focus,#pe-editor textarea:focus{border-color:rgba(34,211,238,.5)}" +
      "#pe-editor textarea{resize:vertical;min-height:82px}" +
      "#pe-editor select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,rgba(255,255,255,.5) 50%),linear-gradient(135deg,rgba(255,255,255,.5) 50%,transparent 50%);background-position:calc(100% - 17px) 19px,calc(100% - 12px) 19px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}" +
      "#pe-editor .pe-count{font-size:10px;color:rgba(255,255,255,.4);text-align:right;font-variant-numeric:tabular-nums}" +
      "#pe-editor .pe-avrow{display:flex;align-items:center;gap:14px}" +
      "#pe-editor .pe-avprev{width:72px;height:72px;flex:0 0 72px;border-radius:20px;object-fit:cover;background:#1c1530;border:1px solid rgba(255,255,255,.12)}" +
      "#pe-editor .pe-avbtns{display:flex;gap:8px;flex-wrap:wrap}" +
      "#pe-editor .pe-hint{font-size:10px;color:rgba(255,255,255,.42);line-height:1.5;margin-top:7px}" +
      "#pe-editor .pe-foot{display:flex;align-items:center;gap:10px;margin-top:22px;flex-wrap:wrap}" +
      "#pe-editor .pe-foot .pe-msg{font-size:11px;flex:1;min-width:120px}" +
      "#pe-editor .pe-save{margin-left:auto;min-height:44px;padding:10px 22px;border-radius:11px;border:1px solid rgba(212,165,116,.45);background:linear-gradient(135deg,rgba(212,165,116,.28),rgba(245,158,11,.2));color:#f0d5a8;font:700 13px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}" +
      "#pe-editor .pe-save:hover{background:linear-gradient(135deg,rgba(212,165,116,.4),rgba(245,158,11,.3))}" +
      "#pe-editor .pe-cancel{min-height:44px;padding:10px 18px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);font:600 13px/1 inherit;cursor:pointer}" +
      "#pe-editor .pe-cancel:hover{background:rgba(255,255,255,.1);color:#fff}" +
      "#pe-editor .pe-save:disabled{opacity:.55;cursor:not-allowed}" +
      "@media(max-width:480px){#pe-editor{padding:12px;align-items:flex-end}#pe-editor .pe-panel{max-height:88vh;border-radius:20px;padding:18px}}" +
      /* ---- activity feed ---- */
      ".pe-act-item{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}" +
      ".pe-act-item:last-child{border-bottom:none}" +
      ".pe-act-ico{width:28px;height:28px;border-radius:9px;flex:0 0 28px;display:flex;align-items:center;justify-content:center;font-size:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);color:var(--ac-gold,rgba(212,165,116,.9))}" +
      /* the text and the timestamp stack, they must not share a line */
      ".pe-act-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}" +
      ".pe-act-txt{display:block;font-size:12.5px;line-height:1.45;color:var(--ac-text,rgba(255,255,255,.9));overflow-wrap:anywhere}" +
      ".pe-act-time{display:block;font-size:10px;color:var(--ac-dim,rgba(255,255,255,.45));font-variant-numeric:tabular-nums}" +
      /* ---- profile picture ---- */
      ".pe-pic-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}" +
      ".pe-pic-preview{width:74px;height:74px;border-radius:18px;object-fit:cover;background:#1c1530;border:1px solid rgba(255,255,255,.1);flex:0 0 74px}" +
      ".pe-pic-side{min-width:0;flex:1 1 190px}" +
      ".pe-pic-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}" +
      ".pe-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 14px;border-radius:10px;border:1px solid var(--ac-border,rgba(255,255,255,.12));background:rgba(255,255,255,.05);color:rgba(255,255,255,.82);font:600 12px/1 inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s}" +
      ".pe-btn:hover{background:rgba(255,255,255,.1);color:#fff}" +
      ".pe-btn-gold{border-color:rgba(212,165,116,.4);background:rgba(212,165,116,.12);color:#e8c89a}" +
      ".pe-btn-gold:hover{background:rgba(212,165,116,.2)}" +
      ".pe-note{font-size:10px;color:rgba(255,255,255,.4);margin-top:7px;line-height:1.45}" +
      ".pe-note-err{color:#fca5a5}" +
      ".pe-note-ok{color:#86efac}" +
      /* ---- social links ---- */
      ".pe-socials{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:9px}" +
      ".pe-social{display:flex;align-items:center;gap:9px;min-height:44px;padding:6px 8px 6px 11px;border-radius:11px;border:1px solid var(--ac-border,rgba(255,255,255,.1));background:rgba(255,255,255,.04)}" +
      ".pe-social-ico{width:20px;text-align:center;font-size:12px;color:var(--ac-dim,rgba(255,255,255,.6));flex:0 0 20px}" +
      ".pe-social-in{flex:1;min-width:0;width:100%;border:none;background:transparent;outline:none;color:#fff;font:400 12px/1.3 inherit;padding:6px 0}" +
      ".pe-social-in::placeholder{color:rgba(255,255,255,.32)}" +
      ".pe-social-save{width:30px;height:30px;flex:0 0 30px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".pe-social-save:hover{color:#fff;background:rgba(255,255,255,.1)}" +
      ".pe-social-save.is-dirty{color:var(--ac-gold,#d4a574);border-color:rgba(212,165,116,.45)}" +
      /* one field + its save button share a line */
      ".pe-social-row{display:flex;align-items:center;gap:6px;min-width:0}" +
      ".pe-social-row .pe-social{flex:1 1 auto;min-width:0}" +
      /* visually hidden but read out by screen readers */
      ".pe-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}" +
      /* ---- profile header: background panel, pencil, layout switch ---- */
      /* The card renders no panel of its own, so the header gets one here. */
      "#profilePageBody .cmp-head{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--ac-border,rgba(255,255,255,.08));background:linear-gradient(150deg,rgba(255,255,255,.05),rgba(255,255,255,.015));box-shadow:0 18px 44px rgba(0,0,0,.28);padding:16px 18px 14px;margin-bottom:14px}" +
      "#profilePageBody .cmp-head .pe-cover{display:block;position:absolute;inset:0;z-index:0;opacity:.3;background-size:cover;background-position:center 30%;pointer-events:none}" +
      "#profilePageBody .cmp-head>*:not(.pe-cover){position:relative;z-index:1}" +
      "#profilePageBody .cmp-head .cmp-actions{display:none}" +
      /* the pencil lives beside the name, not in a row of buttons */
      "#profilePageBody .pe-pencil{width:30px;height:30px;flex:0 0 30px;margin-left:6px;border-radius:9px;border:1px solid var(--ac-border,rgba(255,255,255,.12));background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s,border-color .15s}" +
      "#profilePageBody .pe-pencil:hover{background:rgba(212,165,116,.16);border-color:rgba(212,165,116,.4);color:#e8c89a}" +
      "#profilePageBody .pe-pencil:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}" +
      /* layout switch */
      "#profilePageBody .pe-layout{display:inline-flex;gap:3px;padding:3px;border-radius:999px;border:1px solid var(--ac-border,rgba(255,255,255,.1));background:rgba(255,255,255,.04);margin-left:auto}" +
      "#profilePageBody .pe-layout button{min-height:26px;padding:4px 11px;border:none;border-radius:999px;background:transparent;color:rgba(255,255,255,.55);font:700 10px/1 inherit;letter-spacing:.04em;cursor:pointer;display:inline-flex;align-items:center;gap:5px}" +
      "#profilePageBody .pe-layout button i{font-size:9px}" +
      "#profilePageBody .pe-layout button:hover{color:rgba(255,255,255,.85)}" +
      "#profilePageBody .pe-layout button[aria-pressed=true]{background:linear-gradient(90deg,rgba(34,211,238,.2),rgba(59,130,246,.18));color:#67e8f9;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}" +
      "#profilePageBody .pe-layout button:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}" +
      "#profilePageBody .pe-head-tools{display:flex;align-items:center;gap:8px;margin-top:12px}" +
      /* ---- compact layout ---- */
      /* the avatar is sized by .cmp-avatar-ring - shrinking the inner elements
         instead would leave the ring at full size and overlap the text */
      "#profilePageBody.pe-compact .cmp-head{padding:12px 14px 10px;border-radius:15px}" +
      "#profilePageBody.pe-compact .cmp-top{gap:12px}" +
      "#profilePageBody.pe-compact .cmp-avatar-ring{width:54px;height:54px}" +
      "#profilePageBody.pe-compact .cmp-avatar{font-size:18px}" +
      "#profilePageBody.pe-compact .cmp-name{font-size:1.15rem}" +
      "#profilePageBody.pe-compact .cmp-bio{font-size:12px;margin-top:8px}" +
      "#profilePageBody.pe-compact .cmp-qstats{margin-top:10px;padding:8px 10px}" +
      "#profilePageBody.pe-compact .cmp-qstat b{font-size:1rem}" +
      "#profilePageBody.pe-compact .pe-block,.pe-block{padding:12px 14px}" +
      "#profilePageBody.pe-compact .pv-block{margin-top:14px}" +
      "#profilePageBody.pe-compact .cmp-sec-card{padding:14px}" +
      "#profilePageBody.pe-compact .cmp-page{gap:1rem}" +
      /* ---- custom links in the editor ---- */
      "#pe-editor .pe-links{display:flex;flex-direction:column;gap:8px}" +
      "#pe-editor .pe-linkrow{display:flex;align-items:center;gap:7px}" +
      "#pe-editor .pe-linkrow input[type=text]{flex:1;min-width:0}" +
      "#pe-editor .pe-linklab{flex:0 0 118px}" +
      "#pe-editor .pe-linkdel{width:34px;height:34px;flex:0 0 34px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center}" +
      "#pe-editor .pe-linkdel:hover{color:#fca5a5;border-color:rgba(252,165,165,.35);background:rgba(252,165,165,.1)}" +
      "#pe-editor .pe-addlink{align-self:flex-start;min-height:36px;padding:8px 14px;border-radius:10px;border:1px dashed rgba(255,255,255,.2);background:rgba(255,255,255,.03);color:rgba(255,255,255,.7);font:600 11px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px}" +
      "#pe-editor .pe-addlink:hover{background:rgba(255,255,255,.08);color:#fff}" +
      "#pe-editor .pe-socialgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:7px}" +
      "#pe-editor .pe-socrow{display:flex;align-items:center;gap:8px;min-height:40px;padding:5px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}" +
      "#pe-editor .pe-socrow i{width:17px;text-align:center;font-size:11px;color:var(--ac-dim,rgba(255,255,255,.55))}" +
      "#pe-editor .pe-socrow input{flex:1;min-width:0;border:none;background:transparent;outline:none;color:#fff;font:400 12px/1.3 inherit;padding:6px 0}" +
      "#pe-editor .pe-socrow input::placeholder{color:rgba(255,255,255,.3)}" +
      "@media(max-width:560px){#pe-editor .pe-linkrow{flex-wrap:wrap}#pe-editor .pe-linklab{flex:1 1 100%}#pe-editor .pe-socialgrid{grid-template-columns:1fr}}" +
      "@media(max-width:480px){.pe-socials{grid-template-columns:1fr}.pe-act-ico{width:26px;height:26px;flex:0 0 26px}}" +
      "@media(hover:none){.pe-btn:hover{background:rgba(255,255,255,.05)}.pe-social-save:hover{background:rgba(255,255,255,.05)}}";
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

  function currentLinks() {
    var out = {};
    (state.links || []).forEach(function (l) {
      if (!l || !l.url) return;
      var key = String(l.label || "").trim().toLowerCase();
      var def = PLATFORM_BY_KEY[key];
      if (!def) return;                       /* unknown platform: leave alone */
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
    return '<div class="pe-socials">' + PLATFORMS.map(function (p) {
      var id = "pe-soc-" + p.key;
      return '<div class="pe-social-row">'
        + '<label class="pe-social" for="' + id + '">'
        + '<i class="' + p.icon + " pe-social-ico\" aria-hidden=\"true\"></i>"
        + '<span class="pe-sr-only">' + esc(p.label) + "</span>"
        + '<input class="pe-social-in" id="' + id + '" data-pe-soc="' + p.key + '" data-pe-pristine="' + esc(have[p.key] || "") + '" type="text" inputmode="url" autocomplete="off" spellcheck="false" maxlength="300" placeholder="' + esc(p.base ? p.label + " username or link" : "https:// link") + '" value="' + esc(have[p.key] || "") + '">'
        + "</label>"
        + '<button type="button" class="pe-social-save" data-pe-soc-save="' + p.key + '" aria-label="' + esc("Save " + p.label) + '" title="' + esc("Save " + p.label) + '"><i class="fas fa-check" aria-hidden="true"></i></button>'
        + "</div>";
    }).join("") + "</div>"
      + '<p class="pe-note" data-pe-soc-note>' + esc(tt("peSocNote", "Saved to your profile and visible on it for everyone. Clear a field to remove that link.")) + "</p>";
  }

  function pictureHtml() {
    return '<div class="pe-pic-row">'
      + '<img class="pe-pic-preview" id="pe-pic-preview" src="' + esc(state.avatar || "Juice-WRLD.png") + '" alt="">'
      + '<div class="pe-pic-side">'
      + '<input type="file" id="pe-pic-file" accept="image/jpeg,image/png,image/webp" style="display:none">'
      + '<div class="pe-pic-actions">'
      + '<button type="button" class="pe-btn pe-btn-gold" id="pe-pic-btn"><i class="fas fa-camera" aria-hidden="true"></i> ' + esc(tt("peChangePic", "Change picture")) + "</button>"
      + '<button type="button" class="pe-btn" id="pe-pic-remove"><i class="fas fa-eraser" aria-hidden="true"></i> ' + esc(tt("peRemovePic", "Remove")) + "</button>"
      + "</div>"
      + '<p class="pe-note" id="pe-pic-note">' + esc(tt("pePicNote", "JPG, PNG or WebP. Resized to 256x256 in your browser before upload.")) + "</p>"
      + "</div></div>";
  }

  /* ---------------------------------------------------------------- mount */
  function mount() {
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile() || !state.uid) return;
    css();

    var old = document.getElementById(WID);
    if (old) old.remove();

    dressHeader(body);
    applyLayout(body);

    var wrap = document.createElement("div");
    wrap.id = WID;
    wrap.innerHTML =
      block(tt("pePicture", "Profile picture"), pictureHtml()) +
      block(tt("peSocials", "Social links"), socialsHtml()) +
      block(tt("peActivity", "Recent activity"), '<div class="pv-act">' + activityHtml(state.activity) + "</div>", "pe-activity");

    /* Append at the end of the profile body, before the privacy block if it is
       already there so the editing tools sit above it. */
    var privacy = document.getElementById("ws-privacy");
    if (privacy && privacy.parentNode) privacy.parentNode.insertBefore(wrap, privacy);
    else body.appendChild(wrap);

    bind(wrap);
  }

  /* The profile card ships a row of buttons (WRLD Player, The Vault, Edit
     Profile, Sign Out). They are gone: the pencil now lives in the header, and
     Sign Out is in the account menu and the mobile profile popup. */
  function stripActionRow(body) {
    var row = body.querySelector(".cmp-actions");
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  /* Give the header a real panel, add the pencil beside the name, and put the
     layout switch on the right. */
  function dressHeader(body) {
    stripActionRow(body);

    var head = body.querySelector(".cmp-head");
    if (!head) return;

    /* cover art behind the header, when a banner is set */
    var oldCover = head.querySelector(".pe-cover");
    if (oldCover) oldCover.parentNode.removeChild(oldCover);
    if (state.banner) {
      var cover = document.createElement("span");
      cover.className = "pe-cover";
      cover.setAttribute("aria-hidden", "true");
      cover.style.backgroundImage = 'url("' + state.banner.replace(/"/g, "%22") + '")';
      head.insertBefore(cover, head.firstChild);
    }

    /* pencil beside the name */
    var nameRow = head.querySelector(".cmp-name-row");
    if (nameRow && !nameRow.querySelector(".pe-pencil")) {
      var pen = document.createElement("button");
      pen.type = "button";
      pen.className = "pe-pencil";
      pen.id = "pe-header-edit";
      pen.title = tt("editProfile", "Edit Profile");
      pen.setAttribute("aria-label", tt("editProfile", "Edit Profile"));
      pen.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i>';
      pen.addEventListener("click", function (e) { e.preventDefault(); openEditor(); });
      nameRow.appendChild(pen);
    }

    /* layout switch */
    var tools = head.querySelector(".pe-head-tools");
    if (tools) tools.parentNode.removeChild(tools);
    tools = document.createElement("div");
    tools.className = "pe-head-tools";
    tools.innerHTML = '<div class="pe-layout" role="group" aria-label="' + esc(tt("peLayout", "Profile layout")) + '">'
      + '<button type="button" data-pe-layout="richer" aria-pressed="true"><i class="fas fa-tilt" aria-hidden="true"></i> ' + esc(tt("peRicher", "Richer")) + "</button>"
      + '<button type="button" data-pe-layout="compact" aria-pressed="false"><i class="fas fa-compress" aria-hidden="true"></i> ' + esc(tt("peCompact", "Compact")) + "</button>"
      + "</div>";
    tools.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-pe-layout]") : null;
      if (!b) return;
      setLayout(b.getAttribute("data-pe-layout"), body);
    });
    head.appendChild(tools);
  }

  var LAYOUT_KEY = "pe_profile_layout";

  function currentLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) === "compact" ? "compact" : "richer"; } catch (e) { return "richer"; }
  }

  function setLayout(mode, body) {
    if (mode !== "compact") mode = "richer";
    try { localStorage.setItem(LAYOUT_KEY, mode); } catch (e) {}
    applyLayout(body || document.getElementById("profilePageBody"));
  }

  function applyLayout(body) {
    if (!body) return;
    var mode = currentLayout();
    body.classList.toggle("pe-compact", mode === "compact");
    var switcher = body.querySelector(".pe-layout");
    if (switcher) {
      switcher.querySelectorAll("[data-pe-layout]").forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-pe-layout") === mode ? "true" : "false");
      });
    }
  }

  /* ----------------------------------------------------------------- bind */
  function bind(wrap) {
    var note = wrap.querySelector("[data-pe-soc-note]");
    var picNote = wrap.querySelector("#pe-pic-note");

    /* ---- social links ---- */
    /* The stored value is kept on data-pe-pristine when the block is built (and
       refreshed after every successful save), so "dirty" is a straight compare
       and Escape always has the real previous value to put back. */
    wrap.addEventListener("input", function (e) {
      var input = e.target.closest ? e.target.closest("[data-pe-soc]") : null;
      if (!input) return;
      var key = input.getAttribute("data-pe-soc");
      var save = wrap.querySelector('[data-pe-soc-save="' + key + '"]');
      if (save) save.classList.toggle("is-dirty", input.value !== input.getAttribute("data-pe-pristine"));
    });

    wrap.addEventListener("click", function (e) {
      var save = e.target.closest ? e.target.closest("[data-pe-soc-save]") : null;
      if (save) { saveSocial(wrap, save.getAttribute("data-pe-soc-save"), note); return; }
      if (e.target.closest && e.target.closest("#pe-pic-btn")) { var f = wrap.querySelector("#pe-pic-file"); if (f) f.click(); return; }
      if (e.target.closest && e.target.closest("#pe-pic-remove")) { removePicture(wrap, picNote); }
    });

    /* Enter saves, Escape reverts the field. */
    wrap.addEventListener("keydown", function (e) {
      var input = e.target.closest ? e.target.closest("[data-pe-soc]") : null;
      if (!input) return;
      var key = input.getAttribute("data-pe-soc");
      if (e.key === "Enter") { e.preventDefault(); saveSocial(wrap, key, note); }
      else if (e.key === "Escape") { revert(wrap, key); }
    });

    var file = wrap.querySelector("#pe-pic-file");
    if (file) file.addEventListener("change", function (e) { uploadPicture(wrap, e.target.files && e.target.files[0], picNote); });
  }

  function fieldValue(wrap, key) {
    var input = wrap.querySelector('[data-pe-soc="' + key + '"]');
    return input ? input.value : "";
  }

  function revert(wrap, key) {
    var input = wrap.querySelector('[data-pe-soc="' + key + '"]');
    if (!input) return;
    var pristine = input.getAttribute("data-pe-pristine");
    input.value = pristine == null ? "" : pristine;
    markClean(wrap, key);
  }

  /* After a successful save the stored value is the new baseline. */
  function acceptSaved(wrap, key, value) {
    var input = wrap.querySelector('[data-pe-soc="' + key + '"]');
    if (input) {
      input.value = value;
      input.setAttribute("data-pe-pristine", value);
    }
    markClean(wrap, key);
  }

  function markClean(wrap, key) {
    var save = wrap.querySelector('[data-pe-soc-save="' + key + '"]');
    if (save) save.classList.remove("is-dirty");
  }

  function saveSocial(wrap, key, note) {
    if (!PLATFORM_BY_KEY[key]) return;
    var value = fieldValue(wrap, key).trim();
    setNote(note, tt("peSaving", "Saving..."), "");

    api("/api/profile", { action: "update_social", platform: key, value: value })
      .then(function (r) {
        var d = r.data || {};
        if (r.status < 200 || r.status >= 300 || d.ok === false) {
          setNote(note, (d.error || tt("peSaveFailed", "Could not save that link")) + ".", "err");
          return;
        }
        /* The API normalises handles into full URLs - show what was stored. */
        var base = PLATFORM_BY_KEY[key].base;
        var stored = d.cleared ? "" : (base && d.url && d.url.indexOf(base) === 0 ? d.url.slice(base.length) : (d.url || ""));
        acceptSaved(wrap, key, stored);
        setNote(note, tt("peSaved", "Saved"), "ok");
        /* Keep our own copy current instead of re-fetching the whole account -
           that would rebuild the block and flash the page on every save. */
        updateStateLink(key, d.cleared ? "" : (d.url || ""));
        syncLinks();
      });
  }

  function updateStateLink(key, url) {
    var next = (state.links || []).filter(function (l) {
      return String((l && l.label) || "").trim().toLowerCase() !== key;
    });
    if (url) next.push({ label: key, url: url });
    state.links = next;
  }

  function setNote(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = "pe-note" + (kind === "err" ? " pe-note-err" : kind === "ok" ? " pe-note-ok" : "");
  }

  /* Keep the profile card's own link list in step with the editor. */
  function syncLinks() {
    var box = document.querySelector("#profilePageBody .cmp-links");
    if (!box) return;
    var links = [];
    PLATFORMS.forEach(function (p) {
      var v = (currentLinks()[p.key] || "");
      if (!v) return;
      links.push({ label: p.key, url: /^https?:\/\//i.test(v) ? v : p.base + v });
    });
    box.innerHTML = links.map(function (l) {
      return '<a class="cmp-link" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow">'
        + '<i class="fas fa-link"></i>' + esc(PLATFORM_BY_KEY[l.label] ? PLATFORM_BY_KEY[l.label].label : l.label)
        + '<i class="fas fa-arrow-up-right-from-square" style="margin-left:auto"></i></a>';
    }).join("");
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

  function uploadPicture(wrap, file, note) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setNote(note, tt("pePicType", "Only JPG, PNG and WebP images are allowed."), "err");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNote(note, tt("pePicBig", "That image is too large (max 8MB)."), "err");
      return;
    }
    setNote(note, tt("pePicResizing", "Resizing..."), "");
    resize(file, function (dataUrl) {
      if (!dataUrl) { setNote(note, tt("pePicBad", "That image could not be read."), "err"); return; }
      api("/api/profile", { action: "update_avatar", avatar: dataUrl })
        .then(function (r) {
          var d = r.data || {};
          if (r.status < 200 || r.status >= 300 || d.ok === false) {
            setNote(note, (d.error || tt("pePicFail", "Could not update your picture")) + ".", "err");
            return;
          }
          var preview = wrap.querySelector("#pe-pic-preview");
          if (preview) preview.src = dataUrl;
          state.avatar = dataUrl;
          applyAvatarEverywhere(dataUrl);
          setNote(note, tt("pePicSaved", "Profile picture updated"), "ok");
        });
    });
  }

  function removePicture(wrap, note) {
    setNote(note, tt("peSaving", "Saving..."), "");
    api("/api/profile", { action: "update_avatar", clear: true })
      .then(function (r) {
        var d = r.data || {};
        if (r.status < 200 || r.status >= 300 || d.ok === false) {
          setNote(note, (d.error || tt("pePicFail", "Could not remove your picture")) + ".", "err");
          return;
        }
        var preview = wrap.querySelector("#pe-pic-preview");
        if (preview) preview.src = "Juice-WRLD.png";
        state.avatar = "";
        applyAvatarEverywhere("");
        setNote(note, tt("pePicRemoved", "Picture removed"), "ok");
      });
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

  /* ============================================================== EDITOR == */
  /* Owns the pencil button on the profile card. Built on <body> so it can never
     be hidden by a page section, and it saves through the same endpoint the
     Account Settings editor uses. */

  function buildEditor() {
    css();
    if (document.getElementById(EDITOR_ID)) return document.getElementById(EDITOR_ID);

    var ov = document.createElement("div");
    ov.id = EDITOR_ID;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "pe-editor-title");
    ov.innerHTML =
      '<div class="pe-panel">'
      + '<h3 id="pe-editor-title"><i class="fas fa-pen" aria-hidden="true"></i> ' + esc(tt("editProfile", "Edit Profile")) + "</h3>"
      + '<button type="button" class="pe-x" data-pe-close aria-label="' + esc(tt("cancel", "Close")) + '"><i class="fas fa-xmark" aria-hidden="true"></i></button>'
      /* picture */
      + '<div class="pe-fld"><span class="pe-lbl">' + esc(tt("pePicture", "Profile picture")) + "</span>"
      + '<div class="pe-avrow">'
      + '<img class="pe-avprev" id="pe-ed-av" alt="">'
      + '<div class="pe-avbtns">'
      + '<button type="button" class="pe-btn pe-btn-gold" id="pe-ed-av-btn"><i class="fas fa-camera" aria-hidden="true"></i> ' + esc(tt("peChangePic", "Change picture")) + "</button>"
      + '<button type="button" class="pe-btn" id="pe-ed-av-remove"><i class="fas fa-eraser" aria-hidden="true"></i> ' + esc(tt("peRemovePic", "Remove")) + "</button>"
      + '<input type="file" id="pe-ed-av-file" accept="image/jpeg,image/png,image/webp" style="display:none">'
      + "</div></div>"
      + '<p class="pe-hint">' + esc(tt("pePicNote", "JPG, PNG or WebP. Resized to 256x256 in your browser before upload.")) + "</p></div>"
      /* name */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-ed-name">' + esc(tt("name", "Name")) + "</label>"
      + '<input type="text" id="pe-ed-name" maxlength="24" autocomplete="off" spellcheck="false"></div>'
      /* status */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-ed-status">' + esc(tt("status", "Status")) + "</label>"
      + '<select id="pe-ed-status">' + STATUSES.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("") + "</select></div>"
      /* bio */
      + '<div class="pe-fld"><label class="pe-lbl" for="pe-ed-bio">' + esc(tt("bio", "Bio")) + "</label>"
      + '<textarea id="pe-ed-bio" rows="3" maxlength="300" placeholder="' + esc(tt("peBioPh", "Tell the 999s who you are")) + '"></textarea>'
      + '<span class="pe-count" id="pe-ed-count">0/300</span></div>'
      /* ---- links: the known platforms plus any custom ones ---- */
      + '<div class="pe-fld"><span class="pe-lbl">' + esc(tt("peLinks", "Links")) + "</span>"
      + '<div class="pe-socialgrid">' + PLATFORMS.map(function (p) {
        return '<span class="pe-socrow"><i class="' + p.icon + '" aria-hidden="true"></i>'
          + '<input type="text" data-pe-ed-soc="' + p.key + '" maxlength="300" spellcheck="false" autocomplete="off" placeholder="' + esc(p.base ? p.label + " username or link" : "https:// link") + '">'
          + "</span>";
      }).join("") + "</div>"
      + '<div class="pe-links" id="pe-ed-links"></div>'
      + '<button type="button" class="pe-addlink" id="pe-ed-addlink"><i class="fas fa-plus" aria-hidden="true"></i> ' + esc(tt("peAddCustomLink", "Add custom link")) + "</button>"
      + '<p class="pe-hint">' + esc(tt("peLinksHint", "Social handles are expanded to full links for you. Custom links need a label and a full https:// address.")) + "</p></div>"
      /* footer */
      + '<div class="pe-foot">'
      + '<span class="pe-msg" id="pe-ed-msg" aria-live="polite"></span>'
      + '<button type="button" class="pe-cancel" data-pe-close>' + esc(tt("cancel", "Cancel")) + "</button>"
      + '<button type="button" class="pe-save" id="pe-ed-save"><i class="fas fa-check" aria-hidden="true"></i> ' + esc(tt("save", "Save")) + "</button>"
      + "</div></div>";

    document.body.appendChild(ov);

    ov.addEventListener("click", function (e) {
      if (e.target === ov) closeEditor();
      if (e.target.closest && e.target.closest("[data-pe-close]")) closeEditor();
      if (e.target.closest && e.target.closest("#pe-ed-av-btn")) { var f = document.getElementById("pe-ed-av-file"); if (f) f.click(); }
      if (e.target.closest && e.target.closest("#pe-ed-av-remove")) { avatarDraft = ""; paintEditorAvatar(); setEditorMsg(tt("pePicWillClear", "Picture will be removed when you save."), ""); }
      if (e.target.closest && e.target.closest("#pe-ed-addlink")) { addCustomLinkRow(); return; }
      var del = e.target.closest ? e.target.closest(".pe-linkdel") : null;
      if (del) { var row = del.closest(".pe-linkrow"); if (row && row.parentNode) row.parentNode.removeChild(row); }
    });
    ov.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closeEditor(); return; }
      if (e.key !== "Tab") return;
      /* keep focus inside the dialog while it is open */
      var f = ov.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    var bio = document.getElementById("pe-ed-bio");
    var count = document.getElementById("pe-ed-count");
    if (bio && count) {
      bio.addEventListener("input", function () { count.textContent = bio.value.length + "/300"; });
    }

    var fileIn = document.getElementById("pe-ed-av-file");
    if (fileIn) fileIn.addEventListener("change", function (e) { editorAvatarFile(e.target.files && e.target.files[0]); });

    var save = document.getElementById("pe-ed-save");
    if (save) save.addEventListener("click", saveEditor);

    return ov;
  }

  /* ---- custom link rows ---- */
  function customLinkRowHtml(label, url) {
    return '<span class="pe-linkrow">'
      + '<input type="text" class="pe-linklab" data-pe-link-label maxlength="40" placeholder="' + esc(tt("peLinkLabel", "Label")) + '" value="' + esc(label || "") + '" aria-label="' + esc(tt("peLinkLabel", "Label")) + '">'
      + '<input type="text" data-pe-link-url maxlength="500" spellcheck="false" autocomplete="off" placeholder="https://" value="' + esc(url || "") + '" aria-label="' + esc(tt("peLinkUrl", "Link address")) + '">'
      + '<button type="button" class="pe-linkdel" aria-label="' + esc(tt("peRemoveLink", "Remove link")) + '" title="' + esc(tt("peRemoveLink", "Remove link")) + '"><i class="fas fa-trash" aria-hidden="true"></i></button>'
      + "</span>";
  }

  function addCustomLinkRow(label, url) {
    var host = document.getElementById("pe-ed-links");
    if (!host) return;
    host.insertAdjacentHTML("beforeend", customLinkRowHtml(label, url));
    var rows = host.querySelectorAll("[data-pe-link-label]");
    if (rows.length) rows[rows.length - 1].focus();
  }

  /* Existing links that are not one of the known platforms are shown as custom
     rows, so nothing that is already saved can be lost by editing here. */
  function fillEditorLinks() {
    var host = document.getElementById("pe-ed-links");
    if (host) host.innerHTML = "";
    var known = {};
    PLATFORMS.forEach(function (p) { known[p.key] = true; });
    (state.links || []).forEach(function (l) {
      if (!l || !l.url) return;
      var key = String(l.label || "").trim().toLowerCase();
      if (known[key]) return;
      addCustomLinkRow(String(l.label || ""), String(l.url || ""));
    });
    PLATFORMS.forEach(function (p) {
      var input = document.querySelector('[data-pe-ed-soc="' + p.key + '"]');
      if (input) input.value = currentLinks()[p.key] || "";
    });
  }

  /* Turn the editor's link fields into the payload /api/account expects.
     Anything half-filled is reported instead of silently dropped. */
  function collectEditorLinks() {
    var out = [];
    var problem = "";
    PLATFORMS.forEach(function (p) {
      var input = document.querySelector('[data-pe-ed-soc="' + p.key + '"]');
      var v = input ? String(input.value || "").trim().replace(/^@+/, "") : "";
      if (!v) return;
      if (/^https?:\/\//i.test(v)) { out.push({ label: p.key, url: v.slice(0, 500) }); return; }
      if (!p.base) { if (!problem) problem = tt("peWebsiteNeedsLink", "Website needs a full link."); return; }
      if (!/^[A-Za-z0-9._-]+$/.test(v)) { if (!problem) problem = p.label + ": " + tt("peBadHandle", "that handle does not look right"); return; }
      out.push({ label: p.key, url: (p.base + v).slice(0, 500) });
    });
    var rows = document.querySelectorAll("#pe-ed-links .pe-linkrow");
    for (var i = 0; i < rows.length; i++) {
      var lab = rows[i].querySelector("[data-pe-link-label]");
      var url = rows[i].querySelector("[data-pe-link-url]");
      var label = lab ? String(lab.value || "").trim().slice(0, 40) : "";
      var link = url ? String(url.value || "").trim().slice(0, 500) : "";
      if (!label && !link) continue;                    /* empty row: ignore */
      if (!label) { if (!problem) problem = tt("peLinkNeedsLabel", "A custom link needs a label."); continue; }
      if (!/^https?:\/\//i.test(link)) { if (!problem) problem = label + ": " + tt("peLinkNeedsUrl", "needs a full https:// link"); continue; }
      out.push({ label: label, url: link });
    }
    /* the server keeps the first 12 */
    if (out.length > 12 && !problem) problem = tt("peTooManyLinks", "You can save up to 12 links.");
    return { links: out.slice(0, 12), problem: problem };
  }

  function paintEditorAvatar() {
    var img = document.getElementById("pe-ed-av");
    if (!img) return;
    var src = avatarDraft || state.avatar;
    if (src) img.src = src;
    else img.removeAttribute("src");
  }

  function editorAvatarFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setEditorMsg(tt("pePicType", "Only JPG, PNG and WebP images are allowed."), "err"); return; }
    if (file.size > 8 * 1024 * 1024) { setEditorMsg(tt("pePicBig", "That image is too large (max 8MB)."), "err"); return; }
    setEditorMsg(tt("pePicResizing", "Resizing..."), "");
    resize(file, function (dataUrl) {
      if (!dataUrl) { setEditorMsg(tt("pePicBad", "That image could not be read."), "err"); return; }
      avatarDraft = dataUrl;
      paintEditorAvatar();
      setEditorMsg(tt("pePicReady", "Picture ready - press Save to keep it."), "ok");
    });
  }

  function setEditorMsg(text, kind) {
    var el = document.getElementById("pe-ed-msg");
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === "err" ? "#fca5a5" : kind === "ok" ? "#86efac" : "rgba(255,255,255,.45)";
  }

  var lastFocus = null;

  function openEditor() {
    if (!state.uid) { load(function () { openEditor(); }); return; }
    var ov = buildEditor();
    var name = document.getElementById("pe-ed-name");
    var status = document.getElementById("pe-ed-status");
    var bio = document.getElementById("pe-ed-bio");
    var count = document.getElementById("pe-ed-count");
    if (name) name.value = state.name || "";
    if (status) status.value = STATUSES.indexOf(state.status) >= 0 ? state.status : "Online";
    if (bio) bio.value = state.bio || "";
    if (count) count.textContent = (state.bio || "").length + "/300";
    fillEditorLinks();
    avatarDraft = state.avatar || "";
    paintEditorAvatar();
    setEditorMsg("", "");
    lastFocus = document.activeElement;
    ov.classList.add("open");
    try { document.documentElement.classList.add("scroll-locked"); } catch (e) {}
    if (name) setTimeout(function () { name.focus(); }, 30);
  }

  function closeEditor() {
    var ov = document.getElementById(EDITOR_ID);
    if (!ov) return;
    ov.classList.remove("open");
    try { document.documentElement.classList.remove("scroll-locked"); } catch (e) {}
    avatarDraft = "";
    /* Save is disabled while a save is in flight - always re-arm it, otherwise
       the editor is dead the next time it is opened. */
    var btn = document.getElementById("pe-ed-save");
    if (btn) btn.disabled = false;
    var msg = document.getElementById("pe-ed-msg");
    if (msg) { msg.textContent = ""; msg.style.color = "rgba(255,255,255,.45)"; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function editorOpen() {
    var ov = document.getElementById(EDITOR_ID);
    return !!(ov && ov.classList.contains("open"));
  }

  function saveEditor() {
    if (!state.uid) return;
    var btn = document.getElementById("pe-ed-save");
    if (btn) btn.disabled = true;
    setEditorMsg(tt("peSaving", "Saving..."), "");

    var nameEl = document.getElementById("pe-ed-name");
    var statusEl = document.getElementById("pe-ed-status");
    var bioEl = document.getElementById("pe-ed-bio");
    var name = nameEl ? nameEl.value.trim().slice(0, 24) : "";
    var status = statusEl ? statusEl.value : "Online";
    var bio = bioEl ? bioEl.value.trim().slice(0, 300) : "";
    /* An empty name would blank the profile, so keep the current one. */
    if (!name) name = state.name;

    /* avatar + banner go through the same action the Account Settings editor
       uses. banner is echoed back so saving never clears it. */
    var avatar = avatarDraft || state.avatar || "";

    var linkData = collectEditorLinks();
    if (linkData.problem) {
      setEditorMsg(linkData.problem, "err");
      if (btn) btn.disabled = false;
      return;
    }

    api("/api/account", { action: "updateProfile", name: name, status: status, bio: bio, avatar: avatar, banner: state.banner || "" })
      .then(function (r) {
        var d = r.data || {};
        if (r.status < 200 || r.status >= 300 || d.ok === false) {
          setEditorMsg((d.error || tt("peSaveFailed", "Could not save your profile")) + ".", "err");
          if (btn) btn.disabled = false;
          return;
        }
        state.name = name;
        state.status = status;
        state.bio = bio;
        state.avatar = avatar;
        applyProfileEverywhere();
        setEditorMsg(tt("peSaved", "Saved"), "ok");
        /* Links are a second write so a link problem never costs you the bio. */
        return api("/api/account", { action: "saveLinks", links: linkData.links }).then(function (lr) {
          var ld = lr.data || {};
          if (lr.status >= 200 && lr.status < 300 && ld.ok !== false) state.links = linkData.links;
          setTimeout(function () {
            closeEditor();
            toast(tt("peProfileSaved", "Profile updated"), "success");
            load();
          }, 450);
        });
      });
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
      /* On your own profile, edit right here. */
      if (onProfilePage() && !editorOpen()) { openEditor(); return; }
      /* Anywhere else the modal is trapped, so send the visitor to the page
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
    window.openProfileEditor = openEditor;   /* also callable directly */
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
        };
        mount();
        if (cb) cb();
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

    /* Matches how the other profile widgets (privacy, stats, playlists) attach:
       watch the profile section become active. */
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