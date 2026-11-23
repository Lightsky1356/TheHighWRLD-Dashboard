/* ============================================================================
   PROFILE - the rebuilt self / member page
   Replaces the old layout entirely. All data comes from /api/profile
   (fallbacks honest: guest = sign-in gate, missing numbers = omitted).
   ========================================================================== */
(function () {
  "use strict";

  /* ---------- shared bits ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 10000) return Math.round(n / 1000) + "k";
    return n.toLocaleString();
  }
  function hoursToMin(h) { return Math.round((Number(h) || 0) * 60); }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------- era helpers ---------- */
  var ERA_ORDER = ["GB&GR", "WOD", "DRFL", "JW3", "POST", "OUT", "AF", "ND", "BDM", "HIH", "999", "JW999", "JTK"];
  /* High-resolution era cover art for the hero backdrop. The settings-era
     thumbnails are only 64px and turn to mush when stretched behind a hero. */
  var ERA_ART = {
    "GB&GR": "AlbumArt/goodbye.jpg",
    "WOD": "AlbumArt/WOD.png",
    "DRFL": "AlbumArt/DRFL.png",
    "JW3": "AlbumArt/legends.jpg",
    "POST": "AlbumArt/party.jpg",
    "999": "AlbumArt/999.jpg",
    "JW999": "AlbumArt/999.jpg"
  };
  var ERA_TINT = {
    "GB&GR": ["#3b82f6", "#9e8000"],
    "WOD": ["#db2777", "#cc4d92"],
    "DRFL": ["#ef4444", "#d05c00"],
    "JW3": ["#8f80c4", "#a67c00"],
    "POST": ["#767fea", "#008fc1"],
    "OUT": ["#767fea", "#008fc1"],
    "AF": ["#009585", "#0f766e"],
    "ND": ["#009585", "#0f766e"],
    "BDM": ["#c17b00", "#7a3711"],
    "HIH": ["#9f1239", "#d44e65"],
    "999": ["#dc2626", "#d45154"],
    "JW999": ["#dc2626", "#d45154"],
    "JTK": ["#3b82f6", "#b57300"]
  };
  function eraOfTag(tag) {
    var m = String(tag || "").replace(/\[?\d+m/g, "").match(/\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH|JTK)\)/i);
    return m ? m[1].toUpperCase() : null;
  }
  function eraLabel(era) {
    if (!era) return "Mystery";
    if (era === "GB&GR") return "Goodbye & Good Riddance";
    if (era === "WOD") return "WRLD ON DRUGS";
    if (era === "DRFL") return "Death Race For Love";
    if (era === "JW3") return "Legends Never Die";
    if (era === "POST") return "The Party Never Ends";
    if (era === "OUT") return "Outsiders";
    if (era === "AF") return "Affliction";
    if (era === "ND") return "NOTHING'S DIFFERENT";
    if (era === "BDM") return "BINGEDRINKINGMUSIC";
    if (era === "HIH") return "Heartbroken In Hollywood 999";
    if (era === "JTK") return "JUICED UP THE EP";
    return era;
  }
  function eraArt(era) { return (era && ERA_ART[era]) || "AlbumArt/999.jpg"; }
  function eraTint(era) { return (era && ERA_TINT[era]) || ["#fcd34d", "#d4a574"]; }
  function trackByTitle(title) {
    if (typeof trackList === "undefined" || !trackList) return null;
    var t = String(title || "").toLowerCase();
    if (/^[0-9]+$/.test(String(title || "").trim())) {
      var ni = parseInt(String(title).trim(), 10);
      if (ni >= 0 && ni < trackList.length) return { index: ni, track: trackList[ni] };
      return null;
    }
    for (var i = 0; i < trackList.length; i++) {
      if (String(trackList[i].title || "").toLowerCase() === t) return { index: i, track: trackList[i] };
    }
    var base = String(title || "").replace(/\s*\(.*\)\s*/, "").trim().toLowerCase();
    if (base) {
      for (var k = 0; k < trackList.length; k++) {
        var tn = trackList[k] && trackList[k].title ? String(trackList[k].title) : "";
        if (tn.replace(/\s*\(.*\)\s*/, "").trim().toLowerCase() === base) return { index: k, track: trackList[k] };
      }
    }
    return null;
  }

  function eraFromTrackId(id) {
    if (typeof trackList === "undefined" || !trackList) return null;
    /* Top-plays store the track title, sometimes with the era parenthetical
       intact. Match on the title stem first, era tag as-is second. */
    var t = String(id || "");
    var byIdx = null;
    for (var i = 0; i < trackList.length; i++) {
      var cur = String(trackList[i].title || "");
      if (cur === t || cur.toLowerCase() === t.toLowerCase()) { byIdx = i; break; }
    }
    if (byIdx != null) return eraOfTag(trackList[byIdx].tag);
    return eraOfTag(t);
  }
  function coverForId(id) {
    var rec = trackByTitle(id);
    if (rec && rec.track && rec.track.cover) { var c = String(rec.track.cover); return c.indexOf("http") === 0 ? c : c.replace(/^Covers\//, "Covers/"); }
    var era = eraFromTrackId(id);
    return eraArt(era);
  }
  function playIndexById(id) { var rec = trackByTitle(id); return rec ? rec.index : -1; }

  /* ---------- data loading ---------- */
  function fetchJson(url) {
    return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  var sessionUidCache = null;
  function sessionOwnUid() {
    if (sessionUidCache !== null) return Promise.resolve(sessionUidCache);
    return fetch("/api/users/me", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (d) {
      var uid = d && d.ok && d.signedIn ? d.uid : "";
      sessionUidCache = uid || "";
      /* Keep the local guess in line with the session - everything else on
         the site (presets, skeletons, cleanup) reads this too. */
      try { if (uid) localStorage.setItem("wantedUserId", uid); } catch (e) {}
      return sessionUidCache;
    });
  }
  function isSelfView() {
    try { return !window.isOtherProfilePath || !window.isOtherProfilePath(); } catch (e) { return true; }
  }
  function profileKey() {
    try { return window.profilePathKey ? window.profilePathKey() : ""; } catch (e) { return ""; }
  }
  function loadData() {
    var self = isSelfView(), key = profileKey();
    /* The account session is the truth when it exists: wantedUserId in
       localStorage is a cache that a fresh sign-in can refresh later. */
    return sessionOwnUid().then(function (sessionUid) {
      var ownUid = "";
      if (self) {
        var cached = "";
        try { cached = localStorage.getItem("wantedUserId") || ""; } catch (e) {}
        ownUid = sessionUid || cached;
      } else {
        ownUid = key;
      }
      if (self && !ownUid) return { profile: null, xp: null, self: true };
      var url = "/api/profile?user=" + encodeURIComponent(ownUid);
      return Promise.all([fetchJson(url), fetchJson("/api/xp?limit=100&user=" + encodeURIComponent(ownUid))]).then(function (r) {
        return { profile: r[0], xp: r[1], self: self };
      });
    });
  }

  /* ---------- hour histogram note ---------- */
  function mostActiveWindow(hours) {
    if (!Array.isArray(hours) || !hours.length) return null;
    var max = 0, idx = 0;
    for (var i = 0; i < 24; i++) { if ((hours[i] || 0) > max) { max = hours[i]; idx = i; } }
    if (!max) return null;
    var ampm = idx >= 12 ? "PM" : "AM", hr = ((idx + 11) % 12) + 1;
    return "most around " + hr + " " + ampm;
  }

  /* ---------- milestones ---------- */
  var MILESTONES = [
    { id: "first", label: "First play", icon: "fa-play", how: "Play any song in the vault", test: function (s) { return s.plays >= 1; } },
    { id: "ten", label: "10 plays", icon: "fa-headphones", how: "10 total plays in the vault", test: function (s) { return s.plays >= 10; } },
    { id: "fifty", label: "50 plays", icon: "fa-bolt", how: "50 total plays in the vault", test: function (s) { return s.plays >= 50; } },
    { id: "hundred", label: "100 plays", icon: "fa-fire", how: "100 total plays in the vault", test: function (s) { return s.plays >= 100; } },
    { id: "twofifty", label: "250 plays", icon: "fa-rocket", how: "250 total plays in the vault", test: function (s) { return s.plays >= 250; } },
    { id: "fivehundred", label: "500 plays", icon: "fa-crown", how: "500 total plays in the vault", test: function (s) { return s.plays >= 500; } },
    { id: "thousand", label: "1,000 plays", icon: "fa-gem", how: "1,000 total plays in the vault", test: function (s) { return s.plays >= 1000; } },
    { id: "unique25", label: "25 songs", icon: "fa-box-archive", how: "Play 25 different songs", test: function (s) { return s.unique >= 25; } },
    { id: "unique100", label: "100 songs", icon: "fa-layer-group", how: "Play 100 different songs", test: function (s) { return s.unique >= 100; } },
    { id: "streak7", label: "7-day streak", icon: "fa-calendar-check", how: "Listen on 7 consecutive days", test: function (s) { return s.streak >= 7; } },
    { id: "streak30", label: "30-day streak", icon: "fa-calendar-days", how: "Listen on 30 consecutive days", test: function (s) { return s.streak >= 30; } },
    { id: "level5", label: "Level 5", icon: "fa-star", how: "Reach level 5 by earning XP", test: function (s) { return s.level >= 5; } },
    { id: "level10", label: "Level 10", icon: "fa-star-of-life", how: "Reach level 10 by earning XP", test: function (s) { return s.level >= 10; } },
    { id: "top25", label: "Top 25 all-time", icon: "fa-ranking-star", how: "Place in the top 25 of the all-time XP leaderboard", test: function (s) { return s.rank != null && s.rank <= 25; } }
  ];

  /* ---------- HTML builders ---------- */
  function esc2(s) { return esc(s); }
  function favChipHTML(favSong) {
    favSong = favSong || "";
    if (!favSong) return '<button type="button" class="pv2-favsong hidden" id="pv2FavChip"></button>';
    var rec = trackByTitle(favSong);
    var idx = rec ? rec.index : -1;
    return '<button type="button" class="pv2-favsong" id="pv2FavChip"' + (idx >= 0 ? ' data-play-idx="' + idx + '"' : ' disabled') + ' title="Play it"><i class="fas fa-music"></i><span>' + esc2(favSong) + '</span>' + (idx >= 0 ? '<i class="fas fa-play pv2-favsong-play"></i>' : '') + '</button>';
  }
  function nowPlayingHTML(np) {
    var t = np ? trackByTitle(np.trackId || np.title) : null;
    var idx = playIndexById(np ? (np.trackId || np.title) : "");
    var art = t && t.track && t.track.cover ? t.track.cover : eraArt(t ? eraOfTag(t.track.tag) : null);
    var album = t && t.track ? eraLabel(eraOfTag(t.track.tag)) : "Juice WRLD";
    var year = t && t.track && t.track.year ? t.track.year : "";
    return '<div class="pv2-now' + (np && np.title ? '' : ' hidden') + '" id="pv2Now" data-title="' + esc2(np ? np.title : "") + '">' +
      '<div class="pv2-now-art-wrap"><img class="pv2-now-art" id="pv2NowArt" src="' + esc2(art) + '" alt="" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'">' +
      '<span class="pv2-eq" id="pv2NowEq"><i></i><i></i><i></i><i></i></span>' +
      '</div>' +
      '<div class="pv2-now-body">' +
        '<div class="pv2-now-top"><span class="pv2-now-live"><span class="pv2-eq-sm"><i></i><i></i><i></i></span>Listening now</span><span class="pv2-now-src">TheHighWRLD Dashboard</span></div>' +
        '<b class="pv2-now-title" id="pv2NowTitle">' + esc2(np ? np.title : "") + '</b>' +
        '<span class="pv2-now-sub"><span id="pv2NowAlbum">' + esc2(album + (year ? " · " + year : "")) + '</span>' +
          (t && t.track && eraOfTag(t.track.tag) ? ' <span class="pv2-now-era">' + esc2(eraOfTag(t.track.tag)) + '</span>' : '') +
        '</span>' +
        '<div class="pv2-now-bar" id="pv2NowBar" role="progressbar" aria-label="Playback progress"><div class="pv2-now-bar-fill" id="pv2NowBarFill" style="width:0%"></div></div>' +
        '<div class="pv2-now-time"><span id="pv2NowCur">0:00</span><span id="pv2NowDur">0:00</span></div>' +
      '</div>' +
      '<button type="button" class="pv2-now-play" id="pv2NowPlay" data-play-idx="' + idx + '"' + (idx < 0 ? ' disabled title="Track not in catalogue"' : '') + '><i class="fas fa-play"></i> Play this track</button>' +
    '</div>';
  }
  function initials(name) {
    var t = String(name || "9").trim();
    if (!t) return "9";
    var parts = t.split(/\s+/);
    return ((parts[0] || "")[0] || "9").toUpperCase();
  }
  /* Discord's custom-avatar URL goes stale when somebody changes their
     picture. Try their default avatar (derivable from the id in the old URL),
     then fall back to initials. Kept as a global so the inline handler stays
     a simple call instead of nested escaped HTML. */
  function discordDefaultAvatar(src) {
    var m = /discordapp\.com\/avatars\/(\d+)\//.exec(String(src || ""));
    if (!m) return "";
    var id = Number(m[1]);
    return isFinite(id) ? "https://cdn.discordapp.com/embed/avatars/" + (Math.floor(id / 4194304) % 6) + ".png" : "";
  }
  window.__thwAvatarError = function (img) {
    if (!img || img.dataset.triedDefault === "1") return;
    img.dataset.triedDefault = "1";
    var fallback = discordDefaultAvatar(img.getAttribute("src") || "");
    if (fallback) {
      img.onerror = function () {
        img.onerror = null;
        img.outerHTML = '<div class="pv2-avatar-fallback" id="pv2HeroAvatar" aria-hidden="true">' +
          esc2(img.dataset.initials || "?") + '</div>';
      };
      img.src = fallback;
    } else {
      img.onerror = null;
      img.outerHTML = '<div class="pv2-avatar-fallback" id="pv2HeroAvatar" aria-hidden="true">' +
        esc2(img.dataset.initials || "?") + '</div>';
    }
  };
  function avatarHtml(p) {
    var initialsHTML = '<div class="pv2-avatar-fallback" id="pv2HeroAvatar" aria-hidden="true">' + esc2(initials(p.name)) + '</div>';
    if (!p.avatar) return initialsHTML;
    return '<img class="pv2-avatar" id="pv2HeroAvatar" src="' + esc2(p.avatar) + '" alt="" decoding="async" ' +
      'data-initials="' + esc2(initials(p.name)) + '" onerror="window.__thwAvatarError(this)">';
  }
  function joinedStr(j) {
    if (!j) return "";
    try {
      var d = new Date(String(j).replace(" ", "T") + "Z");
      if (isNaN(d.getTime())) d = new Date(String(j));
      if (isNaN(d.getTime())) return String(j).slice(0, 10);
      return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch (e) { return String(j).slice(0, 10); }
  }
  function statBlock(n, label) {
    return '<div><b>' + esc2(String(n)) + '</b><span>' + esc2(label) + '</span></div>';
  }
  function eraStackHTML(topList) {
    /* Sum plays per era across the top track list we can see (honest: label
       says these come from the vault). */
    var sums = {}, order = [];
    for (var i = 0; i < topList.length; i++) {
      var era = eraFromTrackId(topList[i].track_id);
      if (!era) continue;
      if (sums[era] == null) { sums[era] = 0; order.push(era); }
      sums[era] += Number(topList[i].n) || 0;
    }
    var rows = order.map(function (era) { return { era: era, plays: sums[era] }; })
      .sort(function (a, b) { return b.plays - a.plays; }).slice(0, 5);
    if (!rows.length) return '<p class="pv2-none">Play some songs from the vault and the eras you love most will show up here.</p>';
    var max = rows[0].plays || 1;
    return '<div class="pv2-eras">' + rows.map(function (r, i) {
      var tint = eraTint(r.era);
      var pct = Math.round((r.plays / max) * 100);
      return '<div class="pv2-era-row"><span class="pv2-era-num">' + (i + 1) + '</span>' +
        '<img class="pv2-era-art" src="' + esc2(eraArt(r.era)) + '" alt="" loading="lazy" decoding="async">' +
        '<div class="pv2-era-body"><div class="pv2-era-name-row"><span class="pv2-era-name-sm">' + esc2(eraLabel(r.era)) + '</span><span class="pv2-era-n">' + fmtNum(r.plays) + ' plays</span></div>' +
        '<div class="pv2-era-bar"><span class="pv2-era-fill" style="width:' + pct + '%;background:linear-gradient(90deg,' + esc2(tint[0]) + ',' + esc2(tint[1]) + ')"></span></div>' +
      '</div></div>';
    }).join("") + '</div>';
  }
  function topSongsHTML(topList) {
    if (!topList || !topList.length) return '<p class="pv2-none">Nothing played yet - press play on anything in the vault.</p>';
    var maxPlays = Number(topList[0].n) || 1;
    return '<div class="pv2-top-list">' + topList.slice(0, 8).map(function (t, i) {
      var idx = playIndexById(t.track_id);
      var cover = coverForId(t.track_id);
      var era = eraFromTrackId(t.track_id);
      var rec = (typeof trackList !== "undefined") ? trackByTitle(t.track_id) : null;
      var album = rec && rec.track ? (rec.track.album || rec.track.album_name || "") : "";
      var plays = Number(t.n) || 0;
      var pct = Math.max(4, Math.round((plays / maxPlays) * 100));
      var inner = '<span class="pv2-rank">' + (i + 1) + '</span>' +
        '<img class="pv2-song-cover" src="' + esc2(cover) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'">' +
        '<span class="pv2-song-t"><span class="pv2-song-title">' + esc2(t.track_id) + '</span>' +
          '<span class="pv2-song-meta">' + (era ? '<span class="pv2-song-era">' + esc2(era) + '</span>' : '') +
          (album ? '<span class="pv2-song-album"><i class="fas fa-compact-disc" aria-hidden="true"></i>' + esc2(album) + '</span>' : '') + '</span>' +
        '</span>' +
        '<span class="pv2-plays">' + fmtNum(plays) + '<span>plays</span></span>';
      return idx >= 0
        ? '<button type="button" class="pv2-song" data-play-idx="' + idx + '">' + inner + '</button>'
        : '<div class="pv2-song">' + inner + '</div>';
    }).join("") + '</div>';
  }
  function hourHistogramHTML(hours) {
    if (!Array.isArray(hours) || hours.length < 24) return '<p class="pv2-none">Play something and your listening pattern will draw itself here.</p>';
    var max = Math.max.apply(null, hours.map(function (h) { return Number(h) || 0; }));
    if (!max) return '<p class="pv2-none">No hourly pattern yet.</p>';
    var bars = '';
    for (var h = 0; h < 24; h++) {
      var v = Number(hours[h]) || 0;
      var pct = Math.round((v / max) * 100);
      var lb = h === 0 ? "12" : (h === 12 ? "12" : ((h % 12) || 12)) + (h < 12 ? "a" : "");
      bars += '<div class="pv2-hr"><span class="pv2-hr-bar' + (pct >= 88 ? ' hot' : '') + '" style="height:' + Math.max(4, pct) + '%"></span><span class="pv2-hr-lb">' + lb + '</span></div>';
    }
    var note = mostActiveWindow(hours);
    return '<div class="pv2-hours">' + bars + '</div>' +
      '<p class="pv2-hours-note">Plays by hour of the day' + (note ? ' &middot; <b>' + esc2(note) + '</b>' : "") + '</p>';
  }
  function milestonesHTML(stats) {
    var unlockedCount = MILESTONES.filter(function (m) { return m.test(stats); }).length;
    var html = '<div class="pv2-ach-grid">';
    MILESTONES.forEach(function (m) {
      var unlocked = m.test(stats);
      html += '<button type="button" class="pv2-ach' + (unlocked ? ' unlocked' : ' locked') + '" data-ach-id="' + esc2(m.id) + '" title="' + esc2(m.how) + '"><i class="fas ' + m.icon + '"></i><small>' + esc2(m.label) + '</small></button>';
    });
    html += '</div>';
    html += '<p class="pv2-card-note" style="margin-top:10px">' + unlockedCount + ' of ' + MILESTONES.length + ' unlocked &middot; <a class="pv2-xp-link" href="#" id="pv2AchHow">How to unlock <i class="fas fa-arrow-right" style="font-size:9px"></i></a></p>';
    return html;
  }
  function collageHTML(favorites, editable) {
    if (!favorites || !favorites.length) return '<p class="pv2-none">No favourites yet.</p>';
    var picks = favorites.slice(0, 8).map(function (f) { return f && f.title; }).filter(Boolean);
    return '<div class="pv2-collage">' + picks.map(function (title) {
      var cover = coverForId(title);
      return '<div class="pv2-fav-item" role="button" tabindex="0" data-fav-title="' + esc2(title) + '" aria-label="Play ' + esc2(title) + '">' +
        '<img src="' + esc2(cover) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'">' +
        '<span class="pv2-fav-name">' + esc2(title) + '</span>' +
        (editable
          ? '<button type="button" class="pv2-fav-info" data-fav-info="' + esc2(title) + '" aria-label="Info for ' + esc2(title) + '"><i class="fas fa-circle-info" aria-hidden="true"></i></button>' +
            '<button type="button" class="pv2-fav-heart" data-unfav="' + esc2(title) + '" aria-label="Remove ' + esc2(title) + ' from favourites"><i class="fas fa-heart-circle-xmark" aria-hidden="true"></i></button>'
          : '') + '</div>';
    }).join("") + '</div>';
  }

  /* ---------- render ---------- */
  function renderInto(body, html) {
    body.innerHTML = html;
    body.removeAttribute("aria-busy");
  }

  function privateGate() {
    return '<div class="pv2-signin"><i class="fas fa-lock"></i><h2>This profile is private</h2><p>The member has chosen to keep their profile to themselves.</p></div>';
  }

  function signInGate() {
    return '<div class="pv2-signin"><i class="fas fa-user-lock"></i><h2>Your profile lives here</h2><p>Sign in and the page fills with your plays, your level, your top songs, your eras.</p><button type="button" class="pv2-link" onclick="if(window.switchAppPage)window.switchAppPage(\'login\')"><i class="fas fa-right-to-bracket"></i> Sign in</button></div>';
  }

  function renderError(msg) {
    return '<div class="pv2-signin"><i class="fas fa-triangle-exclamation"></i><h2>Couldn\'t load the profile</h2><p>' + esc2(msg || "Something went sideways. Try again in a moment.") + '</p></div>';
  }

  function buildPage(d, xp, selfFlag) {
    var p = d.profile || {}, s = d.stats || {}, dc = d.discord || {};
    /* Use the same self/other decision loadData() made, not a fresh read of
       the address (which canonicalisation may have changed meanwhile). */
    var isMe = (typeof selfFlag === "boolean") ? selfFlag : isSelfView();
    var name = p.name || d.name || dc.name || (isMe ? "You" : "999_" + String(d.uid || "").slice(-4));
    var uname = p.username || d.handle || String(d.uid || "");
    var xpObj = (xp && xp.me) || null;
    var rank = xpObj && xpObj.rankAll != null ? xpObj.rankAll : null;
    var xpTotal = xpObj ? xpObj.xp : 0;
    var level = xpObj ? xpObj.level : 1;
    var prog = xpObj && typeof xpObj.levelProgress === "number" ? xpObj.levelProgress : 0;
    var curXp = 0, nextXp = 50;
    try {
      var lvl = Math.max(1, Number(level) || 1);
      var base = 50 * (lvl - 1) * (lvl - 1), next = 50 * lvl * lvl;
      curXp = Math.max(0, xpTotal - base); nextXp = Math.max(1, next - base);
    } catch (e) {}
    var hoursArr = Array.isArray(d.hours) ? d.hours : null;
    var topList = Array.isArray(d.topPlays) ? d.topPlays : [];
    var favs = Array.isArray(d.favorites) ? d.favorites : [];
    var activity = Array.isArray(d.activity) ? d.activity : [];
    var stats = {
      plays: Number(s.plays) || 0,
      unique: Number(s.unique != null ? s.unique : (s.unique_tracks != null ? s.unique_tracks : 0)) || 0,
      hours: Number(s.hours) || 0,
      streak: Number(d.streak) || 0,
      level: level,
      rank: rank
    };
    /* Share with the achievements panel so it can render without a re-fetch. */
    try { _profileStats = { plays: stats.plays, unique: stats.unique, streak: stats.streak, level: stats.level, rank: stats.rank }; } catch (e) {}
    var eraCounts = {};
    topList.forEach(function (t) { var e = eraFromTrackId(t.track_id); if (e) eraCounts[e] = (eraCounts[e] || 0) + (Number(t.n) || 0); });
    var topEra = null, topEraPlays = 0;
    Object.keys(eraCounts).forEach(function (k) { if (eraCounts[k] > topEraPlays) { topEra = k; topEraPlays = eraCounts[k]; } });

    var banner = (p.bannerChoice === "classic") ? "AlbumArt/999.jpg" : (p.bannerChoice === "custom" && p.banner ? p.banner : eraArt(topEra));
    try { window.__pv2TopEraArt = eraArt(topEra); window.__pv2TopEraLabel = topEra ? eraLabel(topEra) : ""; } catch (e) {}
    var html = '';

    /* Hero */
    html += '<div class="pv2-hero">';
    html += '<img class="pv2-hero-art" id="pv2HeroArt" src="' + esc2(banner) + '" alt="" loading="eager" decoding="async" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'"><div class="pv2-hero-shade"></div>';
    html += '<div class="pv2-hero-inner">';
    html += '<div class="pv2-hero-top"><div><div class="pv2-era-label">Top era</div><div class="pv2-era-name">' + esc2(eraLabel(topEra)) + '</div></div>';
    if (isMe) html += '<button type="button" class="pv2-copy-btn" id="pv2CopyLink" title="Copy profile link" aria-label="Copy profile link"><i class="fas fa-link"></i></button>';
    html += '</div>';
    html += '<div class="pv2-hero-mid"><div class="pv2-avatar-wrap">' + avatarHtml(p) + '<span class="pv2-dot" style="background:#10b981"></span></div>';
    html += '<div class="pv2-meta"><h1 class="pv2-name" id="pv2HeroName">' + esc2(name) + '</h1><p class="pv2-handle">@' + esc2(String(uname).toLowerCase()) + '</p>';
    html += '<p class="pv2-joined">' + (p.joined ? 'Joined ' + esc2(joinedStr(p.joined)) : '') + (dc.linked ? (p.joined ? ' &middot; ' : '') + 'Discord linked' : '') + '</p>';
    html += '<p class="pv2-bio' + (p.bio ? '' : ' hidden') + '" id="pv2HeroBio">' + esc2(p.bio || "") + '</p>';
    if (topEra) html += '<span class="pv2-era-chip"><i class="fas fa-crown"></i>' + esc2(eraLabel(topEra)) + '</span>';
    var favSong = p.favSong || "";
    html += favChipHTML(favSong);
    if (isMe) html += '<div class="pv2-hero-actions"><button type="button" class="pv2-mini-btn" onclick="if(window.openEditProfile)window.openEditProfile()"><i class="fas fa-pen"></i>Edit profile</button></div>';
    html += '</div></div>';
    html += nowPlayingHTML(d.nowPlaying);

    /* Links — shown to everybody on the profile, right under the presence card. */
    var links = Array.isArray(p.links) ? p.links : [];
    html += '<div class="pv2-links">' +
      '<span class="pv2-links-label"><i class="fas fa-link" aria-hidden="true"></i>Links</span>' +
      '<div class="pv2-links-row">' +
      (links.length
        ? links.map(function (l) {
            var url = String((l && l.url) || "").trim();
            var label = String((l && l.label) || "").trim() || url;
            if (!/^https?:\/\//i.test(url)) return "";
            return '<a class="pv2-link-chip" href="' + esc2(url) + '" target="_blank" rel="noopener noreferrer nofollow">' +
              '<i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>' + esc2(label) + '</a>';
          }).join("") || '<span class="pv2-links-empty">No usable links yet.</span>'
        : '<span class="pv2-links-empty">' + (isMe ? 'No links yet &mdash; add them in Edit profile.' : 'No links added yet.') + '</span>') +
      '</div></div>';

    html += '<div class="pv2-strip">';
    html += statBlock(isMe && rank != null ? ordinal(rank) : (rank != null ? ordinal(rank) : "-"), rank != null ? "Leaderboard" : "Unranked");
    html += statBlock(fmtNum(stats.plays), "Plays");
    html += statBlock(Math.round(hoursToMin(stats.hours)) + "m", "Listened");
    html += statBlock(fmtNum(stats.unique), "Songs");
    html += statBlock(fmtNum(stats.streak), "Day streak");
    html += '</div>';
    html += '</div></div>'; /* hero inner / hero */

    /* Fan level + achievements card */
    html += '<div class="pv2-card" style="margin-top:16px"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-bolt"></i>Fan level &amp; achievements</h2><span class="pv2-card-note">' + fmtNum(xpTotal) + ' XP all time</span></div>';
    html += '<div class="pv2-levelrow"><div class="pv2-level-badge"><b>' + esc2(String(level)) + '</b><span>Level</span></div>';
    html += '<div class="pv2-level-meta"><div class="pv2-level-top"><span class="pv2-level-fan">Fan</span><span class="pv2-level-xp">' + fmtNum(curXp) + ' / ' + fmtNum(nextXp) + ' XP</span></div>';
    html += '<div class="pv2-level-bar"><span class="pv2-level-fill" id="pv2LevelFill" style="width:' + Math.round(Math.min(1, Math.max(0, prog)) * 100) + '%"></span></div>';
    html += '<div class="pv2-level-foot"><span class="pv2-level-next">' + (level >= 10 ? "Max level fan in the vault" : (fmtNum(nextXp - curXp) + ' XP to level ' + (level + 1))) + '</span><a class="pv2-xp-link" href="#" onclick="if(window.openXpPanel)window.openXpPanel();return false">How XP works <i class="fas fa-arrow-right" style="font-size:9px"></i></a></div>';
    html += '</div></div>'; /* levelrow */
    html += milestonesHTML(stats);
    html += '</div>';

    /* Grid: top songs / top eras / hours / recent strip */
    html += '<div class="pv2-grid" style="margin-top:16px">';
    html += '<div class="pv2-card" style="grid-column:span 2"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-fire"></i>Top songs</h2><span class="pv2-card-note">' + topList.length + (topList.length === 1 ? ' song' : ' songs') + '</span></div>' + topSongsHTML(topList) + '</div>';
    html += '<div class="pv2-card"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-layer-group"></i>Top eras</h2><span class="pv2-card-note">by your top plays</span></div>' + eraStackHTML(topList) + '</div>';
    /* Your listening pattern is personal - it only appears on your own page,
       never when you are looking at somebody else's profile. */
    if (isMe) {
      html += '<div class="pv2-card" style="grid-column:span 2"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-clock-rotate-left"></i>When you listen</h2><span class="pv2-card-note">24-hour pattern</span></div>' + hourHistogramHTML(hoursArr) + '</div>';
    }
    html += '</div>'; /* grid */

    /* Recently played (self only — the API only answers the signed-in member) */
    if (isMe) {
      html += '<div class="pv2-card" style="margin-top:16px"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-rotate"></i>Recently played</h2></div><div class="pv2-recent" id="pv2Recent"><p class="pv2-none">Loading&hellip;</p></div></div>';
    }

    /* Playlists — the API only sends public ones to other viewers, so this
       card is honest for both your own page and somebody else's. */
    var plists = Array.isArray(d.playlists) ? d.playlists : [];
    html += '<div class="pv2-card" style="margin-top:16px"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-list-music"></i>Playlists</h2><span class="pv2-card-note">' + plists.length + ' saved</span></div>' +
      (plists.length
        ? '<div class="pv2-playlists">' + plists.map(function (p) {
            return '<div class="pv2-playlist"><span class="pv2-playlist-name">' + esc2(p.name || "Untitled") + '</span><span class="pv2-playlist-count">' + (Number(p.count) || 0) + ' songs</span></div>';
          }).join('') + '</div>'
        : '<p class="pv2-none">No public playlists yet.</p>') + '</div>';

    /* Favourites — always present, even when empty, and refreshed live. */
    html += '<div class="pv2-card" style="margin-top:16px"><div class="pv2-card-h"><h2 class="pv2-card-title"><i class="fas fa-heart"></i>Favourites</h2><span class="pv2-card-note" id="pv2FavCount">' + favs.length + ' saved</span></div><div id="pv2Fav">' + collageHTML(favs, isMe) + '</div></div>';

    return html;
  }

  function bindCopy(body, d) {
    var btn = document.getElementById("pv2CopyLink");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var handle = profileKey() || (d && d.profile && d.profile.handle) || "";
      var url = window.location.origin + (isSelfView()
        ? "/Profile"
        : (typeof window.profilePathFor === "function" ? window.profilePathFor(handle) : location.pathname));
      var done = function () {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(function () { btn.innerHTML = '<i class="fas fa-link"></i>'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else {
        try { var ta = document.createElement("textarea"); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); } catch (e) {}
      }
    });
  }
  function bindSongs(body) {
    body.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-play-idx]") : null;
      if (!b) return;
      var idx = parseInt(b.getAttribute("data-play-idx"), 10);
      if (!isNaN(idx) && window.selectTrackFromList) {
        /* selectTrackFromList already loads and plays the track - stay on the
           profile so clicking a top song does not bounce to the player page. */
        try { window.selectTrackFromList(idx); } catch (e) {}
      }
    });
  }
  /* Playing a song from a profile card must not move the reader: some play
     paths switch to another page, and switchAppPage() always scrolls to the
     top, so restore both the page and the exact scroll position. */
  function keepProfileAfterPlay(was, y) {
    setTimeout(function () {
      try {
        var now = document.querySelector(".app-page.active");
        if (was && now && was !== now && window.switchAppPage) {
          window.switchAppPage(String(was.id || "page-section-profile").replace(/^page-section-/, ""));
          /* switchAppPage always scrolls to the top - undo that. */
          window.scrollTo(0, y);
        }
      } catch (e) {}
    }, 140);
  }

  function fillRecent() {
    var host = document.getElementById("pv2Recent");
    if (!host) return;
    fetchJson("/api/recent?limit=12").then(function (d) {
      if (!d || d.ok === false) { host.innerHTML = '<p class="pv2-none">No recent plays yet.</p>'; return; }
      var rows = Array.isArray(d) ? d : (d.recent || []);
      rows = rows.map(function (r) { return r && (r.title || r.track_id || ""); }).filter(Boolean);
      var seen = {}, out = [];
      rows.forEach(function (t) { var k = t.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(t); });
      if (!out.length) { host.innerHTML = '<p class="pv2-none">No recent plays yet. Press play.</p>'; return; }
      host.innerHTML = out.slice(0, 10).map(function (title) {
        var cover = coverForId(title);
        return '<a class="pv2-recent-item" href="#" data-recent-title="' + esc2(title) + '" onclick="return false">' +
          '<img class="pv2-recent-art" src="' + esc2(cover) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'AlbumArt/999.jpg\'">' +
          '<span class="pv2-recent-t">' + esc2(title) + '</span></a>';
      }).join("");
      /* Recent rows play their song in place, like Top songs. Delegated once
         because this list is repainted by the realtime poll. */
      if (!host.__pv2RecentWired) {
        host.__pv2RecentWired = true;
        host.addEventListener("click", function (e) {
          var row = e.target.closest ? e.target.closest("[data-recent-title]") : null;
          if (!row) return;
          e.preventDefault();
          var title = row.getAttribute("data-recent-title") || "";
          var idx = -1;
          try { idx = (typeof trackList !== "undefined") ? trackList.findIndex(function (t) { return String((t || {}).title || "").toLowerCase() === title.toLowerCase(); }) : -1; } catch (err) {}
          if (idx < 0 && window.trackByTitle) {
            var rec = window.trackByTitle(title);
            if (rec && typeof rec.index === "number") idx = rec.index;
          }
          if (idx >= 0 && window.selectTrackFromList) {
            try {
              var was = document.querySelector(".app-page.active");
              var y = window.scrollY;
              window.selectTrackFromList(idx);
              keepProfileAfterPlay(was, y);
            } catch (err) {}
          }
        });
      }
    });
  }
  function fillFavourites() {
    var host = document.getElementById("pv2Fav");
    if (!host) return;
    /* On somebody else's page, ask for their favourites. Using the session
       uid here showed the viewer's own saves under the other member's name. */
    var key = isSelfView() ? "" : profileKey();
    var favUrl = "/api/profile" + (key ? "?user=" + encodeURIComponent(key) : "");
    fetchJson(favUrl).then(function (d) {
      if (!d || d.ok === false) return;
      var favs = Array.isArray(d.favorites) ? d.favorites : [];
      /* Favourites kept only on this device (before sign-in) still count. */
      if (!favs.length) {
        try {
          var map = JSON.parse(localStorage.getItem("jw_favorites") || "{}");
          favs = Object.keys(map).filter(function (k) { return !!map[k]; }).map(function (k) { return { title: k }; });
        } catch (e) {}
      }
      host.innerHTML = collageHTML(favs, isSelfView());
      var note = document.getElementById("pv2FavCount");
      if (note) note.textContent = favs.length + " saved";
      if (!host.__pv2FavWired) {
        host.__pv2FavWired = true;
        host.addEventListener("click", function (e) {
          var info = e.target.closest ? e.target.closest("[data-fav-info]") : null;
          if (info) {
            e.preventDefault();
            e.stopPropagation();
            var ti = info.getAttribute("data-fav-info") || "";
            var ii = -1;
            try { ii = (typeof trackList !== "undefined") ? trackList.findIndex(function (t) { return String((t || {}).title || "").toLowerCase() === ti.toLowerCase(); }) : -1; } catch (err) {}
            /* Open the panel for this song without touching playback. */
            try {
              if (window.showInfoPanel) window.showInfoPanel();
              if (ii >= 0 && typeof refreshInfoPanel === "function") refreshInfoPanel(ii);
            } catch (err) {}
            return;
          }
          var heart = e.target.closest ? e.target.closest("[data-unfav]") : null;
          if (heart) {
            e.preventDefault();
            e.stopPropagation();
            var t = heart.getAttribute("data-unfav") || "";
            var u = sessionUidCache || "";
            try { u = u || localStorage.getItem("wantedUserId") || ""; } catch (err) {}
            fetch("/api/account", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "toggleFavorite", title: t, user: u }),
            }).then(function (r) { return r.json().catch(function () { return {} }); })
              .then(function (d) {
                if (!d || !d.ok) return;
                /* Keep the on-device fallback in step with the server so an
                   unfavourited song cannot reappear through it. */
                try {
                  var map = JSON.parse(localStorage.getItem("jw_favorites") || "{}");
                  Object.keys(map).forEach(function (k) {
                    if (String(k).toLowerCase() === t.toLowerCase()) delete map[k];
                  });
                  localStorage.setItem("jw_favorites", JSON.stringify(map));
                } catch (err) {}
                fillFavourites();
              })
              .catch(function () {});
            return;
          }
          var btn = e.target.closest ? e.target.closest("[data-fav-title]") : null;
          if (!btn) return;
          e.preventDefault();
          var title = btn.getAttribute("data-fav-title") || "";
          var idx = -1;
          try { idx = (typeof trackList !== "undefined") ? trackList.findIndex(function (t) { return String((t || {}).title || "").toLowerCase() === title.toLowerCase(); }) : -1; } catch (err) {}
          if (idx < 0) return;
          var was = document.querySelector(".app-page.active");
          var y = window.scrollY;
          try { if (window.selectTrackFromList) window.selectTrackFromList(idx); } catch (err) {}
          keepProfileAfterPlay(was, y);
        });
      }
    }).catch(function () {});
  }

  /* Recently played updates in realtime while the profile is on screen: a
     short poll, paused when the tab is hidden, so a play made anywhere on the
     site shows up here without a reload. */
  try {
    if (!window.__pv2RecentPoll) {
      window.__pv2RecentPoll = setInterval(function () {
        var sec = document.getElementById("page-section-profile");
        if (!document.hidden && sec && sec.classList.contains("active")) {
          if (document.getElementById("pv2Recent")) fillRecent();
          if (document.getElementById("pv2Fav")) fillFavourites();
        }
      }, 8000);
    }
  } catch (e) {}

  /* Profile addresses are always /@handle. The handle is the member's Discord
     username, never a site uid; once the API resolves the key the address bar
     is replaced with the handle form. */
  function canonicaliseProfileAddress(apiData) {
    try {
      var handle = (apiData && (apiData.handle || (apiData.profile && apiData.profile.username))) || "";
      handle = String(handle).trim().replace(/^@/, "");
      if (!handle) return;
      var want = (typeof window.profilePathFor === "function")
        ? window.profilePathFor(handle)
        : "/@" + encodeURIComponent(handle);
      if (location.pathname !== want && history.replaceState) {
        history.replaceState({ profile: handle }, "", want);
      }
    } catch (e) {}
  }

  var _profileRenderGen = 0;
  function renderFullProfile() {
    var host = document.getElementById("profilePageBody");
    if (!host) return;
    var gen = ++_profileRenderGen;
    function current() { return gen === _profileRenderGen && document.getElementById("profilePageBody") === host; }
    host.classList.remove("cmp-profile-host");
    host.innerHTML = '<div class="pv2-signin"><i class="fas fa-circle-notch fa-spin"></i><p>Loading your profile&hellip;</p></div>';
    loadData().then(function (d) {
      if (!current()) return; /* a newer profile was opened while this one loaded */
      if (!d || !d.profile) { host.innerHTML = '<div class="pv2-page">' + signInGate() + '</div>'; return; }
      if (d.profile.ok === false) { host.innerHTML = '<div class="pv2-page">' + signInGate() + '</div>'; return; }
      if (d.profile.hidden) { host.innerHTML = '<div class="pv2-page">' + privateGate() + '</div>'; return; }
      try {
        /* loadData() already puts the whole /api/profile response in d.profile,
           links included. Do not overwrite it from the wrapper - that wiped
           everybody's links and showed "No links added yet." on every page. */
        if (!Array.isArray(d.profile.links)) d.profile.links = [];
        host.innerHTML = '<div class="pv2-page">' + buildPage(d.profile, d.xp, d.self) + '</div>';
        bindCopy(host, d.profile);
        bindSongs(host);
        wireAchievementClicks(host);
        canonicaliseProfileAddress(d.profile);
        fillRecent();
        fillFavourites();
        afterMount();
        /* Rebuild the user's playlist manager (and its Create button) after
           the v2 host is painted - an earlier mount would be wiped here. */
        try { if (typeof window.thwMountPlaylistsManager === "function") window.thwMountPlaylistsManager(); } catch (e) {}
        window.__pv2Mounted = true;
      } catch (e) {
        console.error("profile render failed", e);
        host.innerHTML = renderError("Something broke while drawing the page.");
      }
    })["catch"](function () {
      if (current()) renderInto(host, renderError("The vault didn't answer. Try again in a moment."));
    });
  }

  /* ---------- Achievements panel (how to unlock) ---------- */
  /* Stats bundle kept from the last render so the panel can show real state. */
  var _profileStats = { plays: 0, unique: 0, streak: 0, level: 1, rank: null };
  function renderAchievementsPanel(stats) {
    var host = document.getElementById("achievementsBody");
    if (!host) return;
    var html = '';
    MILESTONES.forEach(function (m) {
      var unlocked = m.test(stats);
      html += '<div class="ach-row' + (unlocked ? ' unlocked' : '') + '">' +
        '<span class="ach-row-icon"><i class="fas ' + esc2(m.icon) + '"></i></span>' +
        '<span class="ach-row-meta"><b>' + esc2(m.label) + '</b><span>' + esc2(m.how) + '</span></span>' +
        '<span class="ach-row-state">' + (unlocked ? '<i class="fas fa-check-circle" aria-hidden="true"></i>Unlocked' : '<i class="fas fa-lock" aria-hidden="true"></i>Locked') + '</span>' +
      '</div>';
    });
    host.innerHTML = html;
  }
  function openAchievementsPanel() {
    /* Uses the stats bundle captured at render time — no second request. */
    var stats = _profileStats || { plays: 0, unique: 0, streak: 0, level: 1, rank: null };
    renderAchievementsPanel(stats);
    setModalOpen("achievementsModal", true);
  }
  window.openAchievementsPanel = openAchievementsPanel;

  /* Wire clicks on the badge grid and the "How to unlock" link. */
  function wireAchievementClicks(hostEl) {
    hostEl.addEventListener("click", function (e) {
      var badge = e.target.closest ? e.target.closest(".pv2-ach") : null;
      var how = e.target.closest ? e.target.closest("#pv2AchHow") : null;
      if (how) { e.preventDefault(); openAchievementsPanel(); return; }
      if (badge) { openAchievementsPanel(); }
    });
  }

  /* ---------- Rank / How XP works panel ---------- */
  var LADDER = [
    { t: "Newcomer", l: 1, dot: "#8b8b93" },
    { t: "Listener", l: 3, dot: "#f59e0b" },
    { t: "Fan", l: 7, dot: "#f4f4f6" },
    { t: "Day One", l: 14, dot: "#fcd34d" },
    { t: "Lucid Dreamer", l: 24, dot: "#2dd4bf" },
    { t: "Righteous", l: 60, dot: "#60a5fa" },
    { t: "Legend", l: 150, dot: "#22d3ee" },
    { t: "999", l: 400, dot: "#fb7185" },
    { t: "Forever 999", l: 999, dot: "#f43f5e" }
  ];
  function xpForLevel(n) { return 50 * (n - 1) * (n - 1); }
  function rankTitle(level) {
    var title = LADDER[0].t;
    for (var i = 0; i < LADDER.length; i++) { if (level >= LADDER[i].l) title = LADDER[i].t; }
    return title;
  }
  function fmtInt(n) { return (Number(n) || 0).toLocaleString(); }

  function setModalOpen(id, open) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle("open", !!open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  function renderXpPanel(d) {
    var me = d && d.me ? d.me : null;
    var progressHost = document.getElementById("rankProgress");
    var ladderHost = document.getElementById("rankLadder");

    /* Progress block */
    if (progressHost) {
      if (!me) {
        progressHost.innerHTML = '<p class="rank-signin">Sign in and every play moves you up the ladder. <a href="#" id="rankSignInLink">Sign in</a></p>';
        var link = document.getElementById("rankSignInLink");
        if (link) link.addEventListener("click", function (e) {
          e.preventDefault();
          setModalOpen("xpPanelModal", false);
          if (window.switchAppPage) window.switchAppPage("login");
        });
      } else {
        var level = Number(me.level) || 1;
        var total = Number(me.xp) || 0;
        var lvlBase = xpForLevel(level), nextBase = xpForLevel(level + 1);
        var into = Math.max(0, total - lvlBase), span = Math.max(1, nextBase - lvlBase);
        var pct = Math.round(Math.min(1, into / span) * 100);
        var title = rankTitle(level);
        var titleDot = (function () { for (var i = LADDER.length - 1; i >= 0; i--) { if (level >= LADDER[i].l) return LADDER[i].dot; } return LADDER[0].dot; })();
        var nextRung = null;
        for (var li = 0; li < LADDER.length; li++) { if (LADDER[li].l > level) { nextRung = LADDER[li]; break; } }
        progressHost.innerHTML =
          '<span class="rank-pill"><i style="background:' + esc2(titleDot) + '"></i>' + esc2(title) + ' · Level ' + esc2(String(level)) + '</span>' +
          '<div class="rank-bigrow"><div class="rank-bigxp"><b>' + fmtInt(total) + '</b><span>XP in all</span></div>' +
          '<span class="rank-nextlevel">' + (nextRung ? fmtInt(nextBase - total) + ' XP to level ' + (level + 1) : 'Max level') + '</span></div>' +
          '<div class="rank-bar"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div>' +
          (nextRung
            ? '<p class="rank-nextrank"><span class="rank-nextrank-dot" style="background:' + esc2(nextRung.dot) + '"></span>Next rank: <b>' + esc2(nextRung.t) + '</b> at Level ' + nextRung.l + ' · ' + fmtInt(nextBase - total) + ' XP away</p>'
            : '<p class="rank-nextrank"><span class="rank-nextrank-dot" style="background:#f43f5e"></span>Top of the ladder - <b>Forever</b></p>') +
          '<p class="rank-week">This week: <b>' + fmtInt(me.week_xp || 0) + ' XP</b> in the vault</p>';
      }
    }

    /* The ladder (two columns, lowest first) */
    if (ladderHost) {
      var myLevel = me ? (Number(me.level) || 1) : 0;
      ladderHost.innerHTML = LADDER.map(function (rung, i) {
        var done = myLevel >= rung.l;
        var isCurrent = myLevel > 0 && done && (i === LADDER.length - 1 || myLevel < LADDER[i + 1].l);
        return '<li class="rank-rung' + (isCurrent ? ' current' : '') + '"><span class="rank-dot" style="background:' + esc2(rung.dot) + '"></span><span class="rank-rung-name">' + esc2(rung.t) + (isCurrent ? '' : '') + '</span>' + (isCurrent ? '<span class="rank-rung-tag">Your rank</span>' : '') + '<span class="rank-rung-lvl">Level ' + rung.l + '</span></li>';
      }).join("");
    }
  }

  function openXpPanel() {
    setModalOpen("xpPanelModal", true);
    var ladderHost = document.getElementById("rankLadder");
    if (ladderHost) ladderHost.innerHTML = '<li class="rank-rung"><span class="rank-rung-medal"><i class="fas fa-circle-notch fa-spin"></i></span><span class="rank-rung-text"><b>Loading the ladder&hellip;</b></span></li>';
    fetchJson("/api/xp?limit=1").then(function (d) { renderXpPanel(d || null); });
  }
  window.openXpPanel = openXpPanel;

  /* Close on backdrop click and Escape (the data-close buttons are handled by account.js). */
  (function wireRankModalDismiss() {
    var overlay = document.getElementById("xpPanelModal");
    if (!overlay) return;
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) setModalOpen("xpPanelModal", false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) setModalOpen("xpPanelModal", false);
    });
  })();

  (function wireAchievementsModalDismiss() {
    var overlay = document.getElementById("achievementsModal");
    if (!overlay) return;
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) setModalOpen("achievementsModal", false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) setModalOpen("achievementsModal", false);
    });
  })();

  /* ---------- live presence (rich mini-player) ---------- */
  var headTimer = null, headKnown = null, presenceTimer = null;
  var presenceState = null;
  var ownTrackIsCatalogue = false;
  var presenceTrackIndex = -1;

  function headPollUid() {
    try {
      if (sessionUidCache) return sessionUidCache;
      return isSelfView() ? (localStorage.getItem("wantedUserId") || "") : profileKey();
    } catch (e) { return ""; }
  }
  function stopHeadPoll() { if (headTimer) { clearInterval(headTimer); headTimer = null; } }
  function startHeadPoll() {
    stopHeadPoll();
    var uid = headPollUid();
    if (!uid) return;
    headTimer = setInterval(pollHead, 5000);
  }
  function secs(x) { x = Math.max(0, Number(x) || 0); var m = Math.floor(x / 60), s = Math.floor(x % 60); return m + ":" + (s < 10 ? "0" : "") + s; }
  function presenceTick() {
    if (!presenceState || !presenceState.title) return;
    var now = Date.now();
    var pos = presenceState.anchorMs;
    if (presenceState.playing) pos += now - presenceState.anchorAt;
    pos = Math.max(0, Math.min(presenceState.durationMs || pos, pos));
    var pct = presenceState.durationMs ? Math.min(100, (pos / presenceState.durationMs) * 100) : 0;
    var fill = document.getElementById("pv2NowBarFill");
    if (fill) fill.style.width = pct + "%";
    var cur = document.getElementById("pv2NowCur");
    if (cur) cur.textContent = secs(pos / 1000);
    var dur = document.getElementById("pv2NowDur");
    if (dur) dur.textContent = presenceState.durationMs ? secs(presenceState.durationMs / 1000) : "--:--";
  }
  function stopPresenceTimer() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }
  function startPresenceTimer() {
    stopPresenceTimer();
    presenceTimer = setInterval(presenceTick, 500);
    presenceTick();
  }
  function applyNowPlaying(np) {
    var block = document.getElementById("pv2Now");
    if (!block) return;
    var title = document.getElementById("pv2NowTitle");
    var art = document.getElementById("pv2NowArt");
    var live = document.getElementById("pv2NowEq");
    if (!np || !np.title) {
      block.classList.add("hidden");
      presenceState = null;
      stopPresenceTimer();
      return;
    }
    var rec = trackByTitle(np.trackId || np.title);
    var idx = (typeof playIndexById === "function") ? playIndexById(np.trackId || np.title) : -1;
    var el = function (id) { return document.getElementById(id); };
    block.classList.remove("hidden");
    block.dataset.title = np.title;
    if (title) title.textContent = np.title;
    var album = el("pv2NowAlbum");
    if (album) {
      var a = rec && rec.track ? eraLabel(eraOfTag(rec.track.tag)) + " · " + (rec.track.year || "") : "Juice WRLD";
      album.textContent = a;
    }
    if (art) art.src = (rec && rec.track && rec.track.cover) ? rec.track.cover : eraArt(rec && rec.track ? eraOfTag(rec.track.tag) : null);
    var playBtn = el("pv2NowPlay");
    if (playBtn) {
      playBtn.setAttribute("data-play-idx", idx);
      playBtn.disabled = idx < 0;
      playBtn.title = idx >= 0 ? "Play this track" : "Not in the catalogue";
    }
    if (live) live.classList.toggle("paused", np.playing === false);
    var liveEl = block.querySelector(".pv2-now-live");
    if (liveEl) liveEl.classList.toggle("paused", np.playing === false);
    /* Re-anchor. Seek backwards bends the anchor into the past; it lands here
       because every publish/protocol is client-authoritative on position. */
    presenceState = {
      title: np.title,
      anchorMs: Math.max(0, Number(np.positionMs) || 0),
      durationMs: Number(np.durationMs) || 0,
      playing: np.playing !== false,
      anchorAt: typeof np.positionAt === "string" || typeof np.positionAt === "number" ? (typeof np.positionAt === "number" ? np.positionAt : Date.parse(np.positionAt)) : Date.now(),
    };
    if (!isFinite(presenceState.anchorAt) || presenceState.anchorAt > Date.now() + 60000) presenceState.anchorAt = Date.now();
    startPresenceTimer();
  }
  function renderNowPlaying(np) { applyNowPlaying(np); }
  function applyHead(d) {
    var changed = false;
    var prev = headKnown;
    headKnown = { name: d.name, bio: d.bio, avatar: d.avatar, bannerChoice: d.bannerChoice, favSong: d.favSong };
    if (prev && prev.name === d.name && prev.bio === d.bio && prev.avatar === d.avatar && prev.bannerChoice === d.bannerChoice && prev.favSong === d.favSong) {
      renderNowPlaying(d.nowPlaying);
      return;
    }
    changed = true;
    var n = document.getElementById("pv2HeroName"); if (n && d.name) n.textContent = d.name;
    var b = document.getElementById("pv2HeroBio");
    if (b) {
      if (d.bio) { b.textContent = d.bio; b.classList.remove("hidden"); }
      else { b.textContent = ""; b.classList.add("hidden"); }
    }
    var av = document.getElementById("pv2HeroAvatar");
    if (av && prev && prev.avatar !== d.avatar) {
      if (d.avatar) av.outerHTML = '<img class="pv2-avatar" id="pv2HeroAvatar" src="' + esc2(d.avatar) + '" alt="" decoding="async" onerror="this.onerror=null;this.style.display=\'none\'">';
      else av.outerHTML = '<div class="pv2-avatar-fallback" id="pv2HeroAvatar" aria-hidden="true">' + esc2(initials(d.name)) + '</div>';
    }
    var banner = document.getElementById("pv2HeroArt");
    if (banner && prev && prev.bannerChoice !== d.bannerChoice) {
      banner.src = d.bannerChoice === "classic" ? "AlbumArt/999.jpg" : (window.__pv2TopEraArt || "AlbumArt/999.jpg");
    }
    if (prev && prev.favSong !== d.favSong) {
      var chip = document.getElementById("pv2FavChip");
      if (chip) chip.outerHTML = favChipHTML(d.favSong);
    }
    if (changed) {
      /* The edit modal tracks _profile itself, but keep the cache fresh for it. */
      try { window.__pv2HeadCache = headKnown; } catch (e) {}
    }
    renderNowPlaying(d.nowPlaying);
  }
  function pollHead() {
    var uid = headPollUid();
    if (!uid) return;
    fetchJson("/api/profile?user=" + encodeURIComponent(uid) + "&head=1").then(function (d) {
      if (!d || d.ok === false) return;
      if (d.hidden) return;
      applyHead(d);
    });
  }

  /* While signed in and playing, tell the vault what's on (one row, 5-min TTL).
     The position rides along so a friend watching this page sees the same
     seek, not a stale one. The anchor is published on track change, on
     every play/seek, and at most every ~2.5 s otherwise - enough for the
     viewer's progress bar to stay smooth. */
  var lastPresenceTrack = null;
  var presenceRateAt = 0;
  function publishPresence(force) {
    try {
      if (!isSelfView()) return;
      var uid = headPollUid();
      if (!uid) return;
      if (typeof isPlaying === "undefined" || !isPlaying) return;
      var idx = (typeof currentTrackIndex === "number") ? currentTrackIndex : -1;
      var src = (typeof trackList !== "undefined" && trackList) ? trackList : [];
      var t = idx >= 0 ? src[idx] : null;
      if (!t || !t.title) return;
      var a = document.querySelector("audio");
      var artwork = "AlbumArt/999.jpg";
      if (t.cover) artwork = String(t.cover);
      else { var cr = coverForId(t.title); if (cr) artwork = cr; }
      if (!force) {
        var now = Date.now();
        if (t.title === lastPresenceTrack && now - presenceRateAt < 8000) return;
        if (now - presenceRateAt < 2000) return;
        presenceRateAt = now;
      } else {
        presenceRateAt = Date.now();
      }
      lastPresenceTrack = t.title;
      var positionMs = a ? Math.max(0, Math.floor((a.currentTime || 0) * 1000)) : 0;
      var durationMs = a && isFinite(a.duration) && a.duration > 0 ? Math.floor(a.duration * 1000) : 0;
      var playing = a ? !a.paused : true;
      fetch("/api/activity", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "listening", trackId: String(t.title).slice(0, 140),
          title: String(t.title).slice(0, 160),
          artist: String(t.artist || "Juice WRLD").slice(0, 120),
          artwork: artwork.slice(0, 300),
          positionMs: positionMs,
          durationMs: durationMs,
          playing: playing,
          positionAt: Date.now(),
        })
      }).catch(function () {});
    } catch (e) {}
  }

  /* The Edit panel (or anything else) can push a live hero update. */
  window.__pv2ApplyLive = function (partial) {
    partial = partial || {};
    if (partial.name != null) { var n = document.getElementById("pv2HeroName"); if (n) n.textContent = String(partial.name); }
    if (partial.bio != null) {
      var b = document.getElementById("pv2HeroBio");
      if (b) {
        if (partial.bio) { b.textContent = String(partial.bio); b.classList.remove("hidden"); }
        else { b.textContent = ""; b.classList.add("hidden"); }
      }
    }
    if (partial.favSong != null) {
      var chip = document.getElementById("pv2FavChip");
      if (chip) chip.outerHTML = favChipHTML(String(partial.favSong));
    }
    if (partial.avatar != null) {
      var av = document.getElementById("pv2HeroAvatar");
      if (av) {
        if (partial.avatar) av.outerHTML = '<img class="pv2-avatar" id="pv2HeroAvatar" src="' + esc2(String(partial.avatar)) + '" alt="" decoding="async" onerror="this.onerror=null;this.style.display=\'none\'">';
        else av.outerHTML = '<div class="pv2-avatar-fallback" id="pv2HeroAvatar" aria-hidden="true">' + esc2(initials(String(partial.name || "999"))) + '</div>';
      }
    }
  };

  /* Kick off live bits once the page has rendered. */
  function afterMount() {
    startHeadPoll();
    publishPresence();
    setInterval(publishPresence, 8000);
    /* Position/anchor publishes for the viewer watching from anywhere: stay
       smooth without a flood of requests while still landing every seek. */
    var a = document.querySelector("audio");
    if (a && !a._presenceWired) {
      a._presenceWired = true;
      var last = 0;
      a.addEventListener("timeupdate", function () {
        var now = Date.now();
        if (now - last < 2500) return;
        last = now;
        publishPresence(true);
      });
      a.addEventListener("seeked", function () { last = 0; publishPresence(true); });
      a.addEventListener("play", function () { publishPresence(true); });
      a.addEventListener("pause", function () { publishPresence(true); });
    }
  }

  /* Take the profile page over completely. */
  window.renderProfilePageBody = renderFullProfile;
  window.profileSectionShown = function () { renderFullProfile(); };
  window.__THW_PROFILE_V2 = true;

  /* Delete the retired profile layout, do not merely hide it. Several legacy
     modules (profile-enhancements, wrld-stats, follows, privacy, playlists-ui)
     still append their old cards into #profilePageBody. The v2 profile is the
     only layout this page serves, so strip those nodes as they are added - the
     observer catches late/asynchronous mounts, the periodic pass catches any
     that slipped through. */
  function purgeLegacyProfileBlocks() {
    var host = document.getElementById("profilePageBody");
    if (!host) return;
    var sel = ".pv-block, .ws-block, .pp-shelf, .cmp-head, .cmp-sec-card";
    Array.prototype.forEach.call(host.querySelectorAll(sel), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }
  try {
    if (!window.__pv2LegacyPurge) {
      window.__pv2LegacyPurge = true;
      var legacyObserver = new MutationObserver(purgeLegacyProfileBlocks);
      legacyObserver.observe(document.documentElement, { childList: true, subtree: true });
      setInterval(purgeLegacyProfileBlocks, 500);
    }
  } catch (e) {}
  purgeLegacyProfileBlocks();

  /* Stacking fix: #editProfileModal and #xpPanelModal ship inside <main>,
     which carries position:relative + z-index:1 and therefore forms a stacking
     context that traps the modals below the fixed nav (z-50). Re-parenting
     them to <body> lets their own z-index:420 beat the nav everywhere. */
  try {
    ["editProfileModal", "xpPanelModal"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentElement !== document.body) document.body.appendChild(el);
    });
  } catch (e) {}

  /* Scroll lock, one rule for every overlay that owns the screen:
       - #app-boot (the boot splash) until it fades out,
       - #wrldlog-overlay (the WRLD Log splash) while it is shown,
       - any element carrying .modal-overlay.open (all site modals).
     A single MutationObserver watches classes/styles and flips one class on
     <html>; profile.css freezes scroll while it is set. */
  try {
    var lockQueued = false;
    function syncScrollLock() {
      lockQueued = false;
      var locked = false;
      var boot = document.getElementById("app-boot");
      if (boot && !boot.classList.contains("gone")) locked = true;
      if (!locked) {
        var wl = document.getElementById("wrldlog-overlay");
        if (wl) {
          var d = "";
          try { d = getComputedStyle(wl).display; } catch (e) {}
          if (d && d !== "none") locked = true;
        }
      }
      if (!locked && document.querySelector(".modal-overlay.open")) locked = true;
      if (!locked && document.body && document.body.style.overflow === "hidden") document.body.style.overflow = "";
      document.documentElement.classList.toggle("thw-scroll-locked", !!locked);
    }
    function queueSync() { if (!lockQueued) { lockQueued = true; requestAnimationFrame(syncScrollLock); } }
    var observer = new MutationObserver(queueSync);
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    syncScrollLock();
    /* The boot splash transitions in after load; make sure the class settles. */
    setTimeout(syncScrollLock, 500);
    setTimeout(syncScrollLock, 1500);
  } catch (e) {}

  /* If the profile page is already active when this script loads (deep link), render now. */
  try {
    var page = document.getElementById("page-section-profile");
    if (page && ((location.pathname || "").toLowerCase().indexOf("/profile") === 0)) {
      if (window.switchAppPage) window.switchAppPage("profile");
      window.setTimeout(renderFullProfile, 0);
    }
  } catch (e) {}
})();
