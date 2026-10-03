/* ============================================================================
   Profile Enhancements - richer profiles on your own page.

   Adds three things that the profile page was missing, all backed by real
   server state (nothing is stored in localStorage):

     1. Recent activity  - your own activity feed (plays, favorites, playlists,
        votes, downloads, profile + security changes). Other members already
        had this block; your own profile did not.
     2. Social links     - inline editor for your links, saved through
        POST /api/profile { action: "update_social" } which validates the
        platform and the URL server-side.
     3. Profile picture  - upload straight from the profile page, resized in
        the browser and saved through update_avatar.

   Self profiles only: when you are looking at someone else's profile this file
   does nothing at all.

   Loaded as `<script src="./profile-enhancements.js" defer>` from index.html.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__profileEnhancementsMounted) return;
  window.__profileEnhancementsMounted = true;

  var WID = "profile-enhancements";

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

  function myUid() {
    try { return localStorage.getItem("wantedUserId") || ""; } catch (e) { return ""; }
  }

  /* -------------------------------------------------------------- css */
  function css() {
    if (document.getElementById("profile-enh-style")) return;
    var st = document.createElement("style");
    st.id = "profile-enh-style";
    st.textContent =
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
      ".pe-btn:disabled{opacity:.5;cursor:not-allowed}" +
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

  /* Current links, keyed by platform, so the editor can pre-fill. */
  function linksByPlatform(links) {
    var out = {};
    (links || []).forEach(function (l) {
      if (!l || !l.url) return;
      var key = String(l.label || "").trim().toLowerCase();
      if (!key) return;
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

  function socialsHtml(links) {
    var have = linksByPlatform(links);
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

  function pictureHtml(avatar) {
    var src = avatar || "Juice-WRLD.png";
    return '<div class="pe-pic-row">'
      + '<img class="pe-pic-preview" id="pe-pic-preview" src="' + esc(src) + '" alt="">'
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
  function mount(state) {
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile() || !state.uid) return;
    css();

    var old = document.getElementById(WID);
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.id = WID;
    wrap.innerHTML =
      block(tt("pePicture", "Profile picture"), pictureHtml(state.avatar)) +
      block(tt("peSocials", "Social links"), socialsHtml(state.links)) +
      block(tt("peActivity", "Recent activity"), '<div class="pv-act">' + activityHtml(state.activity) + "</div>", "pe-activity");

    /* Append at the end of the profile body, before the privacy block if it is
       already there so the editing tools sit above it. */
    var privacy = document.getElementById("ws-privacy");
    if (privacy && privacy.parentNode) privacy.parentNode.insertBefore(wrap, privacy);
    else body.appendChild(wrap);

    bind(wrap);
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

  function currentValue(wrap, key) {
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
    var value = currentValue(wrap, key).trim();
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
        refreshLinks(wrap);
      });
  }

  function setNote(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = "pe-note" + (kind === "err" ? " pe-note-err" : kind === "ok" ? " pe-note-ok" : "");
  }

  /* Keep the profile card's own link list in step with the editor. */
  function refreshLinks(wrap) {
    var links = [];
    PLATFORMS.forEach(function (p) {
      var input = wrap.querySelector('[data-pe-soc="' + p.key + '"]');
      var v = input ? input.value.trim() : "";
      if (!v) return;
      links.push({ label: p.key, url: /^https?:\/\//i.test(v) ? v : p.base + v });
    });
    var box = document.querySelector("#profilePageBody .cmp-links");
    if (!box) return;
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

  /* ----------------------------------------------------------------- load */
  var loading = false;
  function load() {
    if (loading) return;
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
        mount({
          uid: uid,
          avatar: prof.avatar || (d.discord && d.discord.avatar) || "",
          links: d.links || [],
          activity: d.activity || [],
        });
      });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
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