(function () {
  "use strict";

  var uid = "";
  try { uid = localStorage.getItem("wantedUserId") || ""; } catch (e) {}
  var uidSuffix = uid ? uid.slice(-4).toUpperCase() : "0000";

  var _data = null;
  var _pollTimer = null;
  var _pendingDiscordBioPrompt = false;
  var _visible = false;
  var _cachedTheme = "default";
  try { _cachedTheme = localStorage.getItem("wantedTheme") || "default"; } catch (e) {}
  var _cachedLang = "en";
  try { _cachedLang = localStorage.getItem("wantedLang") || "en"; } catch (e) {}
  var _themeTarget = document.documentElement;
  try {
    var _earlyTheme = localStorage.getItem("wantedTheme");
    if (_earlyTheme) { _themeTarget.setAttribute("data-theme", _earlyTheme); }
  } catch (e) {}
  var _profile = { name: "999_" + uidSuffix, bio: "", status: "Online", avatar: "", banner: "" };

  /* ---------- Appearance overrides (accent + ambient glow) ---------- */
  var _ap = { accent: "", glow: "" };
  try {
    var _apRaw = JSON.parse(localStorage.getItem("apSettings") || "{}");
    _ap.accent = typeof _apRaw.accent === "string" ? _apRaw.accent : "";
    _ap.glow = typeof _apRaw.glow === "string" ? _apRaw.glow : "";
  } catch (e) {}
  function apAmbient() {
    var el = document.getElementById("ap-ambient");
    if (!el) {
      el = document.createElement("div");
      el.id = "ap-ambient";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return el;
  }
  function applyAppearance() {
    var root = document.body;
    if (_ap.accent) root.setAttribute("data-accent", _ap.accent);
    else root.removeAttribute("data-accent");
    var ap = document.getElementById("account-page");
    if (ap) {
      if (_ap.accent) ap.setAttribute("data-accent", _ap.accent);
      else ap.removeAttribute("data-accent");
    }
    var amb = apAmbient();
    if (_ap.glow) amb.setAttribute("data-glow", _ap.glow);
    else amb.removeAttribute("data-glow");
  }
  applyAppearance();

  /* ---------- Toasts ---------- */
  function toast(msg, type) {
    var box = document.getElementById("toasts");
    if (!box) return;
    var el = document.createElement("div");
    el.className = "toast " + (type || "info");
    var ico = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    el.innerHTML = '<i class="fas ' + ico + '"></i>' + msg;
    box.appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; el.style.transform = "translateX(30px)"; setTimeout(function () { el.remove(); }, 300); }, 4000);
  }

  /* ---------- Button loading state ---------- */
  function btnBusy(btn, on) {
    if (!btn) return;
    if (on) { btn.classList.add("is-loading"); btn.disabled = true; }
    else { btn.classList.remove("is-loading"); btn.disabled = false; }
  }

  /* ---------- API ---------- */
  function api(body) {
    body.user = uid;
    return fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }
  function loadAccount() {
    if (!uid) return Promise.resolve(null);
    return fetch("/api/account?user=" + encodeURIComponent(uid), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) { _data = d; renderAll(); } })
      .catch(function () {});
  }

  /* ---------- Small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function relTime(ts) {
    if (!ts) return "";
    var d = Date.now() - Date.parse(ts);
    if (isNaN(d)) return "";
    var s = Math.floor(d / 1000);
    if (s < 60) return _tt("justNow", "just now");
    if (s < 3600) return Math.floor(s / 60) + _tt("minAgo", "m ago");
    if (s < 86400) return Math.floor(s / 3600) + _tt("hourAgo", "h ago");
    return Math.floor(s / 86400) + _tt("dayAgo", "d ago");
  }
  function fmtDate(ts) {
    if (!ts) return "";
    var dt = new Date(ts);
    if (isNaN(dt)) return "";
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function initial(name) {
    var s = String(name || "9").trim();
    var ch = s ? s.charAt(0).toUpperCase() : "9";
    if (!/[A-Z0-9]/.test(ch)) ch = "9";
    return ch;
  }
  function stLabel(status) {
    if (status === "Online") return _tt("stOnline", "Online");
    if (status === "Idle") return _tt("stIdle", "Idle");
    if (status === "Do Not Disturb") return _tt("stDnd", "Do Not Disturb");
    return status || _tt("stOnline", "Online");
  }

  /* ---------- Profile ---------- */
  function applyProfile() {
    var p = _profile;
    var aInner = document.getElementById("profileAvatarInner");
    if (aInner) {
      aInner.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : esc(initial(p.name));
    }
    var nav = document.getElementById("navAvatarInner");
    if (nav) nav.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : esc(initial(p.name));var mbn = document.getElementById("mbnAvatarInner");if (mbn) mbn.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : esc(initial(p.name));
    var n = document.getElementById("profileName"); if (n) n.textContent = p.name || "999_" + uidSuffix;
    var h = document.getElementById("profileHandle");
    if (h) h.innerHTML = "@" + esc(String(profileUsername() || p.name || "999").toLowerCase()) + ((_data && _data.discord && _data.discord.linked) ? ' <span class="disc-tag"><i class="fab fa-discord"></i> #' + uidSuffix + "</span>" : "");
    var b = document.getElementById("profileBio"); if (b) b.textContent = p.bio || "";
    var st = document.getElementById("pStatus"); if (st) st.textContent = stLabel(p.status || "Online");
    var dot = document.getElementById("onlineDot");
    if (dot) {
      var c = "#64748b";
      if (p.status === "Online") c = "#10b981";
      else if (p.status === "Idle") c = "#f59e0b";
      else if (p.status === "Do Not Disturb") c = "#ef4444";
      dot.style.background = c;
      dot.style.boxShadow = "0 0 14px " + c;
    }
    var sDot = document.getElementById("pStatusDot");
    if (sDot) sDot.style.color = dot ? dot.style.background : "#10b981";
    var set = document.getElementById("setName"); if (set) set.value = p.name;
    var setB = document.getElementById("setBio"); if (setB) setB.value = p.bio;
    var setS = document.getElementById("setStatus"); if (setS) setS.value = p.status;
    var mN = document.getElementById("mName"); if (mN) mN.value = p.name;
    var mB = document.getElementById("mBio"); if (mB) mB.value = p.bio;
    var mS = document.getElementById("mStatus"); if (mS) mS.value = p.status;
    var pn = document.getElementById("profName"); if (pn) pn.value = p.name;
    var pb = document.getElementById("profBio"); if (pb) pb.value = p.bio;
    var ap = document.getElementById("avatarPreview"); if (ap) ap.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="">' : '<i class="fas fa-user"></i>';
    var mp = document.getElementById("mAvatarPreview"); if (mp) mp.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="">' : '<i class="fas fa-user"></i>';
  }

  /* ---------- Compact profile card (Wanted / Suggestions tabs) ---------- */
  function profileUsername() {
    var u = "";
    if (_data && _data.profile && _data.profile.username) u = _data.profile.username;
    if (!u) u = _profile.username || "";
    return u;
  }
  function delMatch(val, uname) {
    var v = String(val || "").trim().toLowerCase();
    var u = String(uname || "").trim().toLowerCase();
    return !!(v && (v === u || v === ("@" + u)));
  }
  function vaultTracks() {
    if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList.length;
    var n = 0;
    if (typeof window !== "undefined" && window.trackList) n = window.trackList.length || 0;
    return n || 248;
  }
  function vaultHours() {
    var secs = 0;
    var src = (typeof trackList !== "undefined" && trackList) ? trackList : null;
    if (src) {
      for (var i = 0; i < src.length; i++) { secs += Number(src[i] && src[i].duration) || 0; }
    }
    return (secs ? Math.floor(secs / 3600) : 32) + "h+";
  }
  function cmpAvatarHtml(avatar, name) {
    return avatar ? '<img src="' + esc(avatar) + '" alt="">' : esc(initial(name));
  }
  function cmpVerifiedHtml(linked) {
    return linked ? '<span class="cmp-verified"><i class="fab fa-discord"></i> ' + esc(_tt("verifiedBadge", "Verified")) + '</span>' : '';
  }
  function compactProfileHtml(includeSections) {
    if (!uid) {
      return '<div class="cmp-page"><div class="cmp-signin"><i class="fas fa-user-circle" style="font-size:26px;color:#22d3ee"></i><div>' + esc(_tt("cmpSignIn", "Sign in to show your profile here.")) + ' <a href="#" onclick="event.preventDefault();if(window.switchAppPage)window.switchAppPage(\'account\')">' + esc(_tt("signIn", "Sign In")) + '</a></div></div></div>';
    }
    if (!_data) {
      return '<div class="cmp-page"><div style="font-size:11px;color:var(--ac-dim);text-align:center;padding:8px">' + esc(_tt("loadingProfile", "Loading profile...")) + '</div></div>';
    }
    var p = _data.profile || {};
    var st = _data.stats || {};
    var d = _data.discord || {};
    var uname = profileUsername() || uid || "999_" + uidSuffix;
    var dotC = "#64748b";
    if (p.status === "Online") dotC = "#10b981";
    else if (p.status === "Idle") dotC = "#f59e0b";
    else if (p.status === "Do Not Disturb") dotC = "#ef4444";
    var html = '';
    html += '<div class="cmp-page">';
    html += '<div class="cmp-head">';
    html += '<div class="cmp-top"><span class="cmp-avatar-wrap"><span class="cmp-avatar-ring"><span class="cmp-avatar">' + cmpAvatarHtml(p.avatar, p.name) + '</span></span><span class="cmp-online" style="background:' + dotC + ';box-shadow:0 0 10px ' + dotC + '"></span></span>';
    html += '<div class="cmp-id"><div class="cmp-name-row"><h2 class="cmp-name">' + esc(p.name || "999_" + uidSuffix) + '</h2>' + cmpVerifiedHtml(!!d.linked) + '</div>';
    html += '<div class="cmp-handle">@' + esc(String(uname).toLowerCase()) + '</div>';
    html += '<div class="cmp-meta">' + esc(stLabel(p.status || "Online")) + (p.joined ? ' &middot; ' + esc(_tt("joinedWord", "Joined")) + ' ' + esc(fmtDate(p.joined)) : '') + '<span class="cmp-site-presence" data-uid="' + esc(String(uid)) + '"></span></div></div></div>';
    html += '<div class="cmp-bio">' + esc(p.bio || _tt("cmpNoBio", "No bio yet - let the 999s know who you are.")) + '</div>';
    html += '<div class="cmp-qstats">';
    html += qstat((Number(st.plays) || 0).toLocaleString(), _tt("qstatPlays", "Plays"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat(ppTime(st.hours), _tt("listenedWord", "Listened"));
    html += '</div>';
    html += '<div class="cmp-actions">';
    html += '<a class="cmp-btn" href="#" onclick="event.preventDefault();if(window.switchAppPage)window.switchAppPage(\'player\')"><i class="fas fa-play"></i>' + esc(_tt("cmpPlayer", "WRLD Player")) + '</a>';
    html += '<a class="cmp-btn" href="#" onclick="event.preventDefault();if(window.switchAppPage)window.switchAppPage(\'hub\')"><i class="fas fa-crown"></i>' + esc(_tt("cmpVault", "The Vault")) + '</a>';
    html += '<button type="button" class="cmp-btn" onclick="if(window.openEditProfile)window.openEditProfile()"><i class="fas fa-pen"></i>' + esc(_tt("editProfile", "Edit Profile")) + '</button>';
    html += '<button type="button" class="cmp-btn gold" data-cmp-signout="1"><i class="fas fa-right-from-bracket"></i>' + esc(_tt("signOut", "Sign Out")) + '</button>';
    html += '</div>';
    var links = (_data && _data.links) || [];
    if (links.length) {
      html += '<div class="cmp-links">' + links.map(function (l) { return l && l.url ? '<a class="cmp-link" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow"><i class="fas fa-link"></i>' + esc(l.label || l.url) + '<i class="fas fa-arrow-up-right-from-square" style="margin-left:auto"></i></a>' : ''; }).join("") + '</div>';
    }
    if (includeSections) {
      var favs = (_data && _data.favorites) || [];
      var pls = (_data && _data.playlists) || [];
      html += '<div class="cmp-sections">';
      html += '<div class="cmp-sec-card"><div class="cmp-sec-title"><span><i class="fas fa-heart"></i> ' + esc(_tt("t4", "Favorites")) + '</span><span class="cmp-sec-actions"><button type="button" class="cmp-toggle" data-fav-toggle="1" title="' + esc(_tt("cmpToggleView", "Toggle view")) + '"><i class="fas fa-table-cells-large"></i></button><span class="cmp-count">' + favs.length + '</span></span></div>';
      html += '<div class="cmp-fav-grid"></div></div>';
      html += '<div class="cmp-sec-card"><div class="cmp-sec-title"><span><i class="fas fa-list-music"></i> ' + esc(_tt("t11", "My Playlists")) + '</span><span class="cmp-count">' + pls.length + '</span></div>';
      html += '<div class="cmp-pl-grid grid-2"></div></div>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }
  function renderCompactProfile() {
    var pp = document.getElementById("page-section-profile");
    if (pp && pp.classList.contains("active") && _profilePage && _profilePage.self) renderSelfProfilePage();
  }
  function pvPill(ico, val, lbl) {
    return '<div class="pv-stat"><i class="fas ' + ico + '"></i><b>' + esc(String(val == null ? "0" : val)) + '</b><span>' + esc(lbl) + '</span></div>';
  }
  function compactProfileViewHtml(d) {
    var pr = d.profile || {}, st = d.stats || {}, dc = d.discord || {};
    var name = pr.name || "999";
    var uname = pr.username || d.handle || d.uid || name;
    var avatar = pr.avatar ? '<img src="' + esc(pr.avatar) + '" alt="" onerror="this.style.display=\'none\'">' : esc(initial(name));
    var verified = !!(dc.linked || pr.verified);
    var status = pr.status || "Online";
    var dotC = "#64748b";
    if (status === "Online") dotC = "#10b981";
    else if (status === "Idle") dotC = "#f59e0b";
    else if (status === "Do Not Disturb") dotC = "#ef4444";
    var banner = pr.banner ? '<img src="' + esc(pr.banner) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    var links = (d.links || []).filter(function (l) { return l && l.url; });
    var plays = (d.topPlays || []).slice(0, 5).map(function (t) {
      return '<div class="pv-top"><span class="pv-top-num">' + esc(t.track_id) + '</span><span class="pv-top-cnt">' + (Number(t.n) || 0) + ' plays</span></div>';
    }).join("") || '<p class="pv-none">No plays recorded yet</p>';
    var pls = (d.playlists || []).slice(0, 6).map(function (p) {
      return '<div class="pv-pl" data-openpl="' + p.id + '" role="button" tabindex="0" title="' + esc(_tt("openTitle", "Open")) + '" style="background:linear-gradient(135deg,' + (p.color ? esc(p.color) : "#a855f7") + ',rgba(20,12,40,.9))"><i class="fas fa-play pv-pl-play" data-playpl="' + p.id + '"></i><div class="pv-pl-info"><b>' + esc(p.name) + '</b><span>' + (p.count || 0) + ' tracks</span></div></div>';
    }).join("") || '<p class="pv-none">No playlists</p>';
    var favs = (d.favorites || []);
    var favBlock = favs.length
      ? '<div class="cmp-sec-title" style="margin:18px 2px 10px"><span><i class="fas fa-heart"></i> ' + esc(_tt("t4", "Favorites")) + '</span><span class="cmp-count">' + favs.length + '</span></div><div class="cmp-fav-grid" id="pvFavGrid"></div>'
      : '';
    var html = '';
    html += '<div class="pv-banner-wrap">' + banner + '</div>';
    html += '<div class="pv-body">';
    html += '<div class="pv-top-row"><div class="pv-avatar">' + avatar + '<span class="pv-dot" style="background:' + dotC + ';box-shadow:0 0 12px ' + dotC + '"></span></div>';
    html += '<div class="pv-id"><div class="pv-name-row"><h3>' + esc(name) + '</h3>' + cmpVerifiedHtml(verified) + '</div>';
    html += '<p class="pv-handle">@' + esc(String(uname).toLowerCase()) + '</p>';
    html += '<span class="pv-status" style="color:' + dotC + '"><i class="fas fa-circle" style="font-size:6px"></i> ' + esc(status) + '</span><span class="cmp-site-presence" data-uid="' + esc(String(d.uid || "")) + '"></span></div></div>';
    html += (pr.joined ? '<p class="pv-joined"><i class="fas fa-calendar"></i> ' + esc(_tt("joinedWord", "Joined")) + ' ' + esc(String(pr.joined).slice(0, 10)) + '</p>' : '');
    html += (pr.bio ? '<div class="cmp-bio">' + esc(pr.bio) + '</div>' : '');
    html += '<div class="cmp-qstats">';
    html += qstat((Number(st.plays) || 0).toLocaleString(), _tt("qstatPlays", "Plays"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat(ppTime(st.hours), _tt("listenedWord", "Listened"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat((Number(st.favorites) || 0).toLocaleString(), _tt("statFavs", "Favorites"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat((Number(st.votes) || 0).toLocaleString(), _tt("votesWord", "Votes"));
    html += '</div>';
    html += '<div class="cmp-actions" style="margin-top:12px"><a class="cmp-btn" href="#" onclick="event.preventDefault();if(window.closeWantedProfile)window.closeWantedProfile();if(window.switchAppPage)window.switchAppPage(\'player\')"><i class="fas fa-play"></i> ' + esc(_tt("cmpPlayer", "WRLD Player")) + '</a></div>';
    html += '<div class="pv-block"><div class="pv-block-title">Links</div><div class="cmp-links">' + (links.map(function (l) { return '<a class="cmp-link" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow"><i class="fas fa-link"></i>' + esc(l.label || l.url) + '<i class="fas fa-arrow-up-right-from-square" style="margin-left:auto"></i></a>'; }).join("") || '<p class="pv-none">No links shared</p>') + '</div></div>';
    html += '<div class="pv-block"><div class="pv-block-title">Top plays</div><div class="pv-tops">' + plays + '</div></div>';
    html += '<div class="pv-block"><div class="pv-block-title">Playlists</div><div class="pv-pls">' + pls + '</div></div>';
    html += favBlock;
    html += '</div>';
    return html;
  }
  window.openCompactProfile = function (user, byDiscord) {
    if (window.openProfile) window.openProfile(user, byDiscord);
  };

  /* ---------- Owner ---------- */
  function applyOwner() {
    var group = document.getElementById("navOwnerGroup");
    var crownM = document.getElementById("owner-crown-btn-m");
    var ppOwner = document.getElementById("mobile-profile-owner");
    var isOwner = !!(_data && _data.isOwner);
    if (group) group.style.display = isOwner ? "" : "none";
    if (crownM) crownM.style.display = isOwner ? "" : "none";
    if (ppOwner) ppOwner.style.display = isOwner ? "" : "none";
  }
  function bindOwnerClose() {
    var pan = document.getElementById("owner-panel");
    var bak = document.getElementById("owner-backdrop");
    var cb = document.getElementById("ownerCloseBtn");
    var close = function () {
      if (pan) pan.classList.remove("owner-active");
      if (bak) bak.classList.remove("show");
      if (cb) cb.style.display = "none";
    };
    if (cb) cb.onclick = close;
    if (bak) bak.onclick = close;
    window.closeOwnerPanel = close;
    initOwnerOverlay();
  }
  function initOwnerOverlay() {
    if (window.__ownerScrollSync) return;
    window.__ownerScrollSync = true;
    var prevOverflow = "";
    var getBak = function () { return document.getElementById("owner-backdrop"); };
    try {
      var bakEl = getBak();
      var panEl = document.getElementById("owner-panel");
      if (bakEl && bakEl.parentNode !== document.body) document.body.appendChild(bakEl);
      if (panEl && panEl.parentNode !== document.body) document.body.appendChild(panEl);
    } catch (e) {}
    var syncOwnerScroll = function () {
      var bak = getBak();
      var open = !!(bak && bak.classList.contains("show"));
      try {
        if (open) {
          if (document.body.style.overflow !== "hidden") prevOverflow = document.body.style.overflow || "";
          document.body.style.overflow = "hidden";
          document.documentElement.classList.add("scroll-locked");
        } else {
          document.body.style.overflow = prevOverflow;
          document.documentElement.classList.remove("scroll-locked");
        }
      } catch (e) {}
    };
    try {
      var bakObs = getBak();
      if (window.MutationObserver && bakObs) {
        new MutationObserver(syncOwnerScroll).observe(bakObs, { attributes: true, attributeFilter: ["class"] });
      }
    } catch (e) {}
    syncOwnerScroll();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var bak = getBak();
        if (bak && bak.classList.contains("show") && window.closeOwnerPanel) window.closeOwnerPanel();
      }
    });
  }
  window.initOwnerOverlay = initOwnerOverlay;
  window.openOwnerPanel = function () {
    var pan = document.getElementById("owner-panel");
    if (!pan) return;
    pan.style.display = "";
    pan.classList.add("owner-active");
    var bak = document.getElementById("owner-backdrop");
    if (bak) bak.classList.add("show");
    var cb = document.getElementById("ownerCloseBtn");
    if (cb) cb.style.display = "";
    bindOwnerClose();
    try {
      document.body.style.overflow = "hidden";
      document.documentElement.classList.add("scroll-locked");
    } catch (e) {}
    if (window.ownerUnlockByUser && uid) window.ownerUnlockByUser(uid);
    else if (window.ownerAutoUnlock) window.ownerAutoUnlock();
  };

  /* ---------- Stats ---------- */
  function applyStats() {
    var s = (_data && _data.stats) || {};
    var setAll = function (key, v) {
      var nodes = document.querySelectorAll('[data-stat="' + key + '"]');
      var txt = Number(v || 0).toLocaleString();
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = txt;
    };
    setAll("plays", s.plays);
    setAll("favorites", s.favorites);
    setAll("votes", s.votes);
    setAll("replies", s.replies);
    setAll("hours", s.hours);
    setAll("downloads", s.downloads);
    var joinedTxt = (_data && _data.profile && _data.profile.joined) ? new Date(_data.profile.joined).getFullYear() : "2026";
    var jdNodes = document.querySelectorAll('[data-stat="joined"]');
    for (var j = 0; j < jdNodes.length; j++) jdNodes[j].textContent = joinedTxt;
    var jf = document.getElementById("joinDate"); if (jf) jf.textContent = _data && _data.profile && _data.profile.joined ? fmtDate(_data.profile.joined) : "2026";
  }

  /* ---------- Activity ---------- */
  var ACT_ICON = { vote: "fa-vote-yea", reply: "fa-comment", favorite: "fa-heart", download: "fa-download", profile: "fa-user-pen", security: "fa-shield-halved", listen: "fa-headphones" };
  function applyActivity() {
    var box = document.getElementById("activityList");
    if (!box) return;
    var rows = (_data && _data.activity) || [];
    if (!rows.length) {
      box.innerHTML = '<p class="ac-empty">' + esc(_tt("noActivity", "No activity yet - go play some tracks, vote &amp; reply in the Wanted Vault.")) + '</p>';
      return;
    }
    box.innerHTML = rows.map(function (a) {
      var ico = ACT_ICON[a.type] || "fa-bolt";
      return '<div class="tl-item"><div class="tl-time">' + esc(relTime(a.ts)) + '</div><div class="tl-txt"><i class="fas ' + ico + ' tl-ico"></i>' + esc(a.label) + '</div></div>';
    }).join("");
  }

  /* ---------- Notifications (top-nav bell) ---------- */
  function setNotifBell(on) {
    var wrap = document.getElementById("nav-notif-wrap");
    if (wrap) wrap.style.display = on ? "" : "none";
    if (!on) {
      var m = document.getElementById("navNotifMenu");
      if (m && m.closest) { var w = m.closest(".nav-notif-wrap"); if (w) w.classList.remove("open"); }
    }
  }
  window.setNotifBell = setNotifBell;
  function gotoNotif(n) {
    if (n.reply_id) { try { sessionStorage.setItem("ac_notif_reply", n.reply_id); } catch (e) {} }
    if (n.track_id) { try { sessionStorage.setItem("ac_notif_track", n.track_id); } catch (e) {} }
    if (window.switchAppPage) switchAppPage("wanted");
    setTimeout(function () {
      var track = n.track_id || "";
      var rid = n.reply_id;
      if (window.renderWantedVault) renderWantedVault();
      var sorted = window._wantedSorted || [];
      var idx = -1;
      for (var i = 0; i < sorted.length; i++) { if (String(sorted[i].t) === track) { idx = i; break; } }
      if (idx >= 0 && window._wantedOpen) {
        _wantedOpen[idx] = true;
        if (window.renderWantedVault) renderWantedVault();
        setTimeout(function () {
          var el = document.getElementById("wanted-replies-" + idx);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          if (rid) {
            var r = document.querySelector('[data-reply-id="' + rid + '"]');
            if (r) { r.classList.add("notif-flash"); r.scrollIntoView({ behavior: "smooth", block: "center" }); }
          }
        }, 250);
      } else if (idx >= 0) {
        var t = document.getElementById("wanted-reply-toggle-" + idx);
        if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); }
      } else {
        toast(_tt("toastTrackNotFound", "Track not found in the vault"), "info");
      }
    }, 120);
  }
  function applyNotifications() {
    var wrap = document.getElementById("nav-notif-wrap");
    if (!wrap) return;
    var rows = (_data && _data.notifications) || [];
    var unread = (_data && _data.unread ? _data.unread : 0);
    var badge = document.getElementById("navNotifBadge");
    if (badge) { badge.textContent = unread > 99 ? "99+" : String(unread); badge.style.display = unread > 0 ? "" : "none"; }
    var list = document.getElementById("navNotifList");
    if (!list) return;
    if ((typeof Notification !== "undefined") && Notification.permission === "granted") {
      rows.forEach(function (n) {
        var k = "ac_nd_" + n.id;
        try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch (e) {}
        if (n.read) return;
        try {
          var nt = new Notification("TheHighWRLD - " + (n.type === "reply" ? _tt("notifReply", "New reply") : n.type === "leak" ? _tt("notifLeak", "New leak") : _tt("notifUpdate", "Update")), { body: String(n.message).slice(0, 140), tag: "acn" + n.id });
          nt.onclick = function () { window.focus(); if (window.gotoNotif) gotoNotif({ track_id: n.track_id || "", reply_id: n.reply_id ? Number(n.reply_id) : null }); };
        } catch (e) {}
      });
    }
    if (!rows.length) {
      list.innerHTML = '<p class="nav-notif-empty">' + esc(_tt("noNotifs", "No notifications yet.")) + '</p>';
      return;
    }
    list.innerHTML = rows.slice(0, 40).map(function (n) {
      var ico = n.type === "reply" ? "fa-comment" : n.type === "leak" ? "fa-fire" : n.type === "vote" ? "fa-vote-yea" : "fa-bell";
      return '<button type="button" class="nav-notif-item' + (n.read ? " read" : " unread") + '" data-nid="' + n.id + '" data-track="' + esc(n.track_id || "") + '" data-rid="' + (n.reply_id || "") + '"><span class="nni-ico"><i class="fas ' + ico + '"></i></span><span class="nni-main"><span class="nni-txt">' + esc(n.message) + '</span><span class="nni-time">' + esc(relTime(n.ts)) + (n.actor ? " &middot; " + esc(n.actor) : "") + '</span></span>' + (n.read ? "" : '<span class="unread-dot"></span>') + '</button>';
    }).join("");
  }
  function bindNotifications() {
    var list = document.getElementById("navNotifList");
    if (list) list.addEventListener("click", function (e) {
      var row = e.target.closest(".nav-notif-item");
      if (!row) return;
      var nid = row.getAttribute("data-nid");
      var track = row.getAttribute("data-track") || "";
      var rid = row.getAttribute("data-rid") || "";
      var wrap = row.closest(".nav-notif-wrap");
      if (wrap) wrap.classList.remove("open");
      if (!row.classList.contains("read")) {
        row.classList.add("read");
        row.classList.remove("unread");
        api({ action: "markNotifRead", id: nid });
      }
      gotoNotif({ track_id: track, reply_id: rid ? Number(rid) : null });
    });
    var markBtn = document.getElementById("navNotifMarkAll");
    if (markBtn) markBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      api({ action: "markAllNotif" }).then(function () { loadAccount(); toast(_tt("toastMarkAllRead", "All notifications marked as read"), "success"); });
    });
    var btn = document.getElementById("navNotifBtn");
    if (btn) btn.addEventListener("click", function () {
      var w = btn.closest(".nav-notif-wrap");
      if (!w) return;
      var was = w.classList.contains("open");
      document.querySelectorAll(".nav-notif-wrap.open").forEach(function (o) { o.classList.remove("open"); });
      if (!was) w.classList.add("open");
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      document.querySelectorAll(".nav-notif-wrap.open").forEach(function (o) {
        if (!o.contains(e.target)) o.classList.remove("open");
      });
    });
  }

  /* ---------- Favorites ---------- */
  function trackIndexByTitle(title) {
    if (typeof trackList === "undefined" || !trackList) return -1;
    var low = String(title || "").trim().toLowerCase();
    for (var i = 0; i < trackList.length; i++) {
      if (trackList[i] && String(trackList[i].title || "").trim().toLowerCase() === low) return i;
    }
    return -1;
  }
  function coverForTitle(title) {
    var idx = trackIndexByTitle(title);
    return idx >= 0 && trackList[idx] && trackList[idx].cover ? trackList[idx].cover : "";
  }
  function renderFavRows(rows, own, grid) {
    grid = grid || document.getElementById("favGrid");
    if (!grid) return;
    if (!rows || !rows.length) { grid.innerHTML = '<p class="ac-empty" style="grid-column:1/-1">' + esc(_tt("noFavorites", "No favorites yet - tap the heart on any song to save it here.")) + '</p>'; return; }
    grid.innerHTML = rows.map(function (f) {
      var idx = trackIndexByTitle(f.title);
      var cov = coverForTitle(f.title);
      var initials = String(f.title || "??").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase() || "??";
      var art = cov ? '<img class="fav-art-img" src="' + esc(cov) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '<span class="fav-initials">' + esc(initials) + '</span>';
      var like = own ? '<button class="fav-like" data-fav="' + esc(f.title) + '" title="' + esc(_tt("unfavorite", "Unfavorite")) + '"><i class="fas fa-heart"></i></button>' : '<span class="fav-like off"><i class="fas fa-heart"></i></span>';
      var tg = ""; try { var _ti = trackIndexByTitle(f.title); if (_ti >= 0 && typeof trackList !== "undefined" && trackList[_ti]) tg = trackList[_ti].tag || trackList[_ti].category || ""; } catch (e) {} var tagHtml = tg ? '<div class="fav-tag">' + esc(String(tg).slice(0, 80)) + '</div>' : ''; return '<div class="fav-card" data-play-idx="' + idx + '" role="button" tabindex="0"><div class="fav-art">' + art + '<div class="fav-zoom"><span class="fav-play-btn"><i class="fas fa-play"></i></span></div></div>' + '<div class="fav-info"><div class="fav-main"><div class="fav-text"><div class="fav-name">' + esc(f.title) + '</div>' + tagHtml + '</div>' + like + '</div><div class="fav-sub">' + esc(_tt("saved", "saved")) + ' &middot; ' + esc(fmtDate(f.created_at)) + '</div></div></div>';
    }).join("");
  }
  function applyFavorites() {
    renderFavRows((_data && _data.favorites) || [], true);
  }
  function bindFavGrid(grid) {
    if (!grid) return;
    grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".fav-like[data-fav]");
      if (btn) {
        var name = btn.getAttribute("data-fav");
        api({ action: "toggleFavorite", title: name }).then(function () {
          loadAccount();
          toast(name + " " + _tt("removedFromFavs", "removed from favorites"), "info");
        });
        return;
      }
      if (e.target.closest(".fav-like")) return;
      var play = e.target.closest("[data-play-idx]");
      if (play) {
        var idx = parseInt(play.getAttribute("data-play-idx"), 10);
        if (!isNaN(idx) && idx >= 0 && window.selectTrackFromList) { window.selectTrackFromList(idx); if (window.showMiniPlayer) window.showMiniPlayer(); }
      }
    });
  }
  function bindFavorites() {
    bindFavGrid(document.getElementById("favGrid"));
  }

  /* ---------- Analytics ---------- */
  function dayList(days) {
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
  function applyAnalytics() {
    var active = document.querySelector("#anTabs .an-tab.active");
    renderAnalytics(active ? active.getAttribute("data-an") : "weekly");
  }
  function renderAnalytics(key) {
    if (!_data) return;
    var weekly = (_data.analytics && _data.analytics.weekly) || [];
    var monthly = (_data.analytics && _data.analytics.monthly) || [];
    var top = (_data.analytics && _data.analytics.topPlays) || [];
    var src = key === "monthly" ? monthly : weekly;
    var labels = key === "monthly"
      ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    var days = key === "monthly" ? 30 : 7;
    var map = {};
    src.forEach(function (r) { map[r.day] = r.s || 0; });
    var values = dayList(days).map(function (d) { return map[d] || 0; });
    var sub = document.getElementById("chartSub");
    if (sub) sub.textContent = key === "monthly" ? _tt("last30Days", "Last 30 days") : _tt("last7Days", "Last 7 days");
    drawLine(document.getElementById("lineChart"), values, labels);
    var totalSec = values.reduce(function (a, b) { return a + b; }, 0);
    var sum = document.getElementById("anSummary");
    if (sum) sum.innerHTML = "<b>" + fmtHours(totalSec) + "</b> " + esc(_tt("listeningPeriod", "listening this period")) + " &middot; <b>" + countValues(values) + "</b> " + esc(_tt("activeDays", "active days"));
    hbars(document.getElementById("prodBars"), top.slice(0, 5).map(function (t) { return [t.track_id, t.n]; }), _tt("plays", "plays"));
    var allTime = (_data.stats && _data.stats.plays) ? [[_tt("allPlays", "All plays"), _data.stats.plays]] : [];
    hbars(document.getElementById("topBars"), allTime, _tt("plays", "plays"));
  }
  function fmtHours(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.round((sec % 3600) / 60);
    return h + "h " + m + "m";
  }
  function countValues(arr) { var n = 0; arr.forEach(function (v) { if (v > 0) n++; }); return n; }
  function drawLine(canvas, data, labels) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 600, h = rect.height || 170;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var max = Math.max.apply(null, data.concat([1])) * 1.15;
    var pad = 12;
    var n = data.length;
    var stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;
    function y(v) { return h - pad - ((v / max) * (h - pad * 2)); }
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(245,158,11,.35)");
    grad.addColorStop(1, "rgba(236,72,153,.02)");
    ctx.beginPath();
    ctx.moveTo(pad, y(data[0]));
    for (var i = 1; i < n; i++) {
      var x = pad + i * stepX;
      var x0 = pad + (i - 1) * stepX;
      var cx = (x0 + x) / 2;
      ctx.bezierCurveTo(cx, y(data[i - 1]), cx, y(data[i]), x, y(data[i]));
    }
    ctx.lineTo(pad + (n - 1) * stepX, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pad, y(data[0]));
    for (var j = 1; j < n; j++) {
      var xj = pad + j * stepX;
      var xj0 = pad + (j - 1) * stepX;
      var cj = (xj0 + xj) / 2;
      ctx.bezierCurveTo(cj, y(data[j - 1]), cj, y(data[j]), xj, y(data[j]));
    }
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    var tick = Math.ceil(n / 7);
    for (var k = 0; k < n; k++) {
      var xk = pad + k * stepX;
      ctx.beginPath();
      ctx.arc(xk, y(data[k]), 3, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.fill();
      if (k % tick === 0 && labels && labels[k]) {
        ctx.fillStyle = "rgba(255,255,255,.5)";
        ctx.font = "9px Sora, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(labels[k], xk, h - 2);
      }
    }
  }
  function hbars(el, rows, unit) {
    if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = '<p class="ac-empty">' + esc(_tt("noData", "No data yet.")) + '</p>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r[1] || 0; }));
    var html = "";
    rows.forEach(function (r) {
      var pct = max ? Math.round((r[1] / max) * 100) : 0;
      html += '<div class="hbar-row"><div class="hbar-name">' + esc(r[0]) + '</div><div class="hbar-track"><div class="hbar-fill" data-pct="' + pct + '"></div></div><div class="hbar-val">' + r[1] + ' ' + (unit || "") + '</div></div>';
    });
    el.innerHTML = html;
    setTimeout(function () {
      el.querySelectorAll(".hbar-fill").forEach(function (f) { f.style.width = f.getAttribute("data-pct") + "%"; });
    }, 60);
  }
  function bindAnalyticsTabs() {
    var tabs = document.getElementById("anTabs");
    if (tabs) tabs.addEventListener("click", function (e) {
      var tab = e.target.closest(".an-tab");
      if (!tab) return;
      document.querySelectorAll("#anTabs .an-tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      renderAnalytics(tab.getAttribute("data-an"));
    });
  }

  /* ---------- Downloads ---------- */
  function applyDownloads() {
    var body = document.getElementById("dlBody");
    if (!body) return;
    var rows = (_data && _data.downloads) || [];
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--ac-dim);padding:18px">' + esc(_tt("noDownloads", "No downloads yet.")) + '</td></tr>'; return; }
    body.innerHTML = rows.map(function (d) {
      var initials = String(d.title || "??").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase() || "??";
      return '<tr><td><div class="song-cell"><div class="t-art">' + esc(initials) + '</div><div><div class="t-name">' + esc(d.title) + '</div><div class="t-sub">' + esc(fmtDate(d.ts)) + '</div></div></div></td><td>' + esc(d.size || "3.4 MB") + '</td><td>' + esc(relTime(d.ts)) + '</td><td><button class="dl-btn" data-dl="' + esc(d.title) + '"><i class="fas fa-download"></i> ' + esc(_tt("again", "Again")) + '</button></td></tr>';
    }).join("");
  }
  function bindDownloads() {
    var body = document.getElementById("dlBody");
    if (body) body.addEventListener("click", function (e) {
      var b = e.target.closest(".dl-btn");
      if (!b) return;
      var title = b.getAttribute("data-dl");
      api({ action: "addDownload", title: title, size: "3.4 MB" }).then(function () {
        loadAccount();
        toast(_tt("downloading", "Downloading") + " " + title + "...", "info");
      });
    });
  }

  /* ---------- Logins + devices ---------- */
  function applyLogins() {
    var rows = (_data && _data.logins) || [];
    var dev = document.getElementById("devList");
    if (dev) {
      var groups = {};
      rows.forEach(function (l) {
        var k = (l.dev || "Computer") + "|" + (l.browser || "Browser") + "|" + (l.os || "OS");
        if (!groups[k]) groups[k] = { label: l.browser + " on " + l.os, ico: l.dev === "Mobile" ? "fa-mobile-screen" : "fa-laptop", last: l.ts, count: 0 };
        groups[k].count++;
        if (!groups[k].last || l.ts > groups[k].last) groups[k].last = l.ts;
      });
      var arr = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.last.localeCompare(a.last); });
      dev.innerHTML = arr.slice(0, 5).map(function (g, i) {
        return '<div class="device"><div class="dv-ico"><i class="fas ' + g.ico + '"></i></div><div><div class="dv-name">' + esc(g.label) + '</div><div class="dv-meta">' + g.count + ' ' + esc(_tt("session", "session")) + (g.count === 1 ? "" : "s") + " - " + esc(relTime(g.last)) + '</div></div>' + (i === 0 ? '<span class="dv-this">' + esc(_tt("recent", "RECENT")) + '</span>' : "") + '</div>';
      }).join("") || '<p class="ac-empty">' + esc(_tt("noDevices", "No devices yet.")) + '</p>';
    }
    var box = document.getElementById("loginList");
    if (box) {
      if (!rows.length) { box.innerHTML = '<p class="ac-empty">' + esc(_tt("noLoginHistory", "No login history yet.")) + '</p>'; return; }
      box.innerHTML = rows.map(function (l) {
        var ico = l.dev === "Mobile" ? "fa-mobile-screen" : "fa-laptop";
        return '<div class="tl-item" style="padding-bottom:12px"><div class="tl-time">' + esc(relTime(l.ts)) + '</div><div class="tl-txt"><b><i class="fas ' + ico + '"></i> ' + esc(l.browser + " " + _tt("onWord", "on") + " " + l.os) + '</b> - ' + esc(l.country || _tt("unknown", "unknown")) + '</div></div>';
      }).join("");
    }
  }
  var logoutBtn = document.getElementById("logoutOthersBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", function () {
    btnBusy(logoutBtn, true);
    api({ action: "clearLogins" }).then(function () { btnBusy(logoutBtn, false); loadAccount(); toast(_tt("toastDevicesOut", "Other devices logged out"), "success"); }).catch(function () { btnBusy(logoutBtn, false); });
  });

  /* ---------- Discord ---------- */
  function applyDiscord() {
    var d = (_data && _data.discord) || {};
    var st = document.getElementById("discState");
    if (st) { st.textContent = d.linked ? _tt("connectedWord", "Connected") : _tt("notConnected", "Not connected"); st.className = d.linked ? "disc-state ok" : "disc-state"; }
    var nm = document.getElementById("discName");
    if (nm) nm.textContent = d.linked ? _tt("discRefreshHint", "Handle, display name, bio & avatar sync from Discord - hit Refresh to re-pull.") : _tt("linkDiscordSync", "Link Discord to sync your name, bio &amp; avatar");
    var bio = document.getElementById("discBio");
    if (bio) { bio.textContent = d.bio || ""; bio.style.display = d.bio ? "" : "none"; }
    var box = document.getElementById("discAvatarBox");
    if (box) box.innerHTML = d.avatar ? '<img src="' + esc(d.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fab fa-discord"></i>';
    var btn = document.getElementById("linkDiscordBtn");
    if (btn) btn.innerHTML = d.linked ? '<i class="fas fa-rotate-right"></i> ' + esc(_tt("refreshWord", "Refresh")) : '<i class="fab fa-discord"></i> ' + esc(_tt("link", "Link"));
    var dcStatus = document.getElementById("dcStatus");
    if (dcStatus) { dcStatus.textContent = d.linked ? _tt("connectedWord", "Connected") : _tt("notConnected", "Not connected"); dcStatus.className = d.linked ? "conn-val ok" : "conn-val"; }
    var dcId = document.getElementById("dcId");
    if (dcId) dcId.textContent = d.linked ? (d.id || "—") : "—";
    var un = document.getElementById("unlinkDiscordBtn");
    if (un) un.style.display = d.linked ? "" : "none";
  }
  function linkDiscord() {
    var w = window.open("/api/discord/login?uid=" + encodeURIComponent(uid) + "&mode=popup", "discordAuth", "width=520,height=680");
    if (!w) window.location.href = "/api/discord/login?uid=" + encodeURIComponent(uid);
  }
  var linkBtn = document.getElementById("linkDiscordBtn");
  if (linkBtn) linkBtn.addEventListener("click", linkDiscord);
  window.addEventListener("message", function (ev) {
    if (ev.data && ev.data.type === "discord-linked") {
      if (ev.origin !== window.location.origin) return;
      _pendingDiscordBioPrompt = true;
      loadAccount();
      toast(_tt("toastDiscordLinked", "Discord linked - profile synced"), "success");
      var ok = document.getElementById("discordLinkOk");
      if (ok) { ok.style.display = ""; setTimeout(function () { ok.style.display = "none"; }, 6000); }
    }
  });

  /* ---------- Last.FM ---------- */
  function applyLastFm() {
    var lf = (_data && _data.lastfm) || null;
    var st = document.getElementById("lfStatus");
    if (st) { st.textContent = lf && lf.linked ? _tt("connectedWord", "Connected") : _tt("notConnected", "Not connected"); st.className = lf && lf.linked ? "conn-val ok" : "conn-val"; }
    var user = document.getElementById("lfUser");
    if (user) user.textContent = lf && lf.linked ? (lf.username || "—") : "—";
    var unLf = document.getElementById("unlinkLastFmBtn");
    if (unLf) unLf.style.display = lf && lf.linked ? "" : "none";
  }
  function linkLastFm() {
    var w = window.open("/api/lastfm/login?uid=" + encodeURIComponent(uid) + "&mode=popup", "lastFmAuth", "width=520,height=680");
    if (!w) window.location.href = "/api/lastfm/login?uid=" + encodeURIComponent(uid);
  }
  var lfLinkBtn = document.getElementById("linkLastFmBtn");
  if (lfLinkBtn) lfLinkBtn.addEventListener("click", linkLastFm);
  window.addEventListener("message", function (ev) {
    if (ev.data && ev.data.type === "lastfm-linked") {
      if (ev.origin !== window.location.origin) return;
      loadAccount();
      toast(_tt("toastLastfmLinked", "Last.FM linked"), "success");
      var ok = document.getElementById("lastfmLinkOk");
      if (ok) { ok.style.display = ""; setTimeout(function () { ok.style.display = "none"; }, 6000); }
    }
  });
  var unLfBtn = document.getElementById("unlinkLastFmBtn");
  if (unLfBtn) unLfBtn.addEventListener("click", function () {
    btnBusy(unLfBtn, true);
    api({ action: "unlinkLastfm" }).then(function (d) {
      btnBusy(unLfBtn, false);
      if (d && d.ok) { loadAccount(); toast(_tt("toastLastfmUnlinked", "Last.FM unlinked"), "success"); }
    }).catch(function () { btnBusy(unLfBtn, false); });
  });

  /* ---------- Account info (settings panels) ---------- */
  function applyAccountInfo() {
    var acct = (_data && _data.account) || null;
    var p = _profile || {};
    var name = p.name || "";
    var aiName = document.getElementById("aiName");
    if (aiName) aiName.textContent = name || "—";
    var aiEmail = document.getElementById("aiEmail");
    if (aiEmail) aiEmail.textContent = acct ? acct.email : _tt("signInToView", "Sign in to view");
    var newEmail = document.getElementById("newEmail");
    if (newEmail && acct && acct.email && !newEmail.dataset.prefilled) { newEmail.value = acct.email; newEmail.dataset.prefilled = "1"; }
    var aiJoined = document.getElementById("aiJoined");
    if (aiJoined) aiJoined.textContent = p.joined ? fmtDate(p.joined) : "—";
    var aiStatus = document.getElementById("aiStatus");
    if (aiStatus) aiStatus.textContent = stLabel(p.status || "Online");
    var aiVerified = document.getElementById("aiVerified");
    if (aiVerified) {
      if (acct && acct.verified) aiVerified.innerHTML = '<span class="ver-badge"><i class="fas fa-badge-check"></i> ' + esc(_tt("verifiedBadge", "Verified")) + '</span>';
      else if (acct) aiVerified.textContent = _tt("notVerified", "Not verified");
      else aiVerified.textContent = "—";
    }
    var delU = document.getElementById("delUsername");
    if (delU) delU.textContent = "@lightsky1356";
    var delTyped = document.getElementById("delTyped");
    var delBtn2 = document.getElementById("deleteAccountBtn2");
    if (delTyped && delBtn2) {
      delBtn2.disabled = !delMatch(delTyped.value, "lightsky1356");
      var delErr = document.getElementById("delError");
      if (delErr) delErr.style.display = (delTyped.value || "").trim() && delBtn2.disabled ? "" : "none";
    }
    var g = (_data && _data.google) || null;
    var glStatus = document.getElementById("glStatus");
    if (glStatus) { glStatus.textContent = g && g.linked ? _tt("connectedWord", "Connected") : _tt("notConnected", "Not connected"); glStatus.className = g && g.linked ? "conn-val ok" : "conn-val"; }
    var glEmail = document.getElementById("glEmail");
    if (glEmail) glEmail.textContent = g && g.linked ? g.email : "—";
    var unG = document.getElementById("unlinkGoogleBtn");
    if (unG) unG.style.display = g && g.linked ? "" : "none";
  }

  /* ---------- Password mode (create vs change) ---------- */
  function applyPasswordMode() {
    var hasPw = !!(_data && _data.account && _data.account.hasPassword);
    var wrap = document.getElementById("curPassWrap");
    if (wrap) wrap.style.display = hasPw ? "" : "none";
    var eWrap = document.getElementById("curPassEmailWrap");
    if (eWrap) eWrap.style.display = hasPw ? "" : "none";
    var title = document.getElementById("pwCardTitle");
    if (title) title.textContent = hasPw ? _tt("changePassword", "Change Password") : _tt("createPassword", "Create a Password");
    var hint = document.getElementById("pwCardHint");
    if (hint) hint.textContent = hasPw
      ? _tt("pwHintUpdate", "Keep your account locked in - update your password anytime.")
      : _tt("pwHintCreate", "You don't have a password yet - set one so you can sign in with email & password.");
    var btn = document.getElementById("pwBtnLabel");
    if (btn) btn.textContent = hasPw ? _tt("updatePassword", "Update Password") : _tt("setPassword", "Set Password");
  }

  /* ---------- Settings panel nav ---------- */
  function bindSettingsPanels() {
    var nav = document.querySelector(".set-nav");
    if (!nav) return;
    nav.querySelectorAll("[data-set-panel]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-set-panel"));
        if (!target) return;
        document.querySelectorAll(".set-panel").forEach(function (p) { p.classList.remove("active"); p.style.display = "none"; });
        target.classList.add("active");
        target.style.display = "";
        document.querySelectorAll(".set-nav .set-nav-item").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
      });
    });
    nav.querySelectorAll("[data-set-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-set-jump");
        if (t && window.acctJump) window.acctJump(t);
      });
    });
  }

  /* ---------- Settings actions ---------- */
  function bindAccountActions() {
    function setResult(id, msg, ok) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg || "";
      el.style.display = msg ? "" : "none";
      el.className = "set-result" + (ok ? " ok" : "");
    }
    var emBtn = document.getElementById("changeEmailBtn");
    if (emBtn) emBtn.addEventListener("click", function () {
      var email = document.getElementById("newEmail");
      var pw = document.getElementById("curPassEmail");
      var v = email ? email.value.trim() : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setResult("changeEmailResult", _tt("errValidEmail", "Please enter a valid email address."), false);
      btnBusy(emBtn, true);
      api({ action: "changeEmail", newEmail: v, currentPassword: pw ? pw.value : "" }).then(function (d) {
        btnBusy(emBtn, false);
        if (d && d.ok) {
          setResult("changeEmailResult", _tt("okEmailUpdated", "Email updated. A verification email has been sent."), true);
          if (email) email.value = "";
          if (pw) pw.value = "";
          loadAccount();
        } else {
          setResult("changeEmailResult", (d && d.error) || _tt("couldNotUpdateEmail", "Could not update email."), false);
        }
      }).catch(function () { btnBusy(emBtn, false); setResult("changeEmailResult", _tt("couldNotUpdateEmail", "Could not update email."), false); });
    });
    var pwBtn = document.getElementById("changePassBtn");
    if (pwBtn) pwBtn.addEventListener("click", function () {
      var cur = document.getElementById("curPass"), nw = document.getElementById("newPass"), cf = document.getElementById("confPass");
      var nwV = nw ? nw.value : "", cfV = cf ? cf.value : "";
      function fieldErr(f, msg) {
        if (!f) return;
        var wrap = f.closest(".field");
        if (!wrap) return;
        var err = wrap.querySelector(".field-err");
        if (msg) {
          if (!err) { err = document.createElement("div"); err.className = "field-err"; wrap.appendChild(err); }
          err.textContent = msg;
          wrap.classList.add("has-err");
        } else {
          if (err) err.remove();
          wrap.classList.remove("has-err");
        }
      }
      if (!nwV) { fieldErr(nw, _tt("errPwReq", "New password is required.")); return setResult("changePassResult", _tt("errPwReq", "New password is required."), false); }
      if (nwV.length < 8) { fieldErr(nw, _tt("errPwMin", "Password must be at least 8 characters.")); return setResult("changePassResult", _tt("errPwMin", "Password must be at least 8 characters."), false); }
      if (nwV !== cfV) { fieldErr(cf, _tt("errPwMismatch", "Passwords do not match.")); return setResult("changePassResult", _tt("errPwMismatch", "Passwords do not match."), false); }
      fieldErr(nw, ""); fieldErr(cf, "");
      btnBusy(pwBtn, true);
      api({ action: "changePassword", currentPassword: cur ? cur.value : "", newPassword: nwV }).then(function (d) {
        btnBusy(pwBtn, false);
        if (d && d.ok) {
          setResult("changePassResult", _tt("okPwUpdated", "Password updated."), true);
          if (cur) cur.value = ""; if (nw) nw.value = ""; if (cf) cf.value = "";
        } else {
          setResult("changePassResult", (d && d.error) || _tt("couldNotUpdatePw", "Could not update password."), false);
        }
      }).catch(function () { btnBusy(pwBtn, false); setResult("changePassResult", _tt("couldNotUpdatePw", "Could not update password."), false); });
    });
    ["curPass", "newPass", "confPass", "curPassEmail"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        var wrap = el.closest(".field");
        if (wrap) {
          wrap.classList.remove("has-err");
          var err = wrap.querySelector(".field-err");
          if (err) err.remove();
        }
      });
    });
    var unD = document.getElementById("unlinkDiscordBtn");
    if (unD) unD.addEventListener("click", function () {
      btnBusy(unD, true);
      api({ action: "unlinkDiscord" }).then(function (d) {
        btnBusy(unD, false);
        if (d && d.ok) { toast(_tt("toastDiscordUnlinked", "Discord unlinked"), "success"); loadAccount(); }
        else toast((d && d.error) || _tt("couldNotUnlinkDiscord", "Could not unlink Discord"), "error");
      }).catch(function () { btnBusy(unD, false); toast(_tt("couldNotUnlinkDiscord", "Could not unlink Discord"), "error"); });
    });
    var unG = document.getElementById("unlinkGoogleBtn");
    if (unG) unG.addEventListener("click", function () {
      btnBusy(unG, true);
      api({ action: "unlinkGoogle" }).then(function (d) {
        btnBusy(unG, false);
        if (d && d.ok) { toast(_tt("toastGoogleUnlinked", "Google unlinked"), "success"); loadAccount(); }
        else toast((d && d.error) || _tt("couldNotUnlinkGoogle", "Could not unlink Google"), "error");
      }).catch(function () { btnBusy(unG, false); toast(_tt("couldNotUnlinkGoogle", "Could not unlink Google"), "error"); });
    });
    var linkG = document.getElementById("linkGoogleBtn");
    if (linkG) linkG.addEventListener("click", function () {
      window.location.href = "/api/auth/google/start";
    });
    var sessBtn = document.getElementById("sessionSignOutBtn");
    if (sessBtn) sessBtn.addEventListener("click", function () {
      if (window.authSignOut) window.authSignOut();
      else window.location.href = "/api/auth/logout";
    });
    var delTyped = document.getElementById("delTyped");
    var delBtn2 = document.getElementById("deleteAccountBtn2");
    if (delTyped) delTyped.addEventListener("input", function () {
      var match = delMatch(delTyped.value, "lightsky1356");
      if (delBtn2) delBtn2.disabled = !match;
      var delErr = document.getElementById("delError");
      if (delErr) delErr.style.display = (delTyped.value || "").trim() && !match ? "" : "none";
    });
    if (delBtn2) delBtn2.addEventListener("click", function () {
      openModal("deleteModal");
    });
  }

  /* ---------- Themes + languages ---------- */
  var THEMES = [
    ["default", "Cyan"], ["violet", "Deep Violet"], ["embers", "Ember Nights"],
    ["obsidian", "Dark Obsidian"], ["aurora", "Aurora"], ["sakura", "Sakura Dream"],
    ["ocean", "Ocean Deep"], ["royal", "Royal Gold"],
    ["neon", "Neon Nights"], ["blood", "Blood Moon"], ["storm", "Midnight Storm"],
    ["forest", "Emerald Forest"], ["sunset", "Sunset Drive"], ["ice", "Arctic Ice"],
    ["candy", "Candy Pop"], ["matrix", "Digital Matrix"], ["cyber", "Cyberpunk"],
    ["gold", "Gold"], ["galaxy", "Deep Galaxy"], ["lava", "Lava Flow"],
    ["toxic", "Toxic Slime"], ["rose", "Rose Gold"], ["oled", "Pure OLED"],
    ["ultraviolet", "Ultraviolet"], ["pharaoh", "Pharaoh Sands"], ["dragon", "Dragon Fire"],
    ["mint", "Mint Fresh"], ["tangerine", "Tangerine Sky"],
    ["grape", "Grape Soda"], ["pumpkin", "Pumpkin Spice"], ["silver", "Silver Lining"], ["midnight", "Midnight Blue"]
  ];
  var LANGS = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"], ["ru", "Russian"], ["uk", "Ukrainian"], ["sv", "Swedish"], ["no", "Norwegian"], ["da", "Danish"], ["fi", "Finnish"], ["cs", "Czech"], ["el", "Greek"], ["hu", "Hungarian"], ["ro", "Romanian"], ["tr", "Turkish"], ["ar", "Arabic"], ["hi", "Hindi"], ["th", "Thai"], ["vi", "Vietnamese"], ["id", "Indonesian"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"]];
  var I18N = {
    en: { t1: "Quick Stats", t2: "Recent Activity", t3: "Notifications", t4: "Favorites", t6: "Personal Analytics", t7: "Download History", t8: "Settings", t9: "Security", t10: "Danger Zone", t11: "My Playlists", t12: "Owner Dashboard" },
    es: { t1: "Estadísticas Rápidas", t2: "Actividad Reciente", t3: "Notificaciones", t4: "Favoritos", t6: "Analítica Personal", t7: "Historial de Descargas", t8: "Ajustes", t9: "Seguridad", t10: "Zona de Peligro", t11: "Mis Playlists", t12: "Panel del Propietario" },
    fr: { t1: "Statistiques Rapides", t2: "Activité Récente", t3: "Notifications", t4: "Favoris", t6: "Analytique Personnelle", t7: "Historique des Téléchargements", t8: "Paramètres", t9: "Sécurité", t10: "Zone de Danger", t11: "Mes Playlists", t12: "Tableau du Propriétaire" },
    de: { t1: "Schnelle Statistiken", t2: "Letzte Aktivität", t3: "Benachrichtigungen", t4: "Favoriten", t6: "Persönliche Analytik", t7: "Download-Verlauf", t8: "Einstellungen", t9: "Sicherheit", t10: "Gefahrenzone", t11: "Meine Playlists", t12: "Eigentümer-Dashboard" },
    pt: { t1: "Estatísticas Rápidas", t2: "Atividade Recente", t3: "Notificações", t4: "Favoritos", t6: "Análise Pessoal", t7: "Histórico de Downloads", t8: "Configurações", t9: "Segurança", t10: "Zona de Perigo", t11: "Minhas Playlists", t12: "Painel do Proprietário" },
    it: { t1: "Statistiche Rapide", t2: "Attività Recente", t3: "Notifiche", t4: "Preferiti", t6: "Analisi Personale", t7: "Cronologia Download", t8: "Impostazioni", t9: "Sicurezza", t10: "Zona di Pericolo", t11: "Le Mie Playlist", t12: "Dashboard Proprietario" },
    nl: { t1: "Snelle Statistieken", t2: "Recente Activiteit", t3: "Meldingen", t4: "Favorieten", t6: "Persoonlijke Analyse", t7: "Downloadgeschiedenis", t8: "Instellingen", t9: "Beveiliging", t10: "Gevarenzone", t11: "Mijn Afspeellijsten", t12: "Eigenaar Dashboard" },
    pl: { t1: "Szybkie Statystyki", t2: "Ostatnia Aktywność", t3: "Powiadomienia", t4: "Ulubione", t6: "Osobista Analityka", t7: "Historia Pobrań", t8: "Ustawienia", t9: "Bezpieczeństwo", t10: "Strefa Zagrożenia", t11: "Moje Playlisty", t12: "Panel Właściciela" },
    ru: { t1: "Быстрая статистика", t2: "Недавняя активность", t3: "Уведомления", t4: "Избранное", t6: "Личная аналитика", t7: "История загрузок", t8: "Настройки", t9: "Безопасность", t10: "Опасная зона", t11: "Мои плейлисты", t12: "Панель владельца" },
    ar: { t1: "إحصائيات سريعة", t2: "النشاط الأخير", t3: "الإشعارات", t4: "المفضلة", t6: "التحليلات الشخصية", t7: "سجل التنزيلات", t8: "الإعدادات", t9: "الأمان", t10: "منطقة الخطر", t11: "قوائم التشغيل", t12: "لوحة المالك" },
    ja: { t1: "クイック統計", t2: "最近のアクティビティ", t3: "通知", t4: "お気に入り", t6: "個人分析", t7: "ダウンロード履歴", t8: "設定", t9: "セキュリティ", t10: "危険ゾーン", t11: "マイプレイリスト", t12: "オーナーダッシュボード" },
    ko: { t1: "빠른 통계", t2: "최근 활동", t3: "알림", t4: "즐겨찾기", t6: "개인 분석", t7: "다운로드 기록", t8: "설정", t9: "보안", t10: "위험 구역", t11: "내 재생목록", t12: "소유자 대시보드" },
    zh: { t1: "快速统计", t2: "最近活动", t3: "通知", t4: "收藏", t6: "个人分析", t7: "下载历史", t8: "设置", t9: "安全", t10: "危险区域", t11: "我的播放列表", t12: "所有者仪表盘" }
  };
  var _lang = "en";
  try { _lang = localStorage.getItem("wantedLang") || "en"; } catch (e) {}
  var _themeTarget = document.documentElement;
  function _tt(key, fb) {
    var D = window.SiteChromeI18N;
    if (D && D[_lang] && D[_lang][key]) return D[_lang][key];
    return fb;
  }
  function applyI18n() {
    var t = (window.SiteChromeI18N && window.SiteChromeI18N[_lang]) || I18N[_lang] || I18N.en;
    var map = { t1: "stats", t2: "activity", t3: "notifications", t4: "favorites", t6: "analytics", t7: "downloads", t8: "settings", t9: "security", t10: "danger", t11: "playlists", t12: "owner-panel" };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) {
        var h = el.querySelector(".sec-title");
        if (h) h.textContent = t[k];
      }
    });
    if (window.applySiteI18n) window.applySiteI18n(_lang);
    try { document.documentElement.lang = _lang; } catch (e) {}
    applyAppearance();
  }
  function applyThemeLang() {
    var theme = _data && _data.theme ? _data.theme : (_cachedTheme || "default");
    var th = document.getElementById("setTheme");
    if (th) th.value = theme;
    var fth = document.getElementById("ftTheme");
    if (fth) fth.value = theme;
    var lg = document.getElementById("setLang");
    if (lg) lg.value = _lang;
    var flg = document.getElementById("ftLang");
    if (flg) flg.value = _lang;
    applyTheme(theme);
    try { localStorage.setItem("wantedTheme", theme); } catch (e) {}
    try { localStorage.setItem("wantedLang", _lang); } catch (e) {}
    applyI18n();
  }
  function applyTheme(theme) {
    theme = theme || "default";
    _themeTarget = document.documentElement;
    _themeTarget.setAttribute("data-theme", theme);
    var ap = document.getElementById("account-page");
    if (ap) ap.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
  }
  function bindThemeLang() {
    function fillSelect(sel, list) {
      if (!sel || sel.dataset.filled) return;
      sel.dataset.filled = "1";
      list.forEach(function (x) { var o = document.createElement("option"); o.value = x[0]; o.textContent = x[1]; sel.appendChild(o); });
    }
    var th = document.getElementById("setTheme");
    var fth = document.getElementById("ftTheme");
    var lg = document.getElementById("setLang");
    var flg = document.getElementById("ftLang");
    fillSelect(th, THEMES); fillSelect(fth, THEMES);
    fillSelect(lg, LANGS); fillSelect(flg, LANGS);
    function syncTheme(v) { if (th) th.value = v; if (fth) fth.value = v; }
    function syncLang(v) { if (lg) lg.value = v; if (flg) flg.value = v; }
    function bindThemeSel(sel) {
      if (!sel) return;
      sel.addEventListener("change", function () {
        var v = sel.value;
        applyTheme(v);
        syncTheme(v);
        try { localStorage.setItem("wantedTheme", v); } catch (e) {}
        api({ action: "saveTheme", theme: v }).then(function () { loadAccount(); });
        var tt = null;
        if (window.SiteChromeI18N && window.SiteChromeI18N[_lang]) tt = window.SiteChromeI18N[_lang].toastThemeApplied;
        toast(tt || "Theme applied", "success");
      });
    }
    function bindLangSel(sel) {
      if (!sel) return;
      sel.addEventListener("change", function () {
        _lang = sel.value;
        syncLang(_lang);
        applyI18n();
        try { localStorage.setItem("wantedLang", _lang); } catch (e) {}
        api({ action: "saveLanguage", language: _lang }).then(function () { loadAccount(); });
        var tt = null;
        if (window.SiteChromeI18N && window.SiteChromeI18N[_lang]) tt = window.SiteChromeI18N[_lang].toastLangSet;
        toast((tt || "Language set to") + " " + (sel.options[sel.selectedIndex].textContent), "success");
      });
    }
    bindThemeSel(th); bindThemeSel(fth);
    bindLangSel(lg); bindLangSel(flg);
    syncTheme(_data && _data.theme ? _data.theme : (_cachedTheme || "default"));
    syncLang(_lang);
  }

  /* ---------- Profile persistence ---------- */
  function persistProfile() {
    api({ action: "updateProfile", name: _profile.name, bio: _profile.bio, status: _profile.status, avatar: _profile.avatar, banner: _profile.banner }).then(function () {
      loadAccount();
    });
  }
  function fileToDataURL(file, maxW, maxH, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var r = Math.min(maxW / w, maxH / h, 1);
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * r));
        canvas.height = Math.max(1, Math.round(h * r));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        cb(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function bindProfile() {
    var editBtn = document.getElementById("editProfileBtn");
    if (editBtn) editBtn.addEventListener("click", function () {
      var mp = document.getElementById("mAvatarPreview");
      if (mp) mp.innerHTML = _profile.avatar ? '<img src="' + esc(_profile.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fas fa-user"></i>';
      openModal("editProfileModal");
      fillMLinks();
    });
    var mAv = document.getElementById("mAvatarFile");
    if (mAv) mAv.addEventListener("change", function () {
      if (!mAv.files[0]) return;
      fileToDataURL(mAv.files[0], 256, 256, function (url) {
        _profile.avatar = url;
        var mp = document.getElementById("mAvatarPreview");
        if (mp) mp.innerHTML = '<img src="' + url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
      });
    });
    var dbiSave = document.getElementById("dbiSaveBtn");
    if (dbiSave) dbiSave.addEventListener("click", function () {
      var dbi = document.getElementById("dbiInput");
      if (!dbi) return;
      var v = dbi.value.trim();
      _profile.bio = v || _profile.bio;
      dbi.value = "";
      persistProfile();
      applyProfile();
      closeModal("discordBioModal");
      toast(v ? _tt("toastBioSynced", "Discord bio synced to your profile") : _tt("toastBioSkipped", "Bio left empty"), v ? "success" : "info");
    });
    var mSave = document.getElementById("mSaveBtn");
    if (mSave) mSave.addEventListener("click", function () {
      _profile.name = document.getElementById("mName").value.trim() || _profile.name;
      _profile.status = document.getElementById("mStatus").value;
      _profile.bio = document.getElementById("mBio").value.trim() || "";
      persistProfile();
      applyProfile();
      var mBox = document.getElementById("mLinksEditor");
      if (mBox) {
        var mLinks = collectLinks(mBox).slice(0, 12);
        api({ action: "saveLinks", links: mLinks }).then(function (d) {
          if (!d || !d.ok) toast((d && d.error) || _tt("couldNotSaveLinks", "Could not save links"), "error");
        });
      }
      closeModal("editProfileModal");
      toast(_tt("toastProfileUpdated", "Profile updated"), "success");
    });
    var saveBtn = document.getElementById("saveProfileBtn");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      _profile.name = document.getElementById("setName").value.trim() || _profile.name;
      _profile.status = document.getElementById("setStatus").value;
      _profile.bio = document.getElementById("setBio").value.trim() || "";
      persistProfile();
      applyProfile();
      toast(_tt("toastSettingsSaved", "Settings saved"), "success");
    });
    var avFile = document.getElementById("avatarFile");
    if (avFile) avFile.addEventListener("change", function () {
      if (!avFile.files[0]) return;
      fileToDataURL(avFile.files[0], 256, 256, function (url) {
        _profile.avatar = url;
        var ap = document.getElementById("avatarPreview");
        if (ap) ap.innerHTML = '<img src="' + url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
      });
    });
    var profSave = document.getElementById("profSaveBtn");
    if (profSave) profSave.addEventListener("click", function () {
      var pn = document.getElementById("profName"), pb = document.getElementById("profBio");
      if (pn) _profile.name = pn.value.trim() || _profile.name;
      if (pb) _profile.bio = pb.value.trim() || "";
      persistProfile();
      applyProfile();
      var res = document.getElementById("profResult");
      if (res) {
        res.textContent = _tt("toastProfileUpdated", "Profile updated");
        res.style.display = "";
        setTimeout(function () { res.style.display = "none"; }, 2600);
      }
      toast(_tt("toastProfileUpdated", "Profile updated"), "success");
    });
  }

  /* ---------- Profile links (server-synced) ---------- */
  function linksRow(l) {
    return '<div class="link-row"><input type="text" class="link-row-label" placeholder="' + esc(_tt("linkLabelPh", "Label (e.g. YouTube)")) + '" maxlength="40" value="' + esc(l.label) + '"><input type="url" class="link-row-url" placeholder="https://" maxlength="500" value="' + esc(l.url) + '"><button type="button" class="mini-btn del" title="' + esc(_tt("remove", "Remove")) + '" data-dellink="1"><i class="fas fa-xmark"></i></button></div>';
  }
  function collectLinks(box) {
    var out = [];
    box.querySelectorAll(".link-row").forEach(function (r) {
      var l = r.querySelector(".link-row-label");
      var u = r.querySelector(".link-row-url");
      var label = l ? l.value.trim() : "";
      var url = u ? u.value.trim() : "";
      if (label || url) out.push({ label: label, url: url });
    });
    return out;
  }
  function bindLinkRowActions() {
    var box = document.getElementById("linksEditor");
    if (!box) return;
    box.querySelectorAll("[data-dellink]").forEach(function (del) {
      del.onclick = function () {
        var r = del.closest(".link-row");
        if (r) r.remove();
        if (!box.querySelector(".link-row")) box.innerHTML = '<p class="ac-empty">' + esc(_tt("noLinks", "No links yet.")) + '</p>';
      };
    });
  }
  function applyLinks() {
    var box = document.getElementById("linksEditor");
    if (!box) return;
    var rows = (_data && _data.links) || [];
    box.innerHTML = rows.length ? rows.map(linksRow).join("") : '<p class="ac-empty">' + esc(_tt("noLinks", "No links yet.")) + '</p>';
    bindLinkRowActions();
  }
  function bindLinks() {
    var box = document.getElementById("linksEditor");
    if (!box) return;
    bindLinkRowActions();
    var addBtn = document.getElementById("linksAddBtn");
    if (addBtn) addBtn.onclick = function () {
      var cur = collectLinks(box);
      cur.push({ label: "", url: "" });
      box.innerHTML = cur.map(linksRow).join("");
      bindLinkRowActions();
      var last = box.querySelector(".link-row:last-child .link-row-label");
      if (last) last.focus();
    };
    var saveBtn = document.getElementById("saveLinksBtn");
    if (saveBtn) saveBtn.onclick = function () {
      var links = collectLinks(box).slice(0, 12);
      api({ action: "saveLinks", links: links }).then(function (d) {
        if (d && d.ok) { toast(_tt("toastLinksSaved", "Links saved"), "success"); loadAccount(); }
        else { toast((d && d.error) || _tt("couldNotSaveLinks", "Could not save links"), "error"); }
      }).catch(function () { toast(_tt("couldNotSaveLinks", "Could not save links"), "error"); });
    };
  }

  /* ---------- Playlists (server-synced) ---------- */
  var _plColor = "";
  var _plEditId = null;
  var _plDetailId = null;
  var _ppPlaylists = null;
  function renderPlaylistsRows(rows, own, grid) {
    grid = grid || document.getElementById("plGrid");
    if (!grid) return;
    var nb = document.getElementById("plNewBtn");
    if (nb) nb.style.display = own ? "" : "none";
    if (!rows || !rows.length) {
      if (!own) { grid.innerHTML = '<p class="ac-empty" style="grid-column:1/-1">' + esc(_tt("noPlaylists", "No playlists yet")) + '</p>'; return; }
      grid.innerHTML = '<div class="card pl-empty-card"><i class="fas fa-list-music"></i><b>' + esc(_tt("noPlaylists", "No playlists yet")) + '</b><p>' + esc(_tt("plEmptySub", "Create a playlist and it will sync across every device you use.")) + '</p><button class="btn btn-gold btn-sm" id="plNewBtnEmpty"><i class="fas fa-plus"></i>' + esc(_tt("createFirstPl", "Create your first playlist")) + '</button></div>'; bindPlNew(); return;
    }
    var pal = ["#a855f7", "#ec4899", "#f59e0b", "#22d3ee", "#22c55e", "#3b82f6", "#ef4444"];
    grid.innerHTML = rows.map(function (p, i) {
      var col = p.color || pal[i % pal.length];
      var initials = String(p.name || "PL").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 3).toUpperCase() || "PL";
      var dur = "";
      if (p.tracks && p.tracks.length) {
        var secs = 0;
        p.tracks.forEach(function (t) { secs += trackDurationOf(t.title); });
        dur = '<span><i class="fas fa-clock"></i> ' + fmtHours(secs) + '</span>';
      }
      var acts = '<div class="pl-actions"><button class="mini-btn play" data-playpl="' + p.id + '" title="' + esc(_tt("playTitle", "Play")) + '"><i class="fas fa-play"></i></button><button class="mini-btn" data-openpl="' + p.id + '" title="' + esc(_tt("openTitle", "Open")) + '"><i class="fas fa-list-ul"></i></button>';
      if (own) acts += '<button class="mini-btn" data-editpl="' + p.id + '" title="' + esc(_tt("editTitle", "Edit")) + '"><i class="fas fa-pen"></i></button><button class="mini-btn del" data-delpl="' + p.id + '" title="' + esc(_tt("deleteTitle", "Delete")) + '"><i class="fas fa-trash"></i></button>';
      acts += '</div>';
      return '<div class="card pl-card" data-pl="' + p.id + '"><div class="pl-cover" style="background:linear-gradient(135deg,' + col + ',rgba(20,12,40,.9))">' + esc(initials) + '<i class="fas fa-play play-hover" data-playpl="' + p.id + '"></i></div><div class="pl-info"><div class="pl-name">' + esc(p.name) + '</div><div class="pl-desc">' + esc(p.desc || "") + '</div><div class="pl-meta"><span><i class="fas fa-music"></i> ' + (p.count || 0) + ' ' + esc(_tt("songsCount", "songs")) + '</span>' + dur + '</div></div>' + acts + '</div>';
    }).join("");
  }
  function applyPlaylists() {
    renderPlaylistsRows((_data && _data.playlists) || [], true);
  }
  function trackDurationOf(title) {
    try {
      if (typeof trackList !== "undefined" && trackList) {
        for (var i = 0; i < trackList.length; i++) { if (String(trackList[i].title) === String(title)) return Number(trackList[i].duration) || 0; }
      }
    } catch (e) {}
    return 0;
  }
  function findPlaylist(id) {
    var pl = null;
    if (_ppPlaylists && _profilePage && _profilePage.self === false) {
      _ppPlaylists.forEach(function (p) { if (String(p.id) === String(id)) pl = p; });
    }
    if (!pl) ((_data && _data.playlists) || []).forEach(function (p) { if (String(p.id) === String(id)) pl = p; });
    return pl;
  }
  function playPlaylist(id) {
    var pl = findPlaylist(id);
    if (!pl) return;
    var titles = (pl.tracks || []).map(function (t) { return t.title; }).filter(Boolean);
    if (!titles.length) { toast(_tt("toastPlNoTracks", "This playlist has no tracks yet"), "error"); return; }
    if (window.queueTracks) { window.queueTracks(titles); toast(_tt("playing", "Playing") + ' "' + pl.name + '" (' + titles.length + " " + _tt("tracks", "tracks") + ")", "success"); }
    else { toast(_tt("toastPlayerWarming", "Player is warming up - try again"), "error"); }
    if (window.switchAppPage) switchAppPage("player");
  }
  function openPlDetail(id) {
    var pl = findPlaylist(id);
    if (!pl) return;
    _plDetailId = id;
    var isOwn = false;
    if (!(_ppPlaylists && _profilePage && _profilePage.self === false)) {
      ((_data && _data.playlists) || []).forEach(function (p) { if (String(p.id) === String(id)) isOwn = true; });
    }
    document.getElementById("plDetailTitle").textContent = pl.name;
    document.getElementById("plDetailCount").textContent = (pl.count || 0) + " " + _tt("tracks", "tracks");
    var list = document.getElementById("plTrackList");
    var addRow = document.getElementById("plAddTitle");
    if (addRow && addRow.closest) addRow.closest(".pl-track-add").style.display = isOwn ? "" : "none";
    if (!(pl.tracks || []).length) { list.innerHTML = '<p class="ac-empty">' + esc(_tt("plNoTracksDetail", "No tracks yet - add songs to build a playlist.")) + '</p>'; }
    else {
      list.innerHTML = pl.tracks.map(function (t, i) {
        return '<div class="pl-track-row"><span class="pl-track-idx">' + (i + 1) + '</span><span class="pl-track-name" data-pltrackplay="' + esc(t.title) + '"><i class="fas fa-music"></i>' + esc(t.title) + '</span><span class="pl-track-dur">' + fmtHours(trackDurationOf(t.title)) + '</span><button class="mini-btn" data-pltrackfav="' + esc(t.title) + '" title="' + esc(_tt("favTitle", "Favorite")) + '"><i class="fas fa-heart"></i></button>' + (isOwn ? '<button class="mini-btn del" data-pltrackdel="' + t.id + '" title="' + esc(_tt("remove", "Remove")) + '"><i class="fas fa-xmark"></i></button>' : '') + '</div>';
      }).join("");
    }
    openModal("plDetailModal");
  }
  function bindPlNew() {
    var b1 = document.getElementById("plNewBtn");
    var b2 = document.getElementById("plNewBtnEmpty");
    [b1, b2].forEach(function (b) {
      if (b) b.onclick = function () {
        _plEditId = null; _plColor = "";
        document.getElementById("plModalTitle").textContent = _tt("newPlaylist", "New Playlist");
        document.getElementById("plName").value = "";
        document.getElementById("plDesc").value = "";
        bindPlColors();
        openModal("editPlModal");
      };
    });
  }
  function bindPlColors() {
    var row = document.getElementById("plColors");
    if (!row) return;
    row.querySelectorAll("span").forEach(function (s) {
      s.classList.toggle("on", s.getAttribute("data-c") === _plColor);
    });
  }
  function bindPlGrid(grid) {
    if (!grid) return;
    grid.addEventListener("click", function (e) {
      var play = e.target.closest("[data-playpl]");
      var open = e.target.closest("[data-openpl]");
      var del = e.target.closest("[data-delpl]");
      var edit = e.target.closest("[data-editpl]");
      if (play) { playPlaylist(parseInt(play.getAttribute("data-playpl"), 10)); return; }
      if (open) { openPlDetail(parseInt(open.getAttribute("data-openpl"), 10)); return; }
      if (del) {
        var id = parseInt(del.getAttribute("data-delpl"), 10);
        var card = del.closest(".pl-card");
        if (card) { card.style.transition = "all .3s"; card.style.opacity = "0"; card.style.transform = "scale(.92)"; }
        setTimeout(function () {
          api({ action: "deletePlaylist", id: id }).then(function () {
            loadAccount();
            toast(_tt("toastPlDeleted", "Playlist deleted"), "info");
          });
        }, 280);
        return;
      }
      if (edit) {
        var pid = parseInt(edit.getAttribute("data-editpl"), 10);
        var p = null;
        ((_data && _data.playlists) || []).forEach(function (x) { if (x.id === pid) p = x; });
        if (!p) return;
        _plEditId = pid; _plColor = p.color || "";
        document.getElementById("plModalTitle").textContent = _tt("editPlaylist", "Edit Playlist");
        document.getElementById("plName").value = p.name;
        document.getElementById("plDesc").value = p.desc || "";
        bindPlColors();
        openModal("editPlModal");
      }
    });
  }
  function bindPlaylists() {
    bindPlNew();
    bindPlGrid(document.getElementById("plGrid"));
    var colorRow = document.getElementById("plColors");
    if (colorRow) colorRow.addEventListener("click", function (e) {
      var s = e.target.closest("span[data-c]");
      if (!s) return;
      _plColor = s.getAttribute("data-c");
      bindPlColors();
    });
    var plSave = document.getElementById("plSaveBtn");
    if (plSave) plSave.addEventListener("click", function () {
      var name = (document.getElementById("plName").value || "").trim();
      var desc = (document.getElementById("plDesc").value || "").trim();
      if (!name) { toast(_tt("toastEnterPlName", "Enter a playlist name"), "error"); return; }
      if (_plEditId) {
        api({ action: "renamePlaylist", id: _plEditId, name: name, desc: desc, color: _plColor }).then(function () {
          closeModal("editPlModal");
          loadAccount();
          toast(_tt("toastPlUpdated", "Playlist updated"), "success");
        });
      } else {
        api({ action: "createPlaylist", name: name, desc: desc, color: _plColor }).then(function () {
          closeModal("editPlModal");
          loadAccount();
          toast(_tt("toastPlCreated", "Playlist created"), "success");
        });
      }
    });
    var detailAdd = document.getElementById("plAddBtn");
    if (detailAdd) detailAdd.addEventListener("click", function () {
      var title = (document.getElementById("plAddTitle").value || "").trim();
      if (!_plDetailId || !title) { toast(_tt("toastEnterSongTitle", "Enter a song title"), "error"); return; }
      api({ action: "addPlaylistTrack", playlist_id: _plDetailId, title: title }).then(function () {
        document.getElementById("plAddTitle").value = "";
        loadAccount();
        setTimeout(function () { openPlDetail(_plDetailId); }, 100);
      });
    });
    var trackListBox = document.getElementById("plTrackList");
    if (trackListBox) trackListBox.addEventListener("click", function (e) {
      var fav = e.target.closest("[data-pltrackfav]");
      var play = e.target.closest("[data-pltrackplay]");
      var del = e.target.closest("[data-pltrackdel]");
      if (fav) {
        api({ action: "toggleFavorite", title: fav.getAttribute("data-pltrackfav") }).then(function () {
          toast(_tt("toastFavUpdated", "Favorite updated"), "success");
        }).catch(function () {});
        return;
      }
      if (play) {
        var title = play.getAttribute("data-pltrackplay");
        if (window.queueTracks) window.queueTracks([title]);
        else toast(_tt("nowPlaying", "Now playing") + " " + title, "info");
        return;
      }
      if (del) {
        api({ action: "removePlaylistTrack", track_id: parseInt(del.getAttribute("data-pltrackdel"), 10) }).then(function () {
          loadAccount();
          setTimeout(function () { openPlDetail(_plDetailId); }, 100);
        });
      }
    });
    document.getElementById("plAddTitle").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && document.getElementById("plAddBtn")) document.getElementById("plAddBtn").click();
    });
  }

  /* ---------- Edit profile modal links ---------- */
  function fillMLinks() {
    var box = document.getElementById("mLinksEditor");
    if (!box) return;
    var rows = (_data && _data.links) || [];
    box.innerHTML = rows.length ? rows.map(linksRow).join("") : '<p class="ac-empty" style="text-align:center;padding:8px">' + esc(_tt("noLinks", "No links yet.")) + '</p>';
    box.querySelectorAll("[data-dellink]").forEach(function (del) {
      del.onclick = function () {
        var r = del.closest(".link-row");
        if (r) r.remove();
        if (!box.querySelector(".link-row")) box.innerHTML = '<p class="ac-empty" style="text-align:center;padding:8px">' + esc(_tt("noLinks", "No links yet.")) + '</p>';
      };
    });
  }
  function bindMLinks() {
    var box = document.getElementById("mLinksEditor");
    if (!box) return;
    function rebindDels() {
      box.querySelectorAll("[data-dellink]").forEach(function (del) {
        del.onclick = function () {
          var r = del.closest(".link-row");
          if (r) r.remove();
          if (!box.querySelector(".link-row")) box.innerHTML = '<p class="ac-empty" style="text-align:center;padding:8px">' + esc(_tt("noLinks", "No links yet.")) + '</p>';
        };
      });
    }
    var add = document.getElementById("mLinksAddBtn");
    if (add) add.onclick = function () {
      var cur = collectLinks(box);
      cur.push({ label: "", url: "" });
      box.innerHTML = cur.map(linksRow).join("");
      rebindDels();
      var last = box.querySelector(".link-row:last-child .link-row-label");
      if (last) last.focus();
    };
    rebindDels();
  }

  /* ---------- Account views (sidebar shell) ---------- */
  var AC_LEGACY_VIEWS = { stats: "profile", activity: "profile", playlists: "profile", favorites: "profile", analytics: "profile", downloads: "profile", settings: "profile", security: "password", "site-prefs": "profile" };
  var AC_PROFILE_SECTIONS = ["profile", "activity", "playlists", "favorites", "analytics", "downloads"];
  var _acView = "profile";
  try { if (sessionStorage.getItem("ac_view")) _acView = sessionStorage.getItem("ac_view"); } catch (e) {}
  if (AC_LEGACY_VIEWS[_acView]) _acView = AC_LEGACY_VIEWS[_acView];
  var AC_VIEWS = [
    ["profile", "Profile", "fa-user", "Profile", "Your profile, stats, playlists, favorites, analytics & settings", "acTitle", "acSubProfile"],
    ["email", "Email & Verifications", "fa-envelope", "Email & Verifications", "Change your email and view account information", "emailTitle", "acSubEmail"],
    ["password", "Password", "fa-key", "Password", "Update your password, active devices & recent logins", "pwTitle", "acSubPassword"],
    ["connected", "Connected Accounts", "fa-link", "Connected Accounts", "Link or unlink Discord and Google", "connectedTitle", "acSubConnected"],
    ["danger", "Danger Zone", "fa-triangle-exclamation", "Danger Zone", "Irreversible account actions", "dangerTitle", "acSubDanger"]
  ];
  var _acViewValid = false;
  AC_VIEWS.forEach(function (v) { if (v[0] === _acView) _acViewValid = true; });
  if (!_acViewValid) { _acView = "profile"; try { sessionStorage.setItem("ac_view", "profile"); } catch (e) {} }
  function showAcView(id) {
    if (AC_LEGACY_VIEWS[id]) id = AC_LEGACY_VIEWS[id];
    _acView = id;
    try { sessionStorage.setItem("ac_view", id); } catch (e) {}
  }
  function switchAccountView(id) {
    if (!document.getElementById(id)) return;
    showAcView(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function buildSidebar() {
    var nav = document.getElementById("acShellNav");
    if (!nav || nav.dataset.built) return;
    nav.dataset.built = "1";
    AC_VIEWS.forEach(function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ac-nav-btn";
      b.setAttribute("data-ac-view", v[0]);
      b.innerHTML = '<i class="fas ' + v[2] + '"></i><span>' + _tt(v[5], v[1]) + '</span>';
      b.addEventListener("click", function () { switchAccountView(v[0]); });
      nav.appendChild(b);
    });
  }
  var AC_JUMP_TARGETS = { profile: "profile", email: "email", password: "password", connected: "connected", danger: "danger", stats: "ppStats", settings: "appearance", "site-prefs": "appearance", security: "security", activity: "ppStats", playlists: "playlists", favorites: "favorites", analytics: "analytics", downloads: "downloads" };
  var AC_PROFILE_TARGETS = ["ppStats", "playlists", "favorites", "analytics"];
  function acctJump(id) {
    var t = AC_JUMP_TARGETS[id] || id;
    if (AC_PROFILE_TARGETS.indexOf(t) >= 0) {
      if (window.openProfile) window.openProfile();
      setTimeout(function () {
        var el = document.getElementById(t);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 450);
      return;
    }
    if (window.switchAppPage) {
      var sec = document.getElementById("page-section-account");
      if (!sec || !sec.classList.contains("active")) window.switchAppPage("account");
    }
    setTimeout(function () {
      var el = document.getElementById(t);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 80);
  }
  function bindNavMenu() {
    var wrap = document.querySelector(".nav-account-wrap");
    var btn = document.getElementById("nav-account-btn");
    if (btn) btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (wrap) wrap.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (wrap && !wrap.contains(e.target)) wrap.classList.remove("open");
    });
    var menu = document.getElementById("nav-account-menu");
    if (menu) menu.addEventListener("click", function (e) {
      var tab = e.target.closest(".nam-tab");
      if (tab) {
        e.stopPropagation();
        var target = tab.getAttribute("data-ac-tab");
        if (target) acctJump(target);
        var sub = tab.nextElementSibling;
        if (sub && sub.classList.contains("nam-sub")) {
          var was = tab.classList.contains("open");
          menu.querySelectorAll(".nam-tab.open").forEach(function (t) { t.classList.remove("open"); });
          if (!was) tab.classList.add("open");
        }
        return;
      }
      var link = e.target.closest(".nam-link");
      if (link) {
        if (link.getAttribute("data-acct-open-profile")) {
          if (wrap) wrap.classList.remove("open");
          if (window.openProfile) window.openProfile();
          return;
        }
        var t = link.getAttribute("data-acct-jump");
        if (t) { if (wrap) wrap.classList.remove("open"); acctJump(t); }
      }
    });
    window.acctJump = acctJump;
    window.openEditProfile = function () {
      var mp = document.getElementById("mAvatarPreview");
      if (mp) mp.innerHTML = _profile.avatar ? '<img src="' + esc(_profile.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fas fa-user"></i>';
      openModal("editProfileModal");
      fillMLinks();
    };
    window.viewMyProfile = function () {
      if (window.openProfile) window.openProfile();
      else acctJump("profile");
    };
  }

  function askNotifPermission() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    try { Notification.requestPermission(); } catch (e) {}
  }

    /* ---------- Public profile page ---------- */
  var _profilePage = { key: "", byDiscord: false, data: null, self: false };
  function ppHours(sec) {
    var v = Number(sec || 0);
    if (v >= 100) return Math.round(v) + "h";
    return (Math.round(v * 10) / 10) + "h";
  }
  function ppTime(hours) {
    var v = Number(hours || 0);
    if (v <= 0) return "0m";
    var h = Math.floor(v), m = Math.round((v - h) * 60);
    if (m >= 60) { h += 1; m = 0; }
    if (h >= 1) return h + "h " + m + "m";
    return Math.max(1, m) + "m";
  }
  function qstat(htmlVal, label) {
    return '<div class="cmp-qstat"><b>' + htmlVal + '</b><span>' + esc(label) + '</span></div>';
  }
  function profilePageLoading() {
    return '<div class="pp-loading"><div class="pp-spinner"></div><p>' + esc(_tt("loadingProfile", "Loading profile...")) + '</p></div>';
  }
  function profilePageError(msg) {
    return '<div class="pp-error"><div class="pp-error-ico"><i class="fas fa-user-slash"></i></div><h2>' + esc(_tt("profileNotFound", "Profile Not Found")) + '</h2><p>' + esc(msg || _tt("profileNotFoundSub", "This profile doesn't exist or was deleted.")) + '</p><button type="button" class="pp-btn pp-btn-ghost" onclick="switchAppPage(&#39;home&#39;)"><i class="fas fa-arrow-left"></i><span>' + esc(_tt("backLobby", "Back to Lobby")) + '</span></button></div>';
  }
  function wireCompactHost(host, includeSections) {
    if (!host) return;
    var so = host.querySelector("[data-cmp-signout]");
    if (so) so.addEventListener("click", function () {
      if (window.authSignOut) window.authSignOut();
      else window.location.href = "/api/auth/logout";
    });
    if (!includeSections) return;
    var tg = host.querySelector("[data-fav-toggle]");
    if (tg) tg.addEventListener("click", function () {
      host.classList.toggle("cmp-list");
      var ic = tg.querySelector("i");
      if (ic) ic.className = host.classList.contains("cmp-list") ? "fas fa-list" : "fas fa-table-cells-large";
    });
    var fg = host.querySelector(".cmp-fav-grid");
    if (fg) { renderFavRows((_data && _data.favorites) || [], true, fg); bindFavGrid(fg); }
    var pg = host.querySelector(".cmp-pl-grid");
    if (pg) { renderPlaylistsRows((_data && _data.playlists) || [], true, pg); bindPlGrid(pg); }
  }
  function renderSelfProfilePage() {
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    body.innerHTML = compactProfileHtml(true);
    wireCompactHost(body, true);
  }
  function renderProfilePageBody() {
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    body.classList.add("cmp-profile-host");
    if (_profilePage.self) { _ppPlaylists = null; renderSelfProfilePage(); return; }
    if (_profilePage.data) {
      body.innerHTML = '<div class="cmp-card cmp-card-page">' + compactProfileViewHtml(_profilePage.data) + '</div>';
      _ppPlaylists = _profilePage.data.playlists || [];
      var fg = document.getElementById("pvFavGrid");
      if (fg) renderFavRows(_profilePage.data.favorites || [], false, fg);
      bindPvFavGrid(fg);
      bindPvPls();
      return;
    }
    body.innerHTML = profilePageLoading();
    var q = _profilePage.byDiscord ? "/api/profile?discord=" + encodeURIComponent(_profilePage.key) : "/api/profile?user=" + encodeURIComponent(_profilePage.key);
    fetch(q, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { body.innerHTML = profilePageError(d && d.error ? String(d.error) : ""); return; }
        if (String(d.uid) === String(uid)) { _profilePage.self = true; _profilePage.key = ""; _profilePage.byDiscord = false; renderSelfProfilePage(); return; }
        _profilePage.data = d;
        body.innerHTML = '<div class="cmp-card cmp-card-page">' + compactProfileViewHtml(d) + '</div>';
        _ppPlaylists = d.playlists || [];
        var fg = document.getElementById("pvFavGrid");
        if (fg) renderFavRows(d.favorites || [], false, fg);
        bindPvFavGrid(fg);
        bindPvPls();
      })
      .catch(function () { body.innerHTML = profilePageError(); });
  }
  function bindPvPls() {
    var box = document.querySelector("#profilePageBody .pv-pls");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var play = e.target.closest("[data-playpl]");
      if (play) { playPlaylist(play.getAttribute("data-playpl")); return; }
      var card = e.target.closest("[data-openpl]");
      if (card) openPlDetail(card.getAttribute("data-openpl"));
    });
  }
  function bindPvFavGrid(fg) {
    if (!fg) return;
    fg.addEventListener("click", function (e) {
      if (e.target.closest(".fav-like")) return;
      var play = e.target.closest("[data-play-idx]");
      if (play) {
        var idx = parseInt(play.getAttribute("data-play-idx"), 10);
        if (!isNaN(idx) && idx >= 0 && window.selectTrackFromList) { window.selectTrackFromList(idx); if (window.showMiniPlayer) window.showMiniPlayer(); }
      }
    });
  }
  window.openProfile = function (user, byDiscord) {
    var target = String(user == null ? "" : user).trim().replace(/^@/, "");
    if (!target || String(target) === String(uid)) {
      if (!uid) { if (window.switchAppPage) switchAppPage("account"); toast(_tt("toastSignInProfile", "Sign in to view your profile"), "info"); return; }
      _profilePage.self = true; _profilePage.key = ""; _profilePage.byDiscord = false; _profilePage.data = null;
      if (window.switchAppPage) switchAppPage("profile");
      try { if (history.pushState) history.pushState({ profile: true }, "", "/profile"); } catch (e) {}
      return;
    }
    _profilePage.self = false; _profilePage.key = target; _profilePage.byDiscord = !!byDiscord; _profilePage.data = null;
    if (window.switchAppPage) switchAppPage("profile");
    try { if (history.pushState) history.pushState({ profile: target }, "", "/profile/" + encodeURIComponent(target)); } catch (e) {}
  };
