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
  function _hexRgba(hex, alpha) {
    var m = String(hex || "").trim().match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return String(hex || "#2563eb");
    var n = parseInt(m[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }
  try {
    var _earlyTheme = localStorage.getItem("wantedTheme");
    if (_earlyTheme) { _themeTarget.setAttribute("data-theme", _earlyTheme); }
    var _earlyAppearance = {};
    try { _earlyAppearance = JSON.parse(localStorage.getItem("wrldPlayerSettings") || "{}"); } catch (e) { _earlyAppearance = {}; }
    if (_earlyAppearance.movingColors === false) _themeTarget.setAttribute("data-motion", "still");
  } catch (e) {}
  var _profile = { name: "999_" + uidSuffix, bio: "", status: "Online", avatar: "", banner: "" };

  /* ---------- Member themes: the stylesheet behind a u- slug ----------
     *
     * A member theme's CSS is not shipped in themes.css: the server generates
     * it from validated slots at submit time. This pulls that sheet once per
     * slug per page-load and plants it as a style tag the other sheets sit
     * beside, exactly like themes.css reaching html[data-theme=u-...]. */
  var _memberCssLoaded = {};
  function ensureMemberThemeCss(theme) {
    if (!theme || typeof theme !== "string") return;
    if (!/^u-[a-z0-9-]{2,40}$/.test(theme)) return;
    if (_memberCssLoaded[theme]) return;
    _memberCssLoaded[theme] = true;
    fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "themeCss", theme: theme }),
    }).then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (d) {
        if (!d || !d.ok || !d.css) return;
        var id = "member-theme-css-" + theme.slice(2);
        var el = document.getElementById(id);
        if (!el) {
          el = document.createElement("style");
          el.id = id;
          document.head.appendChild(el);
        }
        el.textContent = d.css;
      })
      .catch(function () {});
  }

  /* The Community Themes page needs who is looking, to decide whether the
     take-down buttons are theirs to press. The uid only counts as signed
     in when the account GET has actually succeeded - a remembered
     localStorage uid from a lapsed session is not a verified account, and
     the page must show the sign-in card, not a form the server would
     refuse anyway. */
  window.thwViewer = function () {
    return { uid: (_data && uid) || "", isOwner: !!(_data && _data.isOwner) };
  };

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
  /* Added alongside the mark-all toast: it reports the "nothing was unread"
     case, and _tt falls back to the literal supplied here, so a visitor whose
     language has no entry yet still reads English rather than a raw key. */
  var I18N_FALLBACK_NOTHING_UNREAD = "Nothing left unread";
  void I18N_FALLBACK_NOTHING_UNREAD;

  /* Delegates to the shared toast in toast.js rather than reimplementing it.
     This local copy used to render into #toasts as .toast, but that CSS is
     scoped to #account-page and the container has no such ancestor, so the rule
     never applied and these toasts were showing as unstyled bare divs. They now
     take the same .gtoast path as every other toast on the site, which is a
     visible change and a fix. The 4000 is this file's original lifetime and is
     passed explicitly so that does not silently shift. */
  function toast(msg, type) {
    if (window.toast) window.toast(msg, type, 4000);
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
    }).then(function (r) { return r.json().catch(function () { return null; }); });
  }
  /* The account is read from one place, and the reads are not repeated.
   *
   * It used to be read on every page that opened the account, on every
   * change of tab, on every save, and every forty-five seconds while the
   * account was on screen - so opening the account cost several requests
   * before it had shown anything, and every request is one of the hundred
   * thousand the day allows.
   *
   * So a read that is already under way is not started again, and a read
   * that has just happened is not repeated. What is left is the poll, which
   * is what keeps the activity list and the unread count fresh, and it runs
   * only while the account is actually on screen. */
  var _accountLoading = null;
  var _accountLoadedAt = 0;
  var ACCOUNT_FRESH_MS = 20000;

  function loadAccount(force) {
    if (!uid) return Promise.resolve(null);
    var now = Date.now();
    /* One read at a time. */
    if (_accountLoading) return _accountLoading;
    /* And not again straight away - unless something has just changed it. */
    if (!force && _data && now - _accountLoadedAt < ACCOUNT_FRESH_MS) {
      return Promise.resolve(_data);
    }
    _accountLoading = fetch("/api/account?user=" + encodeURIComponent(uid), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _accountLoadedAt = Date.now();
        if (d && d.ok) { _data = d; renderAll(); }
        return d;
      })
      .catch(function () {})
      .then(function (d) { _accountLoading = null; return d; });
    return _accountLoading;
  }
  /* A change that has just been made has to be shown at once, not after the
     freshness window. */
  function loadAccountNow() { return loadAccount(true); }
  function plLiveSync() {
    if (window._plHydrate) { try { window._plHydrate(true); } catch (e) {} }
    if (window.renderSidebarPlaylists) { try { window.renderSidebarPlaylists(); } catch (e) {} }
    if (window.renderHubPlaylists) { try { window.renderHubPlaylists(); } catch (e) {} }
  }
  window._plRefreshAccount = function () { loadAccountNow(); };

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
    var pSub = document.getElementById("profHeadSub");
    if (pSub) pSub.textContent = "thehighwrlddashboard.pages.dev/@" + String(profileUsername() || p.name || "999").toLowerCase();
    var aInner = document.getElementById("profileAvatarInner");
    if (aInner) {
      aInner.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : esc(initial(p.name));
    }
    var nav = document.getElementById("navAvatarInner");
    if (nav) nav.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : esc(initial(p.name));var mbn = document.getElementById("mbnAvatarInner");if (mbn) mbn.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : '<i class="fas fa-user" aria-hidden="true"></i>';
    /* Account dropdown + mobile sheet: mirror the avatar and the sheet head */
    ["acctAvatarInnerMenu", "thwSheetAvatarInner"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : esc(initial(p.name));
    });
    /* Sheet head: display name (the session username when present, else name). */
    var sheetName = document.querySelector(".thw-sheet-name");
    var sheetUsername = (_data && _data.profile && _data.profile.username) ? _data.profile.username : "";
    if (sheetName) sheetName.textContent = sheetUsername || p.name || "THW Listener";
    var sheetTag = document.querySelector(".thw-sheet-tag");
    if (sheetTag) sheetTag.textContent = (_data && _data.discord && _data.discord.linked) ? "Verified on TheHighWRLD" : "TheHighWRLD Listener";
    /* Desktop account dropdown: mirror the same head */
    var acctName = document.querySelector("#navAccountSignedIn .acct-name");
    if (acctName) acctName.textContent = sheetUsername || p.name || "THW Listener";
    /* Never rewrite .acct-tag with textContent: it carries the live rank and
       level spans, and a blanket write used to wipe them on every render. */
    var acctVerified = document.getElementById("acctVerified");
    if (acctVerified) acctVerified.textContent = (_data && _data.discord && _data.discord.linked) ? " · Verified" : "";
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
    var ap = document.getElementById("avatarPreview"); if (ap) ap.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="">' : '<i class="fas fa-user"></i>';
    var mp = document.getElementById("mAvatarPreview"); if (mp) mp.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="">' : '<i class="fas fa-user"></i>';
    if (window.__pv2ApplyLive) window.__pv2ApplyLive({ avatar: p.avatar });
    var pp = document.getElementById("mPicPreview"); if (pp) pp.innerHTML = p.avatar ? '<img decoding="async" src="' + esc(p.avatar) + '" alt="">' : '<i class="fas fa-user"></i>';
    /* Edit-profile rail preview */
    var rp = document.getElementById("mPreviewName"); if (rp) rp.textContent = p.name || ("999_" + uidSuffix);
    var rh = document.getElementById("mPreviewHandle"); if (rh) rh.textContent = "@" + String(profileUsername() || p.name || "999").toLowerCase();
    var rb = document.getElementById("mPreviewBio"); if (rb) rb.textContent = p.bio || "Your bio shows here.";
    var rf = document.getElementById("mPreviewFav"), rft = document.getElementById("mPreviewFavText");
    if (rf && rft) { if (p.favSong) { rft.textContent = p.favSong; rf.classList.remove("hidden"); } else { rf.classList.add("hidden"); } }
    var bc = document.getElementById("mBioCount"); if (bc) bc.textContent = String((p.bio || "").length) + " / 160";
    var bi = document.getElementById("mBannerImg");
    if (bi) bi.src = (p.bannerChoice === "custom" && p.banner) ? p.banner : (p.bannerChoice === "classic" ? "AlbumArt/999.jpg" : (window.__pv2TopEraArt || "AlbumArt/999.jpg"));
    /* Custom banner card state: preview thumb + checked radio */
    var bcImg = document.getElementById("mBannerCustomImg");
    var bcIcon = document.getElementById("mBannerCustomIcon");
    if (bcImg) {
      if (p.bannerChoice === "custom" && p.banner) { bcImg.src = p.banner; bcImg.hidden = false; if (bcIcon) bcIcon.style.display = "none"; }
      else { bcImg.hidden = true; if (bcIcon) bcIcon.style.display = ""; }
    }
    /* Keep the custom card's check state consistent with the stored choice */
    var bcRadio = document.getElementById("mBannerCustom");
    if (bcRadio) bcRadio.checked = p.bannerChoice === "custom";
    var eraLabelTxt = window.__pv2TopEraLabel || "Your top era";
    var bt = document.getElementById("mBannerTopEra"); if (bt) bt.textContent = eraLabelTxt;
    var bn = document.getElementById("mBannerEraName"); if (bn) bn.textContent = eraLabelTxt;
    var pj = document.getElementById("mPreviewJoined");
    if (pj && _data && _data.profile && _data.profile.joined) {
      try { pj.textContent = new Date(String(_data.profile.joined).replace(" ", "T")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (e) { pj.textContent = ""; }
    }
    var fa = document.getElementById("mPreviewFavArt");
    if (fa && p.favSong) {
      fa.src = (function () {
        var src = (typeof trackList !== "undefined" && trackList) ? trackList : [];
        var q = String(p.favSong).toLowerCase();
        for (var i = 0; i < src.length; i++) {
          var t = String(src[i] && src[i].title || "").toLowerCase();
          if (t === q && src[i].cover) return String(src[i].cover);
        }
        return "AlbumArt/999.jpg";
      })();
    }
    var ba = document.getElementById("mBannerAuto"), bcb = document.getElementById("mBannerClassic");
    if (ba && bcb) { ba.checked = p.bannerChoice !== "classic"; bcb.checked = p.bannerChoice === "classic"; }
    var fc = document.getElementById("mFavCurrent"), fct = document.getElementById("mFavCurrentText");
    if (fc && fct) { if (p.favSong) { fct.textContent = p.favSong; fc.classList.remove("hidden"); } else { fc.classList.add("hidden"); } }
  }

  /* ---------- Compact profile card (Wanted / Suggestions tabs) ---------- */
  function profileUsername() {
    var u = "";
    if (_data && _data.profile && _data.profile.username) u = _data.profile.username;
    if (!u) u = _profile.username || "";
    return u;
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
    return avatar ? '<img decoding="async" src="' + esc(avatar) + '" alt="">' : esc(initial(name));
  }
  function cmpVerifiedHtml(linked) {
    return linked ? '<span class="cmp-verified"><i class="fab fa-discord"></i> ' + esc(_tt("verifiedBadge", "Verified")) + '</span>' : '';  }

  /* Owner badge. Reads the same _data.isOwner that the owner dashboard and
     nav already use, so there is one answer to "is this the owner" rather than
     a second flag that could disagree with it. */
  function cmpOwnerHtml(isOwner) {
    return isOwner ? '<span class="cmp-owner"><i class="fas fa-crown"></i> ' + esc(_tt("ownerBadge", "Owner")) + '</span>' : '';
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
    var avatar = pr.avatar ? '<img decoding="async" src="' + esc(pr.avatar) + '" alt="" onerror="this.style.display=\'none\'">' : esc(initial(name));
    var verified = !!(dc.linked || pr.verified);
    var status = pr.status || "Online";
    var dotC = "#64748b";
    if (status === "Online") dotC = "#10b981";
    else if (status === "Idle") dotC = "#f59e0b";
    else if (status === "Do Not Disturb") dotC = "#ef4444";
    var banner = pr.banner ? '<img decoding="async" src="' + esc(pr.banner) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    var links = (d.links || []).filter(function (l) { return l && l.url; });
    var mine = String(d.uid || "") === String(typeof uid !== "undefined" ? uid : "");
    var plays = (d.topPlays || []).slice(0, 5).map(function (t) {
      var pi = trackIndexByTitleFuzzy(t.track_id);
      var pname = (pi >= 0 && trackList[pi] && trackList[pi].title) ? trackList[pi].title : t.track_id;
      return '<div class="pv-top"' + (pi >= 0 ? ' data-play-idx="' + pi + '" role="button" tabindex="0" title="Play"' : '') + '>' + '<span class="pv-top-num">' + esc(pname) + '</span><span class="pv-top-cnt">' + (Number(t.n) || 0) + ' plays</span></div>';
    }).join("") || '<p class="pv-none">No plays recorded yet</p>';
    var pls = (d.playlists || []).slice(0, 6).map(function (p) {
      return '<div class="pv-pl" data-openpl="' + p.id + '" role="button" tabindex="0" title="' + esc(_tt("openTitle", "Open")) + '" style="background:linear-gradient(135deg,' + (p.color ? esc(p.color) : "#a855f7") + ',rgba(20,12,40,.9))"><i class="fas fa-play pv-pl-play" data-playpl="' + p.id + '"></i><div class="pv-pl-info"><b>' + esc(p.name) + '</b><span>' + (p.count || 0) + ' tracks</span></div></div>';
    }).join("") || '<p class="pv-none">No playlists</p>';
    var favs = (d.favorites || []);

    /* The same board as your own profile: one full width header card, then the
       cards below it in two columns. Every block carries data-pnl so the CSS
       can order it and fold it from its own header. */
    var html = '';
    html += '<div class="cmp-page cmp-card-page">';
    html += '<div class="cmp-head" data-pnl="profile">';
    html += '<div class="cmp-sec-title cmp-head-title"><span><i class="fas fa-id-card"></i> ' + esc(_tt("cmpPanelProfile", "Profile")) + '</span></div>';
    if (banner) html += '<div class="pv-banner-wrap">' + banner + '</div>';
    html += '<div class="cmp-top"><span class="pv-avatar">' + avatar + '<span class="pv-dot" style="background:' + dotC + ';box-shadow:0 0 12px ' + dotC + '"></span></span>';
    html += '<div class="cmp-id"><div class="cmp-name-row"><h3 class="cmp-name">' + esc(name) + '</h3>' + cmpVerifiedHtml(verified) + '</div>';
    html += '<p class="pv-handle">@' + esc(String(uname).toLowerCase()) + '</p>';
    html += '<span class="pv-status" style="color:' + dotC + '"><i class="fas fa-circle" style="font-size:6px"></i> ' + esc(status) + '</span><span class="cmp-site-presence" data-uid="' + esc(String(d.uid || "")) + '"></span><span class="um-profile-status" data-uid="' + esc(String(d.uid || "")) + '"></span></div></div>';
    html += (pr.joined ? '<p class="pv-joined"><i class="fas fa-calendar"></i> ' + esc(_tt("joinedWord", "Joined")) + ' ' + esc(String(pr.joined).slice(0, 10)) + '</p>' : '');
    html += (pr.bio ? '<div class="cmp-bio">' + esc(pr.bio) + '</div>' : '');
    /* the links belong to the header card, right under the bio */
    if (links.length) {
      html += '<div class="cmp-links">' + links.map(function (l) {
        return '<a class="cmp-link" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow"><i class="fas fa-link"></i>' + esc(l.label || l.url) + '<i class="fas fa-arrow-up-right-from-square" style="margin-left:auto"></i></a>';
      }).join("") + '</div>';
    }
    html += '<div class="cmp-qstats">';
    html += qstat((Number(st.plays) || 0).toLocaleString(), _tt("qstatPlays", "Plays"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat(ppTime(st.hours), _tt("listenedWord", "Listened"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat((Number(st.favorites) || 0).toLocaleString(), _tt("statFavs", "Favorites"));
    html += '<div class="cmp-qdiv"></div>';
    html += qstat((Number(st.votes) || 0).toLocaleString(), _tt("votesWord", "Votes"));
    html += '</div>';
    if (!mine) {
      html += '<div class="cmp-actions"><a class="cmp-btn" href="#" onclick="event.preventDefault();if(window.closeWantedProfile)window.closeWantedProfile();if(window.switchAppPage)window.switchAppPage(\'player\')"><i class="fas fa-play"></i> ' + esc(_tt("cmpPlayer", "WRLD Player")) + '</a>';
      if (d.uid && _data && _data.discord && _data.discord.linked) {
        html += '<button type="button" class="cmp-btn report-flag-btn" data-report="profile:u:' + esc(String(d.uid)) + '" data-report-title="' + esc(name) + '" title="Report this profile" style="margin-left:8px"><i class="fas fa-flag"></i> Report</button>';
      }
      html += '<button type="button" class="cmp-btn user-menu-btn" data-user-menu data-uid="' + esc(String(d.uid)) + '" data-name="' + esc(name) + '" data-username="' + esc(String(d.handle || "")) + '" aria-label="More user actions" title="More user actions" style="margin-left:8px"><i class="fas fa-ellipsis"></i></button>';
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="cmp-sections">';
    html += '<div class="cmp-sec-card" data-pnl="top-plays"><div class="cmp-sec-title"><span><i class="fas fa-fire"></i> ' + esc(_tt("cmpPanelTopPlays", "Top plays")) + '</span></div><div class="pv-tops">' + plays + '</div></div>';
    html += '<div class="cmp-sec-card" data-pnl="favorites"><div class="cmp-sec-title"><span><i class="fas fa-heart"></i> ' + esc(_tt("t4", "Favorites")) + '</span><span class="cmp-count">' + favs.length + '</span></div>';
    html += (favs.length ? '<div class="cmp-fav-grid" id="pvFavGrid"></div>' : '<p class="pv-none">No favorites yet</p>');
    html += '</div>';
    html += '<div class="cmp-sec-card" data-pnl="playlists"><div class="cmp-sec-title"><span><i class="fas fa-list-music"></i> ' + esc(_tt("cmpPanelPlaylists", "Playlists")) + '</span><span class="cmp-count">' + (d.playlists || []).length + '</span></div><div class="pv-pls">' + pls + '</div></div>';
    html += '</div>';
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
    var isOwner = isSignedInNow() && !!(_data && _data.isOwner);
    if (group) group.style.display = isOwner ? "" : "none";
    if (crownM) crownM.style.display = isOwner ? "" : "none";
    if (ppOwner) ppOwner.style.display = isOwner ? "" : "none";
  }

  // Single source of truth for "the user is signed in right now". Local owner
  // flags and the wantedUserId persist after sign-out, so they must never be
  // trusted on their own when deciding whether owner controls may show.
  function isSignedInNow() {
    try { return !!localStorage.getItem("wantedAuthUser"); } catch (e) { return false; }
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
  var ACT_ICON = { vote: "fa-vote-yea", reply: "fa-comment", favorite: "fa-heart", download: "fa-download", profile: "fa-user-pen", security: "fa-shield-halved", listen: "fa-headphones", playlist: "fa-list-music", bookmark: "fa-bookmark", community: "fa-users", link: "fa-link" };
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

  /* Which announcements this device has already been shown, newest last.
     Keyed on seenKey - id plus revision - so an announcement corrected with
     "notify again" comes back as new, and a plain typo fix does not.
     Bounded for the same reason the list is: five are ever shown. */
  var ANN_SEEN_KEY = "thw.ann.seen";
  function annSeen() {
    try {
      var v = JSON.parse(localStorage.getItem(ANN_SEEN_KEY) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch (e) { return []; }
  }
  function markAnnSeen(list) {
    try {
      var cur = annSeen();
      (list || []).forEach(function (a) {
        var k = String(a && (a.seenKey != null ? a.seenKey : a.id));
        if (k && cur.indexOf(k) < 0) cur.push(k);
      });
      localStorage.setItem(ANN_SEEN_KEY, JSON.stringify(cur.slice(-40)));
    } catch (e) {}
  }
  function unseenAnnouncements(ann) {
    var seen = annSeen();
    return (ann || []).filter(function (a) {
      return seen.indexOf(String(a.seenKey != null ? a.seenKey : a.id)) < 0;
    });
  }

  /* A toast the first time a given announcement appears on this device. Guarded
     on a separate key from the seen list on purpose: seen is written when the
     bell is opened, which can be long after the toast, and the toast must not
     repeat every poll in between. */
  var ANN_TOASTED_KEY = "thw.ann.toasted";
  function toastNewAnnouncements(unseen) {
    if (!unseen.length) return;
    var toasted;
    try { toasted = JSON.parse(localStorage.getItem(ANN_TOASTED_KEY) || "[]"); } catch (e) { toasted = []; }
    if (!Array.isArray(toasted)) toasted = [];
    var fresh = [];
    unseen.forEach(function (a) {
      var k = String(a.seenKey != null ? a.seenKey : a.id);
      if (toasted.indexOf(k) < 0) fresh.push(a);
    });
    if (!fresh.length) return;
    fresh.forEach(function (a) {
      var heading = a.title || _tt("notifAnn", "Announcement");
      var body = String(a.body != null ? a.body : a.message || "").slice(0, 110);
      /* The local toast(), which now delegates to window.toast from toast.js.
         The note that used to sit here described window.toast as being assigned
         only by profile-enhancements.js - it was never assigned at all, by
         anything, so the `if (window.toast)` guards in other files were all
         dead. toast.js now defines it once for the whole app. Two arguments,
         matching this function's signature; a third would be ignored. */
      try {
        toast(esc(heading) + (body ? " — " + esc(body) : ""), "info");
      } catch (e) {}
    });
    try {
      var next = toasted.concat(fresh.map(function (a) { return String(a.seenKey != null ? a.seenKey : a.id); }));
      localStorage.setItem(ANN_TOASTED_KEY, JSON.stringify(next.slice(-40)));
    } catch (e) {}
  }

  function setNotifBell(on) {
    var wrap = document.getElementById("nav-notif-wrap");
    if (wrap) wrap.style.display = on ? "" : "none";
    if (!on) {
      var m = document.getElementById("navNotifMenu");
      if (m && m.closest) { var w = m.closest(".nav-notif-wrap"); if (w) w.classList.remove("open"); }
    }
  }
  /* Whether there is a real session.
     NOT `uid`: account.js reads that from "wantedUserId", and auth.js assigns an
     anonymous one to every visitor through newAnonUid(), so it is truthy for a
     signed-out guest. "wantedAuthUser" is set on sign-in and removed on
     sign-out, so its absence is what actually means no session. */
  function signedIn() {
    try { return !!localStorage.getItem("wantedAuthUser"); } catch (e) { return false; }
  }
  window.setNotifBell = setNotifBell;
  function gotoNotif(n) {
    if (n.type === "dm_message" || n.type === "dm_mention") {
      /* A message is opened on the messages page - the Inner Circle lives
         there full-screen, so this lands on the conversation list. */
      if (window.switchAppPage) switchAppPage("messages");
      else if (window.openInnerCircle) window.openInnerCircle();
      return;
    }
    if (n.type === "playlist" && n.post_id) {
      if (window.openSharedPlaylistById) { try { window.openSharedPlaylistById(Number(n.post_id)); } catch (e) {} }
      return;
    }
    if (n.type === "drop") {
      if (window.switchAppPage) switchAppPage("home");
      setTimeout(function () {
        try {
          var sec = document.getElementById("drops-sec");
          if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {}
      }, 400);
      return;
    }
    if (n.post_id) {
      if (window.switchAppPage) switchAppPage("community");
      if (window.openCommunityPost) { try { window.openCommunityPost(n.post_id, n.reply_id || null); } catch (e) {} }
      return;
    }
    if (n.type === "suggestion") { if (window.switchAppPage) switchAppPage("suggestions"); return; }
    if (n.type === "comment_reply") {
      /* The track title rides in the message as '"<title>" — <name> replied…'. */
      var m = String(n.message || "").match(/^"([^"]{1,160})"/);
      if (m && window.openSongPage) { try { window.openSongPage(m[1]); return; } catch (e) {} }
      if (window.switchAppPage) switchAppPage("song");
      return;
    }
    if (n.type === "wanted") { if (window.switchAppPage) switchAppPage("wanted"); return; }
    if (n.type === "announcement") return;
    if (n.type === "moderation") return;
    if (n.type === "appeal") return;
    if (n.type === "warning") return;
    if (n.type === "ban") return;
    if (n.type === "follow" && n.actor_uid) {
      if (window.openProfile) { try { window.openProfile(n.actor_uid); } catch (e) {} }
      return;
    }
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
  /* Community reply notifications (/api/notifications, session-authed).
     Merged into the same bell; refetched at most every 30s. */
  function refreshCommNotifs() {
    if (window.__commNotifsLoading) return;
    var now = Date.now();
    if (window.__commNotifsTs && now - window.__commNotifsTs < 30000) return;
    window.__commNotifsTs = now;
    window.__commNotifsLoading = true;
    /* The notifications and the announcements come with the bootstrap - one
       request carrying several answers rather than one request each. The
       bell is asked for on every page load, so it is worth having it ride
       along with the other answers. */
    var take = window.THWBootstrap && window.THWBootstrap.take;
    var ask = function () {
      return fetch("/api/notifications", { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; })
        .then(function (d) { return d && d.ok ? d : null; });
    };
    (take ? take("notifications", ask) : ask()).then(function (d) {
      window.__commNotifsLoading = false;
      var boot = d && d.notifications ? d.notifications : (Array.isArray(d) ? d : []);
      window.__commNotifs = (boot || []).map(function (n) {
        return { id: "c" + n.id, type: n.type || "reply", message: n.message, actor: n.actor, ts: n.ts, post_id: n.post_id, reply_id: n.reply_id, track_id: n.track_id || "", read: !!n.read, comm: true };
      });
      var annBoot = window.THWBootstrap && window.THWBootstrap.from("announcements");
      if (annBoot) window.__annNotifs = annBoot;
      applyNotifications();
    });
  }
  window.addEventListener("thw:notification", function () {
    window.__commNotifsTs = 0;
    refreshCommNotifs();
  });
  function commNotifRead(nid) {
    var id = Number(String(nid || "").replace(/^c/, "")) || 0;
    if (!id) return;
    try { fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "read", id: id }) }).catch(function () {}); } catch (e) {}
  }
  /* Remove one row from the bell.
     *
     * Announcements are the odd one out: their read state is this device's
     * localStorage, not a row in community_notifications, so there is nothing on
     * the server to delete - they are dropped from the cached list and marked
     * seen. A signed-out visitor has announcements and nothing else, so this is
     * the only path they ever take, which is why the server call below is
     * conditional rather than the whole helper being gated on a session.
     *
     * The row is removed by hand rather than by re-rendering: a re-render rebuilds
     * from the cached arrays, which still hold the row just dismissed, so it
     * would come straight back. */
  function dismissNotifRow(nid, ntype) {
    var key = String(nid);
    if (ntype === "announcement") {
      var anns = window.__annNotifs || [];
      var keep = [];
      for (var i = 0; i < anns.length; i++) if (String(anns[i].id) !== key) keep.push(anns[i]);
      window.__annNotifs = keep;
      /* Marked seen as well as removed, so the badge does not come back on the
         next poll for something the reader has just dismissed. */
      markAnnSeen(anns.filter(function (a) { return String(a.id) === key; }));
    } else if (signedIn()) {
      var n = Number(key.replace(/^c/, "")) || 0;
      if (n > 0) {
        try {
          fetch("/api/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ action: "dismiss", id: n }),
          }).catch(function () {});
        } catch (e) {}
      }
    }
    /* Off the cached community list too, so the next 30s poll does not bring it
       back before the server has actually removed it. */
    if (window.__commNotifs) {
      var keepC = [];
      for (var ci = 0; ci < window.__commNotifs.length; ci++) {
        if (String(window.__commNotifs[ci].id) !== key) keepC.push(window.__commNotifs[ci]);
      }
      window.__commNotifs = keepC;
    }
    var row = document.querySelector('#navNotifList [data-nid="' + key.replace(/"/g, "") + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    var list = document.getElementById("navNotifList");
    if (list && !list.querySelector(".nav-notif-item")) {
      list.innerHTML = '<p class="nav-notif-empty">' + esc(_tt("noNotifs", "No notifications yet.")) + "</p>";
    }
  }

  function commNotifReadAll() {
    try { fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "readAll" }) }).catch(function () {}); } catch (e) {}
  }
  /* Mark the cached rows as read.
   *
   * The bell draws from two caches - the account's own notifications and the
   * community ones - and both have to be told, or the next poll undoes what
   * the button just did.
   *
   * The bootstrap cache is dropped as well. It holds the same community
   * notifications, and it is what the next poll reads from, so leaving it
   * alone would mean the next refresh asks a question whose answer was
   * decided before the button was pressed. */
  function markCachedNotificationsRead() {
    if (_data && Array.isArray(_data.notifications)) {
      for (var i = 0; i < _data.notifications.length; i++) _data.notifications[i].read = 1;
      _data.unread = 0;
    }
    if (Array.isArray(window.__commNotifs)) {
      for (var j = 0; j < window.__commNotifs.length; j++) window.__commNotifs[j].read = true;
    }
    try {
      if (window.THWBootstrap && typeof window.THWBootstrap.invalidate === "function") {
        window.THWBootstrap.invalidate();
      }
    } catch (e) {}
  }
  /* Mark one cached notification as read. */
  function markCachedNotifRead(nid) {
    var key = String(nid);
    if (_data && Array.isArray(_data.notifications)) {
      for (var i = 0; i < _data.notifications.length; i++) {
        if (String(_data.notifications[i].id) === key) {
          _data.notifications[i].read = 1;
          if (_data.unread > 0) _data.unread -= 1;
        }
      }
    }
    if (Array.isArray(window.__commNotifs)) {
      for (var j = 0; j < window.__commNotifs.length; j++) {
        if (String(window.__commNotifs[j].id) === key) window.__commNotifs[j].read = true;
      }
    }
  }

  function applyNotifications() {
    var wrap = document.getElementById("nav-notif-wrap");
    if (!wrap) return;
    var rows = ((_data && _data.notifications) || []).slice();
    var unread = (_data && _data.unread ? _data.unread : 0);
    var comm = window.__commNotifs || [];
    if (comm.length) {
      rows = comm.concat(rows);
      for (var ci = 0; ci < comm.length; ci++) if (!comm[ci].read) unread++;
    }
    var ann = window.__annNotifs || [];
    if (ann.length) rows = ann.concat(rows);
    refreshCommNotifs();

    /* An announcement nobody has seen on this device is unread. Before this the
       badge ignored announcements entirely, so a notice posted to be seen showed
       no badge at all and was invisible until the bell happened to be opened.
       The row's own read flag is left alone: the server has no per-user read
       state for announcements and inventing one here would be a lie about what
       is stored. */
    var unseenAnn = unseenAnnouncements(ann);
    toastNewAnnouncements(unseenAnn);
    unread += unseenAnn.length;

    var badge = document.getElementById("navNotifBadge");
    if (badge) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = unread > 0 ? "" : "none";
      /* Pulses only while an announcement specifically is waiting. Pulsing for
         any unread would be a permanent distraction for the ordinary case, and
         the ordinary case already has a red dot on every row. */
      var bellBtn = document.getElementById("navNotifBtn");
      if (bellBtn) bellBtn.classList.toggle("ann-alert", unseenAnn.length > 0);
    }
    var list = document.getElementById("navNotifList");
    if (!list) return;
    /* "Mark all read" POSTs to the server, and a guest has no server-side read
       state - so it would toast a success that changed nothing. It does not
       touch the per-device announcement read state either, so it would not even
       clear the announcement badge. Hidden rather than disabled: a control that
       cannot work is worse than one that is absent. */
    /* Shown for everyone. It clears the announcement read state locally, which
       works without a session, so a guest pressing it sees the badge and the
       list actually change rather than being handed a success toast that did
       nothing. The server call below is still skipped without a session. */
    /* No system notification is created here.
       This used to build one with `new Notification(...)` from the rows in the
       bell, and that is the notification a person was actually seeing - the
       "TheHighWRLD - New follower" banner, with the in-app message as its
       body. Two problems with it, and both were the whole point of the push
       work:
         - it lives in the PAGE, so it can only ever fire while the app is
           open. It was standing in for the push and making the feature look
           app-only.
         - it put the in-app message on the lock screen, actor name and all,
           which is exactly what the push payload is designed not to do.
       The service worker is the only notifier now. It fires whether the app is
       open, closed, or in the background, and the payload it receives carries
       a generic summary instead of the message. */
    if (!rows.length) {
      list.innerHTML = '<p class="nav-notif-empty">' + esc(_tt("noNotifs", "No notifications yet.")) + '</p>';
      return;
    }
    list.innerHTML = rows.slice(0, 40).map(function (n) {
      var ico = n.type === "reply" || n.type === "comment_reply" ? "fa-comment" : n.type === "mention" || n.type === "dm_mention" ? "fa-at" : n.type === "dm_message" ? "fa-comment-dots" : n.type === "playlist" ? "fa-list-music" : n.type === "drop" ? "fa-ticket" : n.type === "suggestion" ? "fa-lightbulb" : n.type === "wanted" ? "fa-fire" : n.type === "announcement" ? "fa-bullhorn" : n.type === "appeal" ? "fa-scale-balanced" : n.type === "warning" ? "fa-triangle-exclamation" : n.type === "ban" ? "fa-ban" : n.type === "follow" ? "fa-user-plus" : n.type === "moderation" ? "fa-shield-halved" : n.type === "leak" ? "fa-fire" : n.type === "vote" ? "fa-vote-yea" : "fa-bell";
      return '<button type="button" class="nav-notif-item' + (n.read ? " read" : " unread") + '" data-nid="' + n.id + '" data-ntype="' + esc(n.type || "") + '" data-actor="' + esc(n.actor_uid || "") + '" data-track="' + esc(n.track_id || "") + '" data-rid="' + (n.reply_id || "") + '" data-post="' + (n.post_id || "") + '"><span class="nni-ico"><i class="fas ' + ico + '"></i></span><span class="nni-main"><span class="nni-txt">' + esc(n.message) + '</span><span class="nni-time">' + esc(relTime(n.ts)) + (n.actor ? " &middot; " + esc(n.actor) : "") + '</span></span>' + (n.read ? "" : '<span class="unread-dot"></span>') +
      /* Close control, inside the row so it travels with it when the list
         re-renders. A span with role=button rather than a nested <button>: the
         row itself is already a button and a button cannot contain a button. */
      '<span class="nni-x" role="button" tabindex="0" aria-label="Dismiss this notification">' +
      '<i class="fas fa-xmark" aria-hidden="true"></i></span>' +
      '</button>';
    }).join("");
  }
  function bindNotifications() {
    var list = document.getElementById("navNotifList");
    if (list) list.addEventListener("click", function (e) {
      /* The X comes FIRST, before the row navigation. This handler sits on the
         LIST - an ancestor of the row - so it ran after nothing: dismissing was
         carried out by a document-level listener that only saw the event later,
         while this one had already called gotoNotif and sent the reader to the
         Wanted Vault with a "track not found" toast. Checking the control here
         means a click on it never becomes a row click. */
      var x = e.target.closest ? e.target.closest(".nni-x") : null;
      if (x) {
        var xrow = x.closest(".nav-notif-item");
        if (xrow) {
          e.stopPropagation();
          e.preventDefault();
          dismissNotifRow(xrow.getAttribute("data-nid"), xrow.getAttribute("data-ntype"));
          applyNotifications();
        }
        return;
      }
      var row = e.target.closest(".nav-notif-item");
      if (!row) return;
      var nid = row.getAttribute("data-nid");
      var ntype = row.getAttribute("data-ntype") || "";
      var nactor = row.getAttribute("data-actor") || "";
      var track = row.getAttribute("data-track") || "";
      var rid = row.getAttribute("data-rid") || "";
      var post = row.getAttribute("data-post") || "";
      var wrap = row.closest(".nav-notif-wrap");
      if (wrap) wrap.classList.remove("open");
      if (!row.classList.contains("read")) {
        row.classList.add("read");
        row.classList.remove("unread");
        /* The cached copy has to be marked too, or the next poll draws the
           row as unread again - the same reason the "mark all read" button
           needed it. */
        markCachedNotifRead(nid);
        if (post) commNotifRead(nid);
        else api({ action: "markNotifRead", id: nid });
      }
      if (post) { gotoNotif({ type: ntype, actor_uid: nactor, post_id: Number(post), reply_id: rid ? Number(rid) : null }); return; }
      gotoNotif({ type: ntype, actor_uid: nactor, track_id: track, reply_id: rid ? Number(rid) : null });
    });
    var markBtn = document.getElementById("navNotifMarkAll");
    if (markBtn) markBtn.addEventListener("click", function (e) {
      e.stopPropagation();

      /* How much was actually unread, counted before anything is changed -
         otherwise the toast has nothing honest left to say. */
      var unreadRows = document.querySelectorAll("#navNotifList .nav-notif-item.unread");
      var hadUnread = unreadRows.length > 0;

      /* Announcements first, and locally: their read state is this device's
         localStorage, so that part works for everyone including a guest. */
      markAnnSeen(window.__annNotifs || []);

      /* Then every row still showing unread, community ones included. This is
         the part that was missing: commNotifReadAll() only POSTs, so nothing
         changed on screen until loadAccount() returned and the rows sat there
         looking unread with the badge still up for several seconds. */
      var rows = document.querySelectorAll("#navNotifList .nav-notif-item");
      for (var ri = 0; ri < rows.length; ri++) {
        rows[ri].classList.remove("unread");
        rows[ri].classList.add("read");
        var dot = rows[ri].querySelector(".unread-dot");
        if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
      }

      /* The cached rows have to be marked too.
       *
       * This is why the button looked like it did nothing. The rows on screen
       * were marked, and the server was told - but the cached copies still
       * said "unread", so the next poll brought the unread dots and the
       * badge straight back, a few seconds later. The button appeared not to
       * work because it did work, and then undid itself.
       *
       * So the cache is marked here, and the bootstrap cache is dropped, so
       * the next fetch is the truth rather than the answer to a question
       * asked before the button was pressed. */
      markCachedNotificationsRead();

      /* Server side only with a session - both calls 401 without one. */
      if (signedIn()) {
        api({ action: "markAllNotif" }).then(function () { loadAccountNow(); });
        commNotifReadAll();
      }
      applyNotifications();

      /* Says what it did. For a guest who has already opened the bell, opening
         it cleared the announcements, so there is genuinely nothing left to
         read and the button should say so rather than claim a success. */
      if (hadUnread) {
        toast(_tt("toastMarkAllRead", "All notifications marked as read"), "success");
      } else {
        toast(_tt("toastNothingUnread", "Nothing left unread"), "info");
      }
    });
    var btn = document.getElementById("navNotifBtn");
    if (btn) btn.addEventListener("click", function () {
      var w = btn.closest(".nav-notif-wrap");
      if (!w) return;
      var was = w.classList.contains("open");
      document.querySelectorAll(".nav-notif-wrap.open").forEach(function (o) { o.classList.remove("open"); });
      if (!was) {
        w.classList.add("open");
        /* Opening the bell IS reading them. Marked here rather than when the
           list renders, because the list re-renders every 30s off the poll -
           marking on render would silently clear the badge moments after it
           appeared, before anyone had looked at why. */
        markAnnSeen(window.__annNotifs || []);
        applyNotifications();
      }
    });
    /* The control carries tabindex and role=button, so it has to answer the
       keyboard too - otherwise it is focusable and pressing Enter does nothing. */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!e.target.closest) return;
      var kx = e.target.closest(".nni-x");
      if (!kx || !kx.closest(".nav-notif-item")) return;
      e.preventDefault();
      e.stopPropagation();
      var krow = kx.closest(".nav-notif-item");
      dismissNotifRow(krow.getAttribute("data-nid"), krow.getAttribute("data-ntype"));
      applyNotifications();
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      /* Checked before anything else: the row is a <button>, so a click on the
         control also lands on it, and without this the row's own handler would
         navigate as well as dismissing. */
      var x = e.target.closest(".nni-x");
      if (x && x.closest(".nav-notif-item")) {
        e.stopPropagation();
        e.preventDefault();
        var rowEl = x.closest(".nav-notif-item");
        dismissNotifRow(rowEl.getAttribute("data-nid"), rowEl.getAttribute("data-ntype"));
        applyNotifications();
        return;
      }
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
  function trackIndexByTitleFuzzy(title) {
    var i = trackIndexByTitle(title);
    if (i >= 0) return i;
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      var ns = String(title || "").trim();
      if (/^[0-9]+$/.test(ns)) { var ni = parseInt(ns, 10); if (ni >= 0 && ni < trackList.length) return ni; return -1; }
    } catch (e) {}
    try {
      if (typeof trackList === "undefined" || !trackList) return -1;
      var base = String(title || "").replace(/\s*\(.*\)\s*/, "").trim().toLowerCase();
      if (!base) return -1;
      for (var k = 0; k < trackList.length; k++) {
        var tn = trackList[k] && trackList[k].title ? String(trackList[k].title) : "";
        if (tn.replace(/\s*\(.*\)\s*/, "").trim().toLowerCase() === base) return k;
      }
    } catch (e) {}
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
      var idx = trackIndexByTitleFuzzy(f.title);
      var cov = (idx >= 0 && trackList[idx] && trackList[idx].cover) ? trackList[idx].cover : "";
      var initials = String(f.title || "??").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase() || "??";
      var art = cov ? '<img decoding="async" class="fav-art-img" src="' + esc(cov) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '<span class="fav-initials">' + esc(initials) + '</span>';
      var like = own ? '<button class="fav-like" data-fav="' + esc(f.title) + '" title="' + esc(_tt("unfavorite", "Unfavorite")) + '"><i class="fas fa-heart"></i></button>' : (idx >= 0 ? '<button class="fav-info-btn" data-trackinfo="' + idx + '" title="Info"><i class="fas fa-circle-info"></i></button>' : '<span class="fav-like off"><i class="fas fa-heart"></i></span>');
      var showTitle = (idx >= 0 && trackList[idx] && trackList[idx].title) ? trackList[idx].title : f.title;
      var tg = (idx >= 0 && trackList[idx]) ? (trackList[idx].tag || trackList[idx].category || "") : ""; var tagHtml = tg ? '<div class="fav-tag">' + esc(String(tg).slice(0, 80)) + '</div>' : ''; return '<div class="fav-card" data-play-idx="' + idx + '" role="button" tabindex="0"><div class="fav-art">' + art + '<div class="fav-zoom"><span class="fav-play-btn"><i class="fas fa-play"></i></span></div></div>' + '<div class="fav-info"><div class="fav-main"><div class="fav-text"><div class="fav-name">' + esc(showTitle) + '</div>' + tagHtml + '</div>' + like + '</div><div class="fav-sub">' + esc(_tt("saved", "saved")) + ' &middot; ' + esc(fmtDate(f.created_at)) + '</div></div></div>';
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
        if (!isNaN(idx) && idx >= 0 && window.selectTrackFromList) { window.selectTrackFromList(idx); if (window.showDeckPlayer) window.showDeckPlayer(); }
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
    api({ action: "clearLogins" }).then(function () { btnBusy(logoutBtn, false); loadAccountNow(); toast(_tt("toastDevicesOut", "Other devices logged out"), "success"); }).catch(function () { btnBusy(logoutBtn, false); });
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
    if (box) box.innerHTML = d.avatar ? '<img decoding="async" src="' + esc(d.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fab fa-discord"></i>';
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
    /* the danger zone shows your own username - bindDanger() owns the wiring */
    refreshDangerZone();
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
    var items = Array.prototype.slice.call(nav.querySelectorAll("[data-set-tab]"));
    function setActive(id) {
      items.forEach(function (b) {
        var on = b.getAttribute("data-set-tab") === id;
        b.classList.toggle("active", on);
        if (on) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
    }
    items.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-set-tab") || "");
        if (!target) return;
        if (target.offsetParent === null && !target.getClientRects().length) return; /* hidden for guests */
        setActive(target.id);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    var sections = items.map(function (b) { return document.getElementById(b.getAttribute("data-set-tab") || ""); }).filter(Boolean);
    if (sections.length && typeof IntersectionObserver === "function") {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      }, { rootMargin: "-25% 0px -65% 0px", threshold: 0 });
      sections.forEach(function (s) { obs.observe(s); });
    }
    nav.querySelectorAll("[data-set-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-set-jump");
        if (t && window.acctJump) window.acctJump(t);
      });
    });
  }

  /* ---------- Notification preferences ---------- */
  /* The nine switches are the nine the server keeps in user_notification_prefs
   * and the nine /api/notification-settings reads and writes. The panel is a view
   * of that record and nothing else - the server stays the only place that
   * decides what a notification means.
   *
   * The account page sits behind a sign-in gate, so there is no signed-out
   * case here beyond a read that fails, which leaves the switches showing the
   * defaults rather than somebody else's stored answer. */
  var NOTIF_PREF_FIELDS = [
    ["replies", "notifPrefReplies"],
    ["mentions", "notifPrefMentions"],
    ["upvotes", "notifPrefUpvotes"],
    ["direct_messages", "notifPrefDirectMessages"],
    ["friend_requests", "notifPrefFriendRequests"],
    ["in_site", "notifPrefInSite"],
    ["push", "notifPrefPush"],
    ["message_previews", "notifPrefPreviews"],
  ];
  /* The four bubble blocks are the same server record, one tap target each -
     announcements, Wanted Vault replies, suggestion updates and comment
     replies. There is no element to read at save time, so they are excluded
     from the Save Changes handler entirely and saved the moment they are
     tapped. */
  var NOTIF_BUBBLE_FIELDS = ["announcements", "wanted_replies", "suggestions", "comment_replies"];

  function bindNotificationPrefs() {
    var saveBtn = document.getElementById("notifPrefsSaveBtn");
    var result = document.getElementById("notifPrefsResult");
    if (!saveBtn) return;

    function setResult(msg, ok) {
      if (!result) return;
      result.textContent = msg || "";
      result.style.display = msg ? "" : "none";
      result.className = "set-result" + (ok ? " ok" : "");
    }
    function paint(prefs) {
      if (!prefs) return;
      NOTIF_PREF_FIELDS.forEach(function (f) {
        var el = document.getElementById(f[1]);
        if (el) el.checked = prefs[f[0]] !== 0;
      });
    }

    /* Show what is stored. Until this comes back the switches sit at the
     * server's default - every category on - which is the same answer a
     * missing row gives, so a failed read cannot make it look like everything
     * has been turned off. */
    /* The settings come with the bootstrap, when it has been fetched. The
       panel is opened rarely, and the answer is the same one every time. */
    var take = window.THWBootstrap && window.THWBootstrap.take;
    var ask = function () {
      return fetch("/api/notification-settings", { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) { return d && d.ok ? d : null; });
    };
    (take ? take("notificationSettings", ask) : ask()).then(function (d) {
      if (d && d.prefs) paint(d.prefs);
    });

    saveBtn.addEventListener("click", function () {
      var prefs = {};
      NOTIF_PREF_FIELDS.forEach(function (f) {
        var el = document.getElementById(f[1]);
        prefs[f[0]] = el ? !!el.checked : 1;
      });
      btnBusy(saveBtn, true);
      setResult("");
      fetch("/api/notification-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: prefs }),
      })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          btnBusy(saveBtn, false);
          if (d && d.ok) {
            var ok = _tt("toastSettingsSaved", "Settings saved");
            setResult(ok, true);
            toast(ok, "success");
            /* Put the switches back to what the server actually stored, so a
             * value it refused to keep is not left on screen looking like it
             * was saved. */
            paint(d.prefs);
            return;
          }
          var msg = _tt("notifPrefsFailed", "Couldn't save notification preferences");
          setResult(msg, false);
          toast(msg, "error");
        })
        .catch(function () {
          btnBusy(saveBtn, false);
          var msg = _tt("notifPrefsFailed", "Couldn't save notification preferences");
          setResult(msg, false);
          toast(msg, "error");
        });
    });
  }

  /* The four bubble blocks under "Notify me from". Same server record as the
     switches, one tap target each: the tap writes the one key it owns, and a
     refusal puts the bubble back. Optimistic, like a chat app toggle. */
  function bindNotifBubbles() {
    var bubbles = document.querySelectorAll(".thw-bubble[data-bubble-pref]");
    if (!bubbles.length) return;

    function paint(prefs) {
      if (!prefs) return;
      bubbles.forEach(function (b) {
        var key = b.getAttribute("data-bubble-pref");
        var on = prefs[key] !== 0;
        b.classList.toggle("is-off", !on);
        b.setAttribute("aria-checked", on ? "true" : "false");
        var st = b.querySelector(".thw-bubble-state");
        if (st) st.textContent = on ? "On" : "Off";
      });
    }
    var take = window.THWBootstrap && window.THWBootstrap.take;
    var ask = function () {
      return fetch("/api/notification-settings", { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) { return d && d.ok ? d : null; });
    };
    (take ? take("notificationSettings", ask) : ask()).then(function (d) {
      if (d && d.prefs) paint(d.prefs);
    });

    bubbles.forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-bubble-pref");
        if (!key) return;
        var nowOn = b.getAttribute("aria-checked") !== "true";
        var st = b.querySelector(".thw-bubble-state");
        /* optimistic flip */
        b.setAttribute("aria-checked", nowOn ? "true" : "false");
        b.classList.toggle("is-off", !nowOn);
        if (st) st.textContent = nowOn ? "On" : "Off";
        var body = {};
        body[key] = nowOn ? 1 : 0;
        fetch("/api/notification-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefs: body }),
        })
          .then(function (r) { return r.json().catch(function () { return null; }); })
          .then(function (d) {
            if (d && d.ok && d.prefs) { paint(d.prefs); return; }
            throw new Error("not_saved");
          })
          .catch(function () {
            b.setAttribute("aria-checked", !nowOn ? "true" : "false");
            b.classList.toggle("is-off", nowOn);
            if (st) st.textContent = !nowOn ? "On" : "Off";
            toast(_tt("notifPrefsFailed", "Couldn't save notification preferences"), "error");
          });
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
        if (d && d.ok) { toast(_tt("toastDiscordUnlinked", "Discord unlinked"), "success"); loadAccountNow(); }
        else toast((d && d.error) || _tt("couldNotUnlinkDiscord", "Could not unlink Discord"), "error");
      }).catch(function () { btnBusy(unD, false); toast(_tt("couldNotUnlinkDiscord", "Could not unlink Discord"), "error"); });
    });
    var unG = document.getElementById("unlinkGoogleBtn");
    if (unG) unG.addEventListener("click", function () {
      btnBusy(unG, true);
      api({ action: "unlinkGoogle" }).then(function (d) {
        btnBusy(unG, false);
        if (d && d.ok) { toast(_tt("toastGoogleUnlinked", "Google unlinked"), "success"); loadAccountNow(); }
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
  }

  /* ---------- Themes + languages ---------- */
  var THEMES = [
    ["default", "Default"], ["violet", "Deep Violet"], ["embers", "Ember Nights"],
    ["obsidian", "Dark Obsidian"], ["aurora", "Aurora"], ["sakura", "Sakura Dream"],
    ["ocean", "Ocean Deep"], ["royal", "Royal Gold"],
    ["neon", "Neon Nights"], ["blood", "Blood Moon"], ["storm", "Midnight Storm"],
    ["forest", "Emerald Forest"], ["sunset", "Sunset Drive"], ["ice", "Arctic Ice"],
    ["candy", "Candy Pop"], ["matrix", "Digital Matrix"], ["cyber", "Cyberpunk"],
    ["gold", "Gold"], ["galaxy", "Deep Galaxy"], ["lava", "Lava Flow"],
    ["toxic", "Toxic Slime"], ["rose", "Rose Gold"], ["oled", "Pure OLED"],
    ["ultraviolet", "Ultraviolet"], ["pharaoh", "Pharaoh Sands"], ["dragon", "Dragon Fire"],
    ["mint", "Mint Fresh"], ["tangerine", "Tangerine Sky"],
    ["grape", "Grape Soda"], ["pumpkin", "Pumpkin Spice"], ["silver", "Silver Lining"], ["midnight", "Midnight Blue"],
    /* Seasonal. On the list all year so a theme chosen in its own month still
       names itself in the toast after it - the OFFER is gated by SEASONAL
       below, never the recognition. */
    ["newyear", "New Year"], ["valentines", "Valentine's Day"], ["stpatricks", "St. Patrick's Day"],
    ["easter", "Easter"], ["july4", "Fourth of July"], ["halloween", "Halloween"], ["thanksgiving", "Thanksgiving"], ["christmas", "Christmas"],
    /* The era themes, named the way their era names itself. */
    ["era-jute", "JUICED UP THE EP"], ["era-aff", "affliction"], ["era-hih", "Heartbroken In Hollywood 9 9 9"],
    ["era-jw999", "JuiceWRLD 9 9 9"], ["era-bdm", "BINGEDRINKINGMUSIC"], ["era-nd", "NOTHING'S DIFFERENT </3"],
    ["era-gbgr", "Goodbye & Good Riddance"], ["era-wod", "WRLD ON DRUGS"], ["era-drfl", "Death Race For Love"],
    ["era-out", "Outsiders"], ["era-post", "Posthumous"]
  ];
  /* ---------- Seasonal themes ----------
     *
     * Eight themes anyone may pick, but only while their season is on:
     * Halloween for the whole of October, Christmas for the whole of December,
     * and so on. Easter moves every year, so its window is computed - Good
     * Friday through Easter Monday - rather than written down.
     *
     * The gate lives entirely in the picker. The themes themselves are
     * ordinary CSS blocks like every other theme, and the server recognises
     * all seven the whole year, because a member who chose Halloween in
     * October keeps it in July: nothing about their theme changes silently
     * when the month does. */
  /* Each entry knows three things: when it opens, what it looks like (the
     `about` line the rows show), and its history - the story the row's own
     ⓘ opens. The eighth thing, `fx`, is not stored here: effects.js keeps
     the decals and matches on the theme id. */
  var SEASONAL = [
    { id: "newyear", months: [1], about: "Fireworks gold over midnight blue - January's night sky.",
      history: "January 1 became the year's first day with the Gregorian calendar reform of 1582; before that Europe rang in the year in March or at Easter. Midnight fireworks and noise are descendants of old customs meant to bang the old year out and scare the bad luck away." },
    { id: "valentines", months: [2], about: "Crimson and blush pink for Valentine's Day.",
      history: "The day keeps the name of Saint Valentine, a priest of 3rd-century Rome who, the stories go, kept marrying soldiers in secret when the empire forbade it. Chaucer tied the date to romance in the 1300s, and the Victorians added the cards, roses and heart-shaped chocolates." },
    { id: "stpatricks", months: [3], about: "Emerald green with a pot of found gold.",
      history: "March 17 is the traditional death day of Saint Patrick, the 5th-century missionary who became Ireland's patron saint; legend says he used the shamrock to explain the Trinity. Irish emigrant cities turned a quiet church feast into the parades and green floods of today." },
    { id: "easter", easter: true, about: "Soft spring pastels for the Easter weekend.",
      history: "Easter is the oldest Christian feast, marking the resurrection of Jesus. The Council of Nicaea fixed its date in 325 AD - the first Sunday after the first full moon of spring - which is why it wanders the year. Eggs and hares are older spring symbols of new life the feast absorbed." },
    { id: "july4", months: [7], about: "Stars-and-stripes red and blue for the Fourth of July.",
      history: "July 4, 1776 is the day the Continental Congress adopted the Declaration of Independence. Philadelphia fired fireworks on the first anniversary and the habit stuck; Congress made it an official holiday in 1870. The red-white-and-blue dress code is newer still, mostly 20th-century." },
    { id: "halloween", months: [10], about: "Pumpkin orange and violet - the darkest night of October.",
      history: "October 31 grew out of Samhain, the Celtic turning of the year into winter, when the veil between the living and the dead stood thinnest. Wearing disguises and lighting lanterns began as warding off wandering spirits; Irish arrivals carried the customs to America in the 1800s, where trick-or-treat took shape." },
    { id: "thanksgiving", months: [11], about: "Harvest amber and deep cranberry for the November feast.",
      history: "Thanksgiving traces to the 1621 harvest meal at Plymouth, shared between the Wampanoag people and the Mayflower's survivors after their first terrible winter. Presidents Washington and Lincoln each proclaimed days of thanks; Lincoln fixed the last Thursday of November in 1863, and Congress made the fourth Thursday federal law in 1941. Turkey, cranberries and the parade tradition grew from the 19th century onward." },
    { id: "christmas", months: [12], about: "Holly red, pine green and gold for Christmas.",
      history: "December 25 was fixed as Christmas in the 4th century, likely to sit beside the Roman midwinter feasts. Germany's decorated trees spread through the 1800s, and the Victorian era gave the holiday its cards, crackers, carols and family gift-giving." }
  ];

  /* Meeus/Jones/Butcher - the standard Gregorian approximation, correct from
     1583 into the 4000s, which covers every Easter this site will see. */
  function easterSunday(year) {
    var a = year % 19;
    var b = Math.floor(year / 100);
    var c = year % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31); /* 3 = March, 4 = April */
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  /* Whether a seasonal theme can be chosen at the given moment. `now` exists
     for the browser suite, which holds the calendar still at a stated date
     rather than waiting months for one; the picker only asks for right now. */
  function seasonalOpen(entry, now) {
    now = now || new Date();
    if (entry.months) return entry.months.indexOf(now.getMonth() + 1) !== -1;
    if (entry.easter) {
      var easter = easterSunday(now.getFullYear());
      /* The long weekend, not just the day: Good Friday morning through the
         end of Easter Monday, so the season is more than a few hours wide. */
      var from = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
      var to = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1, 23, 59, 59);
      return now >= from && now <= to;
    }
    return false;
  }

  /* The Appearance picker renders the seasonal themes as tiles next to the
     built-ins. The gate lives entirely in the picker: a tile outside its
     season is shut (unwearable) until its month comes round, and a season
     the member is already wearing stays pickable all year - a theme chosen
     in October keeps Halloween on in July, nothing changes silently when
     the month does. */
  function syncSeasonalThemes(current, now) {
    current = current || document.documentElement.getAttribute("data-theme") || "";
    var tiles = document.querySelectorAll("#seasonalThemesPick [data-seasonal-tile]");
    for (var i = 0; i < tiles.length; i++) {
      var label = tiles[i];
      var id = label.getAttribute("data-seasonal-tile");
      var input = label.querySelector("input[type=radio]");
      var entry = null;
      for (var e = 0; e < SEASONAL.length; e++) if (SEASONAL[e].id === id) { entry = SEASONAL[e]; break; }
      var open = !!entry && (current === id || seasonalOpen(entry, now));
      if (input) input.disabled = !open;
      label.classList.toggle("is-shut", !open);
      label.title = open ? themeName(id) : (themeName(id) + " - out of season right now");
    }
  }

  /* The window check, exposed so the browser suite can hold the calendar
     still and see what the picker would offer on a date of its choosing. The
     picker itself only ever asks for right now. */
  window.thwSeasonal = { table: SEASONAL, easter: easterSunday, open: seasonalOpen, sync: syncSeasonalThemes };
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
  /* The slug ("deep-violet" style value) is what gets stored; the name
     ("Deep Violet") is what a person recognises. An unknown slug falls back
     to itself rather than to nothing, so a theme added without updating
     THEMES still reports which one it picked. */
  function themeName(slug) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][0] === slug) return THEMES[i][1];
    try { if (window.thwThemeNames && window.thwThemeNames[slug]) return window.thwThemeNames[slug]; } catch (e) {}
    return String(slug || "");
  }
  /* Every language has its own template with {name} carried through, so this
     is one lookup. The literal is a fallback for a language added later
     without the key - English rather than nothing, which is what the previous
     two-branch version did by appending the name to the old static
     "Theme applied" string. */
  function themeChangedMsg(name) {
    return _tt("toastThemeChanged", 'Changed theme to "{name}"').replace(/\{name\}/g, name);
  }
  function applyI18n() {
    /* English fills the gaps: a language missing a key shows English rather
       than the literal word "undefined". */
    var t = Object.assign({}, I18N.en, I18N[_lang] || {}, (window.SiteChromeI18N && window.SiteChromeI18N[_lang]) || {});
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
    var lg = document.getElementById("setLang");
    if (lg) lg.value = _lang;
    applyTheme(theme);
    /* Member themes carry their own generated stylesheet, not one from
       themes.css - fetch it whenever the slug is in the u- namespace. */
    ensureMemberThemeCss(theme);
    /* With the theme now known, so an out-of-season choice stays listed. */
    syncSeasonalThemes(theme);
    var mode = _data && _data.site_mode ? _data.site_mode : (_cachedMode || "dark");
    syncMode(mode);
    applyMode(mode);
    /* wantedTheme / wantedLang belong to this DEVICE and are what a guest
       sees. The account's own theme must never be written over them, or
       signing out leaves the next visitor wearing your theme. */
    if (!isSignedInNow() && !_data) {
      try { localStorage.setItem("wantedTheme", theme); } catch (e) {}
      if (!isSignedInNow() && !_data) { try { localStorage.setItem("wantedMode", mode); } catch (e) {} }
      try { localStorage.setItem("wantedLang", _lang); } catch (e) {}
    }
    applyI18n();
  }
  /* Back to the device theme - called after signing out. */
  function applyDeviceTheme() {
    var theme = "default", lang = "en";
    try { theme = localStorage.getItem("wantedTheme") || "default"; } catch (e) {}
    try { lang = localStorage.getItem("wantedLang") || "en"; } catch (e) {}
    var mode = "dark";
    try { mode = localStorage.getItem("wantedMode") || "dark"; } catch (e) {}
    _lang = lang;
    applyTheme(theme);
    ensureMemberThemeCss(theme);
    syncSeasonalThemes(theme);
    applyMode(mode);
    syncMode(mode);
    try { document.documentElement.lang = lang; } catch (e) {}
    var lg = document.getElementById("setLang");
    if (lg) lg.value = lang;
    applyI18n();
  }
  window.applyDeviceTheme = applyDeviceTheme;
  /* Called after signing out: the account payload is stale, so drop it before
     anything can re-apply the account's theme over the device one. */
  window.resetAccountAfterSignOut = function () {
    _data = null;
    applyDeviceTheme();
  };
  function applyTheme(theme) {
    theme = theme || "default";
    _themeTarget = document.documentElement;
    _themeTarget.setAttribute("data-theme", theme);
    var ap = document.getElementById("account-page");
    if (ap) ap.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
  }
  /* Site mode is layered on top of the theme: the document carries BOTH
     data-theme and data-mode, and site-mode.css overrides only what the mode
     needs to change. Dark is deliberately not defined in CSS - it is the
     absence of an override - so switching back to dark reverts exactly to the
     theme's own colours with no reset block that can drift out of date. */
  var SITE_MODES = ["dark", "glass"];
  function applyMode(mode) {
    if (SITE_MODES.indexOf(mode) === -1) mode = "dark";
    document.documentElement.setAttribute("data-mode", mode);
    document.body.setAttribute("data-mode", mode);
    var ap = document.getElementById("account-page");
    if (ap) ap.setAttribute("data-mode", mode);
  }
  function syncMode(v) {
    var sm = document.getElementById("setMode");
    if (sm) sm.value = v;
  }
  function bindModeSel(sel) {
    if (!sel) return;
    sel.addEventListener("change", function () {
      var v = sel.value;
      applyMode(v);
      syncMode(v);
      /* Signed in: this is your account mode and it lives on the server. Only a
         guest (no account) changes the device mode - the same split the theme
         uses, so signing out returns to the mode this device last chose. */
      if (isSignedInNow()) {
        api({ action: "saveMode", mode: v }).then(function () { loadAccountNow(); });
      } else {
        try { localStorage.setItem("wantedMode", v); } catch (e) {}
      }
    });
  }
  function bindThemeLang() {
    function fillSelect(sel, list) {
      if (!sel || sel.dataset.filled) return;
      sel.dataset.filled = "1";
      list.forEach(function (x) { var o = document.createElement("option"); o.value = x[0]; o.textContent = x[1]; sel.appendChild(o); });
    }
    var lg = document.getElementById("setLang");
    fillSelect(lg, LANGS);
    /* First pass over the static markup: everything out of season is shut
       until an applied theme says otherwise a moment later. */
    syncSeasonalThemes();
    function syncLang(v) { if (lg) lg.value = v; }

    /* Picking is done by the appearance tiles - the handler lives in
       applyAppearanceThemeValue(), which owns saving, toasts and the
       go-back snapshot, exactly as the select's change handler used to. */
    function bindLangSel(sel) {
      if (!sel) return;
      sel.addEventListener("change", function () {
        _lang = sel.value;
        syncLang(_lang);
        /* Same rule as the theme: signed in saves to the account, a guest
           changes the device.

           The guest write happens BEFORE applyI18n. applyI18n is what
           translates the page, and anything reading storage to work out the
           current language would otherwise still see the old one. */
        if (isSignedInNow()) api({ action: "saveLanguage", language: _lang }).then(function () { loadAccountNow(); });
        else try { localStorage.setItem("wantedLang", _lang); } catch (e) {}
        applyI18n();
        var tt = null;
        if (window.SiteChromeI18N && window.SiteChromeI18N[_lang]) tt = window.SiteChromeI18N[_lang].toastLangSet;
        toast((tt || "Language set to") + " " + (sel.options[sel.selectedIndex].textContent), "success");
      });
    }
    /* ---------- Seasonal info + Community themes ----------
       *
       * Two doors onto the same list. The ⓘ beside the Theme field says what
       * each seasonal theme IS - its window in this year's real dates, and
       * whether it is on right now - because the picker only ever shows what
       * is in season, so for most of the year a member cannot see that
       * Halloween exists at all. The Community panel adds what everybody else
       * is wearing, straight from the server's counts.
       *
       * Rows wear a theme through the select's own change handler - one path
       * for picking, not a second one that could drift from it. */
    var SEASON_NAMES = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];

    function seasonalById(id) {
      for (var i = 0; i < SEASONAL.length; i++) if (SEASONAL[i].id === id) return SEASONAL[i];
      return null;
    }
    function fmtDay(d) { return SEASON_NAMES[d.getMonth()].slice(0, 3) + " " + d.getDate(); }

    /* This year's actual window, as dates. Not the word "October": Easter
       moves, so a fixed string would be wrong most years. */
    function seasonWindow(entry) {
      var now = new Date();
      if (entry.months) {
        var m = entry.months[0];
        return SEASON_NAMES[m - 1] + " 1 - " + new Date(now.getFullYear(), m, 0).getDate();
      }
      var easter = easterSunday(now.getFullYear());
      var from = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
      var to = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1);
      return fmtDay(from) + " - " + fmtDay(to) + ", " + now.getFullYear();
    }

    /* Open now, or when it comes back - a closed season says the date instead
       of just being absent. */
    function seasonStatus(entry) {
      if (seasonalOpen(entry)) return "Open now";
      var now = new Date();
      if (entry.months) {
        var m = entry.months[0];
        return "Opens " + SEASON_NAMES[m - 1] + " 1, " +
          (now.getMonth() + 1 >= m ? now.getFullYear() + 1 : now.getFullYear());
      }
      var easter = easterSunday(now.getFullYear());
      var gf = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
      if (now > gf) {
        easter = easterSunday(now.getFullYear() + 1);
        gf = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
      }
      return "Opens " + fmtDay(gf) + ", " + gf.getFullYear();
    }

    /* One row, shared by both panels. A shut row stays fully readable -
       reading what exists in June is the point of the panel - only the
       affordance is taken away. */
    /* One card: a span wrapper (the cell) holding the wear button, the row.
       The history ⓘ has to sit beside the button rather than inside it - a
       button cannot carry another button, and a row out of season is
       disabled, which swallows clicks meant for anything inside it. This way
       a theme the member cannot wear right now still tells its history. */
    function themeRow(id, info) {
      var cell = document.createElement("span");
      cell.className = "thw-theme-cell";
      cell.setAttribute("data-theme-id", id);

      var row = document.createElement("button");
      row.type = "button";
      row.className = "thw-theme-row";
      row.setAttribute("data-theme-id", id);
      if (!info.open) {
        row.disabled = true;
        cell.classList.add("is-shut");
      }

      var head = document.createElement("span");
      head.className = "thw-theme-row-head";
      var name = document.createElement("strong");
      name.className = "thw-theme-name";
      name.textContent = themeName(id);
      head.appendChild(name);
      if (info.status) {
        var chip = document.createElement("span");
        chip.className = "thw-theme-chip" + (info.open ? " thw-theme-chip--open" : "");
        chip.textContent = info.status;
        head.appendChild(chip);
      }
      row.appendChild(head);

      if (info.about) {
        var about = document.createElement("span");
        about.className = "thw-theme-about";
        about.textContent = info.about;
        row.appendChild(about);
      }
      if (info.when) {
        var when = document.createElement("span");
        when.className = "thw-theme-when";
        when.textContent = info.when;
        row.appendChild(when);
      }
      if (typeof info.pct === "number") {
        var share = document.createElement("span");
        share.className = "thw-theme-share";
        var pct = document.createElement("span");
        pct.className = "thw-theme-pct";
        pct.textContent = info.pct + "%";
        var bar = document.createElement("span");
        bar.className = "thw-theme-bar";
        var fill = document.createElement("i");
        fill.style.width = Math.max(2, info.pct) + "%";
        bar.appendChild(fill);
        share.appendChild(pct);
        share.appendChild(bar);
        row.appendChild(share);
      }
      if (info.open) row.addEventListener("click", function () { wearFromList(id); });
      cell.appendChild(row);

      /* The season's story: the ⓘ opens a panel with the holiday's picture
         and its fuller history, so a season out of reach still tells its
         tale. Enter and Space open it too, since the ⓘ is keyboard reachable. */
      if (info.history) {
        var histBtn = document.createElement("span");
        histBtn.className = "thw-theme-hist";
        histBtn.setAttribute("role", "button");
        histBtn.setAttribute("tabindex", "0");
        histBtn.setAttribute("aria-label", "History of " + themeName(id));
        histBtn.title = "Season history";
        histBtn.innerHTML = '<i class="fas fa-circle-info"></i>';
        cell.appendChild(histBtn);

        function openHist(e) {
          openHolidayPanel(id);
          e.stopPropagation();
          if (e.preventDefault) e.preventDefault();
        }
        histBtn.addEventListener("click", openHist);
        histBtn.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") openHist(e);
        });
      }
      return cell;
    }

    /* The ⓘ under the seasonal tiles opens the story panel: what each one
       IS, its window this year and whether it is on right now - because a
       member cannot pick a season that is not on, and for most of the year
       cannot see that Halloween exists at all. */
    function fillSeasonalInfo() {
      var host = document.getElementById("seasonal-themes-list");
      if (!host) return;
      host.textContent = "";
      for (var i = 0; i < SEASONAL.length; i++) {
        var entry = SEASONAL[i];
        host.appendChild(themeRow(entry.id, {
          about: entry.about,
          when: seasonWindow(entry),
          status: seasonStatus(entry),
          open: seasonalOpen(entry),
          history: entry.history,
        }));
      }
    }
    (function () {
      var btn = document.getElementById("seasonalThemesInfo");
      if (!btn) return;
      btn.addEventListener("click", function () { fillSeasonalInfo(); openModal("seasonalThemesModal"); });
    })();

    /* The panel behind a row's ⓘ: the holiday's picture, when its season
       runs, a word on its look and the fuller story. A season that is on
       also offers its Wear button; one that is not simply tells its story.
       The art files sit beside the page (sw.js precaches them), so the
       picture is there before the button is even clicked.

       The pictures are real photos from Wikimedia Commons, not drawings.
       Their licences let us use them, but several ask to be credited, so
       every photo carries its credit line in the corner of the panel. */
    var PHOTO_CREDITS = {
      newyear:      { author: "Tony Hisgett",     lic: "CC BY 2.0",    page: "https://commons.wikimedia.org/wiki/File:London_New_Year_2016_Fireworks_4_(23521219043).jpg" },
      valentines:   { author: "Janine",           lic: "CC BY 2.0",    page: "https://commons.wikimedia.org/wiki/File:Red_and_white_bouquet.jpg" },
      stpatricks:   { author: "Amy Wilson, CSIRO", lic: "CC BY 3.0",    page: "https://commons.wikimedia.org/wiki/File:CSIRO_ScienceImage_3328_White_Clover_Trifolium_repens.jpg" },
      easter:       { author: "Radka Kapuciánová", lic: "CC BY-SA 3.0", page: "https://commons.wikimedia.org/wiki/File:Vaj%C3%AD%C4%8Dka_zdoben%C3%A1_voskovou_technikou.jpg" },
      july4:        { author: "Jeremy Nicholson", lic: "CC BY 2.0",    page: "https://commons.wikimedia.org/wiki/File:Fourth_of_July_Fireworks_(3691472851).jpg" },
      halloween:    { author: "Beth Teutschmann", lic: "CC0 (Unsplash)", page: "https://commons.wikimedia.org/wiki/File:Carved_pumpkin_as_face_(Unsplash).jpg" },
      thanksgiving: { author: "Patrick Fitzgerald", lic: "CC BY 2.0",  page: "https://commons.wikimedia.org/wiki/File:Thanksgiving_Turkey.jpg" },
      christmas:    { author: "John Morgan",      lic: "CC BY 2.0",    page: "https://commons.wikimedia.org/wiki/File:Boy_decorating_Christmas_tree.jpg" },
    };
    function openHolidayPanel(id) {
      var entry = null;
      for (var i = 0; i < SEASONAL.length; i++) {
        if (SEASONAL[i].id === id) { entry = SEASONAL[i]; break; }
      }
      if (!entry) return;
      var art = document.getElementById("holidayArt");
      if (art) { art.src = "./holiday-art/" + id + ".jpg"; art.alt = themeName(id); }
      var credit = document.getElementById("holidayCredit");
      if (credit) {
        var c = PHOTO_CREDITS[id];
        credit.innerHTML = c
          ? "<a href=\"" + c.page + "\" target=\"_blank\" rel=\"noopener\">Photo: " + c.author + " - " + c.lic + "</a>"
          : "";
      }
      var nameEl = document.getElementById("holidayName");
      if (nameEl) nameEl.textContent = themeName(id);
      var chip = document.getElementById("holidayChip");
      if (chip) {
        chip.textContent = seasonStatus(entry);
        chip.className = "thw-hist-chip" + (seasonalOpen(entry) ? " thw-hist-chip--open" : "");
      }
      var when = document.getElementById("holidayWhen");
      if (when) when.textContent = seasonWindow(entry);
      var about = document.getElementById("holidayAbout");
      if (about) about.textContent = entry.about || "";
      var story = document.getElementById("holidayHistory");
      if (story) story.textContent = entry.history || "";
      var wear = document.getElementById("holidayWear");
      if (wear) {
        var wearable = seasonalOpen(entry);
        wear.hidden = !wearable;
        wear.onclick = wearable ? function () { wearFromList(id); } : null;
      }
      openModal("seasonalHistoryModal");
    }

    /* Pre-fill the modal once, so the ⓘ opens onto a ready list. */
    fillSeasonalInfo();

    /* A switch to turn the decals off - snow is charming until it is not.
       effects.js owns the layer; this only remembers the choice and tells it
       to decide again - and says so, since the layer is at the far edge of
       the screen and easy to miss either way. */
    (function () {
      var fxToggle = document.getElementById("seasonalFxToggle");
      var fxRow = document.getElementById("seasonalFxRow");
      if (!fxToggle || !fxRow) return;
      var stored = "";
      try { stored = localStorage.getItem("thwThemeFx") || "on"; } catch (_) {}
      fxToggle.checked = stored !== "off";
      fxToggle.addEventListener("change", function () {
        try { localStorage.setItem("thwThemeFx", fxToggle.checked ? "on" : "off"); } catch (_) {}
        try { document.dispatchEvent(new CustomEvent("thw-fx-toggle")); } catch (_) {}
        toast(fxToggle.checked
          ? _tt("toastFxOn", "Seasonal effects on - the worn season falls.")
          : _tt("toastFxOff", "Seasonal effects off - the seasons stay quiet."),
          fxToggle.checked ? "success" : "info");
      });
    })();

    /* Wearing a theme from a panel IS picking its tile: check the input and
       fire change, so saving, toasting and syncing stay in the one handler
       that does all three - applyAppearanceThemeValue(). */
    function wearFromList(id) {
      var tile = document.querySelector('input[name="appearanceTheme"][value="' + id + '"]');
      if (tile) {
        if (tile.disabled) return;
        tile.checked = true;
        tile.dispatchEvent(new Event("change"));
      } else {
        /* A member (u-slug) theme has no tile: wear it the same way Auto
           wears - apply, save, toast and remember - through the same path. */
        applyAppearanceThemeValue(id);
      }
      closeModal("seasonalThemesModal");
      /* Wearing from the holiday's own panel closes that panel too. */
      closeModal("seasonalHistoryModal");
    }
    /* The Community Themes page wears through the same path. */
    window.thwWearTheme = wearFromList;
    /* The slug of the theme the member put off before the latest wear, or
       "" when there is nothing to go back to (or it has worn everything). */
    window.thwPrevTheme = function () {
      try { return localStorage.getItem("thwPrevTheme") || ""; } catch (_) { return ""; }
    };

    bindModeSel(document.getElementById("setMode"));
    bindLangSel(lg);
    syncLang(_lang);

    /* The footer picker drives the same select (and therefore the same save
       and apply path) as the old settings field did. */
    var flBtn = document.getElementById("foot-lang-btn");
    var flMenu = document.getElementById("foot-lang-menu");
    var flLabel = document.getElementById("foot-lang-label");
    if (flBtn && flMenu) {
      var paintLangMenu = function () {
        var cur = (lg && lg.value) || _lang || "en";
        flMenu.innerHTML = LANGS.map(function (x) {
          var on = x[0] === cur;
          return '<button type="button" role="option" data-lang="' + x[0] + '" aria-selected="' + (on ? "true" : "false") + '">' + x[1] + (on ? ' <i class="fas fa-check"></i>' : "") + "</button>";
        }).join("");
        var hit = LANGS.filter(function (x) { return x[0] === cur; })[0];
        if (flLabel && hit) flLabel.textContent = hit[1];
      };
      flBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = flMenu.hidden;
        flMenu.hidden = !open;
        flBtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) paintLangMenu();
      });
      flMenu.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-lang]") : null;
        if (!b) return;
        e.stopPropagation();
        if (lg) { lg.value = b.getAttribute("data-lang"); lg.dispatchEvent(new Event("change", { bubbles: true })); }
        flMenu.hidden = true;
        flBtn.setAttribute("aria-expanded", "false");
      });
      document.addEventListener("click", function (e) {
        if (!flMenu.hidden && !(e.target.closest && e.target.closest("#foot-langs"))) {
          flMenu.hidden = true;
          flBtn.setAttribute("aria-expanded", "false");
        }
      });
      if (lg) lg.addEventListener("change", paintLangMenu);
      paintLangMenu();
    }
  }

  /* ---------- Profile persistence ---------- */
  function persistProfile() {
    return api({ action: "updateProfile", name: _profile.name, bio: _profile.bio, status: _profile.status, avatar: _profile.avatar, banner: _profile.banner, favSong: _profile.favSong || "", bannerChoice: _profile.bannerChoice || "auto" }).then(function () {
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
      if (window.openEditProfile) { window.openEditProfile(); return; }
    });
    var viewMyProfile = document.getElementById("viewMyProfileBtn");
    if (viewMyProfile) viewMyProfile.addEventListener("click", function () { if (window.openProfile) window.openProfile(); });
    var discardBtn = document.getElementById("mCancelBtn");
    if (discardBtn) discardBtn.addEventListener("click", function () {
      /* Discard: refill every field from the stored profile so unsaved edits vanish. */
      var mp = document.getElementById("mAvatarPreview");
      if (mp) mp.innerHTML = _profile.avatar ? '<img decoding="async" src="' + esc(_profile.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fas fa-user"></i>';
      var pp = document.getElementById("mPicPreview");
      if (pp) pp.innerHTML = mp ? mp.innerHTML : (_profile.avatar ? '<img decoding="async" src="' + esc(_profile.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">' : '<i class="fas fa-user"></i>');
      var n = document.getElementById("mName"); if (n) n.value = _profile.name || "";
      var b = document.getElementById("mBio"); if (b) b.value = _profile.bio || "";
      var mh = document.getElementById("mHandle"); if (mh) mh.value = String(profileUsername() || "").toLowerCase();
      var bc = document.getElementById("mBioCount"); if (bc) bc.textContent = String((_profile.bio || "").length) + " / 160";
      var fs = document.getElementById("mFavSearch"); if (fs) fs.value = _profile.favSong || "";
      Array.prototype.forEach.call(document.querySelectorAll('input[name="mBannerChoice"]'), function (r) { r.checked = r.value === (_profile.bannerChoice || "auto"); });
      if (typeof _hideFavResults === "function") _hideFavResults();
      applyProfile();
      toast(_tt("toastDiscarded", "Changes discarded"), "info");
    });
    var mAv = document.getElementById("mAvatarFile");
    if (mAv) mAv.addEventListener("change", function () {
      if (!mAv.files[0]) return;
      fileToDataURL(mAv.files[0], 256, 256, function (url) {
        _profile.avatar = url;
        var mp = document.getElementById("mAvatarPreview");
        if (mp) mp.innerHTML = '<img decoding="async" src="' + url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
        var pp = document.getElementById("mPicPreview");
        if (pp) pp.innerHTML = '<img decoding="async" src="' + url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
        if (window.__markDirty) window.__markDirty();
        if (window.__pv2ApplyLive) window.__pv2ApplyLive({ avatar: url });
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
      var fsEl = document.getElementById("mFavSearch");
      if (fsEl) _profile.favSong = fsEl.value.trim();
      var bsel = document.getElementById("mBannerClassic");
      if (bsel) _profile.bannerChoice = bsel.checked ? "classic" : (_profile.bannerChoice || "auto");
      persistProfile().then(function () {
        /* Saving re-fetches the account; repaint the profile surface so it can
           never be left empty after the reload. */
        try { if (typeof window.profileSectionShown === "function") window.profileSectionShown(); } catch (e) {}
        try { if (typeof window.thwMountPlaylistsManager === "function") window.thwMountPlaylistsManager(); } catch (e) {}
      });
      applyProfile();
      /* Saving is done - leave the editor and put the page back. closeModal()
         also returns the editor to its inline home and frees the scroll lock. */
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
        if (ap) ap.innerHTML = '<img decoding="async" src="' + url + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
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
    return '<div class="link-row"><input type="text" class="link-row-label" placeholder="' + esc(_tt("linkLabelPh", "Label (e.g. YouTube)")) + '" maxlength="40" value="' + esc(l.label) + '"><input type="url" class="link-row-url" placeholder="https://" maxlength="500" value="' + esc(l.url) + '"><button type="button" class="deck-btn del" title="' + esc(_tt("remove", "Remove")) + '" data-dellink="1"><i class="fas fa-xmark"></i></button></div>';
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
        if (d && d.ok) { toast(_tt("toastLinksSaved", "Links saved"), "success"); loadAccountNow(); }
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
      grid.innerHTML = '<div class="card pl-empty-card"><i class="fas fa-list-music"></i><b>' + esc(_tt("noPlaylists", "No playlists yet")) + '</b><p>' + esc(_tt("plEmptySub", "Create a playlist and it will sync across every device you use.")) + '</p><button class="btn btn-gold btn-sm" id="plNewBtnEmpty"><i class="fas fa-plus"></i>' + esc(_tt("createPlaylist", "Create Playlist")) + '</button></div>'; bindPlNew(); return;
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
      var acts = '<div class="pl-actions"><button class="deck-btn play" data-playpl="' + p.id + '" title="' + esc(_tt("playTitle", "Play")) + '"><i class="fas fa-play"></i></button><button class="deck-btn" data-openpl="' + p.id + '" title="' + esc(_tt("openTitle", "Open")) + '"><i class="fas fa-list-ul"></i></button>';
      if (own) acts += '<button class="deck-btn" data-editpl="' + p.id + '" title="' + esc(_tt("editTitle", "Edit")) + '"><i class="fas fa-pen"></i></button><button class="deck-btn del" data-delpl="' + p.id + '" title="' + esc(_tt("deleteTitle", "Delete")) + '"><i class="fas fa-trash"></i></button>';
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
        return '<div class="pl-track-row"><span class="pl-track-idx">' + (i + 1) + '</span><span class="pl-track-name" data-pltrackplay="' + esc(t.title) + '"><i class="fas fa-music"></i>' + esc(t.title) + '</span><span class="pl-track-dur">' + fmtHours(trackDurationOf(t.title)) + '</span><button class="deck-btn" data-pltrackfav="' + esc(t.title) + '" title="' + esc(_tt("favTitle", "Favorite")) + '"><i class="fas fa-heart"></i></button>' + (isOwn ? '<button class="deck-btn del" data-pltrackdel="' + t.id + '" title="' + esc(_tt("remove", "Remove")) + '"><i class="fas fa-xmark"></i></button>' : '') + '</div>';
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
          api({ action: "deletePlaylist", id: id }).then(function (d) {
            if (!d || d.error) { toast((d && d.error) || _tt("errGeneric", "Something went wrong"), "error"); return; }
            loadAccount();
            plLiveSync();
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
        api({ action: "renamePlaylist", id: _plEditId, name: name, desc: desc, color: _plColor }).then(function (d) {
          if (!d || d.error) { toast((d && d.error) || _tt("errGeneric", "Something went wrong"), "error"); return; }
          closeModal("editPlModal");
          loadAccount();
          plLiveSync();
          toast(_tt("toastPlUpdated", "Playlist updated"), "success");
        });
      } else {
        api({ action: "createPlaylist", name: name, desc: desc, color: _plColor }).then(function (d) {
          if (!d || d.error) { toast((d && d.error) || _tt("errGeneric", "Something went wrong"), "error"); return; }
          closeModal("editPlModal");
          loadAccount();
          plLiveSync();
          toast(_tt("toastPlCreated", "Playlist created"), "success");
        });
      }
    });
    var detailAdd = document.getElementById("plAddBtn");
    if (detailAdd) detailAdd.addEventListener("click", function () {
      var title = (document.getElementById("plAddTitle").value || "").trim();
      if (!_plDetailId || !title) { toast(_tt("toastEnterSongTitle", "Enter a song title"), "error"); return; }
      api({ action: "addPlaylistTrack", playlist_id: _plDetailId, title: title }).then(function (d) {
        if (!d || d.error) { toast((d && d.error) || _tt("errGeneric", "Something went wrong"), "error"); return; }
        document.getElementById("plAddTitle").value = "";
        loadAccount();
        plLiveSync();
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
        api({ action: "removePlaylistTrack", track_id: parseInt(del.getAttribute("data-pltrackdel"), 10) }).then(function (d) {
          if (!d || d.error) { toast((d && d.error) || _tt("errGeneric", "Something went wrong"), "error"); return; }
          loadAccount();
          plLiveSync();
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
["myReports", "My Reports", "fa-flag", "My Reports", "Track the status of reports you have filed", "myReportsTitle", "acSubMyReports"],
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
      var link = e.target.closest(".acct-item, .nam-link");
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
      placeEditor("modal");
      openModal("editProfileModal");
      /* The form container is scrollable; a stale scrollTop left the modal
         opened scrolled past the Picture row. Always start at the top. */
      var mount = document.getElementById("editProfileMount");
      if (mount) mount.scrollTop = 0;
      applyProfile();
      syncEditPrivacy();
      renderEditSocials();
      if (window.__refreshDrpPreview) window.__refreshDrpPreview();
    };
    /* ---------- Edit profile v2: preview rail + form wiring ---------- */
    var _favSel = "";
    function _setSwitch(el, on) {
      if (!el) return;
      el.classList.toggle("on", !!on);
      el.setAttribute("aria-checked", on ? "true" : "false");
    }
    function syncEditPrivacy() {
      fetch("/api/privacy", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
        var p = d && d.privacy; if (!p) return;
        _setSwitch(document.getElementById("mPublicProfile"), Number(p.show_profile) !== 0);
        _setSwitch(document.getElementById("mShowListening"), Number(p.show_activity) !== 0);
      }).catch(function () {});
    }
    function postPrivacy(patch) {
      return fetch("/api/privacy", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(function (r) { return r.json(); }).catch(function () { return null; });
    }
    function _ownUidForProfile() {
      try { return localStorage.getItem("wantedUserId") || ""; } catch (e) { return ""; }
    }
    function _socialLabel(k) {
      var m = { twitter: "X / Twitter", instagram: "Instagram", youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", tiktok: "TikTok", facebook: "Facebook", website: "Website" };
      return m[String(k || "").toLowerCase()] || String(k || "");
    }
    function renderEditSocials() {
      var box = document.getElementById("mLinkList"); if (!box) return;
      var uid = _ownUidForProfile();
      if (!uid) { box.innerHTML = '<p class="editpf-hint">Sign in to manage links.</p>'; return; }
      box.innerHTML = '<p class="editpf-hint">Loading links…</p>';
      fetch("/api/profile?user=" + encodeURIComponent(uid), { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
        var links = (d && d.links) || [];
        if (!links.length) { box.innerHTML = '<p class="editpf-hint">No links yet.</p>'; return; }
        box.innerHTML = links.map(function (l) {
          var k = String((l && l.label) || ""), url = String((l && l.url) || "");
          return '<span class="editpf-link-chip"><span><b>' + esc(_socialLabel(k)) + '</b><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url.replace(/^https?:\/\//i, "")) + '</a></span><button type="button" data-clearlink="' + esc(k) + '" aria-label="Remove link"><i class="fas fa-xmark"></i></button></span>';
        }).join("");
      }).catch(function () { box.innerHTML = '<p class="editpf-hint">Could not load links.</p>'; });
    }
    function _hideFavResults() {
      var box = document.getElementById("mFavResults"); if (box) { box.hidden = true; box.innerHTML = ""; }
    }
    function _favMatches(q) {
      var src = (typeof trackList !== "undefined" && trackList) ? trackList : [];
      var out = [];
      for (var i = 0; i < src.length && out.length < 6; i++) {
        var t = String(src[i] && src[i].title || "");
        if (!t) continue;
        if (t.toLowerCase().indexOf(q) !== -1) out.push(t);
      }
      return out;
    }
    function _syncFavChip() {
      var chip = document.getElementById("mFavCurrent"), txt = document.getElementById("mFavCurrentText");
      if (chip && txt) {
        if (_favSel) { txt.textContent = _favSel; chip.classList.remove("hidden"); } else { chip.classList.add("hidden"); }
      }
    }

    function bindEditV2() {
      /* Name: rail preview + hero, live */
      var nameEl = document.getElementById("mName");
      if (nameEl) nameEl.addEventListener("input", function () {
        var v = nameEl.value.trim();
        var preview = document.getElementById("mPreviewName");
        if (preview) preview.textContent = v || ("999_" + uidSuffix);
        if (window.__pv2ApplyLive) window.__pv2ApplyLive({ name: v || ("999_" + uidSuffix) });
        markDirty();
      });

      /* Bio counter + live preview + hero */
      var bio = document.getElementById("mBio"), bc = document.getElementById("mBioCount");
      if (bio && bc) bio.addEventListener("input", function () {
        bc.textContent = String(bio.value.length) + " / 160";
        var preview = document.getElementById("mPreviewBio");
        if (preview) preview.textContent = bio.value || "No bio yet.";
        if (window.__pv2ApplyLive) window.__pv2ApplyLive({ bio: bio.value });
        markDirty();
      });

      /* ---------- debounced autosave + state indicator ---------- */
      var _autoSaveTimer = null, _autoSaveDirty = false;
      function setSaveState(text, kind) {
        var el = document.getElementById("editpfSaveState");
        if (!el) return;
        el.textContent = text || "";
        el.className = "editpf-save-state" + (kind ? " " + kind : "");
      }
      function markDirty() {
        _autoSaveDirty = true;
        setSaveState("Unsaved", "busy");
        clearTimeout(_autoSaveTimer);
        _autoSaveTimer = setTimeout(runAutoSave, 1200);
      }
      function runAutoSave() {
        if (!_autoSaveDirty) return;
        _autoSaveDirty = false;
        setSaveState("Saving…", "busy");
        persistProfile().then(function () {
          setSaveState("Saved", "ok");
          setTimeout(function () { setSaveState("", ""); }, 1800);
        }, function () {
          setSaveState("Couldn't save", "busy");
        });
      }

      /* ---------- Rich Presence (live "what visitors see") preview ---------- */
      function _favArt(title) {
        var src = (typeof trackList !== "undefined" && trackList) ? trackList : [];
        var q = String(title).toLowerCase();
        for (var i = 0; i < src.length; i++) {
          if (String(src[i] && src[i].title || "").toLowerCase() === q && src[i].cover) return String(src[i].cover);
        }
        return "AlbumArt/999.jpg";
      }
      function fillDrpPreview() {
        var art = document.getElementById("mDrpArt");
        var titleEl = document.getElementById("mDrpTitle");
        var subEl = document.getElementById("mDrpSub");
        var liveEl = document.getElementById("mDrpLive");
        if (!art || !titleEl || !subEl || !liveEl) return;
        var head = null;
        try { head = window.__pv2HeadCache || null; } catch (e) {}
        var live = head && head.nowPlaying && head.nowPlaying.title ? head.nowPlaying : null;
        var fav = _favSel || (_profile && _profile.favSong) || "";
        art.src = live ? (live.artwork || "AlbumArt/999.jpg") : (fav ? _favArt(fav) : "AlbumArt/999.jpg");
        titleEl.textContent = live ? live.title : (fav || "Pin a song");
        subEl.textContent = live ? "Listening to Juice WRLD" : (fav ? "Your pinned favourite song" : "Not listening right now");
        liveEl.textContent = live ? "Live" : "Preview";
      }
      function refreshDrpPreview() {
        var uid = _ownUidForProfile();
        if (!uid) { fillDrpPreview(); return; }
        fetch("/api/profile?user=" + encodeURIComponent(uid) + "&head=1", { credentials: "same-origin", cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok !== false && !d.hidden) { try { window.__pv2HeadCache = d; } catch (e) {} }
            fillDrpPreview();
          })
          .catch(function () { fillDrpPreview(); });
      }

      /* Remove avatar */
      var clr = document.getElementById("mAvatarClearBtn");
      if (clr) clr.addEventListener("click", function () {
        _profile.avatar = "";
        applyProfile();
        persistProfile();
        if (window.__pv2ApplyLive) window.__pv2ApplyLive({ avatar: "" });
        fillDrpPreview();
        toast(_tt("toastPictureRemoved", "Picture removed"), "info");
      });

      /* Privacy switches */
      var pp = document.getElementById("mPublicProfile");
      if (pp) pp.addEventListener("click", function () {
        var next = !pp.classList.contains("on");
        _setSwitch(pp, next);
        postPrivacy({ show_profile: next ? 1 : 0 }).then(function (d) {
          if (!d || d.ok === false) { _setSwitch(pp, !next); toast(_tt("toastSaveFailed", "Could not save that"), "error"); return; }
          toast(_tt(next ? "toastProfilePublic" : "toastProfilePrivate", next ? "Your profile is public" : "Your profile is private"), "success");
        });
      });
      var pl = document.getElementById("mShowListening");
      if (pl) pl.addEventListener("click", function () {
        var next = !pl.classList.contains("on");
        _setSwitch(pl, next);
        postPrivacy({ show_activity: next ? 1 : 0 }).then(function (d) {
          if (!d || d.ok === false) { _setSwitch(pl, !next); toast(_tt("toastSaveFailed", "Could not save that"), "error"); return; }
          toast(_tt(next ? "toastListeningVisible" : "toastListeningHidden", next ? "Listening activity visible" : "Listening activity hidden"), "success");
        });
      });

      /* Social links: one at a time, platform auto-detected from the URL */
      var SOCIAL_HOSTS = [["twitter.com", "twitter"], ["x.com", "twitter"], ["instagram.com", "instagram"], ["youtube.com", "youtube"], ["youtu.be", "youtube"], ["soundcloud.com", "soundcloud"], ["open.spotify.com", "spotify"], ["spotify.com", "spotify"], ["tiktok.com", "tiktok"], ["facebook.com", "facebook"], ["fb.com", "facebook"]];
      function _detectPlatform(url) {
        try {
          var h = new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).hostname.toLowerCase().replace(/^www\./, "");
          for (var i = 0; i < SOCIAL_HOSTS.length; i++) {
            if (h === SOCIAL_HOSTS[i][0] || h.endsWith("." + SOCIAL_HOSTS[i][0])) return SOCIAL_HOSTS[i][1];
          }
        } catch (e) {}
        return "website";
      }
      var linkSave = document.getElementById("mLinkSaveBtn");
      var linkUrl = document.getElementById("mLinkUrl");
      if (linkSave && linkUrl) {
        linkSave.addEventListener("click", function () {
          var value = linkUrl.value.trim();
          if (!value) { toast(_tt("toastTypeLinkFirst", "Type a link first"), "info"); return; }
          var platform = _detectPlatform(value);
          fetch("/api/profile", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_social", platform: platform, value: value }) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.ok) { toast((d && d.error) || _tt("toastSaveFailed", "Could not save that"), "error"); return; }
              linkUrl.value = "";
              renderEditSocials();
              toast(_tt("toastLinkSaved", "Link saved"), "success");
            }).catch(function () { toast(_tt("toastSaveFailed", "Could not save that"), "error"); });
        });
      }
      var list = document.getElementById("mLinkList");
      if (list) list.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("[data-clearlink]") : null;
        if (!btn) return;
        var platform = btn.getAttribute("data-clearlink");
        fetch("/api/profile", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_social", platform: platform, value: "" }) })
          .then(function () { renderEditSocials(); })
          .catch(function () {});
      });

      /* Profile theme dropdown */
      var EDIT_THEMES = THEMES;
      var themeSel = document.getElementById("mThemeSelect");
      if (themeSel && !themeSel.dataset.built) {
        themeSel.dataset.built = "1";
        themeSel.innerHTML = EDIT_THEMES.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join("");
        var cur = "default";
        try { cur = (_data && _data.theme) || localStorage.getItem("wantedTheme") || "default"; } catch (e) {}
        themeSel.value = cur;
        themeSel.addEventListener("change", function () {
          var v = themeSel.value;
          try { localStorage.setItem("wantedTheme", v); } catch (e) {}
          try { applyTheme(v); } catch (e) {}
          try { ensureMemberThemeCss(v); } catch (e) {}
          try { if (window.thwAppearanceThemeApplied) window.thwAppearanceThemeApplied(v); } catch (e) {}
          api({ action: "saveTheme", theme: v });
          toast(_tt("toastThemeChanged", 'Changed theme to "{name}"').replace(/\{name\}/g, themeName(v)), "success");
        });
      }

      /* Favourite song search */
      var fs = document.getElementById("mFavSearch");
      var results = document.getElementById("mFavResults");
      if (fs && results) {
        fs.addEventListener("input", function () {
          var q = fs.value.trim().toLowerCase();
          if (q.length < 2) { _hideFavResults(); return; }
          var matches = _favMatches(q);
          if (!matches.length) { results.innerHTML = '<div class="editpf-fav-opt" style="opacity:.6">Nothing in the vault matches that.</div>'; results.hidden = false; return; }
          results.innerHTML = matches.map(function (t) {
            return '<button type="button" class="editpf-fav-opt" data-fav="' + esc(t) + '"><i class="fas fa-music" style="opacity:.6"></i><span>' + esc(t) + '</span></button>';
          }).join("");
          results.hidden = false;
        });
        fs.addEventListener("focus", function () { fs.dispatchEvent(new Event("input")); });
        results.addEventListener("click", function (e) {
          var btn = e.target.closest ? e.target.closest("[data-fav]") : null;
          if (!btn) return;
          _favSel = btn.getAttribute("data-fav") || "";
          _profile.favSong = _favSel;   /* chip + rail derive from _profile on repaint */
          fs.value = _favSel;
          _hideFavResults();
          _syncFavChip();
          applyProfile();
          markDirty();
          fillDrpPreview();
        });
        document.addEventListener("click", function (e) {
          if (!results.hidden && !results.contains(e.target) && e.target !== fs) _hideFavResults();
        });
      }
      var favClear = document.getElementById("mFavClearBtn");
      if (favClear) favClear.addEventListener("click", function () {
        _favSel = "";
        _profile.favSong = "";
        var fs2 = document.getElementById("mFavSearch"); if (fs2) fs2.value = "";
        _syncFavChip();
        applyProfile();
        markDirty();
        fillDrpPreview();
      });

      /* Banner radios */
      var ba = document.getElementById("mBannerAuto"), bcb = document.getElementById("mBannerClassic"), bcu = document.getElementById("mBannerCustom");
      function _pickCustomIfPossible() {
        if (!_profile.banner) {
          /* No custom banner yet - go straight to the file picker so selecting
             works like every other chooser. */
          var bf = document.getElementById("mBannerFile"); if (bf) bf.click();
        }
      }
      [ba, bcb, bcu].forEach(function (radio) {
        if (!radio) return;
        radio.addEventListener("change", function () {
          if (bcu && bcu.checked) {
            _profile.bannerChoice = "custom";
            _pickCustomIfPossible();
          } else if (bcb.checked) {
            _profile.bannerChoice = "classic";
          } else {
            _profile.bannerChoice = "auto";
          }
          applyProfile();
          markDirty();
          fillDrpPreview();
        });
      });

      /* Custom banner upload */
      var bannerUploadBtn = document.getElementById("mBannerUploadBtn");
      if (bannerUploadBtn) bannerUploadBtn.addEventListener("click", function () {
        var bf = document.getElementById("mBannerFile"); if (bf) bf.click();
      });
      var bannerFile = document.getElementById("mBannerFile");
      function _applyBannerDataUrl(url) {
        _profile.banner = url;
        _profile.bannerChoice = "custom";
        var img = document.getElementById("mBannerCustomImg");
        if (img) { img.src = url; img.hidden = false; }
        var icon = document.getElementById("mBannerCustomIcon");
        if (icon) icon.style.display = "none";
        var radioC = document.getElementById("mBannerCustom"); if (radioC) radioC.checked = true;
        applyProfile();
        markDirty();
        fillDrpPreview();
      }
      if (bannerFile) bannerFile.addEventListener("change", function () {
        var file = bannerFile.files && bannerFile.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) { toast(_tt("toastImageNotImage", "That's not an image"), "error"); return; }
        if (file.size > 6 * 1024 * 1024) { toast(_tt("toastImageTooLarge", "Image is too large - keep it under 6 MB"), "error"); return; }
        fileToDataURL(file, 1600, 500, function (url) {
          if (url.length > 285000) {
            fileToDataURL(file, 1100, 340, function (smaller) {
              if (smaller.length > 285000) { toast(_tt("toastImageTooHeavy", "That image is too heavy even after downscaling - try a smaller one"), "error"); return; }
              _applyBannerDataUrl(smaller);
            });
            return;
          }
          _applyBannerDataUrl(url);
        });
      });

      /* Expose the preview + autosave for the avatar flow registered elsewhere. */
      window.__refreshDrpPreview = refreshDrpPreview;
      window.__markDirty = markDirty;
    }
    bindEditV2();
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
  function renderSelfProfilePage() {
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    /* The old self-profile layout was removed; the overhaul renders itself
       into this host. Nothing from the old layout remains. */
    body.innerHTML = '<div id="profileV2Mount" class="profile-v2-mount" aria-busy="true"></div>';
    canonicaliseProfileUrl((_data && _data.username) || "");
  }

  function renderProfilePageBody() {
    var body = document.getElementById("profilePageBody");
    if (!body) return;
    body.classList.add("cmp-profile-host");
    if (_profilePage.self) { _ppPlaylists = null; renderSelfProfilePage(); return; }
    if (_profilePage.data) {
      body.innerHTML = compactProfileViewHtml(_profilePage.data);
      _ppPlaylists = _profilePage.data.playlists || [];
      var fg = document.getElementById("pvFavGrid");
      if (fg) renderFavRows(_profilePage.data.favorites || [], false, fg);
      bindPvFavGrid(fg);
      bindPvPls();
      if (window.userMenu && window.userMenu.profileRendered) window.userMenu.profileRendered(_profilePage.data);
      canonicaliseProfileUrl(_profilePage.data.handle || (_profilePage.data.profile && _profilePage.data.profile.username) || "");
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
        body.innerHTML = compactProfileViewHtml(d);
        _ppPlaylists = d.playlists || [];
        var fg = document.getElementById("pvFavGrid");
        if (fg) renderFavRows(d.favorites || [], false, fg);
        bindPvFavGrid(fg);
        bindPvPls();
        if (window.userMenu && window.userMenu.profileRendered) window.userMenu.profileRendered(d);
        canonicaliseProfileUrl(d.handle || (d.profile && d.profile.username) || "");
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
      var info = e.target.closest("[data-trackinfo]");
      if (info) { var ii = parseInt(info.getAttribute("data-trackinfo"), 10); if (!isNaN(ii) && window.showTrackInfo) window.showTrackInfo(ii); return; }
      if (e.target.closest(".fav-like")) return;
      var play = e.target.closest("[data-play-idx]");
      if (play) {
        var idx = parseInt(play.getAttribute("data-play-idx"), 10);
        if (!isNaN(idx) && idx >= 0 && window.selectTrackFromList) { window.selectTrackFromList(idx); if (window.showDeckPlayer) window.showDeckPlayer(); }
      }
    });
  }
  /* ---------- Profile addresses ----------
   *
   * A member's profile lives at /@handle - for example /@lightsky1356.
   * The handle is the member's Discord username/name. A site uid is never
   * put in the address: nobody can recognise or type one, and it changes when
   * an account is replaced. /Profile stays the way into your own profile.
   *
   * The address is written in one place and read in one place, because the
   * two drifting apart is how a shared link stops working. */
  var PROFILE_PATH_ROOT = "/Profile";
  var PROFILE_HANDLE_PREFIX = "/@";

  /* The song pages: /song/<the-song>.
   *
   * A song's address carries its name, so it cannot live in the table of
   * routes - that holds one address per page, and there are three hundred
   * songs. It is read here instead, the way a profile's address is. */
  /* /songs/<the song> — both /songs and the old /song addresses are read,
     so links made before the rename keep working. The song page tells the
     reader what to do if the address doesn't match anything in the vault. */
  var SONG_PATH_ROOT = "/songs";
  var SONG_PATH_LEGACY = "/song";
  function parseSongPath(pathname) {
    var p = String(pathname || "").replace(/\/+$/, "");
    if (!p) return null;
    var roots = [SONG_PATH_ROOT, SONG_PATH_LEGACY];
    for (var i = 0; i < roots.length; i++) {
      var m = new RegExp("^" + roots[i] + "(/(.+))?$", "i").exec(p);
      if (!m) continue;
      return { slug: m[2] ? decodeURIComponent(m[2]).toLowerCase() : "" };
    }
    return null;
  }

  function profilePathFor(handle) {
    return PROFILE_HANDLE_PREFIX + encodeURIComponent(String(handle || "").replace(/^@/, ""));
  }
  window.profilePathFor = profilePathFor;

  /* Read a profile address back. Returns null when the path is not a profile
   * address, { self: true } for /Profile, and { key: ... } for a /@handle. */
  function parseProfilePath(pathname) {
    var p = String(pathname || "").replace(/\/+$/, "");
    if (!p) return null;
    if (new RegExp("^" + PROFILE_PATH_ROOT + "$", "i").test(p)) return { self: true };
    var m = new RegExp("^/@(.+)$", "i").exec(p);
    if (!m) return null;
    return { key: decodeURIComponent(m[1]) };
  }

  /* Put the canonical address in the bar once the profile is known, so the link
   * somebody copies is one that can be typed. replaceState, not pushState:
   * this is the same page, made addressable. */
  function canonicaliseProfileUrl(username) {
    if (!username) return;
    try {
      var want = profilePathFor(username);
      if (location.pathname === want) return;
      if (history.replaceState) history.replaceState({ profile: username }, "", want);
    } catch (e) {}
  }

  /* The address, read from one place, for the files that need to know whether
   * a profile is being viewed and whose it is. Seven files asked this question
   * with their own copy of the path pattern, which is how a profile address
   * change breaks the pages around it one at a time. */
  window.profilePathKey = function () {
    var p = parseProfilePath(location.pathname);
    if (!p || p.self) return "";
    return String(p.key || "").replace(/^@/, "");
  };
  window.isOtherProfilePath = function () {
    return window.profilePathKey() !== "";
  };

  window.openProfile = function (user, byDiscord) {
    var target = String(user == null ? "" : user).trim().replace(/^@/, "");
    if (!target || String(target) === String(uid)) {
      if (!uid) { if (window.switchAppPage) switchAppPage("account"); toast(_tt("toastSignInProfile", "Sign in to view your profile"), "info"); return; }
      _profilePage.self = true; _profilePage.key = ""; _profilePage.byDiscord = false; _profilePage.data = null;
      /* The address must be in place BEFORE the page is shown: the profile
         module reads location.pathname to decide whose data to fetch. Doing it
         the other way round rendered the previous member's name and stats. */
      try { if (history.pushState) history.pushState({ profile: true }, "", PROFILE_PATH_ROOT); } catch (e) {}
      if (window.switchAppPage) switchAppPage("profile");
      return;
    }
    _profilePage.self = false; _profilePage.byDiscord = !!byDiscord; _profilePage.data = null;
    /* A Discord id is not a handle. Links from the community board, wanted
       vault and chat carry one with data-profile-discord="1"; looking it up
       as a username showed an empty placeholder profile. Resolve it to the
       member's handle first, then address it like any other profile. */
    function openResolved(key) {
      _profilePage.key = key;
      try { if (history.pushState) history.pushState({ profile: key }, "", profilePathFor(key)); } catch (e) {}
      if (window.switchAppPage) switchAppPage("profile");
    }
    if (byDiscord) {
      fetch("/api/profile?discord=" + encodeURIComponent(target), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) { openResolved((d && d.handle) || target); })
        .catch(function () { openResolved(target); });
      return;
    }
    openResolved(target);
  };
window.profileSectionShown = function () {
    renderProfilePageBody();
  };
  window.addEventListener("popstate", function () {
    var p = parseProfilePath(location.pathname);
    if (!p) return;
    if (p.self) { if (window.openProfile) window.openProfile(); }
    else if (window.openProfile) window.openProfile(p.key);
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
          if (a) a.innerHTML = '<img decoding="async" src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
          toast(_tt("toastProfileUpdated", "Profile updated"), "success");
        });
        avFile.value = "";
      });
    }
  })();

  /* ---------- Danger zone ---------- */
  /* Deleting an account is irreversible, so the settings page never does it.
     The person has to type their own username to unlock the button, and the
     button opens a panel that hands them to the server and the form. */
  function delMatch(val, uname) {
    var v = String(val || "").trim().toLowerCase();
    var u = String(uname || "").trim().toLowerCase();
    return !!(v && (v === u || v === ("@" + u)));
  }

  /* The account arrives after the page binds, so the username is resolved on
     demand rather than captured once at boot - that was why the old version
     compared against one hard-coded name and never unlocked for anyone else. */
  function myDeleteName() {
    var u = profileUsername();
    if (!u && _data) u = (_data.profile && _data.profile.name) || ((_data.account && _data.account.name) || "");
    if (!u && _profile) u = _profile.username || _profile.name || "";
    if (!u) { try { u = JSON.parse(localStorage.getItem("wantedAuthUser") || "{}").username || ""; } catch (e) {} }
    return String(u || "").trim();
  }

  function refreshDangerZone() {
    var input = document.getElementById("delTyped");
    var btn = document.getElementById("deleteAccountBtn2");
    var hint = document.getElementById("delUsername");
    var err = document.getElementById("delError");
    var who = document.querySelector("[data-del-who]");
    if (!input || !btn) return;
    var mine = myDeleteName();
    var shown = mine ? "@" + mine : "@your-username";
    if (hint) hint.textContent = shown;
    if (who) who.textContent = mine ? "@" + mine : "your account";
    input.placeholder = shown;
    /* a name change must not leave a stale unlock behind */
    if (!delMatch(input.value, mine)) { input.value = ""; btn.disabled = true; }
    if (err) err.style.display = "none";
  }

  function bindDanger() {
    var input = document.getElementById("delTyped");
    var btn = document.getElementById("deleteAccountBtn2");
    var err = document.getElementById("delError");
    if (!input || !btn) return;
    refreshDangerZone();

    input.addEventListener("input", function () {
      var match = delMatch(input.value, myDeleteName());
      btn.disabled = !match;
      if (err) err.style.display = (input.value || "").trim() && !match ? "" : "none";
    });

    /* Unlocked: open the panel. Nothing is sent anywhere from here. */
    btn.addEventListener("click", function () {
      if (!delMatch(input.value, myDeleteName())) return;
      refreshDangerZone();
      input.value = "";
      btn.disabled = true;
      openModal("deleteModal");
    });
  }

  /* ---------- Modals ---------- */
  var EDITOR_HOME = null;
  /* The editor is relocated into the modal when it opens and back into the
     inline Settings pane when it closes, so both surfaces render the same DOM
     with the same state. */
  function placeEditor(where) {
    var wrap = document.getElementById("profileEditor");
    if (!wrap) return;
    if (where === "modal") {
      EDITOR_HOME = wrap.parentNode;
      var mount = document.getElementById("editProfileMount");
      if (mount) mount.appendChild(wrap);
    } else if (EDITOR_HOME) {
      EDITOR_HOME.appendChild(wrap);
    }
  }
  function openModal(id) { var el = document.getElementById(id); if (el) el.classList.add("open"); }
  function closeModal(id) {
    var el = document.getElementById(id); if (el) el.classList.remove("open");
    if (id === "editProfileModal") placeEditor("home");
    /* setModalOpen() locked the page when the modal opened - release that lock
       once no modal is left open, otherwise the profile stays frozen. */
    try { if (!document.querySelector(".modal-overlay.open")) document.body.style.overflow = ""; } catch (e) {}
  }
  function bindModals() {
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close")); });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(ov.id); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        document.querySelectorAll(".modal-overlay.open").forEach(function (ov) { closeModal(ov.id); });
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
      loadAccountNow();
    });
  }

  /* ---------- Real-time polling ---------- */
  function startPolling() {
    stopPolling();
    /* Every two minutes rather than every forty-five seconds. It is
       there to keep the activity list and the unread count fresh, and
       neither of those changes by the second. */
    _pollTimer = setInterval(function () {
      if (_visible && uid && !document.hidden) loadAccount();
    }, 120000);
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

  /* ---------- Appearance: era tiles, accent, black bg, moving colours ---------- */
  function hexOk(s) { return /^#[0-9a-fA-F]{6}$/.test(String(s || "").trim()); }
  function settingsGet(k, d) { try { var v = window.wrldPlayerSettings && window.wrldPlayerSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } }
  function settingsSet(k, v) { try { window.wrldPlayerSettings && window.wrldPlayerSettings.set(k, v); } catch (e) {} }


  function applyAppearanceThemeValue(v) {
    var wanted = v === "auto" ? "default" : v;
    var wasWearing = document.documentElement.getAttribute("data-theme") || "";
    if (wasWearing && wasWearing !== wanted) {
      /* One path for picking: the tile, a seasonal tile, the go-back chip.
         thwPrevTheme hands out what the member was wearing before. */
      try { localStorage.setItem("thwPrevTheme", wasWearing); } catch (_) {}
    }
    document.dispatchEvent(new CustomEvent("thw-theme-change", {
      detail: { from: wasWearing, to: wanted },
    }));
    /* Member themes load their generated sheet before or with the paint. */
    ensureMemberThemeCss(wanted);
    document.documentElement.style.removeProperty("--th-bg");
    document.documentElement.style.removeProperty("--th-accent");
    document.documentElement.style.removeProperty("--th-accent2");
    var prev = _themeTarget.getAttribute("data-theme") || "default";
    var name = themeName(wanted);
    var failMsg = _tt("toastThemeFailed", "Couldn't save theme");

    applyTheme(wanted);
    try { if (window.thwAppearanceThemeApplied) window.thwAppearanceThemeApplied(wanted); } catch (e) {}
    syncSeasonalThemes(wanted);

    /* Signed in: this is your account's theme and it lives on the server.
       Only a guest (no account) changes the device theme. */
    if (isSignedInNow()) {
      /* The theme is already on screen because it is local CSS, but for an
         account it is not real until the server has it. So the confirmation
         waits for the save rather than claiming success up front, and a
         failed save puts the old theme back - otherwise the page and the
         account disagree and the change silently vanishes on next load. */
      api({ action: "saveTheme", theme: wanted }).then(function (d) {
        if (d && d.ok) { loadAccountNow(); toast(themeChangedMsg(name), "success"); return; }
        applyTheme(prev); syncSeasonalThemes(prev);
        try { if (window.thwAppearanceThemeApplied) window.thwAppearanceThemeApplied(prev); } catch (e) {}
        toast(failMsg, "error");
      }).catch(function () {
        applyTheme(prev); syncSeasonalThemes(prev);
        try { if (window.thwAppearanceThemeApplied) window.thwAppearanceThemeApplied(prev); } catch (e) {}
        toast(failMsg, "error");
      });
      return prev;
    }

    try {
      localStorage.setItem("wantedTheme", wanted);
      toast(themeChangedMsg(name), "success");
    } catch (e) {
      /* Private mode, storage disabled, quota - the theme is on screen but
         will not survive a reload, so say so and put it back. */
      applyTheme(prev); syncSeasonalThemes(prev);
      try { if (window.thwAppearanceThemeApplied) window.thwAppearanceThemeApplied(prev); } catch (e) {}
      toast(failMsg, "error");
    }
    return prev;
  }

  /* Tiles are the source of truth; this mirrors the worn theme onto them. */
  window.thwAppearanceThemeApplied = function (v) {
    document.documentElement.style.removeProperty("--th-bg");
    document.documentElement.style.removeProperty("--th-accent");
    document.documentElement.style.removeProperty("--th-accent2");
    /* The playing song only drives the page under Auto ("default"). */
    try { if (window.thwPaintAmbientSync) window.thwPaintAmbientSync(v); } catch (e) {}
    /* Tiles express: Auto / era / seasonal / the 32 built-ins. A built-in
       theme wearing the page (aurora and friends) reads as Auto - it is the
       page's own colours, which is what the Auto definition says. */
    var picks = "auto era-jute era-aff era-hih era-jw999 era-bdm era-nd era-gbgr era-wod era-drfl era-out era-post default violet embers obsidian aurora sakura ocean royal neon blood storm forest sunset ice candy matrix cyber gold galaxy lava toxic rose oled ultraviolet pharaoh dragon mint tangerine grape pumpkin silver midnight newyear valentines stpatricks easter july4 halloween thanksgiving christmas".split(" ");
    document.querySelectorAll('input[name="appearanceTheme"]').forEach(function (r) {
      r.checked = (r.value === v) || (v === "default" && r.value === "auto") || (picks.indexOf(v) === -1 && r.value === "auto");
    });
  };

  function bindAppearanceSettings() {
    var tiles = document.querySelectorAll('input[name="appearanceTheme"]');
    Array.prototype.forEach.call(tiles, function (radio) {
      radio.addEventListener("change", function () { applyAppearanceThemeValue(this.value); });
    });

    var motion = document.getElementById("appearanceMotion");
    if (motion) {
      motion.checked = settingsGet("movingColors", true) !== false;
      motion.addEventListener("change", function () {
        settingsSet("movingColors", this.checked);
        if (this.checked) document.documentElement.removeAttribute("data-motion");
        else document.documentElement.setAttribute("data-motion", "still");
        /* theme-drift.js checks the flag at frame time; force the drift to
           pick it up on the next frame instead of after a repaint. */
        try { window.dispatchEvent(new Event("thw:appearance-changed")); } catch (e) {}
      });
    }

    /* One palette picker owns how the playing cover becomes the theme. */
    function repaintAuto() {
      try {
        if (window.thwPaintAmbientSync) window.thwPaintAmbientSync(document.documentElement.getAttribute("data-theme") || "default");
        else window.paintAutoTheme();
      } catch (e) {}
      try { window.dispatchEvent(new Event("thw:appearance-changed")); } catch (e) {}
    }

    var colorCount = document.getElementById("coverColorCount");
    if (colorCount) {
      colorCount.value = String(Number(settingsGet("coverColorCount", 0)) || 0);
      colorCount.addEventListener("change", function () {
        settingsSet("coverColorCount", Number(this.value) || 0);
        repaintAuto();
      });
    }

    var driftSel = document.getElementById("coverDrift");
    if (driftSel) {
      driftSel.value = settingsGet("coverDrift", "normal") || "normal";
      driftSel.addEventListener("change", function () {
        settingsSet("coverDrift", this.value);
        repaintAuto();
      });
    }

    var covers = document.querySelectorAll('input[name="appearanceCovers"]');
    Array.prototype.forEach.call(covers, function (r) {
      r.checked = (r.value === settingsGet("coversPref", "song"));
      r.addEventListener("change", function () {
        if (this.checked) {
          settingsSet("coversPref", this.value);
          try { window.dispatchEvent(new Event("thw:appearance-changed")); } catch (e) {}
        }
      });
    });

    var keepQueue = document.getElementById("pbKeepQueueToggle");
    if (keepQueue) {
      keepQueue.checked = settingsGet("replaceQueue", false) !== true;
      keepQueue.addEventListener("change", function () {
        settingsSet("replaceQueue", !this.checked);
        toast(this.checked ? _tt("toastQueueKept", "Your queue stays when you pick a song") : _tt("toastQueueCleared", "Picking a song clears the queue"), "info", 2200);
      });
    }

    /* reflect stored prefs into the tile UI */
    var cur = document.documentElement.getAttribute("data-theme") || "default";
    window.thwAppearanceThemeApplied(cur);
    var coversNow = settingsGet("coversPref", "song");
    Array.prototype.forEach.call(document.querySelectorAll('input[name="appearanceCovers"]'), function (r) { r.checked = (r.value === coversNow); });

    var cards = document.getElementById("suggestionCardsToggle");
    if (cards) {
      cards.checked = settingsGet("suggestionCards", true) !== false;
      cards.addEventListener("change", function () {
        settingsSet("suggestionCards", this.checked);
        if (!this.checked) removeSuggestionCard();
        else armSuggestionCard();
      });
    }
    armSuggestionCard();
  }

  /* ---------- Suggestion cards ---------- */
  function suggestionCardsAllowed() {
    try { return settingsGet("suggestionCards", true) !== false; } catch (e) { return true; }
  }
  function removeSuggestionCard() {
    var card = document.getElementById("thwSuggestCard");
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }
  var _sugTimer = null;
  function armSuggestionCard() {
    if (_sugTimer) { clearTimeout(_sugTimer); _sugTimer = null; }
    if (!suggestionCardsAllowed()) return;
    var last = 0;
    try { last = parseInt(localStorage.getItem("wrldSuggestCardAt") || "0", 10) || 0; } catch (e) {}
    if (Date.now() - last < 3 * 24 * 60 * 60 * 1000) return; /* at most one every three days */
    try { if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return; } catch (e) {}
    _sugTimer = setTimeout(showSuggestionCard, 45000);
  }
  function showSuggestionCard() {
    if (!suggestionCardsAllowed()) return;
    if (document.getElementById("thwSuggestCard")) return;
    var card = document.createElement("div");
    card.id = "thwSuggestCard";
    card.className = "thw-suggest-card";
    card.innerHTML =
      '<span class="thw-suggest-copy"><b>' + esc("Put TheHighWRLD Dashboard on your home screen") + '</b>' +
      '<span>' + esc("TheHighWRLD Dashboard opens up as an app, with no address bar getting in the way.") + '</span></span>' +
      '<span class="thw-suggest-actions">' +
        '<button type="button" class="thw-suggest-never">' + esc("Not now") + '</button>' +
        '<button type="button" class="thw-suggest-yes">' + esc("Show me") + '</button>' +
      '</span>';
    card.querySelector(".thw-suggest-never").addEventListener("click", function () {
      try { localStorage.setItem("wrldSuggestCardAt", String(Date.now())); } catch (e) {}
      removeSuggestionCard();
    });
    card.querySelector(".thw-suggest-yes").addEventListener("click", function () {
      removeSuggestionCard();
      if (window.switchAppPage) window.switchAppPage("downloads");
      try { localStorage.setItem("wrldSuggestCardAt", String(Date.now())); } catch (e) {}
    });
    document.body.appendChild(card);
  }

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
  bindNotificationPrefs();
  bindNotifBubbles();
  bindAccountActions();
  bindNotifications();
  bindListenTracking();
  bindPlaybackSettings();
  bindPrivacySettings();
  bindAppearanceSettings();

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
    /* Which panels are folded is remembered, so the page comes back the way it
       was left. Stored as {sectionId: 0|1}; a panel only takes the stored
       answer when it has one, so a section that ships folded stays folded. */
    var KEY = "ac_collapsed_panels";
    var saved = {};
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (raw && typeof raw === "object") saved = raw;
    } catch (e) {}
    var remember = function (id, collapsed) {
      saved[id] = collapsed ? 1 : 0;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
    };
    function makeToggle(el, owner) {
      if (el.dataset.collapseBound) return;
      el.dataset.collapseBound = "1";
      el.classList.add("ac-head-toggle");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      var chev = document.createElement("i");
      chev.className = "fas fa-chevron-up ac-coll-chev";
      el.appendChild(chev);
      var id = owner.id || "";
      if (id && Object.prototype.hasOwnProperty.call(saved, id)) owner.classList.toggle("collapsed", !!saved[id]);
      function paint() {
        var collapsed = owner.classList.contains("collapsed");
        el.setAttribute("aria-expanded", collapsed ? "false" : "true");
        chev.className = "fas fa-chevron-" + (collapsed ? "down" : "up") + " ac-coll-chev";
      }
      paint();
      function toggle() {
        owner.classList.toggle("collapsed");
        paint();
        if (id) remember(id, owner.classList.contains("collapsed"));
      }
      el.addEventListener("click", function (e) {
        if (e.target.closest("button,a,input,select,textarea")) return;
        toggle();
      });
      el.addEventListener("keydown", function (e) {
        if ((e.key !== "Enter" && e.key !== " ") || e.target !== el) return;
        e.preventDefault();
        toggle();
      });
    }
    root.querySelectorAll(".ac-collapsible").forEach(function (sec) {
      var head = sec.querySelector(".sec-head");
      if (head) makeToggle(head, sec);
    });
    root.querySelectorAll(".ac-set-collapsible").forEach(function (card) {
      var title = card.querySelector(".set-title");
      if (title) makeToggle(title, card);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    /* The session is the truth: if localStorage wantedUserId points at a
       stale or different account, correct it once before anything downstream
       reads it. A single guarded reload lands the whole account on the right
       session instead of flashing an empty/wrong account. */
    try { uid = localStorage.getItem("wantedUserId") || ""; } catch (e) {}
    try {
      fetch("/api/users/me", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (d) {
        var sessionUid = d && d.ok && d.signedIn && d.uid ? String(d.uid) : "";
        if (sessionUid && sessionUid !== uid) {
          try { localStorage.setItem("wantedUserId", sessionUid); } catch (e) {}
          uid = sessionUid;
          try {
            if (sessionStorage.getItem("ac_session_sync_done")) return;
            sessionStorage.setItem("ac_session_sync_done", "1");
            location.reload();
          } catch (e) {
            if (window.renderProfilePageBody) { try { window.renderProfilePageBody(); } catch (e) {} }
          }
        }
      });
    } catch (e) {}
    /* Always on, signed in or not. A guest cannot have personal notifications,
       but announcements are public and live in the bell now, so the bell is how
       a visitor finds one.
       This also kicks the announcement fetch for guests. applyNotifications() -
       which pulls /api/announcements in through refreshCommNotifs() - is
       otherwise only reached from the account-loading path, and that needs a
       session. Without this, a guest's bell would open onto an empty list. */
    setNotifBell(true);
    refreshCommNotifs();
    applyTheme(_cachedTheme);
    try { document.documentElement.lang = _lang; } catch (e) {}
    /* Actually translate the page on load.

       This used to happen only inside applyThemeLang(), which is called from
       renderAll(), and renderAll() only runs when /api/account comes back ok -
       which it never does for a guest. A guest's chosen language was therefore
       ignored on every reload: _lang was read from storage correctly and
       documentElement.lang was set correctly, and then all 110 data-i18n
       elements were left in English. Setting the attribute without translating
       is precisely what made it look right and be wrong.

       applySiteI18n only rewrites textContent and placeholder, so it is safe
       here and does not depend on the account load that follows it. */
    if (window.applySiteI18n) window.applySiteI18n(_lang);
    bindCollapseTabs();
    bindSectionCollapse();
    buildSidebar();
    try { if (window.initOwnerOverlay) window.initOwnerOverlay(); } catch (e) {}
    if (!window.__profileLinkBound) {
      window.__profileLinkBound = true;
      document.addEventListener("click", function (e) {
        var pv = (e.target && e.target.closest) ? e.target.closest(".pv-top[data-play-idx]") : null;
        if (pv) {
          var pi2 = parseInt(pv.getAttribute("data-play-idx"), 10);
          if (!isNaN(pi2) && pi2 >= 0 && window.selectTrackFromList) { window.selectTrackFromList(pi2); if (window.showDeckPlayer) window.showDeckPlayer(); }
          return;
        }
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
      // Fail closed. The owner flags and wantedUserId above survive a sign-out,
      // and both failure paths used to call show(), so an offline or throwing
      // request could hand a signed-out visitor the Owner Dashboard.
      if (!uid || !claimsOwner || !isSignedInNow()) { hide(); return; }
      try {
        fetch("/api/wanted?user=" + encodeURIComponent(uid), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.owner && isSignedInNow()) { show(); }
          else {
            hide();
            try { localStorage.removeItem("ownerCode"); localStorage.removeItem("ownerByUser"); } catch (e) {}
          }
        }).catch(function () { hide(); });
      } catch (e) { hide(); }
    })();
    if (uid) loadAccount();
    wrapSwitchAppPage();
    wireFooterLinks();
    var ppath = (location.pathname || "").replace(/\/+$/, "") || "/";
    var profilePath = parseProfilePath(ppath);
    if (profilePath && profilePath.self) { if (window.openProfile) window.openProfile(); }
    else if (profilePath) { if (window.openProfile) window.openProfile(profilePath.key); }
    else {
      var songPath = parseSongPath(ppath);
      if (songPath && window.openSongPage) {
        window.switchAppPage("song");
        window.openSongPage(songPath.slug, true);
      } else {
        var bootPage = NAV_URL_REV[ppath];
        /* An unrecognised path used to fall through and leave whatever the boot
           timer last showed on screen. It resolves to home instead, so this hook is
           the single thing that decides what a cold load shows. /era/<slug> routes
           into the era page with its own open handler. */
        var mEraRoute = ppath.match(/^\/era\/([^\/]+)\/?$/i);
        if (mEraRoute && window.openEraPage) {
          try { window.openEraPage(decodeURIComponent(mEraRoute[1])); return; } catch (e) {}
        }
        if (window.switchAppPage) window.switchAppPage(bootPage || "home");
      }
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
  /* about and partner were briefly routed by a separate router.js before this was
   found: this map already is the site's one routing table, and a second table
   meant two sources of truth for the same job. _navPillFor already resolves both
   to their real nav buttons (page-nav-about, page-nav-partner), so nothing else
   needed changing to highlight them. */
var NAV_URL = { home: "/",  developers: "/developers", player: "/player", hub: "/vault", wanted: "/wanted", suggestions: "/suggestions", roadmap: "/roadmap", account: "/settings", owner: "/owner", tos: "/TOS", pp: "/PP", dmca: "/DMCA", copyright: "/Copyright", about: "/about", partner: "/partner", gallery: "/gallery", credits: "/credits", downloads: "/downloads", failed: "/failed", login: "/login", register: "/register", era: "/era", leaderboard: "/leaderboard", stats: "/stats", updates: "/updates", tracker: "/tracker", messages: "/messages" };
  var NAV_URL_REV = {};
  Object.keys(NAV_URL).forEach(function (k) { NAV_URL_REV[NAV_URL[k]] = k; });
  /* The router, for a link that has to be a link but must not reload the
   * page. It answers whether the address is one of ours, and puts the page
   * on the screen if it is. */
  window.__thwGoTo = function (path) {
    var p = String(path || "").replace(/\/+$/, "") || "/";
    var page = NAV_URL_REV[p];
    if (!page) return false;
    if (typeof window.switchAppPage === "function") window.switchAppPage(page);
    return true;
  };
  /* The links in the footer are handled here, in one place: a plain click
   * on one of them draws the page, and anything else - a new tab, a middle
   * click, a link to somewhere else - is left to the browser. */
  function wireFooterLinks() {
    var foot = document.querySelector("footer.foot");
    if (!foot || foot._linksWired) return;
    foot._linksWired = true;
    foot.addEventListener("click", function (e) {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !foot.contains(a)) return;
      var href = a.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      if (window.__thwGoTo(url.pathname)) e.preventDefault();
    });
  }
  function _navTabFor(page) {
    if (page === "player") return "player";
    if (page === "hub") return "vault";
    if (page === "wanted" || page === "suggestions") return "community"; if (page === "roadmap") return "roadmap"; if (page === "credits") return "community";
    if (page === "account") return "settings";
    if (page === "profile") return "profile";
    if (page === "owner") return "owner";
    return "lobby";
  }
  function _navPillFor(page) {
    if (page === "wanted" || page === "suggestions") return "";
    if (page === "profile" || page === "account" || page === "owner") return "";
    /* These have no button in the nav bar at all - Gallery and Downloads are
       reached from elsewhere in the vault, Failed Projects from its own card, and
       the sign-in button is navPillAuthBtn rather than a page-nav-* id. Returning
       "" hides the pill deliberately, instead of relying on getElementById
       returning null for a button that was never there. */
    if (page === "gallery") return "page-nav-gallery";
    if (page === "credits") return "page-nav-credits";
    if (page === "downloads" || page === "failed" || page === "login" || page === "register" || page === "tracker" || page === "developers") return "";
    if (page === "tos" || page === "pp" || page === "dmca" || page === "copyright") return "page-nav-home";
    return "page-nav-" + page;
  }
  /* Detail breadcrumb for second-level screens (e.g. Era detail) */
  window.__thwSetCrumbDetail = function (detail, parentText, parentHref) {
    try {
      var root = document.getElementById("bc-root");
      var sep = document.getElementById("bc-sep-detail");
      var cur = document.getElementById("bc-detail");
      if (!detail) {
        if (root) { root.classList.remove("bc-root-current"); }
        if (sep) sep.style.display = "none";
        if (cur) cur.style.display = "none";
        return;
      }
      if (root) { root.textContent = parentText || "Era Pages"; root.href = parentHref || "/era"; root.classList.remove("bc-root-current"); root.style.display = "inline"; }
      if (sep) sep.style.display = "inline";
      if (cur) { cur.textContent = String(detail).slice(0, 80); cur.style.display = "inline"; }
    } catch (_) {}
  };
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
    if (pillId === "") {
      /* No nav pill exists for this page - it lives in the More menu instead.
         Only hide the pill bubble, but keep the rest of the state (nav button,
         breadcrumb, render) in sync; the tail of this function must still run. */
      _moveNavBubble(null);
    } else {
      var pill = document.getElementById(pillId);
      if (pill) pill.classList.add("active");
      _moveNavBubble(pill);
    }

    /* Breadcrumb — Home > Page on every non-home page */
    var bc = document.getElementById("app-breadcrumb");
    if (bc) {
      if (page === "stats" && typeof window.renderStatsPage === "function") { try { window.renderStatsPage(); } catch (e) {} }
    if (page === "updates" && typeof window.renderUpdatesPage === "function") { try { window.renderUpdatesPage(); } catch (e) {} }
    if (page === "tracker" && typeof window.renderTrackerPage === "function") { try { window.renderTrackerPage(); } catch (e) {} }
    var labels = { player: "WRLD Player", hub: "The Vault", era: "Era Pages", leaderboard: "Leaderboard", stats: "Stats", updates: "Updates", tracker: "The Tracker", messages: "Messages", developers: "Public API", wanted: "Wanted Vault", suggestions: "Suggestions", "community-themes": "Community Themes", downloads: "Downloads", failed: "Failed Projects", credits: "Covers", gallery: "Gallery", roadmap: "Roadmap", about: "About the project", partner: "Partnership", tos: "Terms of Service", pp: "Privacy Policy", dmca: "Copyright & DMCA", copyright: "Copyright", settings: "Account Settings", profile: "Profile", account: "Account Settings", "account-gate": "Sign In", register: "Register", login: "Sign In", song: "Track", owner: "Owner Dashboard" };
      var label = labels[page];
      var bcRoot = bc.querySelector("#bc-root");
      var bcSepDetail = bc.querySelector("#bc-sep-detail");
      var bcDetail = bc.querySelector("#bc-detail");
      if (label) {
        if (bcRoot) {
          var navURL = (typeof NAV_URL !== "undefined" && NAV_URL[page]) || "/";
          bcRoot.textContent = label;
          bcRoot.href = navURL;
          bcRoot.style.display = "inline";
        }
        if (bcSepDetail) bcSepDetail.style.display = "none";
        if (bcDetail) bcDetail.style.display = "none";
        bc.style.display = "flex";
        bc.classList.add("visible");
        if (document.body) document.body.classList.add("bc-visible");
      } else {
        bc.classList.remove("visible");
        if (document.body) document.body.classList.remove("bc-visible");
        if (page === "home") bc.style.display = "none";
      }
    }
  }
  /* Signed out: the sidebar keeps Appearance / Playback / Notifications
     only, and the same is true of the page itself. data-signed-in marks
     everything that belongs to an account - sidebar entries, whole
     sections, the preference rows - and one loop hides them. The guest
     banner explains what still works and why. */
  function applyGuestSettingsView() {
    var signedIn = false;
    try { signedIn = !!localStorage.getItem("wantedAuthUser"); } catch (e) {}
    var banner = document.getElementById("acGuestBanner");
    if (banner) {
      if (signedIn) banner.setAttribute("hidden", "");
      else banner.removeAttribute("hidden");
    }
    var els = document.querySelectorAll("[data-signed-in]");
    for (var i = 0; i < els.length; i++) els[i].style.display = signedIn ? "" : "none";
    var guestNote = document.getElementById("notifGuestBlock");
    if (guestNote) guestNote.style.display = signedIn ? "none" : "";
    /* Guests have no Profile panel to anchor the active nav entry to. */
    if (!signedIn) {
      var nav = document.querySelector(".set-nav");
      if (nav) {
        nav.querySelectorAll(".set-nav-item").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-set-tab") === "appearance");
        });
      }
    }
  }

  function wrapSwitchAppPage() {
    var base = window.switchAppPage;
    if (typeof base !== "function") return;
    window.switchAppPage = function (page) {
      var wasRegister = (page === "register");
      if (page === "settings") page = "account";
      if (page === "register") page = "login";
      if (page === "account") { try { applyGuestSettingsView(); } catch (e) {} }
      base(page);
      _applyNavState(page);
      var url = NAV_URL[page];
      if (url && (location.pathname || "").replace(/\/+$/, "") !== url) {
        try { history.pushState({ page: page }, "", url); } catch (e) {}
      }
      if (wasRegister) {
        try { if (typeof window.__showLoginTab === "function") window.__showLoginTab("register"); } catch (e) {}
      }
    };
  }
  window.addEventListener("popstate", function () {
    var p = (location.pathname || "").replace(/\/+$/, "") || "/";
    if (parseProfilePath(p)) return;
    var song = parseSongPath(p);
    if (song && window.openSongPage) { window.openSongPage(song.slug, true); return; }
    var page = NAV_URL_REV[p];
    if (page && window.switchAppPage) window.switchAppPage(page);
  });

  function bindPlaybackSettings() {
    /* Single-key shortcuts — mirror of the deck shortcut and the settings gear menu. */
    var pbKb = document.getElementById("pbKeyboardShortcutsToggle");
    if (pbKb) {
      try { pbKb.checked = window.wrldPlayerSettings && window.wrldPlayerSettings.get("keyboardShortcuts") !== false; } catch (e) {}
      pbKb.addEventListener("change", function () {
        try { window.wrldPlayerSettings && window.wrldPlayerSettings.set("keyboardShortcuts", this.checked); } catch (e) {}
        try { if (typeof window.showToast === "function") window.showToast(this.checked ? _tt("toastShortcutsOn", "Keyboard shortcuts on") : _tt("toastShortcutsOff", "Keyboard shortcuts are off - enable them in Player Settings"), "success", 1800); } catch (e) {}
      });
    }
    /* Autoplay similar songs — when the queue is empty and shuffle is off,
       stay inside the current era instead of marching through the vault. */
    var pbAuto = document.getElementById("pbAutoplayToggle");
    if (pbAuto) {
      try { pbAuto.checked = !!(window.wrldPlayerSettings && window.wrldPlayerSettings.get("autoplaySimilar")); } catch (e) {}
      pbAuto.addEventListener("change", function () {
        try { window.wrldPlayerSettings && window.wrldPlayerSettings.set("autoplaySimilar", this.checked); } catch (e) {}
      });
    }
    /* Resume where you left off — the player-settings.js module owns the
       save/restore; here it is just the switch. */
    var pbResume = document.getElementById("pbResumeToggle");
    if (pbResume) {
      try { pbResume.checked = !!(window.wrldPlayerSettings && window.wrldPlayerSettings.get("resumeLast")); } catch (e) {}
      pbResume.addEventListener("change", function () {
        try { window.wrldPlayerSettings && window.wrldPlayerSettings.set("resumeLast", this.checked); } catch (e) {}
        if (window.THWResume && window.THWResume.setEnabled) window.THWResume.setEnabled(this.checked);
      });
    }
    /* Pause the audio when the tab is hidden. */
    var pbPauseHidden = document.getElementById("pbPauseHiddenToggle");
    if (pbPauseHidden) {
      try { pbPauseHidden.checked = !!(window.wrldPlayerSettings && window.wrldPlayerSettings.get("pauseOnHidden")); } catch (e) {}
      pbPauseHidden.addEventListener("change", function () {
        try { window.wrldPlayerSettings && window.wrldPlayerSettings.set("pauseOnHidden", this.checked); } catch (e) {}
        if (window.THWResume && window.THWResume.setPauseOnHidden) window.THWResume.setPauseOnHidden(this.checked);
      });
    }
  }

  function bindPrivacySettings() {
    var pub = document.getElementById("privPublicToggle");
    var listen = document.getElementById("privListeningToggle");
    var save = document.getElementById("privacySaveBtn");
    var result = document.getElementById("privacyResult");
    if (!pub && !listen) return;
    /* GET once at boot to mirror /api/privacy; signed-out paths 401 quietly. */
    fetch("/api/privacy", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.privacy) return;
        var p = d.privacy;
        var pubOn = Number(p.show_stats) !== 0 || Number(p.show_playlists) !== 0 || Number(p.show_favorites) !== 0;
        if (pub) pub.checked = pubOn;
        if (listen) listen.checked = Number(p.show_activity) !== 0;
      })
      .catch(function () {});
    if (save) {
      save.addEventListener("click", function () {
        var pubOn = !!(pub && pub.checked);
        var listenOn = !!(listen && listen.checked);
        var payload = {
          show_stats: pubOn ? 1 : 0,
          show_playlists: pubOn ? 1 : 0,
          show_favorites: pubOn ? 1 : 0,
          show_activity: listenOn ? 1 : 0
        };
        fetch("/api/privacy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload)
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (result) { result.textContent = d && d.ok ? "Saved" : "Couldn't save"; result.style.opacity = "1"; }
            if (/(ok)/.test(String(d && d.ok))) { try { if (window.showToast) window.showToast("Privacy saved", "success", 1800); } catch (e) {} }
          })
          .catch(function () {
            if (result) { result.textContent = "Couldn't save"; }
          });
      });
    }
  }
  window.closeAcctMenu = function () {
    var w = document.querySelector(".nav-account-wrap");
    if (w) w.classList.remove("open");
  };
  window.openLegal = function (page) {
    if (page === "tos" || page === "pp" || page === "dmca" || page === "copyright") { if (window.switchAppPage) window.switchAppPage(page); }
  };
})();

