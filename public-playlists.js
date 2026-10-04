/* Public Playlists - a page for browsing playlists people have made public.
 *
 * Reads /api/playlist (list, paged) and /api/playlist/:id (one playlist with its
 * tracks). Mounts into #page-section-playlists, which is a normal SPA page
 * section like Gallery and Downloads.
 *
 * Note: script.js's openPlaylistDetail() takes an index into the *viewer's own*
 * playlist array, so it cannot open someone else's playlist - the detail view
 * here is built from the id endpoint instead. */
(function () {
  "use strict";
  if (window.__publicPlaylistsMounted) return;
  window.__publicPlaylistsMounted = true;

  var PAGE_SIZE = 12;
  var offset = 0;
  var total = 0;
  var loading = false;
  var currentFilter = "all";
  var lastQuery = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function css() {
    if (document.getElementById("public-playlists-style")) return;
    var st = document.createElement("style");
    st.id = "public-playlists-style";
    st.textContent =
      ".plp-wrap{max-width:72rem;margin:0 auto;width:100%;padding:0 1rem 2rem}" +
      ".plp-head{text-align:center;margin-bottom:16px}" +
      ".plp-title{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;background:linear-gradient(90deg,#f0abfc,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}" +
      ".plp-sub{font-size:11px;color:rgba(255,255,255,.45);font-style:italic;margin-top:4px}" +
      ".plp-count{font-size:11px;color:rgba(255,255,255,.4);margin-top:6px;font-variant-numeric:tabular-nums}" +
      ".plp-filters{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px}" +
      ".plp-filter{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);border-radius:9999px;padding:6px 14px;font-size:11px;cursor:pointer}" +
      ".plp-filter:hover{color:#fff;border-color:rgba(255,255,255,.3)}" +
      ".plp-filter.active{background:rgba(251,191,36,.16);border-color:rgba(251,191,36,.45);color:#fbbf24}" +
      ".plp-search{max-width:400px;margin:0 auto 16px}" +
      ".plp-search input{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;padding:10px 14px;font-size:13px;outline:none}" +
      ".plp-search input:focus-visible{border-color:rgba(240,171,252,.5)}" +
      ".plp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}" +
      ".plp-card{border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.03);padding:14px;text-align:left;color:#fff;cursor:pointer;transition:border-color .15s;width:100%;font:inherit}" +
      ".plp-card:hover,.plp-card:focus-visible{border-color:rgba(240,171,252,.45)}" +
      ".plp-card:focus-visible{outline:2px solid #f0abfc;outline-offset:2px}" +
      ".plp-card-top{display:flex;gap:10px;margin-bottom:10px}" +
      /* a playlist has a colour, not artwork, so the tile is drawn from it and
         only falls back to the owner's avatar when there is no colour */
      ".plp-cover{width:64px;height:64px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.4);overflow:hidden}" +
      ".plp-cover img{width:100%;height:100%;object-fit:cover}" +
      ".plp-info{flex:1;min-width:0}" +
      ".plp-name{font-size:14px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".plp-owner{font-size:11px;color:rgba(255,255,255,.5);margin-top:2px}" +
      ".plp-meta{font-size:10px;color:rgba(255,255,255,.4);font-family:monospace;margin-top:4px}" +
      ".plp-desc{font-size:11px;color:rgba(255,255,255,.6);margin-top:8px;line-height:1.4;max-height:60px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}" +
      ".plp-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}" +
      ".plp-tag{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:9999px;border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.5)}" +
      ".plp-more{display:block;margin:16px auto 0;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff;border-radius:9999px;padding:8px 24px;font-size:12px;cursor:pointer}" +
      ".plp-more:hover{border-color:rgba(240,171,252,.5);color:#f0abfc}" +
      ".plp-empty{text-align:center;padding:40px 20px;color:rgba(255,255,255,.5)}" +
      ".plp-empty b{display:block;color:#fff;font-size:14px;margin-bottom:6px}" +
      /* ---- detail dialog ---- */
      ".plp-overlay{position:fixed;inset:0;z-index:340;background:rgba(5,2,12,.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:18px}" +
      ".plp-overlay.open{display:flex}" +
      ".plp-dlg{width:100%;max-width:520px;max-height:calc(100vh - 36px);overflow-y:auto;box-sizing:border-box;border-radius:22px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(22,18,40,.98),rgba(12,10,24,.98));box-shadow:0 30px 90px rgba(0,0,0,.6);padding:22px}" +
      ".plp-dhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}" +
      ".plp-dtitle{font-size:16px;font-weight:800;color:#fff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".plp-x{width:34px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:rgba(255,255,255,.55);cursor:pointer;display:grid;place-items:center;flex-shrink:0}" +
      ".plp-x:hover{color:#fff;background:rgba(255,255,255,.08)}" +
      ".plp-dcover{width:72px;height:72px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.4);overflow:hidden;margin-bottom:12px}" +
      ".plp-dcover img{width:100%;height:100%;object-fit:cover}" +
      ".plp-downer{font-size:11px;color:rgba(255,255,255,.5);margin-top:4px}" +
      ".plp-ddesc{font-size:12.5px;line-height:1.65;color:rgba(255,255,255,.7);margin:12px 0}" +
      ".plp-tracks{list-style:none;display:grid;gap:2px;margin-top:8px}" +
      ".plp-track{display:flex;gap:10px;align-items:baseline;padding:7px 8px;border-radius:8px;font-size:12.5px;color:rgba(255,255,255,.85)}" +
      ".plp-track:nth-child(odd){background:rgba(255,255,255,.03)}" +
      ".plp-track .n{color:rgba(255,255,255,.3);font-family:monospace;font-size:10px;min-width:18px}" +
      ".plp-track .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".plp-dfoot{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}" +
      ".plp-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff;border-radius:11px;padding:9px 18px;font-size:12px;cursor:pointer;font:inherit}" +
      ".plp-btn:hover{border-color:rgba(240,171,252,.5);color:#f0abfc}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* Playlists carry a colour rather than a cover image, so the tile is drawn
     from that colour and the owner's avatar is only used when there is none. */
  function tile(pl, cls, initial) {
    var letter = esc(initial || String(pl.name || "?").trim().charAt(0).toUpperCase() || "?");
    if (pl.owner_avatar && !pl.color) {
      return '<div class="' + cls + '"><img src="' + esc(pl.owner_avatar) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + letter + '\'"></div>';
    }
    return '<div class="' + cls + '" style="background:' + esc(pl.color || "linear-gradient(135deg,#312e81,#4c1d95)") + '">' + letter + "</div>";
  }

  function cardHTML(pl) {
    return '<button type="button" class="plp-card" data-pl="' + esc(pl.id) + '">' +
      '<div class="plp-card-top">' +
      tile(pl, "plp-cover") +
      '<div class="plp-info">' +
      '<div class="plp-name">' + esc(pl.name) + '</div>' +
      '<div class="plp-owner">by ' + esc(pl.owner_name || "anon") + '</div>' +
      '<div class="plp-meta">' + Number(pl.track_count) + ' track' + (pl.track_count === 1 ? "" : "s") +
      ' &middot; ' + Number(pl.fav_count || 0) + ' save' + (Number(pl.fav_count || 0) === 1 ? "" : "s") + '</div>' +
      '</div></div>' +
      (pl.desc ? '<div class="plp-desc">' + esc(pl.desc) + '</div>' : '') +
      '<div class="plp-tags"><span class="plp-tag">' + esc(pl.visibility || "public") + '</span></div>' +
      "</button>";
  }

  function matches(card, q) {
    if (!q) return true;
    var name = card.querySelector(".plp-name");
    var owner = card.querySelector(".plp-owner");
    var hay = ((name ? name.textContent : "") + " " + (owner ? owner.textContent : "") + " " + card.textContent).toLowerCase();
    return hay.indexOf(q) > -1;
  }

  function applyFilter() {
    var grid = document.getElementById("plp-grid");
    if (!grid) return;
    var shown = 0;
    grid.querySelectorAll(".plp-card").forEach(function (card) {
      var ok = matches(card, lastQuery);
      card.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    var empty = document.getElementById("plp-empty");
    if (empty) {
      var anyCards = !!grid.querySelector(".plp-card");
      empty.hidden = !!(shown || !anyCards);
    }
    var count = document.getElementById("plp-count");
    if (count) {
      /* clearing the search has to put the real total back, not leave "N matching" */
      if (lastQuery) count.textContent = shown + " matching";
      else count.textContent = total ? total + " public playlist" + (total === 1 ? "" : "s") : "";
    }
  }

  function loadPage(reset) {
    if (loading) return;
    var grid = document.getElementById("plp-grid");
    var more = document.getElementById("plp-more");
    if (!grid) return;
    if (reset) { offset = 0; total = 0; grid.innerHTML = ""; }
    loading = true;
    var url = "/api/playlist?limit=" + PAGE_SIZE + "&offset=" + offset;
    if (currentFilter !== "all") url += "&filter=" + encodeURIComponent(currentFilter);
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        loading = false;
        if (!d || d.ok !== true) {
          if (more) more.hidden = true;
          return;
        }
        var pls = d.playlists || [];
        total = Number(d.total) || 0;
        pls.forEach(function (pl) {
          if (!grid.querySelector('.plp-card[data-pl="' + pl.id + '"]')) {
            var tmp = document.createElement("div");
            tmp.innerHTML = cardHTML(pl);
            grid.appendChild(tmp.firstChild);
          }
        });
        offset += pls.length;
        if (more) more.hidden = !(d.has_more === true) || pls.length === 0;
        var empty = document.getElementById("plp-empty");
        if (empty) {
          var has = !!grid.querySelector(".plp-card");
          empty.hidden = has || pls.length > 0;
          if (!has) {
            empty.innerHTML = reset
              ? '<b>No public playlists yet</b>Make a playlist in your account and set its visibility to Public - it shows up here.'
              : '<b>Nothing to show</b>';
          }
        }
        var count = document.getElementById("plp-count");
        if (count && !lastQuery) count.textContent = total ? total + " public playlist" + (total === 1 ? "" : "s") : "";
        applyFilter();
      });
  }

  /* ---------------- detail ---------------- */

  function detailShell() {
    var ov = document.getElementById("plp-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "plp-overlay";
    ov.id = "plp-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "plp-dtitle");
    ov.innerHTML =
      '<div class="plp-dlg">' +
      '<div class="plp-dhead"><div class="plp-dtitle" id="plp-dtitle">Playlist</div>' +
      '<button class="plp-x" type="button" data-plp-close="1" aria-label="Close"><i class="fas fa-xmark"></i></button></div>' +
      '<div id="plp-dbody"></div>' +
      '<div class="plp-dfoot"><button class="plp-btn" type="button" data-plp-close="1">Close</button></div>' +
      "</div>";
    (document.body || document.documentElement).appendChild(ov);
    ov.addEventListener("click", function (e) {
      if (e.target === ov || e.target.closest("[data-plp-close]")) closeDetail();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) closeDetail();
    });
    return ov;
  }

  function closeDetail() {
    var ov = document.getElementById("plp-overlay");
    if (ov) ov.classList.remove("open");
  }

  function openDetail(id) {
    var ov = detailShell();
    var body = document.getElementById("plp-dbody");
    ov.classList.add("open");
    body.innerHTML = '<div class="plp-empty">Loading…</div>';
    fetch("/api/playlist/" + encodeURIComponent(id), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: "could not load" }; })
      .then(function (d) {
        if (!d || d.ok !== true) {
          body.innerHTML = '<div class="plp-empty">' + esc((d && d.error) || "This playlist is not available.") + "</div>";
          return;
        }
        var pl = d.playlist || {};
        var creator = d.creator || {};
        var tracks = d.tracks || [];
        document.getElementById("plp-dtitle").textContent = pl.name || "Playlist";
        body.innerHTML =
          tile({ color: pl.color, owner_avatar: creator.avatar, name: pl.name }, "plp-dcover") +
          '<div class="plp-downer">by ' + esc(creator.name || "anon") + " &middot; " +
          tracks.length + " track" + (tracks.length === 1 ? "" : "s") + " &middot; " + esc(pl.visibility || "public") + "</div>" +
          (pl.desc ? '<div class="plp-ddesc">' + esc(pl.desc) + "</div>" : "") +
          (tracks.length
            ? '<ul class="plp-tracks">' + tracks.map(function (t, i) {
                return '<li class="plp-track"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(t.title) + "</span></li>";
              }).join("") + "</ul>"
            : '<div class="plp-empty">This playlist has no tracks yet.</div>');
      });
  }

  /* ---------------- mount ---------------- */

  function mount() {
    var sec = document.getElementById("page-section-playlists");
    if (!sec || document.getElementById("plp-root")) return null;
    css();
    var root = document.createElement("div");
    root.id = "plp-root";
    root.className = "plp-wrap";
    root.innerHTML =
      '<div class="plp-head"><div class="plp-title"><i class="fas fa-list-music"></i> Public Playlists</div>' +
      '<p class="plp-sub">Discover playlists from the community</p>' +
      '<div class="plp-count" id="plp-count"></div></div>' +
      '<div class="plp-filters" role="group" aria-label="Filter public playlists">' +
      '<button type="button" class="plp-filter active" data-filter="all">All</button>' +
      '<button type="button" class="plp-filter" data-filter="recent">Recent</button>' +
      '<button type="button" class="plp-filter" data-filter="popular">Most Saved</button>' +
      '</div>' +
      '<div class="plp-search"><input type="search" id="plp-search" placeholder="Search playlists..." aria-label="Search public playlists"></div>' +
      '<div class="plp-grid" id="plp-grid"></div>' +
      '<div class="plp-empty" id="plp-empty" hidden></div>' +
      '<button type="button" class="plp-more" id="plp-more" hidden>Load more</button>';
    var host = sec.querySelector("section") || sec;
    host.appendChild(root);
    return root;
  }

  function boot() {
    var root = mount();
    if (!root) return;
    /* Nothing is fetched until the page is actually opened - otherwise every
       visit to the site would pay for a list nobody looks at. */
    var loaded = false;
    function firstOpen() {
      if (loaded) return;
      loaded = true;
      loadPage(true);
    }
    root.addEventListener("click", function (e) {
      var more = e.target.closest ? e.target.closest("#plp-more") : null;
      if (more) { loadPage(false); return; }
      var filter = e.target.closest ? e.target.closest("[data-filter]") : null;
      if (filter) {
        currentFilter = filter.getAttribute("data-filter") || "all";
        root.querySelectorAll("[data-filter]").forEach(function (b) { b.classList.toggle("active", b === filter); });
        loadPage(true);
        return;
      }
      var card = e.target.closest ? e.target.closest(".plp-card") : null;
      if (card) openDetail(card.getAttribute("data-pl"));
    });
    var search = document.getElementById("plp-search");
    if (search) {
      var timer = null;
      search.addEventListener("input", function () {
        var q = search.value.trim().toLowerCase();
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { lastQuery = q; applyFilter(); }, 200);
      });
    }
    var sec = document.getElementById("page-section-playlists");
    if (sec && sec.classList.contains("active")) firstOpen();
    if (sec && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (!sec.classList.contains("active")) return;
        if (!document.getElementById("plp-root")) mount();
        firstOpen();
      });
      observer.observe(sec, { attributes: true, attributeFilter: ["class"] });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();