window.profileSectionShown = function () {
    renderProfilePageBody();
  };
  window.addEventListener("popstate", function () {
    var p = (location.pathname || "").replace(/\/+$/, "");
    if (p === "/profile") { if (window.openProfile) window.openProfile(); }
    else if (p.indexOf("/profile/") === 0) { if (window.openProfile) window.openProfile(decodeURIComponent(p.slice(9))); }
  });
  (function bindProfilePage() {
    var share = document.getElementById("ppShareBtn");
    if (share) share.addEventListener("click", function () {
      var url = location.href.split("#")[0];
      var done = function () { toast(_tt("toastLinkCopied", "Profile link copied"), "success"); };
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        ta.remove();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, fallback);
      } else { fallback(); }
    });
    var edit = document.getElementById("ppEditBtn");
    if (edit) edit.addEventListener("click", function () {
      if (window.openEditProfile) window.openEditProfile();
      else if (window.acctJump) window.acctJump("profile");
    });
    var avEdit = document.getElementById("ppAvatarEdit");
    var avFile = document.getElementById("ppAvatarFile");
    if (avEdit && avFile) {
      avEdit.addEventListener("click", function () { avFile.click(); });
      avFile.addEventListener("change", function () {
        if (!avFile.files[0]) return;
        fileToDataURL(avFile.files[0], 256, 256, function (url) {
          _profile.avatar = url;
          persistProfile();
          var a = document.getElementById("ppAvatar");
          if (a) a.innerHTML = '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
          toast(_tt("toastProfileUpdated", "Profile updated"), "success");
        });
        avFile.value = "";
      });
    }
  })();

  /* ---------- Danger zone ---------- */
  function bindDanger() {}

  /* ---------- Modals ---------- */
  function openModal(id) { var el = document.getElementById(id); if (el) el.classList.add("open"); }
  function closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove("open"); }
  function bindModals() {
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close")); });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        document.querySelectorAll(".modal-overlay.open").forEach(function (ov) { ov.classList.remove("open"); });
      }
    });
  }

  /* ---------- Listen tracking (wrap main player) ---------- */
  function bindListenTracking() {
    function wrap() {
      if (window.playAudio && !window.playAudio.__acWrapped) {
        var orig = window.playAudio;
        var w = function () {
          orig.apply(this, arguments);
          try {
            var tl = typeof trackList !== "undefined" ? trackList : null;
            var ci = typeof currentTrackIndex !== "undefined" ? currentTrackIndex : -1;
            var t = tl && ci >= 0 ? tl[ci] : null;
            if (t && t.title) {
              try { if (!localStorage.getItem("wantedAuthUser")) return; } catch (e) {}
              api({ action: "listen", title: t.title, seconds: 45 });
            }
          } catch (e) {}
        };
        w.__acWrapped = true;
        window.playAudio = w;
      }
    }
    if (document.readyState === "complete" || document.readyState === "interactive") { setTimeout(wrap, 1200); }
    window.addEventListener("load", function () { setTimeout(wrap, 800); });
    setTimeout(wrap, 2500);
  }

  /* ---------- Render all ---------- */
  function renderAll() {
    _profile = (_data && _data.profile) || _profile;
    if (_data && _data.profile && _data.profile.username) _profile.username = _data.profile.username;
    _lang = (_data && _data.language) || _lang;
    if (window.loadServerFavorites && _data && _data.favorites) window.loadServerFavorites(_data.favorites.map(function (f) { return f.title; }));
    applyProfile();
    renderCompactProfile();
    applyLinks();
    applyStats();
    applyActivity();
    applyNotifications();
    applyFavorites();
    applyAnalytics();
    applyDownloads();
    applyLogins();
    applyDiscord();
    applyLastFm();
    applyAccountInfo();
    applyPasswordMode();
    applyThemeLang();
    applyPlaylists();
    applyOwner();
    buildSidebar();
    showAcView(_acView);
    if (_pendingDiscordBioPrompt && _data && _data.discord && _data.discord.linked) {
      _pendingDiscordBioPrompt = false;
      if (!(_data.profile && String(_data.profile.bio || "").trim())) openModal("discordBioModal");
    }
  }

  /* ---------- Login logging (once per session) ---------- */
  function logLoginOnce() {
    var key = "ac_login_logged_" + uid;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch (e) {}
    api({ action: "logLogin", method: "session" }).then(function () {
      loadAccount();
    });
  }

  /* ---------- Real-time polling ---------- */
  function startPolling() {
    stopPolling();
    _pollTimer = setInterval(function () {
      if (_visible && uid && !document.hidden) loadAccount();
    }, 45000);
  }
  function stopPolling() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

  window.__setAccountUid = function (newUid) {
    uid = String(newUid || "").slice(0, 40);
    uidSuffix = uid ? uid.slice(-4).toUpperCase() : "0000";
    try { localStorage.setItem("wantedUserId", uid); } catch (e) {}
    if (_profile && _profile.name && _profile.name.indexOf("999_") === 0) {
      _profile.name = "999_" + uidSuffix;
    }
    if (_data) _data = null;
    loadAccount();
  };

  window.accountSectionShown = function () {
    _visible = true;
    _ppPlaylists = null;
    applyTheme(_data && _data.theme ? _data.theme : _cachedTheme);
    try { document.documentElement.lang = _lang; } catch (e) {}
    if (uid) {
      loadAccount();
      logLoginOnce();
    } else {
      try { uid = localStorage.getItem("wantedUserId") || ""; } catch (e) {}
      if (uid) { loadAccount(); logLoginOnce(); }
    }
    askNotifPermission();
    startPolling();
  };
  window.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && _visible) loadAccount();
  });

  /* ---------- Init ---------- */
  bindModals();
  bindProfile();
  bindLinks();
  bindMLinks();
  bindNavMenu();
  bindFavorites();
  bindAnalyticsTabs();
  bindDownloads();
  bindPlaylists();
  bindDanger();
  bindThemeLang();
  bindSettingsPanels();
  bindAccountActions();
  bindNotifications();
  bindListenTracking();

  function bindCollapseTabs() {
    var sec = document.getElementById("analytics");
    var btn = document.getElementById("anCollapseToggle");
    if (!sec) return;
    function toggle() {
      var collapsed = sec.classList.toggle("collapsed");
      if (btn) {
        var ic = btn.querySelector("i");
        if (ic) ic.className = collapsed ? "fas fa-chevron-down" : "fas fa-chevron-up";
      }
    }
    var head = sec.querySelector(".sec-head");
    if (head) head.addEventListener("click", function (e) {
      if (e.target.closest("button")) return;
      toggle();
    });
    if (btn) btn.addEventListener("click", toggle);
  }

  function bindSectionCollapse() {
    var root = document.getElementById("page-section-account");
    if (!root) return;
    function makeToggle(el, getter) {
      if (el.dataset.collapseBound) return;
      el.dataset.collapseBound = "1";
      el.classList.add("ac-head-toggle");
      var chev = document.createElement("i");
      chev.className = "fas fa-chevron-up ac-coll-chev";
      el.appendChild(chev);
      el.addEventListener("click", function (e) {
        if (e.target.closest("button,a,input,select,textarea")) return;
        var collapsed = getter().classList.toggle("collapsed");
        chev.className = "fas fa-chevron-" + (collapsed ? "down" : "up");
      });
    }
    root.querySelectorAll(".ac-collapsible").forEach(function (sec) {
      var head = sec.querySelector(".sec-head");
      if (head) makeToggle(head, function () { return sec; });
    });
    root.querySelectorAll(".ac-set-collapsible").forEach(function (card) {
      var title = card.querySelector(".set-title");
      if (title) makeToggle(title, function () { return card; });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    try { uid = localStorage.getItem("wantedUserId") || ""; } catch (e) {}
    setNotifBell(!!uid);
    applyTheme(_cachedTheme);
    try { document.documentElement.lang = _lang; } catch (e) {}
    bindCollapseTabs();
    bindSectionCollapse();
    buildSidebar();
    try { if (window.initOwnerOverlay) window.initOwnerOverlay(); } catch (e) {}
    if (!window.__profileLinkBound) {
      window.__profileLinkBound = true;
      document.addEventListener("click", function (e) {
        var t = (e.target && e.target.closest) ? e.target.closest("[data-profile-link]") : null;
        if (!t) return;
        var id = t.getAttribute("data-profile-link");
        if (!id || !window.openProfile) return;
        e.preventDefault();
        window.openProfile(id, t.getAttribute("data-profile-discord") === "1");
      });
    }
    showAcView(_acView);
    (function () {
      var og = document.getElementById("navOwnerGroup");
      var crownM = document.getElementById("owner-crown-btn-m");
      var ppOwner = document.getElementById("mobile-profile-owner");
      var hide = function () { if (og) og.style.display = "none"; if (crownM) crownM.style.display = "none"; if (ppOwner) ppOwner.style.display = "none"; };
      var show = function () { if (og) og.style.display = ""; if (crownM) crownM.style.display = ""; if (ppOwner) ppOwner.style.display = ""; };
      var claimsOwner = false;
      try { claimsOwner = !!(localStorage.getItem("ownerCode") || localStorage.getItem("ownerByUser") === "1"); } catch (e) {}
      if (!uid || !claimsOwner) { hide(); return; }
      try {
        fetch("/api/wanted?user=" + encodeURIComponent(uid), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.owner) { show(); }
          else {
            hide();
            try { localStorage.removeItem("ownerCode"); localStorage.removeItem("ownerByUser"); } catch (e) {}
          }
        }).catch(function () { show(); });
      } catch (e) { show(); }
    })();
    if (uid) loadAccount();
    wrapSwitchAppPage();
    var ppath = (location.pathname || "").replace(/\/+$/, "") || "/";
    if (ppath === "/profile") { if (window.openProfile) window.openProfile(); }
    else if (ppath.indexOf("/profile/") === 0) { if (window.openProfile) window.openProfile(decodeURIComponent(ppath.slice(9))); }
    else {
      var bootPage = NAV_URL_REV[ppath];
      if (bootPage && window.switchAppPage) window.switchAppPage(bootPage);
    }
  });

  window.addEventListener("resize", function () {
    if (_data) {
      var active = document.querySelector("#anTabs .an-tab.active");
      renderAnalytics(active ? active.getAttribute("data-an") : "weekly");
    }
  });

  /* ---------- Navigation router: activeTab + URL routing ---------- */
  var _activeTab = "lobby";
  var NAV_URL = { home: "/", player: "/player", hub: "/vault", wanted: "/wanted", suggestions: "/suggestions", account: "/account", owner: "/owner", tos: "/TOS", pp: "/PP", dmca: "/DMCA" };
  var NAV_URL_REV = {};
  Object.keys(NAV_URL).forEach(function (k) { NAV_URL_REV[NAV_URL[k]] = k; });
  function _navTabFor(page) {
    if (page === "player") return "player";
    if (page === "hub") return "vault";
    if (page === "wanted" || page === "suggestions") return "community";
    if (page === "account") return "settings";
    if (page === "profile") return "profile";
    if (page === "owner") return "owner";
    return "lobby";
  }
  function _navPillFor(page) {
    if (page === "wanted" || page === "suggestions") return "page-nav-wanted";
    if (page === "profile" || page === "account" || page === "owner") return "";
    if (page === "tos" || page === "pp" || page === "dmca") return "page-nav-home";
    return "page-nav-" + page;
  }
  function _moveNavBubble(el) {
    var r = document.getElementById("nav-pill");
    var s = document.getElementById("nav-bubble");
    if (!r || !s) return;
    if (!el) { s.classList.remove("visible"); return; }
    var l = r.getBoundingClientRect();
    var d = el.getBoundingClientRect();
    s.style.left = (d.left - l.left) + "px";
    s.style.width = d.width + "px";
    s.classList.add("visible");
  }
  function _applyNavState(page) {
    _activeTab = _navTabFor(page);
    if (page !== "profile") _ppPlaylists = null;
    document.querySelectorAll(".page-tab-btn").forEach(function (b) { b.classList.remove("active"); });
    var ab = document.getElementById("nav-account-btn");
    if (ab) {
      ab.classList.toggle("profile-active", page === "profile" || page === "account" || page === "owner");
      ab.classList.toggle("settings-active", page === "account");
    }
    var pillId = _navPillFor(page);
    if (pillId === "") { _moveNavBubble(null); return; }
    var pill = document.getElementById(pillId);
    if (pill) pill.classList.add("active");
    _moveNavBubble(pill);
  }
  function wrapSwitchAppPage() {
    var base = window.switchAppPage;
    if (typeof base !== "function") return;
    window.switchAppPage = function (page) {
      base(page);
      _applyNavState(page);
      var url = NAV_URL[page];
      if (url && (location.pathname || "").replace(/\/+$/, "") !== url) {
        try { history.pushState({ page: page }, "", url); } catch (e) {}
      }
    };
  }
  window.addEventListener("popstate", function () {
    var p = (location.pathname || "").replace(/\/+$/, "") || "/";
    if (p === "/profile" || p.indexOf("/profile/") === 0) return;
    var page = NAV_URL_REV[p];
    if (page && window.switchAppPage) window.switchAppPage(page);
  });
  window.closeAcctMenu = function () {
    var w = document.querySelector(".nav-account-wrap");
    if (w) w.classList.remove("open");
  };
  window.openLegal = function (page) {
    if (page === "tos" || page === "pp" || page === "dmca") { if (window.switchAppPage) window.switchAppPage(page); }
  };
})();

