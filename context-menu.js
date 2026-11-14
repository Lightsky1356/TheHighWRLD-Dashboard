/* Desktop context menu — the player's three-dot menu
 *
 * The same sheet the phone carries in its full-screen player, as a floating
 * panel on desktop: Like, Add to playlist, Change cover (this device only),
 * Share, Go to song, Other versions, Go to era, Edit this song, Credits,
 * Open queue, Playback settings, Show comments, Close player.
 *
 * Deliberately self-contained — it does not read from the phone's sheet —
 * and it drives the same globals the rest of the desktop player uses
 * (toggleFavorite, addToQueue, selectTrackFromList, toggleQueuePanel).
 */
(function () {
  "use strict";
  if (window.__thwDesktopMenu) return;
  window.__thwDesktopMenu = true;

  var MENU_ID = "thw-ctx-menu";
  var anchor = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function currentIndex() {
    try { if (typeof currentTrackIndex === "number") return currentTrackIndex; } catch (e) {}
    return -1;
  }
  function currentTrack() {
    var i = currentIndex();
    try { if (i >= 0 && typeof trackList !== "undefined" && trackList[i]) return trackList[i]; } catch (e) {}
    return null;
  }
  function currentTitle() {
    var t = currentTrack();
    if (t && t.title) return String(t.title);
    var el = document.getElementById("deck-title") || document.getElementById("track-title");
    return el ? String(el.textContent || "").trim() : "Nothing playing";
  }

  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;
  function eraCodeOf(t) {
    try {
      var m = String((t || {}).tag || "").match(ERA_RE);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return (t && t.category === "halloween") ? "POST" : "Other";
  }
  var ERA_NAME = {
    "GB&GR": "Goodbye & Good Riddance", "WOD": "WRLD ON DRUGS",
    "DRFL": "Death Race For Love", "JW3": "Legends Never Die",
    "POST": "Posthumous", "OUT": "Outsiders", "AF": "Afflictions",
    "ND": "Nothing's Different", "BDM": "BINGEDRINKINGMUSIC",
    "SOUNDCLOUD": "SoundCloud",
  };
  function eraNameOf(t) { return ERA_NAME[eraCodeOf(t)] || "Other"; }

  function isFav() {
    var i = currentIndex();
    if (i < 0) return false;
    try { if (typeof isFavorite === "function") return !!isFavorite(i); } catch (e) {}
    return false;
  }
  function toggleFav() {
    var i = currentIndex();
    try { if (i >= 0 && typeof toggleFavorite === "function") toggleFavorite(i); } catch (e) {}
  }
  function toast(text, kind) {
    try { if (typeof showToast === "function") { showToast(text, kind || "info", 2200); return; } } catch (e) {}
    try { if (window.showToastSimple) window.showToastSimple(text, kind || "info", 2200); } catch (e) {}
  }

  /* ---- per-device cover override ("Change cover – only you see it") ---- */
  var coverCache = {};
  function coverSlug(title) {
    return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function customCoverFor(title) {
    var key = coverSlug(title);
    if (key in coverCache) return coverCache[key];
    var found = null;
    try { found = localStorage.getItem("thw-cover-" + key) || null; } catch (e) {}
    coverCache[key] = found;
    return found;
  }
  function setCustomCover(title, dataUrl) {
    var key = coverSlug(title);
    coverCache[key] = dataUrl;
    try { localStorage.setItem("thw-cover-" + key, dataUrl); } catch (e) {}
  }
  function applyCustomCovers() {
    var t = currentTrack();
    var title = t && t.title ? String(t.title) : null;
    if (!title) return;
    var data = customCoverFor(title);
    if (!data) return;
    ["player-cover", "deck-cover", "info-panel-img"].forEach(function (id) {
      var img = document.getElementById(id);
      if (img && img.getAttribute("src") !== data) img.src = data;
    });
  }
  window.addEventListener("thw:trackplaying", function () { setTimeout(applyCustomCovers, 60); });

  /* ---- the panel ---- */
  function build() {
    var menu = document.getElementById(MENU_ID);
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Song options");
    menu.innerHTML =
      '<p class="thw-ctx-title"></p>' +
      '<button class="thw-ctx-item" data-act="like" role="menuitem"><i class="far fa-heart"></i><span class="thw-ctx-like-label">Like</span></button>' +
      '<button class="thw-ctx-item" data-act="addplaylist" role="menuitem"><i class="fas fa-plus"></i><span>Add to playlist</span><i class="fas fa-chevron-right thw-ctx-chev"></i></button>' +
      '<button class="thw-ctx-item" data-act="myplaylists" role="menuitem"><i class="fas fa-compact-disc"></i><span>My playlists<span class="thw-ctx-sub">Play or queue what you saved</span></span></button>' +
      '<button class="thw-ctx-item" data-act="cover" role="menuitem"><i class="fas fa-image"></i><span>Change cover<span class="thw-ctx-sub">Only you see it</span></span></button>' +
      '<div class="thw-ctx-div"></div>' +
      '<button class="thw-ctx-item" data-act="share" role="menuitem"><i class="fas fa-share-nodes"></i><span>Share</span></button>' +
      '<button class="thw-ctx-item" data-act="song" role="menuitem"><i class="fas fa-music"></i><span>Go to song</span></button>' +
      '<button class="thw-ctx-item" data-act="versions" role="menuitem"><i class="fas fa-code-branch"></i><span>Other versions</span></button>' +
      '<button class="thw-ctx-item thw-ctx-era" data-act="era" role="menuitem"><i class="fas fa-layer-group"></i><span><b>Go to era</b><span class="thw-ctx-sub thw-ctx-era-name"></span></span></button>' +
      '<div class="thw-ctx-div"></div>' +
      '<button class="thw-ctx-item" data-act="edit" role="menuitem"><i class="fas fa-pen-to-square"></i><span>Edit this song<span class="thw-ctx-sub">Fix credits, dates or details</span></span></button>' +
      '<div class="thw-ctx-div"></div>' +
      '<button class="thw-ctx-item" data-act="info" role="menuitem"><i class="fas fa-circle-info"></i><span>Info</span></button>' +
      '<button class="thw-ctx-item" data-act="openqueue" role="menuitem"><i class="fas fa-list-ul"></i><span>Open queue</span></button>' +
      '<button class="thw-ctx-item" data-act="eq" role="menuitem"><i class="fas fa-sliders"></i><span>Equalizer and reverb</span></button>' +
      '<button class="thw-ctx-item" data-act="settings" role="menuitem"><i class="fas fa-gear"></i><span>Playback settings</span></button>' +
      '<button class="thw-ctx-item" data-act="comments" role="menuitem"><i class="far fa-comment"></i><span>Show comments</span></button>' +
      '<div class="thw-ctx-div"></div>' +
      '<button class="thw-ctx-item" data-act="close" role="menuitem"><i class="fas fa-xmark"></i><span>Close player<span class="thw-ctx-sub">Stops playback and hides the player</span></span></button>' +
      '<div class="thw-ctx-picker" id="thw-ctx-picker" hidden>' +
        '<p class="thw-ctx-picker-title">Add to playlist</p>' +
        '<div class="thw-ctx-picker-list" id="thw-ctx-picker-list"></div>' +
        '<button class="thw-ctx-item thw-ctx-newpl" data-act="newpl"><i class="fas fa-plus"></i><span>New playlist<span class="thw-ctx-sub">opens your profile</span></span></button>' +
      '</div>';

    document.body.appendChild(menu);
    menu.hidden = true;

    menu.addEventListener("click", function (e) {
      var item = e.target.closest ? e.target.closest("[data-act]") : null;
      if (item) act(menu, item.getAttribute("data-act"));
    });

    return menu;
  }

  function paintLike(menu) {
    var f = isFav();
    var like = menu.querySelector('[data-act="like"]');
    if (like) {
      like.classList.toggle("is-on", f);
      like.innerHTML = '<i class="' + (f ? "fas" : "far") + ' fa-heart"></i><span class="thw-ctx-like-label">' + (f ? "Liked" : "Like") + '</span>';
    }
  }

  function paintTitle(menu) {
    var t = currentTrack();
    var titleEl = menu.querySelector(".thw-ctx-title");
    if (titleEl) titleEl.textContent = currentTitle();
    var eraEl = menu.querySelector(".thw-ctx-era-name");
    if (eraEl) eraEl.textContent = eraNameOf(t);
  }

  function act(menu, a) {
    var t = currentTrack();
    var title = currentTitle();

    if (a === "like") {
      toggleFav();
      paintLike(menu);
      return;
    }

    if (a === "addplaylist") { openPicker(menu, t); return; }

    if (a === "myplaylists") {
      closeMenu();
      if (window.openDesktopPlaylists) window.openDesktopPlaylists();
      else if (window.openDesktopPlayer) window.openDesktopPlayer();
      return;
    }

    if (a === "cover") { pickCover(); return; }

    if (a === "share") { share(title); return; }

    if (a === "song" || a === "versions" || a === "credits") {
      closeMenu();
      if (window.openSongPage) window.openSongPage(title);
      return;
    }

    if (a === "era") {
      var code = eraCodeOf(t);
      closeMenu();
      if (typeof window.switchAppPage === "function") window.switchAppPage("hub");
      setTimeout(function () {
        try {
          var nodes = document.querySelectorAll(".era-node");
          for (var i = 0; i < nodes.length; i++) {
            var c = nodes[i].querySelector(".era-code");
            if (c && String(c.textContent || "").trim().toUpperCase() === code) {
              var btn = nodes[i].querySelector(".era-btn");
              if (btn) btn.click();
              nodes[i].scrollIntoView({ block: "center" });
              return;
            }
          }
        } catch (e) {}
      }, 420);
      return;
    }

    if (a === "edit") {
      closeMenu();
      if (typeof window.switchAppPage === "function") window.switchAppPage("suggestions");
      setTimeout(function () {
        try {
          var titleEl = document.getElementById("sugg-title");
          var descEl = document.getElementById("sugg-desc");
          var catEl = document.getElementById("sugg-category");
          if (titleEl && !titleEl.value) titleEl.value = "Fix: " + title;
          if (descEl && !descEl.value) descEl.value = "Song: " + title + "\n\nWhat needs fixing (credits, dates, details): ";
          if (catEl) catEl.value = "bug_fix";
        } catch (e) {}
      }, 420);
      return;
    }

    if (a === "openqueue") {
      closeMenu();
      if (typeof toggleQueuePanel === "function") toggleQueuePanel();
      return;
    }

    if (a === "eq") { toast("Equalizer and reverb are not in this build yet", "info"); return; }

    if (a === "settings") {
      closeMenu();
      if (typeof window.switchAppPage === "function") window.switchAppPage("account");
      return;
    }

    if (a === "comments") {
      closeMenu();
      var btn = document.getElementById("song-comments-btn");
      if (btn) btn.click();
      return;
    }

    if (a === "close") {
      var au = document.querySelector("audio");
      if (au && !au.paused) {
        var p = document.getElementById("deck-play");
        if (p) p.click();
        else if (typeof window.shadowPause === "function") window.shadowPause();
      }
      closeMenu();
      if (typeof window.switchAppPage === "function") window.switchAppPage("home");
      return;
    }

    if (a === "newpl") {
      closeMenu();
      if (window.viewMyProfile) window.viewMyProfile();
      else if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
      return;
    }
  }

  /* ---- the playlist picker ---- */
  function openPicker(menu, t) {
    var picker = menu.querySelector("#thw-ctx-picker");
    var list = menu.querySelector("#thw-ctx-picker-list");
    if (!picker || !list) return;
    var title = t && t.title ? String(t.title) : currentTitle();
    list.innerHTML = '<p class="thw-ctx-picker-empty">Loading your playlists…</p>';
    picker.hidden = false;

    fetch("/api/playlists", { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 401 || !d.ok) {
          list.innerHTML = '<p class="thw-ctx-picker-empty">Sign in to save this song to a playlist.</p>';
          return;
        }
        var playlists = Array.isArray(d.playlists) ? d.playlists : [];
        if (!playlists.length) {
          list.innerHTML = '<p class="thw-ctx-picker-empty">No playlists yet.<span>Make one in your profile, then come back.</span></p>';
          return;
        }
        list.textContent = "";
        playlists.forEach(function (pl) {
          var row = document.createElement("button");
          row.type = "button";
          row.className = "thw-ctx-item thw-ctx-plrow";
          var color = pl.color || "#7c3aed";
          var count = (pl.tracks && pl.tracks.length) || 0;
          var sub = (pl.visibility === "public" ? "Public · " : "") + count + (count === 1 ? " song" : " songs");
          row.innerHTML =
            '<span class="thw-ctx-pl-dot" style="background:' + esc(color) + '22;color:' + esc(color) + '"><i class="fas fa-list"></i></span>' +
            '<span class="thw-ctx-pl-meta"><span class="thw-ctx-pl-name">' + esc(pl.name || "Playlist") + '</span><br><span class="thw-ctx-pl-count">' + esc(sub) + '</span></span>';
          row.addEventListener("click", function () {
            fetch("/api/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "add", id: pl.id, title: title }),
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (d2) {
                if (d2 && d2.ok) { toast("Added to " + (pl.name || "your playlist"), "success"); closeMenu(); }
                else toast((d2 && (d2.error || d2.message)) || "Could not add to the playlist", "error");
              }).catch(function () { toast("Could not add to the playlist", "error"); });
          });
          list.appendChild(row);
        });
      })
      .catch(function () { list.innerHTML = '<p class="thw-ctx-picker-empty">The playlists could not be loaded.</p>'; });
  }

  /* ---- cover override ---- */
  var fileInput = null;
  function pickCover() {
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.style.display = "none";
      document.body.appendChild(fileInput);
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var t = currentTrack();
        var target = t && t.title ? String(t.title) : currentTitle();
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var size = 224;
            var canvas = document.createElement("canvas");
            canvas.width = size; canvas.height = size;
            var ctx2d = canvas.getContext("2d");
            var side = Math.min(img.width, img.height);
            ctx2d.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            var dataUrl = "";
            try { dataUrl = canvas.toDataURL("image/jpeg", 0.82); } catch (e) { dataUrl = img.src; }
            setCustomCover(target, dataUrl);
            applyCustomCovers();
            closeMenu();
            toast("Cover changed — only you will see it", "success");
          };
          img.onerror = function () { toast("That picture would not load", "error"); };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
      });
    }
    fileInput.click();
  }

  /* ---- share ---- */
  function share(title) {
    var origin = "";
    try { origin = window.location.origin; } catch (e) {}
    var link = origin + "/songs/" + String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    try {
      if (navigator.share) { navigator.share({ title: title, url: link }).catch(function () {}); return; }
    } catch (e) {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { toast("Song link copied", "success"); }, function () { toast("Could not copy the link", "error"); });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Song link copied", "success");
    } catch (e) { toast("Could not copy the link", "error"); }
  }

  /* ---- open / close ---- */
  function position(menu, btn) {
    var rect = btn.getBoundingClientRect();
    var menuWidth = 320;
    var left = Math.min(Math.max(8, rect.right - menuWidth), Math.max(8, window.innerWidth - menuWidth - 8));
    menu.style.left = left + "px";
    menu.style.top = (rect.bottom + 10) + "px";
    var menuHeight = menu.offsetHeight || 560;
    if (rect.bottom + 10 + menuHeight > window.innerHeight) {
      var topAbove = rect.top - menuHeight - 10;
      if (topAbove >= 8) { menu.style.top = topAbove + "px"; }
      else { menu.style.top = Math.max(8, Math.floor((window.innerHeight - menuHeight) / 2)) + "px"; }
    }
  }

  function closeMenu() {
    var menu = document.getElementById(MENU_ID);
    if (menu) menu.hidden = true;
    anchor = null;
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize, true);
  }
  function onDocDown(e) {
    var menu = document.getElementById(MENU_ID);
    if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== anchor) closeMenu();
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); closeMenu(); } }
  function onResize() { closeMenu(); }

  window.togglePlayerContextMenu = function (btn) {
    var menu = build();
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false;
    var pk = menu.querySelector("#thw-ctx-picker");
    if (pk) pk.hidden = true;
    anchor = btn;
    paintLike(menu);
    paintTitle(menu);
    position(menu, btn);
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize, true);
  };

  window.openPlayerContextMenu = window.togglePlayerContextMenu;
})();
