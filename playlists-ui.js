/* Server Playlists manager — self-profile "My Playlists" card + public share view.
 * Full CRUD against /api/playlists (session-authed, ownership-checked server-side).
 * Share URLs look like ?playlist=<share_key>; opening one renders the public
 * playlist modal anywhere. Queue-all is desktop-only (fine pointer). */
(function () {
  "use strict";
  if (window.__playlistsUiMounted) return;
  window.__playlistsUiMounted = true;

  var WID = "ws-plmanager";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function getTL() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    try { if (window.trackList && window.trackList.length) return window.trackList; } catch (e2) {}
    return [];
  }

  function idxFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return i;
    }
    return -1;
  }

  function coverFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return (tl[i] || {}).cover || "";
    }
    return "";
  }

  function durFor(title) {
    var tl = getTL();
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < tl.length; i++) {
      if (String((tl[i] || {}).title || "").trim().toLowerCase() === low) return Number((tl[i] || {}).duration) || 0;
    }
    return 0;
  }

  function fmtDur(sec) {
    sec = Math.round(Number(sec) || 0);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function isDesktop() {
    try { return window.matchMedia && window.matchMedia("(pointer:fine)").matches; } catch (e) { return true; }
  }

  function isSelfProfile() {
    try {
      if (/^\/profile\/.+/.test(location.pathname || "")) return false;
      return !!document.getElementById("profilePageBody");
    } catch (e) { return false; }
  }

  function api(action, extra) {
    var body = { action: action };
    if (extra) for (var k in extra) body[k] = extra[k];
    return fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  function css() {
    if (document.getElementById("plui-style")) return;
    var st = document.createElement("style");
    st.id = "plui-style";
    st.textContent =
      ".plui-row{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03);border-radius:12px;padding:10px;margin-bottom:8px}" +
      ".plui-top{display:flex;align-items:center;gap:8px}" +
      ".plui-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;background:#a855f7}" +
      ".plui-name{flex:1;min-width:0;font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".plui-meta{font-size:10px;color:rgba(255,255,255,.5);font-family:monospace;flex-shrink:0}" +
      ".plui-vis{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:9999px;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.6);cursor:pointer;flex-shrink:0;background:transparent}" +
      ".plui-vis.public{border-color:rgba(52,211,153,.5);color:#34d399}" +
      ".plui-vis.unlisted{border-color:rgba(251,191,36,.5);color:#fbbf24}" +
      ".plui-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".plui-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.05);color:rgba(255,255,255,.8);border-radius:9px;padding:5px 10px;font-size:11px;cursor:pointer}" +
      ".plui-btn:hover{background:rgba(251,191,36,.13);border-color:rgba(251,191,36,.4);color:#fbbf24}" +
      ".plui-btn.danger:hover{background:rgba(244,63,94,.13);border-color:rgba(244,63,94,.45);color:#fb7185}" +
      ".plui-tracks{margin-top:8px;border-top:1px solid rgba(255,255,255,.07);padding-top:6px}" +
      ".plui-track{display:flex;align-items:center;gap:8px;font-size:12px;color:#fff;padding:4px 2px}" +
      ".plui-track span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".plui-mini{border:none;background:transparent;color:rgba(255,255,255,.45);cursor:pointer;font-size:11px;padding:2px 5px}" +
      ".plui-mini:hover{color:#fbbf24}" +
      ".plui-add{display:flex;gap:6px;margin-top:8px}" +
      ".plui-add input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:12px;padding:7px 10px;outline:none}" +
      ".plui-create{display:flex;gap:6px;margin-bottom:10px}" +
      ".plui-create input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:9px;color:#fff;font-size:12px;padding:8px 11px;outline:none}" +
      ".plui-create button{border:1px solid rgba(251,191,36,.45);background:rgba(251,191,36,.12);color:#fbbf24;border-radius:9px;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".plui-note{font-size:11px;color:rgba(255,255,255,.45);text-align:center;padding:8px 0 2px}" +
      ".plui-ov{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(4,2,12,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:16px}" +
      ".plui-box{width:min(480px,94vw);max-height:86vh;overflow:auto;background:#14101f;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px}" +
      ".plui-share-top{display:flex;gap:12px;margin-bottom:10px}" +
      ".plui-share-cover{width:76px;height:76px;border-radius:12px;object-fit:cover;flex-shrink:0;background:#1c1530}" +
      ".plui-share-title{font-size:16px;font-weight:800;color:#fff}" +
      ".plui-share-sub{font-size:11px;color:rgba(255,255,255,.55);margin-top:3px}" +
      ".plui-share-link{display:flex;gap:6px;margin-top:10px}" +
      ".plui-share-link input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:rgba(255,255,255,.75);font-size:11px;padding:8px;font-family:monospace;outline:none}";
    (document.head || document.documentElement).appendChild(st);
  }

  function playIndexes(idxs, startAt) {
    if (!idxs.length) return;
    try {
      if (window.selectTrackFromList) window.selectTrackFromList(idxs[startAt || 0]);
      if (window.switchAppPage) window.switchAppPage("player");
    } catch (e) {}
  }

  function queueIndexes(idxs) {
    var n = 0;
    try {
      for (var i = 0; i < idxs.length; i++) {
        if (typeof addToQueue === "function") { addToQueue(idxs[i]); n++; }
      }
    } catch (e) {}
    if (window.toast) window.toast(n ? ("Queued " + n + " tracks") : "Queue unavailable", n ? "success" : "error");
  }

  function titlesToIdx(tracks) {
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var ix = idxFor(tracks[i].title);
      if (ix >= 0) out.push(ix);
    }
    return out;
  }

  /* ---------------- manager (self profile) ---------------- */

  function rowHTML(p) {
    var h = '<div class="plui-row" data-pl="' + p.id + '">' +
      '<div class="plui-top"><span class="plui-dot" style="background:' + esc(p.color || "#a855f7") + '"></span>' +
      '<span class="plui-name">' + esc(p.name) + '</span>' +
      '<span class="plui-meta">' + p.count + ' tracks' + (p.fav_count ? " · ♥" + p.fav_count : "") + '</span>' +
      '<button type="button" class="plui-vis ' + esc(p.visibility) + '" data-act="vis" title="Cycle visibility">' + esc(p.visibility) + "</button></div>" +
      '<div class="plui-btns">' +
      '<button type="button" class="plui-btn" data-act="play"><i class="fas fa-play"></i> Play</button>';
    if (isDesktop()) h += '<button type="button" class="plui-btn" data-act="queue"><i class="fas fa-list-ul"></i> Queue</button>';
    h += '<button type="button" class="plui-btn" data-act="tracks"><i class="fas fa-music"></i> Tracks</button>' +
      '<button type="button" class="plui-btn" data-act="rename"><i class="fas fa-pen"></i></button>' +
      '<button type="button" class="plui-btn" data-act="share"><i class="fas fa-share-nodes"></i></button>' +
      '<button type="button" class="plui-btn" data-act="dup"><i class="fas fa-copy"></i></button>' +
      '<button type="button" class="plui-btn danger" data-act="del"><i class="fas fa-trash"></i></button></div>' +
      '<div class="plui-tracks" hidden></div></div>';
    return h;
  }

  function trackRow(t, i, n) {
    return '<div class="plui-track" data-tid="' + t.id + '"><span>' + (i + 1) + ". " + esc(t.title) + "</span>" +
      (i > 0 ? '<button type="button" class="plui-mini" data-tact="up" title="Move up"><i class="fas fa-chevron-up"></i></button>' : "") +
      (i < n - 1 ? '<button type="button" class="plui-mini" data-tact="down" title="Move down"><i class="fas fa-chevron-down"></i></button>' : "") +
      '<button type="button" class="plui-mini" data-tact="rm" title="Remove"><i class="fas fa-xmark"></i></button></div>';
  }

  function renderTracks(box, p) {
    var h = "";
    for (var i = 0; i < p.tracks.length; i++) h += trackRow(p.tracks[i], i, p.tracks.length);
    h += '<div class="plui-add"><input maxlength="140" placeholder="Add track by title…" data-add-inp>' +
      '<button type="button" class="plui-btn" data-act="add"><i class="fas fa-plus"></i> Add</button></div>';
    box.innerHTML = h;
    box.hidden = false;
  }

  function paintList(list, pls) {
    if (!list) return;
    list.innerHTML = pls.length ? pls.map(rowHTML).join("") : '<p class="plui-note">No playlists yet — create your first above.</p>';
  }

  function refreshManager() {
    var host = document.getElementById(WID);
    if (!host) return;
    var list = host.querySelector("[data-pl-list]");
    fetch("/api/playlists?mine=1", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!list) return;
        if (!d || d.ok !== true) { list.innerHTML = '<p class="plui-note">Sign in to manage playlists.</p>'; return; }
        var pls = d.playlists || [];
        if (pls.length) paintList(list, pls);
        /* Empty right after a mutation is usually replica lag — leave any
           optimistic rows in place; the delayed resync converges. */
      });
  }

  /* The legacy native card (localStorage-backed, "0" badge) duplicates this
     manager on self profiles and its sync claim is stale. Hide it; the
     Favorites card and others-profiles lists are untouched. */
  function syncNative() {
    try {
      var body = document.getElementById("profilePageBody");
      if (!body) return;
      if (/^\/profile\/.+/.test(location.pathname || "")) return;
      var grid = body.querySelector(".cmp-pl-grid");
      if (!grid) return;
      var card = grid.closest ? grid.closest(".cmp-sec-card") : null;
      if (card && card.style.display !== "none") card.style.display = "none";
    } catch (e) {}
  }

  function mountManager() {
    var body = document.getElementById("profilePageBody");
    if (!body || !isSelfProfile() || document.getElementById(WID)) return;
    css();
    var div = document.createElement("div");
    div.className = "pv-block";
    div.id = WID;
    div.innerHTML = '<div class="pv-block-title">My Playlists</div>' +
      '<div class="plui-create"><input id="plui-new" maxlength="80" placeholder="New playlist name…" autocomplete="off">' +
      '<button type="button" id="plui-create-btn"><i class="fas fa-plus"></i> Create</button></div>' +
      '<p class="plui-note" data-pl-status hidden></p>' +
      '<div data-pl-list><p class="plui-note">Loading…</p></div>';
    body.appendChild(div);
    syncNative();
    var say = function (msg, isErr) {
      var s = div.querySelector("[data-pl-status]");
      if (!s) return;
      s.hidden = !msg;
      s.textContent = msg || "";
      s.style.color = isErr ? "#fb7185" : "rgba(255,255,255,.55)";
      if (window.toast && msg) window.toast(msg, isErr ? "error" : "success");
    };
    var busy = false;
    var doCreate = function () {
      if (busy) return;
      var inp = document.getElementById("plui-new");
      var name = inp ? inp.value.trim() : "";
      if (!name) { if (inp) inp.focus(); return; }
      busy = true;
      say("Creating…", false);
      api("create", { name: name }).then(function (d) {
        busy = false;
        if (d && d.ok) {
          inp.value = "";
          say('Playlist "' + name + '" created.', false);
          /* Optimistic paint: the row we just created (replica lag can make
             the immediate re-read come back empty). */
          if (d.playlist) {
            var host = document.getElementById(WID);
            var list = host ? host.querySelector("[data-pl-list]") : null;
            if (list) paintList(list, [d.playlist]);
          }
          refreshManager();
          setTimeout(refreshManager, 3000);
        } else {
          say("Could not create: " + ((d && d.error) || "not signed in?"), true);
        }
      });
    };
    document.getElementById("plui-create-btn").addEventListener("click", doCreate);
    div.querySelector("#plui-new").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doCreate(); }
    });
    div.addEventListener("click", onManagerClick);
    div.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.hasAttribute && e.target.hasAttribute("data-add-inp")) {
        var row = e.target.closest ? e.target.closest(".plui-row") : null;
        if (row) addTrack(row);
      }
    });
    refreshManager();
  }

  function curPid(row) { return Number(row.getAttribute("data-pl")) || 0; }

  function addTrack(row) {
    var inp = row.querySelector("[data-add-inp]");
    var v = inp ? inp.value.trim().slice(0, 140) : "";
    if (!v) return;
    api("add", { id: curPid(row), title: v }).then(function (d) {
      if (d && d.ok) refreshManager();
    });
  }

  function onManagerClick(e) {
    var btn = e.target.closest ? e.target.closest("[data-act],[data-tact]") : null;
    if (!btn) return;
    var row = btn.closest ? btn.closest(".plui-row") : null;
    if (!row) return;
    var pid = curPid(row);
    var act = btn.getAttribute("data-act");
    var tact = btn.getAttribute("data-tact");
    if (tact) {
      var box = row.querySelector(".plui-tracks");
      var order = [];
      box.querySelectorAll(".plui-track").forEach(function (el) {
        order.push({ id: Number(el.getAttribute("data-tid")), el: el });
      });
      var pos = -1;
      var self = btn.closest ? btn.closest(".plui-track") : null;
      for (var i = 0; i < order.length; i++) if (order[i].el === self) pos = i;
      if (tact === "rm") {
        var tid = self ? self.getAttribute("data-tid") : null;
        api("remove", { id: pid, track_id: Number(tid) || 0 }).then(function () { refreshManager(); });
        return;
      }
      var j = tact === "up" ? pos - 1 : pos + 1;
      if (pos < 0 || j < 0 || j >= order.length) return;
      var tmp = order[pos]; order[pos] = order[j]; order[j] = tmp;
      var titles = [];
      order.forEach(function (o) {
        var s = o.el.querySelector("span");
        var t = s ? s.textContent.replace(/^\d+\.\s*/, "") : "";
        if (t) titles.push(t);
      });
      api("reorder", { id: pid, titles: titles }).then(function () { refreshManager(); });
      return;
    }
    if (act === "play" || act === "queue" || act === "tracks") {
      fetch("/api/playlists?mine=1", { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
        .then(function (d) {
          if (!d || !d.ok) return;
          var pls = d.playlists || [], p = null;
          for (var i = 0; i < pls.length; i++) if (pls[i].id === pid) p = pls[i];
          if (!p) return;
          var idxs = titlesToIdx(p.tracks || []);
          if (act === "play") playIndexes(idxs, 0);
          else if (act === "queue") { if (isDesktop()) queueIndexes(idxs); }
          else {
            var box = row.querySelector(".plui-tracks");
            if (box.hidden) renderTracks(box, p);
            else box.hidden = true;
          }
        });
      return;
    }
    if (act === "rename") {
      var cur = row.querySelector(".plui-name");
      var name = null;
      try { name = window.prompt("Rename playlist", cur ? cur.textContent : ""); } catch (err) {}
      if (name && name.trim()) api("update", { id: pid, name: name.trim() }).then(function () { refreshManager(); });
      return;
    }
    if (act === "vis") {
      var order = ["private", "unlisted", "public"];
      var curV = "private";
      try {
        var b = row.querySelector(".plui-vis");
        curV = b ? b.textContent.trim() : "private";
      } catch (err) {}
      var next = order[(order.indexOf(curV) + 1) % order.length];
      api("update", { id: pid, visibility: next }).then(function () { refreshManager(); });
      return;
    }
    if (act === "share") {
      api("share", { id: pid }).then(function (d) {
        if (d && d.ok) openShare(d.share_key, null);
      });
      return;
    }
    if (act === "dup") {
      api("duplicate", { id: pid }).then(function (d) {
        if (d && d.ok) {
          if (window.toast) window.toast("Duplicated", "success");
          refreshManager();
        }
      });
      return;
    }
    if (act === "del") {
      var ok = false;
      try { ok = window.confirm("Delete this playlist?"); } catch (err) {}
      if (ok) api("delete", { id: pid }).then(function () { refreshManager(); });
      return;
    }
    if (act === "add") addTrack(row);
  }

  /* ---------------- public share view ---------------- */

  function totalDur(tracks) {
    var s = 0;
    for (var i = 0; i < tracks.length; i++) s += durFor(tracks[i].title);
    return s;
  }

  function openShare(key, preloaded) {
    css();
    var done = function (pl, linkUrl) {
      var old = document.getElementById("plui-ov");
      if (old) old.remove();
      var cov = (pl.tracks && pl.tracks.length ? coverFor(pl.tracks[0].title) : "") || "Juice-WRLD.png";
      var url = linkUrl || (location.origin + location.pathname + "?playlist=" + encodeURIComponent(key));
      var ov = document.createElement("div");
      ov.className = "plui-ov";
      ov.id = "plui-ov";
      var h = '<div class="plui-box"><div class="plui-share-top">' +
        '<img decoding="async" class="plui-share-cover" src="' + esc(cov) + '" alt="" onerror="this.onerror=null;this.src=\'Juice-WRLD.png\'">' +
        '<div><div class="plui-share-title">' + esc(pl.name) + '</div>' +
        '<div class="plui-share-sub">by ' + esc(pl.owner_name || "anon") + " &middot; " + pl.tracks.length + " tracks" +
        (totalDur(pl.tracks) ? " &middot; " + esc(fmtDur(totalDur(pl.tracks))) : "") + "</div>" +
        (pl.desc ? '<div class="plui-share-sub">' + esc(pl.desc) + "</div>" : "") + "</div></div>";
      h += '<div class="plui-btns" style="margin:0 0 10px">' +
        '<button type="button" class="plui-btn" data-share="play"><i class="fas fa-play"></i> Play</button>';
      if (isDesktop()) h += '<button type="button" class="plui-btn" data-share="queue"><i class="fas fa-list-ul"></i> Queue</button>';
      h += '<button type="button" class="plui-btn" data-share="fav"><i class="fas fa-heart"></i> ' + (pl.favorited ? pl.fav_count + " Saved" : "Save") + "</button>" +
        '<button type="button" class="plui-btn" data-share="close"><i class="fas fa-xmark"></i> Close</button></div>';
      h += '<div class="plui-tracks" style="border:none;padding:0">';
      pl.tracks.forEach(function (t, i) {
        h += '<div class="plui-track"><span>' + (i + 1) + ". " + esc(t.title) + "</span></div>";
      });
      h += '</div><div class="plui-share-link"><input readonly value="' + esc(url) + '" onclick="this.select()">' +
        '<button type="button" class="plui-btn" data-share="copy"><i class="fas fa-link"></i> Copy</button></div></div>';
      ov.innerHTML = h;
      ov.addEventListener("click", function (e) {
        if (e.target === ov) { ov.remove(); return; }
        var b = e.target.closest ? e.target.closest("[data-share]") : null;
        if (!b) return;
        var a = b.getAttribute("data-share");
        var idxs = titlesToIdx(pl.tracks || []);
        if (a === "play") { ov.remove(); playIndexes(idxs, 0); }
        else if (a === "queue") { if (isDesktop()) queueIndexes(idxs); }
        else if (a === "close") ov.remove();
        else if (a === "copy") {
          var inp = ov.querySelector(".plui-share-link input");
          try {
            if (inp) inp.select();
            if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () {
              if (window.toast) window.toast("Link copied", "success");
            });
            else if (window.toast) window.toast("Link ready to copy", "info");
          } catch (err) {}
        }
        else if (a === "fav") {
          fetch("/api/playlists", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
            body: JSON.stringify({ action: pl.favorited ? "unfavorite" : "favorite", id: pl.id })
          }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
            .then(function (d) {
              if (d && d.ok) {
                pl.favorited = !pl.favorited;
                pl.fav_count = Math.max(0, (pl.fav_count || 0) + (pl.favorited ? 1 : -1));
                b.innerHTML = '<i class="fas fa-heart"></i> ' + (pl.favorited ? pl.fav_count + " Saved" : "Save");
              } else if (window.toast) window.toast("Sign in to save", "error");
            });
        }
      });
      document.body.appendChild(ov);
    };
    if (preloaded) { done(preloaded); return; }
    fetch("/api/playlists?share=" + encodeURIComponent(key), { cache: "no-store" })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
      .then(function (d) { if (d && d.ok) done(d.playlist); });
  }

  window.openSharedPlaylist = openShare;
  window.openSharedPlaylistById = function (id) {
    fetch("/api/playlists?id=" + encodeURIComponent(id), { cache: "no-store" })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
      .then(function (d) {
        if (d && d.ok) {
          css();
          openShare("", d.playlist);
          var ov = document.getElementById("plui-ov");
          if (ov) {
            var inp = ov.querySelector(".plui-share-link input");
            if (inp) inp.value = location.origin + location.pathname + "?plid=" + encodeURIComponent(id);
          }
        }
      });
  };

  function boot() {
    try {
      var m = (location.search || "").match(/[?&]playlist=([^&]+)/);
      if (m) openShare(decodeURIComponent(m[1]));
      else {
        var m2 = (location.search || "").match(/[?&]plid=(\d+)/);
        if (m2 && window.openSharedPlaylistById) window.openSharedPlaylistById(m2[1]);
      }
    } catch (e) {}
    try {
      var orig = window.profileSectionShown;
      window.profileSectionShown = function () {
        try { if (orig) orig(); } catch (e) {}
        setTimeout(function () {
          var body = document.getElementById("profilePageBody");
          if (!body) return;
          try {
            if (/^\/profile\/.+/.test(location.pathname || "")) return;
          } catch (e2) {}
          if (!document.getElementById(WID)) mountManager();
          else refreshManager();
        }, 700);
      };
    } catch (e) {}
    var profileSection = document.getElementById("page-section-profile");
    if (profileSection && window.MutationObserver) {
      var playlistObserver = new MutationObserver(function () {
        try {
          if (/^\/profile\/.+/.test(location.pathname || "")) return;
          if (profileSection.classList.contains("active")) {
            syncNative();
            if (!document.getElementById(WID)) {
              mountManager();
            }
            try { if (playlistObserver) playlistObserver.disconnect(); } catch (e) {}
          }
        } catch (e2) { return; }
      });
      // Use attribute observation for better performance like other scripts
      playlistObserver.observe(profileSection, { attributes: true, attributeFilter: ["class"] });
    }
    // Fallback: try mounting immediately if profile is already active
    try {
      if (profileSection && profileSection.classList.contains("active") && !document.getElementById(WID)) {
        syncNative();
        mountManager();
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