(function () {
  function dashReady(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
  dashReady(function () {
    var links = Array.prototype.slice.call(document.querySelectorAll("#account-page .ac-nav-btn[data-ac-link], #account-page .acv-subnav-item[data-ac-link]"));
    var secs = [];
    links.forEach(function (l) {
      var el = document.getElementById(l.getAttribute("data-ac-link"));
      if (el) secs.push(el);
    });
    function setActive(id) {
      links.forEach(function (l) { l.classList.toggle("active", l.getAttribute("data-ac-link") === id); });
    }
    links.forEach(function (l) {
      l.addEventListener("click", function (e) {
        var id = l.getAttribute("data-ac-link");
        if (!id) return;
        e.preventDefault();
        setActive(id);
        if (window.acctJump) window.acctJump(id);
      });
    });
    Array.prototype.slice.call(document.querySelectorAll("#account-page .acv-nav-item")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.closest(".acv-nav-group");
        if (!group) return;
        var open = group.classList.toggle("acv-nav-group-active");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        var chev = btn.querySelector(".acv-chevron");
        if (chev) chev.classList.toggle("acv-chevron-open", open);
        var sub = document.getElementById(btn.getAttribute("aria-controls"));
        if (sub) sub.classList.toggle("acv-subnav-open", open);
      });
    });
    var tg = document.querySelector("#account-page .ac-dash-toggle");
    var accPage = document.getElementById("account-page");
    if (tg && accPage) tg.addEventListener("click", function () {
      var open = accPage.classList.toggle("ac-dash-open");
      tg.setAttribute("aria-expanded", open ? "true" : "false");
    });
    var ticking = false;
    function spy() {
      ticking = false;
      var acc = document.getElementById("page-section-account");
      if (!acc || !acc.classList.contains("active")) return;
      var targetY = 130, best = null, bestD = 1e9;
      for (var i = 0; i < secs.length; i++) {
        var r = secs[i].getBoundingClientRect();
        if (r.bottom <= 0) continue;
        var d = Math.abs(r.top - targetY);
        if (d < bestD) { bestD = d; best = secs[i]; }
      }
      setActive(best ? best.id : "");
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    setInterval(function () {
      var acc = document.getElementById("page-section-account");
      if (acc && acc.classList.contains("active")) spy();
    }, 400);
  });
})();

