/*
 * The command palette - Ctrl+K, and the site answers before the network
 * does.
 *
 * The site has a search, and it is a good one: it looks through the
 * community, the vault and the people. But it asks the server, so every
 * keystroke waits for a round trip, and on a slow connection it waits
 * for several.
 *
 * Almost everything a person wants from a search box is already in the
 * page: the catalogue of songs is in memory, the pages are in the
 * markup, and the actions are functions. So the palette answers those
 * from the page itself - no request, no waiting - and only asks the
 * server for the one thing the page cannot know, which is what other
 * people have written.
 *
 * The trending list is fetched while the browser is idle, so it is
 * already there when the palette opens.
 *
 * The palette is built the first time it is opened and not before, so
 * it costs the site nothing until somebody wants it.
 */

(function () {
  "use strict";
  if (window.__commandPaletteMounted) return;
  window.__commandPaletteMounted = true;

  var API = "/api/trending?days=7&limit=8";
  var state = {
    open: false,
    rows: [],
    active: 0,
    q: "",
    trending: null,
    people: null,
    peopleQ: "",
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* The catalogue, from the page. tracks.js declares it with const, so it
     is a lexical global and not a property of window. */
  function catalogue() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    try { if (window.trackList && window.trackList.length) return window.trackList; } catch (e2) {}
    return [];
  }

  function smallCover(src) {
    try {
      if (typeof window._coverThumb === "function") return window._coverThumb(src, "320") || src;
    } catch (e) {}
    return src;
  }

  /* ---- the pages a person can go to ---- */
  function pageRows() {
    var out = [];
    function add(icon, label, page, hint) {
      out.push({
        group: "Go to",
        icon: icon,
        label: label,
        hint: hint || "",
        run: function () {
          if (typeof window.switchAppPage === "function") window.switchAppPage(page);
        },
      });
    }
    add("fa-house", "Lobby", "home");
    add("fa-compact-disc", "WRLD Player", "player");
    add("fa-server", "The Vault", "hub");
    add("fa-chart-pie", "Stats", "stats");
    add("fa-book-open", "Updates", "updates");
    add("fa-record-vinyl", "Era Pages", "era");
    add("fa-vote-yea", "Wanted Vault", "wanted");
    add("fa-users", "Community Board", "community");
    add("fa-lightbulb", "Suggestions", "suggestions");
    add("fa-images", "Gallery", "gallery");
    add("fa-fire", "Trending", "trending", "what is being played");
    add("fa-map", "Roadmap", "roadmap");
    add("fa-palette", "Community Themes", "community-themes");
    add("fa-id-badge", "Credits", "credits");
    add("fa-box-archive", "Failed Projects", "failed");
    add("fa-circle-info", "About", "about");
    add("fa-handshake", "Partnership", "partner");
    add("fa-gear", "Settings", "account");
    return out;
  }

  /* ---- the things a person can do ---- */
  function actionRows() {
    var out = [];
    function add(icon, label, hint, run) {
      out.push({ group: "Do", icon: icon, label: label, hint: hint || "", run: run });
    }
    add("fa-dice", "Surprise me", "a random song", function () {
      if (typeof window.spinTrack === "function") window.spinTrack();
    });
    add("fa-comment", "Comments on this song", "the thread under the bar", function () {
      var b = document.getElementById("song-comments-btn");
      if (b) b.click();
    });
    add("fa-list", "The queue", "what plays next", function () {
      if (typeof window.toggleQueuePanel === "function") window.toggleQueuePanel();
    });
    add("fa-magnifying-glass", "Search people and posts", "the whole site", function () {
      var b = document.getElementById("gsToggle");
      if (b) b.click();
    });
    add("fa-palette", "Change the theme", "how the site looks", function () {
      if (window.switchAppPage) window.switchAppPage("account");
      var nav = document.querySelector('.set-nav-item[data-set-tab="appearance"]');
      if (nav) nav.click();
    });
    add("fa-right-to-bracket", "Sign in or out", "", function () {
      var b = document.getElementById("navPillAuthBtn") || document.getElementById("nav-account-btn");
      if (b) b.click();
    });
    return out;
  }

  /* ---- the songs, out of the page, with no waiting ---- */
  function trackRows(q) {
    var tl = catalogue();
    if (!tl.length) return [];
    var low = q.toLowerCase();
    var out = [];
    var i, t, hay, title;
    for (i = 0; i < tl.length && out.length < 12; i++) {
      t = tl[i] || {};
      title = String(t.title || "");
      hay = (title + " " + (t.tag || "") + " " + (t.artist || "") + " " + (t.producer || "") + " " + (t.category || "")).toLowerCase();
      if (q && hay.indexOf(low) < 0) continue;
      out.push({
        group: q ? "Songs" : "Recently added",
        icon: "fa-compact-disc",
        label: title,
        hint: [t.artist, t.tag].filter(Boolean).join(" - "),
        cover: smallCover(t.cover || "Juice-WRLD.png"),
        run: (function (idx) {
          return function () {
            if (typeof window.selectTrackFromList === "function") window.selectTrackFromList(idx);
            if (typeof window.switchAppPage === "function") window.switchAppPage("player");
          };
        })(i),
      });
    }
    return out;
  }

  /* ---- what everybody else has written, which only the server knows ---- */
  function peopleRows(q) {
    if (!q || q.length < 2) return [];
    var out = [];
    if (state.people && state.peopleQ === q) {
      (state.people.posts || []).slice(0, 5).forEach(function (p) {
        out.push({
          group: "From the community",
          icon: "fa-message",
          label: p.title || p.body || "a post",
          hint: p.author_name || p.user_name || "",
          run: function () {
            if (typeof window.switchAppPage === "function") window.switchAppPage("community");
          },
        });
      });
      (state.people.profiles || []).slice(0, 5).forEach(function (p) {
        out.push({
          group: "People",
          icon: "fa-user",
          label: p.name || p.handle || p.uid,
          hint: p.handle ? "@" + p.handle : "",
          run: function () {
            if (typeof window.openProfile === "function") window.openProfile(p.handle || p.uid);
          },
        });
      });
    }
    return out;
  }

  /* ---- the trending list, fetched while the browser is idle ---- */
  function warmTrending() {
    if (state.trending) return;
    fetch(API, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.trending) return;
        state.trending = data.trending;
        if (state.open) draw();
      })
      .catch(function () {});
  }

  function trendingRows() {
    if (!state.trending) return [];
    var tl = catalogue();
    var out = [];
    state.trending.slice(0, 6).forEach(function (row) {
      var title = String(row.title || "");
      var idx = -1;
      for (var i = 0; i < tl.length; i++) {
        if (String((tl[i] || {}).title || "").toLowerCase() === title.toLowerCase()) { idx = i; break; }
      }
      out.push({
        group: "Trending",
        icon: "fa-fire",
        label: title,
        hint: (row.plays || 0) + " plays - " + (row.listeners || 0) + " listeners",
        cover: idx >= 0 ? smallCover((tl[idx] || {}).cover || "Juice-WRLD.png") : "",
        run: (function (i) {
          return function () {
            if (i >= 0 && typeof window.selectTrackFromList === "function") window.selectTrackFromList(i);
            if (typeof window.switchAppPage === "function") window.switchAppPage("player");
          };
        })(idx),
      });
    });
    return out;
  }

  /* ---- asking the server about people, once the page has nothing left
     to offer ---- */
  function askServer(q) {
    if (!q || q.length < 2) { state.people = null; return; }
    if (state.peopleQ === q) return;
    state.peopleQ = q;
    fetch("/api/search?q=" + encodeURIComponent(q), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || state.peopleQ !== q) return;
        state.people = data;
        if (state.open) draw();
      })
      .catch(function () {});
  }

  /* ---- the markup, built the first time the palette is opened ---- */
  function mount() {
    if (document.getElementById("cmd-palette-root")) return;

    var root = el("div");
    root.id = "cmd-palette-root";
    root.innerHTML =
      '<div id="cmd-palette-overlay" hidden>' +
        '<div id="cmd-palette-wash" aria-hidden="true"></div>' +
        '<section id="cmd-palette" role="dialog" aria-modal="true" aria-label="Search and commands">' +
          '<div class="cmd-head">' +
            '<i class="fas fa-magnifying-glass cmd-head-icon" aria-hidden="true"></i>' +
            '<input id="cmd-input" type="text" autocomplete="off" spellcheck="false" ' +
              'placeholder="Search the songs, the pages, the commands" aria-label="Search">' +
            '<button id="cmd-close" type="button" class="cmd-close" aria-label="Close">' +
              '<i class="fas fa-xmark" aria-hidden="true"></i>' +
            "</button>" +
          "</div>" +
          '<div id="cmd-results" class="cmd-results" role="listbox"></div>' +
          '<div class="cmd-foot">' +
            '<span><kbd>↑</kbd><kbd>↓</kbd> to move</span>' +
            '<span><kbd>Enter</kbd> to open</span>' +
            '<span><kbd>Esc</kbd> to close</span>' +
          "</div>" +
        "</section>" +
      "</div>";
    document.body.appendChild(root);

    document.getElementById("cmd-close").addEventListener("click", function () { close(); });
    document.getElementById("cmd-palette-wash").addEventListener("click", function () { close(); });

    var input = document.getElementById("cmd-input");
    input.addEventListener("input", function () {
      state.q = input.value.trim();
      state.active = 0;
      draw();
      askServer(state.q);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var row = state.rows[state.active];
        if (row && row.run) { close(); row.run(); }
      } else if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) { e.preventDefault(); close(); }
    });
  }

  function move(step) {
    if (!state.rows.length) return;
    state.active = (state.active + step + state.rows.length) % state.rows.length;
    var list = document.getElementById("cmd-results");
    var active = list.querySelector(".cmd-row.is-active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  /* ---- the drawing ---- */
  function draw() {
    var list = document.getElementById("cmd-results");
    if (!list) return;
    list.textContent = "";

    var q = state.q;
    var rows = [];
    if (q) {
      rows = trackRows(q).concat(pageRows().filter(function (r) {
        return (r.label + " " + r.hint).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      })).concat(actionRows().filter(function (r) {
        return (r.label + " " + r.hint).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      })).concat(peopleRows(q));
    } else {
      rows = trendingRows().concat(actionRows().slice(0, 3)).concat(pageRows().slice(0, 6));
    }
    if (state.active >= rows.length) state.active = 0;
    state.rows = rows;

    if (!rows.length) {
      var empty = el("p", "cmd-empty", q ? "Nothing here by that name." : "Nothing to show yet.");
      list.appendChild(empty);
      return;
    }

    var lastGroup = "";
    rows.forEach(function (row, i) {
      if (row.group !== lastGroup) {
        var head = el("div", "cmd-group", row.group);
        list.appendChild(head);
        lastGroup = row.group;
      }
      var node = el("button", "cmd-row" + (i === state.active ? " is-active" : ""));
      node.type = "button";
      node.setAttribute("role", "option");
      if (row.cover) {
        var img = document.createElement("img");
        img.className = "cmd-cover";
        img.src = row.cover;
        img.alt = "";
        img.loading = "lazy";
        node.appendChild(img);
      } else {
        var icon = el("i", "fas " + row.icon + " cmd-icon");
        icon.setAttribute("aria-hidden", "true");
        node.appendChild(icon);
      }
      var text = el("span", "cmd-text");
      text.appendChild(el("span", "cmd-label", row.label));
      if (row.hint) text.appendChild(el("span", "cmd-hint", row.hint));
      node.appendChild(text);
      node.addEventListener("click", function () {
        close();
        if (row.run) row.run();
      });
      node.addEventListener("mousemove", function () {
        state.active = i;
        Array.prototype.forEach.call(list.querySelectorAll(".cmd-row"), function (n, k) {
          n.classList.toggle("is-active", k === i);
        });
      });
      list.appendChild(node);
    });
  }

  function open() {
    mount();
    state.open = true;
    state.q = "";
    state.active = 0;
    var overlay = document.getElementById("cmd-palette-overlay");
    overlay.hidden = false;
    var input = document.getElementById("cmd-input");
    input.value = "";
    draw();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 20);
  }

  function close() {
    state.open = false;
    var overlay = document.getElementById("cmd-palette-overlay");
    if (overlay) overlay.hidden = true;
  }

  /* ---- the keys ---- */
  function inAField(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }

  document.addEventListener("keydown", function (e) {
    /* Ctrl+K, or the command key on a Mac. */
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (state.open) close(); else open();
      return;
    }
    /* The slash, when it is not being typed into something. */
    if (e.key === "/" && !state.open && !inAField(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  }, true);

  /* The trending list is fetched while the browser has nothing to do,
     so it is already there when the palette is opened. */
  function idle(fn) {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 2500);
  }
  idle(warmTrending);

  window.openCommandPalette = open;
})();