/* Account dropdown + avatar sheet — fill the plays/minutes stats from the
   reader's own local play counts, and mirror the live online count into the
   sheet. Nothing leaves the device. */
(function () {
  "use strict";
  function fillStats() {
    function set(total, mins) {
      ["acctMenuPlays", "thwSheetPlays"].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = String(total); });
      ["acctMenuMinutes", "thwSheetMinutes"].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = String(mins); });
    }
    function fillLocal() {
      try {
        var counts = {};
        try { counts = JSON.parse(localStorage.getItem("jw_play_counts") || "{}") || {}; } catch (e2) {}
        var total = 0, secs = 0;
        for (var k in counts) {
          if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
          var idx = Number(k), n = Number(counts[k]) || 0;
          if (!isFinite(idx) || !isFinite(n)) continue;
          total += n;
          try { if (typeof trackList !== "undefined" && trackList && trackList[idx]) secs += (Number(trackList[idx].duration) || 0) * n; } catch (e) {}
        }
        set(total, Math.floor(secs / 60));
      } catch (e) {}
    }
    var uid = "";
    try { uid = localStorage.getItem("wantedUserId") || ""; } catch (_) {}
    if (!uid) { fillLocal(); return; }
    /* Signed-in on this device: read the server's own numbers - the local
       counter is per-device and never matched the server's totals. */
    fetch("/api/account?user=" + encodeURIComponent(uid), { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.stats) { fillLocal(); return; }
        var plays = Number(d.stats.plays) || 0;
        var hours = Number(d.stats.hours) || 0;
        set(plays, Math.floor(hours * 60));
      })
      .catch(fillLocal);
  }
  /* Account dropdown head: current rank, level, XP bar and day streak. */
  function fillRank() {
    function put(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }
    fetch("/api/xp", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var me = d && d.me;
        if (!me) return;
        var level = Number(me.level) || 1, xp = Number(me.xp) || 0;
        put("acctLevel", String(level));
        put("acctRankTitle", typeof window.__thwRankTitle === "function" ? window.__thwRankTitle(level) : "Listener");
        var base = 50 * (level - 1) * (level - 1), next = 50 * level * level;
        var pct = Math.min(100, Math.max(0, Math.round(((xp - base) / Math.max(1, next - base)) * 100)));
        var fill = document.getElementById("acctXpFill");
        if (fill) fill.style.width = pct + "%";
      })
      .catch(function () {});
    fetch("/api/profile", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) { put("acctStreakN", String(Math.max(0, Number(d && d.streak) || 0))); })
      .catch(function () {});
  }
  function mirrorOnline() {
    try {
      var nav = document.getElementById("presence-count");
      var sheet = document.getElementById("thwSheetOnline");
      if (nav && sheet) sheet.textContent = nav.textContent.trim() || "0";
    } catch (e) {}
  }
  function boot() {
    fillStats();
    fillRank();
    mirrorOnline();
    var nav = document.getElementById("presence-count");
    if (nav && window.MutationObserver) {
      try { new MutationObserver(mirrorOnline).observe(nav, { childList: true, characterData: true, subtree: true }); } catch (e) {}
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
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
    /* The section offsets are measured once and then read off the scroll
       position. Asking the browser where nine elements are on every
       scroll frame is asking it to lay the page out again on every
       scroll frame, which is the one thing a scroll is trying not to
       do. They are measured again whenever the page is opened or the
       window changes, because that is when they can have moved. */
    var offsets = null;
    function measureSections() {
      offsets = secs.map(function (el) {
        var r = el.getBoundingClientRect();
        return { el: el, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
      });
    }
    function spy() {
      ticking = false;
      var acc = document.getElementById("page-section-account");
      if (!acc || !acc.classList.contains("active")) return;
      if (!offsets) measureSections();
      var targetY = window.scrollY + 130, best = null, bestD = 1e9;
      for (var i = 0; i < offsets.length; i++) {
        var o = offsets[i];
        if (o.bottom <= 0) continue;
        var d = Math.abs(o.top - targetY);
        if (d < bestD) { bestD = d; best = o.el; }
      }
      setActive(best ? best.id : "");
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { offsets = null; onScroll(); });
    var acc = document.getElementById("page-section-account");
    if (acc && window.MutationObserver) {
      new MutationObserver(function () {
        if (acc.classList.contains("active")) { offsets = null; onScroll(); }
      }).observe(acc, { attributes: true, attributeFilter: ["class"] });
    }
  });
})();
