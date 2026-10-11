(function () {
  "use strict";

  /* ------------------------------------------------------------
   * Global Search UI - System 11 frontend
   * Loaded as <script defer src="./global-search.js"> from index.html
   * - Injects a search trigger + panel into the top nav (defensive;
   *   no-ops gracefully if hooks don't exist).
   * - Queries the verified /api/search endpoint (db: search.js).
   * - Deep-links results into the app using the same globals that
   *   account.js / player-performance.js already expose:
   *     window.switchAppPage(page), window.selectTrackFromList(idx),
   *     window.openProfile(user), window.renderHubPlaylists()
   * ------------------------------------------------------------ */

  var _tt = window._tt || function (k, d) { return d || k; };
  var _q = window.location ? window.location : null;
  var SEARCH_ENDPOINT = (window.APP_SEARCH_ENDPOINT) || "/api/search";
  var _timer = null;
  var _open = false;
  var _lastQ = "";
  var _lastData = null;
  var _scope = "all";

  /* ---------- esc ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------- recent searches (localStorage) ---------- */
  function getRecents() {
    try { return JSON.parse(localStorage.getItem("gs_recent") || "[]"); } catch (e) { return []; }
  }
  function saveRecent(q) {
    try {
      var rc = [q].concat(getRecents().filter(function (x) { return x !== q; })).slice(0, 6);
      localStorage.setItem("gs_recent", JSON.stringify(rc));
    } catch (e) {}
  }
  function hintHTML() {
    var h = '<p class="gs-hint">' + esc(_tt("gsHint", "Type to search the vault, vault-wanted board, community and profiles.")) + '</p>';
    var rc = getRecents();
    if (rc.length) {
      h += '<div class="gs-recent">' + rc.map(function (q) {
        return '<button type="button" class="gs-chip" data-gs-q="' + esc(q) + '">' + esc(q) + '</button>';
      }).join("") + '</div>';
    }
    return h;
  }

  /* ---------- build the search UI, welded into existing dom ---------- */
  function mount() {
    if (window.__globalSearchMounted) return;
    window.__globalSearchMounted = true;

    var nav = document.querySelector(".top-nav, .nav, .site-nav, header.nav, #topNav, .navbar");
    var wrap = document.createElement("div");
    wrap.className = "gs-wrap";
    wrap.id = "globalSearchWrap";
    wrap.innerHTML =
      '<button type="button" class="gs-toggle" id="gsToggle" aria-label="Search" title="' + esc(_tt("gsSearch", "Search")) + '">' +
      '<i class="fas fa-magnifying-glass"></i></button>' +
      '<div class="gs-panel" id="gsPanel" hidden>' +
      '<div class="gs-head"><span class="gs-title"><i class="fas fa-magnifying-glass"></i> ' + esc(_tt("gsTitle", "Search")) + '</span>' +
      '<span class="gs-keys"><kbd>K</kbd><kbd>/</kbd></span>' +
      '<button type="button" class="gs-x" id="gsShare" aria-label="Copy link to this search" title="Copy link"><i class="fas fa-link"></i></button>' +
      '<button type="button" class="gs-x" id="gsClose" aria-label="Close search"><i class="fas fa-xmark"></i></button></div>' +
      '<div class="gs-box"><i class="fas fa-magnifying-glass"></i>' +
      '<input type="search" id="gsInput" autocomplete="off" placeholder="' + esc(_tt("gsPlaceholder", "Search tracks, users, playlists, wanted, community...")) + '" aria-label="' + esc(_tt("gsSearch", "Search")) + '">' +
      '<button type="button" class="gs-clear" id="gsClear" hidden><i class="fas fa-xmark"></i></button></div>' +
      '<div class="gs-scopes" id="gsScopes">' +
      '<button type="button" class="gs-scope on" data-gs-scope="all">All</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="tracks">Tracks</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="users">People</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="playlists">Playlists</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="wanted">Wanted</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="suggestions">Ideas</button>' +
      '<button type="button" class="gs-scope" data-gs-scope="community">Community</button></div>' +
      '<div class="gs-results" id="gsResults"><p class="gs-hint">' + esc(_tt("gsHint", "Type to search the vault, vault-wanted board, community and profiles.")) + '</p></div>' +
      '<div class="gs-foot"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';

    /* Minimal gs styles: toggle pill matches the DRP pill; panel is a
       fixed centered modal that sits above the blur backdrop. */
    if (!document.getElementById("gs-style")) {
      var st = document.createElement("style");
      st.id = "gs-style";
      st.textContent = ".gs-wrap{display:inline-flex;align-items:center;margin-left:8px}" +
        ".gs-toggle{display:inline-flex;align-items:center;justify-content:center;width:30px;height:24px;border-radius:9999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);font-size:11px;cursor:pointer}" +
        ".gs-toggle:hover{background:rgba(255,255,255,.12);color:#fff}" +
        ".gs-panel{position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:min(560px,92vw);max-height:70vh;overflow:auto;z-index:10001;background:#14101f;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:12px}" +
        ".gs-panel[hidden]{display:none!important}" +
        ".gs-box{display:flex;align-items:center;gap:8px}" +
        ".gs-box input{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;padding:10px 12px;font-size:14px;outline:none}" +
        ".gs-results{margin-top:8px}" +
        ".gs-head{display:flex;align-items:center;gap:8px;padding:2px 2px 10px}" +
        ".gs-title{font-size:13px;font-weight:800;letter-spacing:.04em;color:#fff;display:flex;align-items:center;gap:7px}" +
        ".gs-keys{margin-left:auto;display:flex;gap:4px}" +
        ".gs-keys kbd,.gs-foot kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:rgba(255,255,255,.7);font-size:10px;font-family:inherit}" +
        ".gs-x{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:1px solid transparent;background:transparent;color:rgba(255,255,255,.6);cursor:pointer;font-size:12px}" +
        ".gs-x:hover{background:rgba(255,255,255,.1);color:#fff}" +
        ".gs-foot{display:flex;gap:12px;align-items:center;padding:10px 2px 0;color:rgba(255,255,255,.45);font-size:10px}" +
        ".gs-group{margin:10px 0 4px}" +
        ".gs-group-title{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45);margin:0 2px 6px;display:flex;align-items:center;gap:6px}" +
        ".gs-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:16px;padding:0 5px;border-radius:9999px;background:rgba(251,191,36,.15);color:#fbbf24;font-size:9px}" +
        ".gs-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px;border-radius:10px;border:1px solid transparent;background:transparent;color:#fff;cursor:pointer}" +
        ".gs-row:hover,.gs-row.active{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.1)}" +
        ".gs-row-ico{color:#fbbf24;font-size:12px;width:16px;text-align:center;flex-shrink:0}" +
        ".gs-row-txt{flex:1;min-width:0;display:flex;flex-direction:column}" +
        ".gs-row-txt b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".gs-row-sub{font-size:11px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".gs-row-go{color:rgba(255,255,255,.3);font-size:11px}" +
        ".gs-art,.gs-ava{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.07);background-size:cover;background-position:center;color:rgba(255,255,255,.6);font-size:13px;flex-shrink:0}" +
        ".gs-art{width:40px;height:40px;border-radius:11px;border:1px solid rgba(255,255,255,.08)}" +
        ".gs-art.pl{background:linear-gradient(135deg,rgba(167,139,250,.4),rgba(76,29,149,.4));color:#c4b5fd}" +
        ".gs-art.wa{background:linear-gradient(135deg,rgba(248,113,113,.4),rgba(127,29,29,.4));color:#fca5a5}" +
        ".gs-art.sg{background:linear-gradient(135deg,rgba(251,191,36,.4),rgba(120,53,15,.4));color:#fcd34d}" +
        ".gs-art.cm{background:linear-gradient(135deg,rgba(34,211,238,.35),rgba(8,51,68,.45));color:#67e8f9}" +
        ".gs-art.lk{background:linear-gradient(135deg,rgba(52,211,153,.35),rgba(6,60,45,.45));color:#6ee7b7}" +
        ".gs-art.cd{background:linear-gradient(135deg,rgba(148,163,184,.3),rgba(30,41,59,.5));color:#cbd5e1}" +
        ".gs-art.gl{background:linear-gradient(135deg,rgba(240,171,252,.4),rgba(88,28,135,.45));color:#f0abfc}" +
        ".gs-art.dr{background:linear-gradient(135deg,rgba(251,146,60,.4),rgba(124,45,18,.45));color:#fdba74}" +
        ".gs-ava{border-radius:50%}" +
        "mark.gs-hl{background:rgba(251,191,36,.35);color:#fff;border-radius:3px;padding:0 1px}" +
        ".gs-hint,.gs-empty,.gs-loading{color:rgba(255,255,255,.5);font-size:12px;padding:14px 4px;text-align:center}" +
        ".gs-recent{display:flex;flex-wrap:wrap;gap:6px;padding:4px 2px}" +
        ".gs-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(255,255,255,.75);border-radius:9999px;padding:4px 10px;font-size:11px;cursor:pointer}" +
        ".gs-chip:hover{background:rgba(255,255,255,.12);color:#fff}" +
        ".gs-scopes{display:flex;gap:6px;flex-wrap:wrap;padding:10px 2px 0}" +
        ".gs-scope{border:1px solid rgba(255,255,255,.14);background:transparent;color:rgba(255,255,255,.6);border-radius:9999px;padding:4px 11px;font-size:11px;cursor:pointer}" +
        ".gs-scope:hover{color:#fff;border-color:rgba(255,255,255,.3)}" +
        ".gs-scope.on{background:rgba(251,191,36,.16);border-color:rgba(251,191,36,.45);color:#fbbf24;font-weight:700}";
      (document.head || document.documentElement).appendChild(st);
    }

    /* Anchor FIRST on the DRP pill itself: the left nav cluster is
       <div class="flex items-center gap-3">THW + #ps-nav-drp</div>, and the
       <nav> carries class "nav-home" (not ".nav"), so the old nav query
       missed and the toggle fell back to body-top. Insert immediately
       AFTER #ps-nav-drp inside its own parent so the two sit side by side. */
    var drp0 = document.getElementById("ps-nav-drp");
    if (drp0 && drp0.parentNode) {
      drp0.parentNode.insertBefore(wrap, drp0.nextSibling);
    } else if (holder) {
      var bell = holder.querySelector("[id^='navNotif'], [class*='nav-notif'], [id='navNotifWrap']");
      if (bell && bell.parentNode) holder.insertBefore(wrap, bell.parentNode);
      else holder.appendChild(wrap);
    } else {
      var body = document.body;
      var top = document.createElement("div");
      top.className = "gs-fs";
      top.innerHTML = wrap.innerHTML;
      wrap = top;
      body.insertBefore(wrap, body.firstChild);
    }

    var toggle = document.getElementById("gsToggle");
    var panel = document.getElementById("gsPanel");
    var input = document.getElementById("gsInput");
    var clear = document.getElementById("gsClear");
    var results = document.getElementById("gsResults");
    if (!toggle || !panel || !input) return;

    function open() {
      _open = true;
      panel.hidden = false;
      panel.classList.add("open");
      try { input.focus(); } catch (e) {}
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    }
    function close() {
      _open = false;
      panel.hidden = true;
      panel.classList.remove("open");
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    }
    function onDocClick(e) {
      if (wrap.contains(e.target)) return;
      if (panel && panel.contains(e.target)) return;
      close();
    }
    function onKey(e) {
      if (e.key === "Escape") { close(); try { input.blur(); } catch (x) {} }
    }
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (_open) close(); else open();
    });
    /* The nav is its own stacking context (z-50): any panel nested inside
       it paints below a body-level blur no matter its z-index. Lift the
       panel to a direct child of <body> so its fixed centering + z-10001
       are viewport-true and it renders above the backdrop. Toggle stays
       in the nav next to the DRP pill. */
    try {
      if (panel.parentNode !== document.body) document.body.appendChild(panel);
    } catch (e) {}
    clear.addEventListener("click", function () {
      input.value = "";
      _lastQ = "";
      clear.hidden = true;
      results.innerHTML = hintHTML();
      input.focus();
    });
    var xBtn = document.getElementById("gsClose");
    if (xBtn) xBtn.addEventListener("click", function (e) { e.stopPropagation(); close(); });
    var shareBtn = document.getElementById("gsShare");
    if (shareBtn) shareBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      try {
        var q = input.value.trim();
        var url = location.origin + location.pathname + (q ? "?q=" + encodeURIComponent(q) : "");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            if (window.toast) window.toast("Search link copied", "success");
          }, function () {});
        }
      } catch (err) {}
    });
    /* Shareable route: ?q=<query> opens the panel pre-filled and searches. */
    try {
      var mq = (location.search || "").match(/[?&]q=([^&]+)/);
      if (mq && !window.__gsRouted) {
        window.__gsRouted = true;
        var rq = decodeURIComponent(mq[1]).slice(0, 80);
        setTimeout(function () {
          try {
            input.value = rq;
            clear.hidden = false;
            if (!_open) open();
            runSearch(rq.trim());
          } catch (err) {}
        }, 600);
      }
    } catch (err) {}
    var scopes = document.getElementById("gsScopes");
    if (scopes) scopes.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-gs-scope]");
      if (!chip) return;
      e.stopPropagation();
      _scope = chip.getAttribute("data-gs-scope") || "all";
      var all = scopes.querySelectorAll("[data-gs-scope]");
      for (var si = 0; si < all.length; si++) all[si].classList.toggle("on", all[si] === chip);
      _active = -1;
      var q = input.value.trim();
      if (q.charAt(0) === ">") renderCommands(q.slice(1).trim());
      else if (q) runSearch(q);
      else if (_lastData) render(_lastData, _lastQ);
      try { input.focus(); } catch (err) {}
    });
    /* Instant suggestions while typing (client-side only): matching recent
       searches + vault track title completions. The debounced fetch replaces
       these with full categorized results. */
    function renderInstant(q) {
      var low = String(q || "").toLowerCase();
      if (!low || low.charAt(0) === ">") return false;
      var list = [], seen = {}, i, k;
      try {
        var rc = getRecents();
        for (i = 0; i < rc.length && list.length < 3; i++) {
          var rl = String(rc[i] || "").toLowerCase();
          if (rl.indexOf(low) === 0 && rl !== low && !seen[rl]) {
            seen[rl] = 1;
            list.push({ t: rc[i], sub: "recent search", icon: "fa-clock-rotate-left" });
          }
        }
      } catch (e) {}
      try {
        var tl = null;
        try { if (typeof trackList !== "undefined" && trackList && trackList.length) tl = trackList; } catch (e0) {}
        if (!tl) { try { if (window.trackList && window.trackList.length) tl = window.trackList; } catch (e1) {} }
        if (tl) {
          for (k = 0; k < tl.length && list.length < 7; k++) {
            var title = String((tl[k] || {}).title || "");
            var tlw = title.toLowerCase();
            if (title && tlw.indexOf(low) === 0 && !seen[tlw]) {
              seen[tlw] = 1;
              list.push({ t: title, sub: "track", icon: "fa-music" });
            }
          }
          for (k = 0; k < tl.length && list.length < 7; k++) {
            var title2 = String((tl[k] || {}).title || "");
            var lk = title2.toLowerCase();
            if (title2 && lk.indexOf(low) > 0 && !seen[lk]) {
              seen[lk] = 1;
              list.push({ t: title2, sub: "track", icon: "fa-music" });
            }
          }
        }
      } catch (e2) {}
      if (!list.length) return false;
      var h = '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsSuggest", "Suggestions")) + "</div>";
      for (i = 0; i < list.length; i++) {
        h += '<button type="button" class="gs-row" data-gs-suggest="' + esc(list[i].t) + '">' +
          '<span class="gs-art cd"><i class="fas ' + list[i].icon + '"></i></span>' +
          '<span class="gs-row-txt"><b>' + esc(list[i].t) + '</b><span class="gs-row-sub">' + esc(list[i].sub) + '</span></span><i class="fas fa-arrow-up-right gs-row-go"></i></button>';
      }
      results.innerHTML = h + "</div>";
      _active = -1;
      return true;
    }
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clear.hidden = !q;
      if (!q) {
        _lastQ = "";
        _lastData = null;
        _active = -1;
        results.innerHTML = hintHTML();
        return;
      }
      if (_timer) clearTimeout(_timer);
      renderInstant(q);
      _timer = setTimeout(function () { runSearch(q); }, 260);
    });
    var _active = -1;
    function gsRows() { return results.querySelectorAll(".gs-row"); }
    function setActive(i) {
      var rs = gsRows();
      if (!rs.length) return;
      _active = (i + rs.length) % rs.length;
      for (var k = 0; k < rs.length; k++) rs[k].classList.toggle("active", k === _active);
      try { rs[_active].scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(_active + (e.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (e.key === "Enter") {
        var rs = gsRows();
        if (_active >= 0 && rs[_active]) { try { rs[_active].click(); } catch (err) {} return; }
        if (_timer) clearTimeout(_timer); runSearch(input.value.trim());
      }
    });

    /* ---------- command palette (type ">" + command) ---------- */
    var COMMANDS = [
      { name: "Go to Lobby", hint: "home page", icon: "fa-home", page: "home" },
      { name: "Go to WRLD Player", hint: "player", icon: "fa-compact-disc", page: "player" },
      { name: "Go to The Vault", hint: "hub", icon: "fa-server", page: "hub" },
      { name: "Go to Wanted Vault", hint: "wanted", icon: "fa-fire", page: "wanted" },
      { name: "Go to Community", hint: "community", icon: "fa-users", page: "community" },
      { name: "Go to Suggestions", hint: "suggestions", icon: "fa-lightbulb", page: "suggestions" },
      { name: "Go to Profile", hint: "profile", icon: "fa-user", page: "profile" },
      { name: "Surprise shuffle", hint: "play a random track", icon: "fa-shuffle", fn: "spin" },
      { name: "Open WRLD Log", hint: "changelog", icon: "fa-book", fn: "wrldlog" }
    ];
    function runCommand(i) {
      var c = COMMANDS[i];
      if (!c) return;
      try {
        if (c.page && window.switchAppPage) window.switchAppPage(c.page);
        else if (c.fn === "spin" && window.spinTrack) window.spinTrack();
        else if (c.fn === "wrldlog" && window.showWrldLog) window.showWrldLog();
      } catch (e) {}
    }
    function renderCommands(cmd) {
      var h = "";
      var low = String(cmd || "").toLowerCase();
      var list = [];
      for (var ci = 0; ci < COMMANDS.length; ci++) {
        if (!low || (COMMANDS[ci].name + " " + COMMANDS[ci].hint).toLowerCase().indexOf(low) >= 0) list.push(ci);
      }
      if (!list.length) {
        h = '<p class="gs-empty">No command matches &ldquo;' + esc(cmd) + '&rdquo;</p>';
      } else {
        h = '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsCommands", "Commands")) + ' <span class="gs-count">' + list.length + '</span></div>';
        for (var ck = 0; ck < list.length; ck++) {
          var cc = COMMANDS[list[ck]];
          h += '<button type="button" class="gs-row" data-gs-cmd="' + list[ck] + '">' +
            '<span class="gs-art cd"><i class="fas ' + cc.icon + '"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(cc.name) + '</b><span class="gs-row-sub">' + esc(cc.hint) + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        }
        h += '</div>';
      }
      results.innerHTML = h;
      _active = -1;
    }

    /* ---------- scope filter + client-side track search ---------- */
    function scopeFilter(d) {
      var scope = _scope || "all";
      if (scope === "all" || !d) return d;
      var out = { tracks: [], users: [], playlists: [], wanted: [], suggestions: [], community: [], gallery: [], drops: [], leaks: [], releases: [], posts: [], results: d.results };
      if (scope === "tracks") out.tracks = d.tracks || [];
      else if (d[scope]) out[scope] = d[scope];
      if (scope === "community") { out.leaks = d.leaks || []; out.releases = d.releases || []; out.posts = d.posts || []; }
      return out;
    }
    function clientTrackSearch(q) {
      var out = [];
      try {
        var tl = null;
        try { if (typeof trackList !== "undefined" && trackList && trackList.length) tl = trackList; } catch (e0) {}
        if (!tl) { try { if (window.trackList && window.trackList.length) tl = window.trackList; } catch (e1) {} }
        if (!tl || !tl.length) return out;
        var low = String(q || "").toLowerCase();
        if (!low) return out;
        for (var i = 0; i < tl.length && out.length < 6; i++) {
          var t = tl[i] || {};
          var title = String(t.title || "");
          if (title.toLowerCase().indexOf(low) >= 0) {
            out.push({ _idx: i, title: title, album: t.artist || t.tag || "", cover: t.cover || "" });
          }
        }
      } catch (e) {}
      return out;
    }

    /* ---------- do the query ---------- */
    var _abort = null;
    function runSearch(q) {
      if (!q) return;
      if (q.charAt(0) === ">") { renderCommands(q.slice(1).trim()); return; }
      if (q === _lastQ && _lastData) { render(_lastData, q); return; }
      _lastQ = q;
      _active = -1;
      var myQ = q;
      if (_abort) { try { _abort.abort(); } catch (e) {} }
      _abort = (typeof AbortController !== "undefined") ? new AbortController() : null;
      results.innerHTML = '<p class="gs-loading"><i class="fas fa-circle-notch fa-spin"></i> ' + esc(_tt("gsSearching", "Searching...")) + '</p>';
      fetch(SEARCH_ENDPOINT + "?q=" + encodeURIComponent(q), { cache: "no-store", signal: _abort ? _abort.signal : undefined })
        .then(function (r) { return r.json(); })
        .catch(function (err) { return { ok: false, error: "fetch", aborted: !!err && err.name === "AbortError" }; })
        .then(function (d) {
          if (!d || d.aborted) return;
          if (input.value.trim() !== myQ) return;
          if (d.ok !== true) {
            results.innerHTML = '<p class="gs-empty">' + esc((d && d.error) || _tt("gsFailed", "Search failed. Try again.")) + '</p>';
            return;
          }
          _lastData = d;
          render(d, q);
        });
    }

    /* ---------- render grouped results ---------- */
    function groupRow(icon, k, v, onClick) {
      return '<button type="button" class="gs-row" data-gs-click="1">' +
        '<i class="fas ' + icon + ' gs-row-ico"></i>' +
        '<span class="gs-row-txt"><b>' + esc(k) + '</b><span class="gs-row-sub">' + esc(v) + '</span></span>' +
        '<i class="fas fa-angle-right gs-row-go"></i></button>';
    }
    function render(d, q) {
      d = scopeFilter(d);
      var scope = _scope || "all";
      var h = "";
      var any = false;

      /* ---- Tracks (client-side vault index; the API has no track table) ---- */
      var tracks = [];
      if (scope === "all" || scope === "tracks") {
        tracks = clientTrackSearch(q);
        if (d.tracks && d.tracks.length) tracks = d.tracks.concat(tracks).slice(0, 6);
      }
      if (tracks.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsTracks", "Tracks")) + ' <span class="gs-count">' + tracks.length + '</span></div>';
        tracks.slice(0, 6).forEach(function (t) {
          var cover = (t.cover) ? '<span class="gs-art" style="background-image:url(\'' + esc(t.cover) + '\')"></span>' : '<span class="gs-art"><i class="fas fa-music"></i></span>';
          h += '<button type="button" class="gs-row" data-gs-play="' + (t._idx != null ? t._idx : "") + '" data-gs-title="' + esc(t.title || "") + '">' +
            cover + '<span class="gs-row-txt"><b>' + esc(t.title || "") + '</b><span class="gs-row-sub">' + esc(t.album || t.artist || "999") + '</span></span><i class="fas fa-play gs-row-go"></i></button>';
        });
        h += '</div>';
      }
      /* ---- Albums (client-side vault index; click fills the query) ---- */
      if ((scope === "all" || !scope)) {
        try {
          var albSeen = {}, albList = [];
          var atl = null;
          try { if (typeof trackList !== "undefined" && trackList && trackList.length) atl = trackList; } catch (e0) {}
          if (atl && typeof getTrackAlbum === "function") {
            var qlow = String(q || "").toLowerCase();
            for (var ai = 0; ai < atl.length && albList.length < 4; ai++) {
              var an = String(getTrackAlbum(atl[ai]) || "");
              var al = an.toLowerCase();
              if (an && al.indexOf(qlow) >= 0 && !albSeen[al]) {
                albSeen[al] = 1;
                albList.push(an);
              }
            }
          }
          if (albList.length) {
            any = true;
            h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsAlbums", "Albums")) + ' <span class="gs-count">' + albList.length + '</span></div>';
            albList.forEach(function (an2) {
              h += '<button type="button" class="gs-row" data-gs-suggest="' + esc(an2) + '">' +
                '<span class="gs-art cd"><i class="fas fa-compact-disc"></i></span>' +
                '<span class="gs-row-txt"><b>' + esc(an2) + '</b><span class="gs-row-sub">album</span></span><i class="fas fa-arrow-up-right gs-row-go"></i></button>';
            });
            h += '</div>';
          }
        } catch (ealb) {}
      }

      /* ---- Users ---- */
      var users = d.users || [];
      if (users.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsUsers", "Users")) + ' <span class="gs-count">' + users.length + '</span></div>';
        users.slice(0, 6).forEach(function (u) {
          var av = (u.avatar) ? '<span class="gs-ava" style="background-image:url(\'' + esc(u.avatar) + '\')"></span>' : '<span class="gs-ava"><i class="fas fa-user"></i></span>';
          h += '<button type="button" class="gs-row" data-gs-user="' + esc(u.uid || u.username || "") + '">' +
            av + '<span class="gs-row-txt"><b>' + esc(u.name || u.username || u.uid) + '</b><span class="gs-row-sub">@' + esc(u.username || u.uid || "") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }

      /* ---- Playlists ---- */
      var pls = d.playlists || [];
      if (pls.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsPlaylists", "Playlists")) + ' <span class="gs-count">' + pls.length + '</span></div>';
        pls.slice(0, 5).forEach(function (p) {
          var pArt = p.owner_avatar
            ? '<span class="gs-art pl" style="background-image:url(\'' + esc(p.owner_avatar) + '\')"></span>'
            : '<span class="gs-art pl"><i class="fas fa-list-ul"></i></span>';
          h += '<button type="button" class="gs-row" data-gs-pl="' + esc(p.id || "") + '">' +
            pArt +
            '<span class="gs-row-txt"><b>' + esc(p.name || "") + '</b><span class="gs-row-sub">' + esc(p.owner || "") + ' &middot; ' + (Number(p.count) || 0) + ' tracks</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }

      /* ---- Wanted vault posts ---- */
      var wanted = d.wanted || d.results && d.results.wanted || [];
      if (wanted.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsWanted", "Wanted Vault")) + ' <span class="gs-count">' + wanted.length + '</span></div>';
        wanted.slice(0, 5).forEach(function (w) {
          h += '<button type="button" class="gs-row" data-gs-wanted="1" data-gs-title="' + esc(w.title || "") + '">' +
            '<span class="gs-art wa"><i class="fas fa-fire"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(w.title || "") + '</b><span class="gs-row-sub">' + esc(w.status || "") + ' &middot; ' + esc(w.by || "") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }

      /* ---- Suggestions (vote board) ---- */
      var sugg = d.suggestions || [];
      if (sugg.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsSugg", "Suggestions")) + ' <span class="gs-count">' + sugg.length + '</span></div>';
        sugg.slice(0, 5).forEach(function (s) {
          h += '<button type="button" class="gs-row" data-gs-sugg="1" data-gs-title="' + esc(s.title || "") + '">' +
            '<span class="gs-art sg"><i class="fas fa-lightbulb"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(s.title || "") + '</b><span class="gs-row-sub">' + esc(s.category || "") + ' &middot; ' + (Number(s.vote_count) || 0) + ' votes &middot; ' + esc(s.author_name || "") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }

      /* ---- Leaks / community ---- */
      var leaks = d.leaks || d.releases || [];
      var comm = d.community || d.posts || [];
      if (leaks.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsLeaks", "Leaks / Releases")) + ' <span class="gs-count">' + leaks.length + '</span></div>';
        leaks.slice(0, 5).forEach(function (l) {
          h += '<button type="button" class="gs-row" data-gs-leak="1" data-gs-title="' + esc(l.title || "") + '">' +
            '<span class="gs-art lk"><i class="fas fa-compact-disc"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(l.title || l.name || "") + '</b><span class="gs-row-sub">' + esc(l.type || "Leak") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }
      if (comm.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsCommunity", "Community")) + ' <span class="gs-count">' + comm.length + '</span></div>';
        comm.slice(0, 5).forEach(function (c) {
          h += '<button type="button" class="gs-row" data-gs-comm="1" data-gs-title="' + esc(c.title || "") + '">' +
            '<span class="gs-art cm"><i class="fas fa-comments"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(c.title || "Post") + '</b><span class="gs-row-sub">@' + esc(c.author || c.by || "") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }
      var gal = d.gallery || [];
      if ((_scope === "all" || !_scope) && gal.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsGallery", "Fan Art")) + ' <span class="gs-count">' + gal.length + '</span></div>';
        gal.slice(0, 5).forEach(function (g) {
          h += '<button type="button" class="gs-row" data-gs-gallery="' + (g.id || "") + '">' +
            '<span class="gs-art gl"><i class="fas fa-images"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(g.title || "Untitled") + '</b><span class="gs-row-sub">by ' + esc(g.user_name || "anon") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }
      var drps = d.drops || [];
      if ((_scope === "all" || !_scope) && drps.length) {
        any = true;
        h += '<div class="gs-group"><div class="gs-group-title">' + esc(_tt("gsDrops", "Drops & Events")) + ' <span class="gs-count">' + drps.length + '</span></div>';
        drps.slice(0, 5).forEach(function (dp) {
          h += '<button type="button" class="gs-row" data-gs-drop="' + (dp.id || "") + '">' +
            '<span class="gs-art dr"><i class="fas fa-gift"></i></span>' +
            '<span class="gs-row-txt"><b>' + esc(dp.title || "Drop") + '</b><span class="gs-row-sub">' + esc(dp.track_title || dp.description || "") + '</span></span><i class="fas fa-angle-right gs-row-go"></i></button>';
        });
        h += '</div>';
      }

      if (!any) {
        h = '<p class="gs-empty">' + esc(_tt("gsNone", "No results for \u201c") + q + esc(_tt("gsNoneEnd", "\u201d"))) + '</p>';
      } else {
        saveRecent(q);
      }
      results.innerHTML = h;
      _active = -1;
      /* highlight the query inside row titles (text nodes only, markup-safe) */
      try {
        var rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
        var bns = results.querySelectorAll(".gs-row-txt b");
        for (var ni = 0; ni < bns.length; ni++) {
          (function (bn) {
            var t = bn.textContent;
            rx.lastIndex = 0;
            if (!rx.test(t)) return;
            rx.lastIndex = 0;
            var frag = document.createDocumentFragment();
            var last = 0, m;
            while ((m = rx.exec(t))) {
              frag.appendChild(document.createTextNode(t.slice(last, m.index)));
              var mk = document.createElement("mark");
              mk.className = "gs-hl";
              mk.textContent = m[0];
              frag.appendChild(mk);
              last = m.index + m[0].length;
              if (m[0].length === 0) rx.lastIndex++;
            }
            frag.appendChild(document.createTextNode(t.slice(last)));
            bn.textContent = "";
            bn.appendChild(frag);
          })(bns[ni]);
        }
      } catch (ehl) {}
    }

    /* ---------- delegation: handle clicks ---------- */
    results.addEventListener("click", function (e) {
      var chip = e.target.closest(".gs-chip");
      if (chip) {
        input.value = chip.getAttribute("data-gs-q") || "";
        clear.hidden = !input.value;
        if (_timer) clearTimeout(_timer);
        _timer = setTimeout(function () { runSearch(input.value.trim()); }, 120);
        input.focus();
        return;
      }
      var row = e.target.closest(".gs-row");
      if (!row) return;
      var play = row.getAttribute("data-gs-play");
      var user = row.getAttribute("data-gs-user");
      var pl = row.getAttribute("data-gs-pl");
      var wanted = row.getAttribute("data-gs-wanted");
      var sugg = row.getAttribute("data-gs-sugg");
      var cmd = row.getAttribute("data-gs-cmd");
      var sug = row.getAttribute("data-gs-suggest");
      var title = row.getAttribute("data-gs-title") || "";

      /* instant suggestion: fill the box and search it now */
      if (sug !== null && sug !== "") {
        input.value = sug;
        clear.hidden = false;
        if (_timer) clearTimeout(_timer);
        runSearch(sug.trim());
        try { input.focus(); } catch (err) {}
        return;
      }

      /* command palette row: run it */
      if (cmd !== null && cmd !== "") {
        runCommand(Number(cmd));
        close();
        return;
      }

      /* track: play it */
      if (play !== null && play !== "") {
        var idx = parseInt(play, 10);
        if (!isNaN(idx) && window.selectTrackFromList) {
          try { window.selectTrackFromList(idx); } catch (err) {}
        } else if (window.selectTrackByTitle) {
          try { window.selectTrackByTitle(title); } catch (err) {}
        } else if (window.switchAppPage) {
          try { window.switchAppPage("player"); } catch (err) {}
        }
        close();
        return;
      }
      /* user: open profile */
      if (user) {
        if (window.openProfile) { try { window.openProfile(user); } catch (err) {} }
        else if (window.switchAppPage) { try { window.switchAppPage("profile"); } catch (err) {} }
        close();
        return;
      }
      /* playlist: open hub playlists tab */
      if (pl) {
        try { sessionStorage.setItem("gs_open_playlist", pl); } catch (err) {}
        if (window.switchAppPage) {
          try { if (window.renderHubPlaylists) window.renderHubPlaylists(); window.switchAppPage("hub"); } catch (err) {}
        }
        close();
        return;
      }
      /* suggestion: jump to the vote board */
      if (sugg) {
        if (window.switchAppPage) {
          try { window.switchAppPage("suggestions"); } catch (err) {}
          try { window.switchAppPage("community"); } catch (err2) {}
        }
        close();
        return;
      }
      /* gallery hit: open the gallery page and its lightbox */
      var galId = row.getAttribute("data-gs-gallery");
      if (galId) {
        close();
        if (window.switchAppPage) { try { window.switchAppPage("gallery"); } catch (err) {} }
        setTimeout(function () {
          try { if (window.openGalleryItem) window.openGalleryItem(galId); } catch (err2) {}
        }, 450);
        return;
      }
      /* drop hit: open home and flash the drop card */
      var dropId = row.getAttribute("data-gs-drop");
      if (dropId) {
        close();
        if (window.switchAppPage) { try { window.switchAppPage("home"); } catch (err) {} }
        setTimeout(function () {
          try {
            var card = document.querySelector('[data-drop-card="' + dropId + '"]');
            if (card) {
              card.scrollIntoView({ behavior: "smooth", block: "center" });
              card.style.outline = "2px solid #f0abfc";
              setTimeout(function () { card.style.outline = ""; }, 2200);
            }
          } catch (err2) {}
        }, 450);
        return;
      }
      /* wanted / leak / community: jump to the board page */
      var page = wanted ? "wanted" : (row.getAttribute("data-gs-leak") ? "leaks" : (row.getAttribute("data-gs-comm") ? "community" : ""));
      if (page && window.switchAppPage) {
        try {
          window.switchAppPage(page);
          var noteTitle = title;
          setTimeout(function () {
            if (window._wantedTitles && noteTitle) {
              var el = document.querySelector('[data-wanted-title="' + CSS.escape(noteTitle) + '"], [data-wtitle="' + CSS.escape(noteTitle) + '"]');
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 350);
        } catch (err) {}
        close();
        return;
      }
      close();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  }
  boot();
})();

/* ---- additive: Ctrl/Cmd+K toggles the global search panel; bare "/" opens it ---- */
(function () {
  "use strict";
  function focuser(t, i) {
    if (i) { setTimeout(function () { try { i.focus(); } catch (e) {} }, 20); }
  }
  function isTyping(e) {
    var n = e.target;
    if (!n) return false;
    var tag = (n.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || (n.isContentEditable === true);
  }
  document.addEventListener("keydown", function (e) {
    var k = e.key || "";
    var meta = e.ctrlKey || e.metaKey;
    if (meta && (k === "k" || k === "K")) {
      e.preventDefault();
      try {
        var tg = document.getElementById("gsToggle") || document.querySelector(".gs-toggle");
        var pn = document.getElementById("gsPanel");
        if (tg) { tg.click(); }
        if (pn) { focuser(tg, document.getElementById("gsInput")); }
      } catch (err) {}
      return;
    }
    if (k === "/" && !meta && !e.altKey && !isTyping(e)) {
      e.preventDefault();
      try {
        var tg2 = document.getElementById("gsToggle") || document.querySelector(".gs-toggle");
        if (tg2) { tg2.click(); }
        focuser(tg2, document.getElementById("gsInput"));
      } catch (err) {}
    }
  });
(function () {
'use strict';
var SEAM = '__gsBlurSeam__';
var BACKDROP = 'gsBlurBackdrop';
var MARK = 'gsBlurMount';
function panelEl() {
  return document.getElementById('gsPanel') || document.querySelector('[id*=gsPanel]') ||
    document.querySelector('[class*=gs-panel], [class*=gsPanel]');
}
function toggleEl() {
  var t = document.querySelector('.gs-toggle');
  if (!t) t = document.querySelector('[id*=gsToggle], [class*=gs-toggle]');
  return t;
}
function typing() {
  var a = document.activeElement;
  if (!a || !a.tagName) return false;
  var tn = a.tagName.toLowerCase();
  if (tn === 'input' || tn === 'textarea' || tn === 'select') return true;
  if (a.isContentEditable) return true;
  return false;
}
function backdrop() {
  var b = document.getElementById(BACKDROP);
  if (b) return b;
  b = document.createElement('div');
  b.id = BACKDROP;
  b.style.cssText = 
'position:fixed;inset:0;display:none;pointer-events:none;' +
'background:rgba(4,2,12,0.40);' +
'backdrop-filter:blur(12px) saturate(0.8);' +
'-webkit-backdrop-filter:blur(12px) saturate(0.8);' +
'z-index:9998;opacity:0;transition:opacity .18s ease;';
  (document.body || document.documentElement).appendChild(b);
  return b;
}
function sync(state) {
  var b = backdrop();
  b.style.display = state ? 'block' : 'none';
  b.style.opacity = state ? '1' : '0';
  var p = panelEl();
  if (p && state) {
    /* Panel CSS already fixes it centered at z 10001; re-assert here so
       the backdrop (z 9998) can never cover it. */
    p.style.zIndex = "10001";
    p.style.position = "fixed";
  }
}
function isOpen() {
  var p = panelEl();
  if (!p) return false;
  if (p.hidden) return false;
  var s = window.getComputedStyle(p);
  return s.display !== 'none' && s.visibility !== 'hidden';
}
function refresh() { sync(isOpen()); }
function open() {
  var t = toggleEl();
  var p = panelEl();
  if (t && p && p.hidden) { try { t.click(); } catch (e) {} }
  else if (p && p.hidden) { p.hidden = false; }
}
document.addEventListener('keydown', function (e) {
  if (e.key !== 'k' && e.key !== 'K') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (typing()) return;
  e.preventDefault();
  var t = toggleEl();
  if (t) { try { t.click(); } catch (err) {} }
  else { var p = panelEl(); if (p) p.hidden = !p.hidden; }
  refresh();
}, true);
var p0 = panelEl();
if (p0 && typeof MutationObserver !== 'undefined') {
  new MutationObserver(refresh).observe(p0, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
}
window[MARK] = refresh;
})();
})();
