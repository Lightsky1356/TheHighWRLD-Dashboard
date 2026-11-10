/* Batch 20 - the artist name filters the wall.
 *
 * Clicking a name used to open a panel. It does not any more: it picks
 * that artist in the wall's own filter, exactly as clicking their chip
 * does, so the page shows the covers they made and nothing else. The
 * links the artist left are shown in that same place - under the filter
 * that is doing the showing.
 *
 * The artist panel is untouched and still opens from the track Info panel. */
(function () {
  "use strict";

  var ROOT_ID = "page-section-credits";
  var built = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* The cover art lives in the artwork repository, not beside the site, so
     the URL is built from the file name the credit table holds. */
  function coverUrl(file) {
    if (!file) return "";
    if (/^https?:/i.test(file)) return file;
    return "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/Covers/" +
      encodeURIComponent(file);
  }

  /* The track a cover belongs to, so the wall can name the song rather than
     a bare file name. trackList is the catalogue. */
  var trackCache = null;
  function trackFor(file, title) {
    if (!trackCache) trackCache = (typeof trackList !== "undefined" && trackList) || [];
    for (var i = 0; i < trackCache.length; i++) {
      var t = trackCache[i];
      if (!t) continue;
      var cov = String(t.cover || "");
      var name = cov.split("/").pop();
      try { name = decodeURIComponent(name); } catch (e) {}
      if (file && name === file) return t;
      if (title && t.title === title) return t;
    }
    return null;
  }

  /* Font Awesome: the brand marks live in the brands font, not the solid
     one, so they need the other prefix. */
  var BRAND_ICONS = { instagram: 1, tiktok: 1, twitter: 1, x: 1, discord: 1, youtube: 1 };
  function linkIcon(icon) {
    var i = String(icon || "link");
    return (BRAND_ICONS[i] ? "fab fa-" : "fas fa-") + i;
  }

  /* ---------- The cover view ---------- */
  var modal = null;
  var lastFocus = null;

  function buildModal() {
    if (modal) return modal;
    var el = document.createElement("div");
    el.className = "cw-modal";
    el.setAttribute("hidden", "");
    el.innerHTML =
      '<div class="cw-modal-backdrop" data-cw-close></div>' +
      '<div class="cw-modal-card" role="dialog" aria-modal="true" aria-labelledby="cw-modal-title">' +
      '<button type="button" class="cw-modal-x" data-cw-close aria-label="Close">&times;</button>' +
      '<figure class="cw-modal-art"><img alt=""></figure>' +
      '<figcaption class="cw-modal-meta">' +
      '<span class="cw-modal-eyebrow">Cover art</span>' +
      '<h2 class="cw-modal-title" id="cw-modal-title"></h2>' +
      '<p class="cw-modal-credit"><span class="cw-dot"></span><span data-cw-credit-name></span></p>' +
      '</figcaption></div>';
    document.body.appendChild(el);
    modal = el;
    el.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-cw-close]")) closeModal();
    });
    return el;
  }

  function openModal(entry) {
    var el = buildModal();
    var img = el.querySelector(".cw-modal-art img");
    img.src = coverUrl(entry.file);
    img.alt = entry.title + " cover art";
    el.querySelector(".cw-modal-title").textContent = entry.title;
    el.querySelector("[data-cw-credit-name]").textContent = entry.artist;
    el.querySelector(".cw-dot").style.setProperty("--cw-color", entry.color || "#a855f7");
    el.hidden = false;
    document.body.classList.add("cw-modal-open");
    lastFocus = document.activeElement;
    var x = el.querySelector(".cw-modal-x");
    if (x) x.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("cw-modal-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && modal && !modal.hidden) closeModal();
  });

  /* ---------- The wall ---------- */
  var artistsByName = {};

  function build() {
    var root = document.querySelector("#" + ROOT_ID + " .cw-mount");
    if (!root) return;

    var artists = (typeof artistData !== "undefined" && artistData) || [];
    var entries = [];

    for (var i = 0; i < artists.length; i++) {
      var a = artists[i];
      if (!a || !a.tracks || !a.tracks.length) continue;
      artistsByName[a.name] = a;
      for (var j = 0; j < a.tracks.length; j++) {
        var row = a.tracks[j];
        if (!row) continue;
        var title = row[0], file = row[1];
        var t = trackFor(file, title);
        entries.push({
          artist: a.name,
          color: a.color || "hsl(260,60%,55%)",
          title: title || (t && t.title) || file || "untitled",
          file: file || "",
        });
      }
    }

    /* One artist can hold several covers; the filter lists them by how
       many they made. */
    var byArtist = {};
    var order = [];
    entries.forEach(function (e) {
      if (!byArtist[e.artist]) { byArtist[e.artist] = []; order.push(e.artist); }
      byArtist[e.artist].push(e);
    });
    order.sort(function (x, y) {
      return byArtist[y].length - byArtist[x].length || x.localeCompare(y);
    });

    var credited = entries.length;
    var artistCount = order.length;

    var html = "";
    html += '<div class="cw-head">';
    html += '<div class="cw-head-main">';
    html += '<span class="cw-eyebrow">The credits wall</span>';
    html += '<h2 class="cw-title">Every cover, and who made it</h2>';
    html += '<p class="abp-lede">The cover art that ships with the catalogue, ' +
      'with the artist credited for each one. Tap a cover to see it full ' +
      'size, or tap a name to see everything that artist made.</p>';
    html += '</div>';
    html += '<div class="cw-stats">';
    html += '<div class="cw-stat"><b>' + credited + '</b><span>credited covers</span></div>';
    html += '<div class="cw-stat"><b>' + artistCount + '</b><span>artists</span></div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="cw-filters" role="group" aria-label="Filter the wall by artist">';
    html += '<button type="button" class="cw-chip is-on" data-cw-artist="">All</button>';
    order.forEach(function (name) {
      html += '<button type="button" class="cw-chip" data-cw-artist="' + esc(name) + '">' +
        esc(name) + ' <span class="cw-chip-n">' + byArtist[name].length + '</span></button>';
    });
    html += '</div>';

    /* The bar that appears when one artist is picked: who they are and
       the links they left. It sits with the filter that is doing the
       showing. */
    html += '<div class="cw-links-bar" data-cw-links-bar hidden>' +
      '<div class="cw-links-who">' +
      '<span class="cw-links-pfp" data-cw-pfp></span>' +
      '<span class="cw-links-name" data-cw-links-name></span>' +
      '<span class="cw-links-count" data-cw-links-count></span>' +
      '</div>' +
      '<div class="cw-links-list" data-cw-links-list></div>' +
      '<button type="button" class="cw-links-clear" data-cw-clear>Show every cover</button>' +
      '</div>';

    html += '<div class="cw-grid">';
    entries.forEach(function (e) {
      html += '<article class="cw-card" data-cw-card data-cw-artist="' + esc(e.artist) + '" ' +
        'tabindex="0" role="button" aria-label="View ' + esc(e.title) + ' cover art">';
      html += '<div class="cw-cover">';
      html += '<img loading="lazy" decoding="async" src="' + esc(coverUrl(e.file)) +
        '" alt="' + esc(e.title) + ' cover art" onerror="this.closest(\'.cw-cover\')' +
        '.classList.add(\'is-missing\');this.remove();">';
      html += '</div>';
      html += '<div class="cw-meta">';
      html += '<h3 class="cw-track" title="' + esc(e.title) + '">' + esc(e.title) + '</h3>';
      html += '<button type="button" class="cw-credit" data-cw-open="' + esc(e.artist) + '" ' +
        'style="--cw-color:' + esc(e.color) + '" title="Show only ' + esc(e.artist) + '\'s covers">';
      html += '<span class="cw-dot"></span>' + esc(e.artist);
      html += '</button>';
      html += '</div>';
      html += '</article>';
    });
    html += '</div>';

    if (!entries.length) {
      html = '<p class="cw-empty">No cover art is credited yet.</p>';
    }

    root.innerHTML = html;

    /* ---------- The filter ---------- */
    var chips = root.querySelectorAll(".cw-chip");
    var bar = root.querySelector("[data-cw-links-bar]");
    var linksList = root.querySelector("[data-cw-links-list]");
    var linksName = root.querySelector("[data-cw-links-name]");
    var linksCount = root.querySelector("[data-cw-links-count]");
    var linksPfp = root.querySelector("[data-cw-pfp]");

    /* The links the picked artist left. */
    function showLinks(name) {
      if (!name) {
        bar.hidden = true;
        return;
      }
      var artist = artistsByName[name];
      if (!artist) { bar.hidden = true; return; }
      bar.hidden = false;
      linksName.textContent = artist.name;
      linksCount.textContent = (byArtist[name] || []).length + " cover" +
        ((byArtist[name] || []).length === 1 ? "" : "s");

      linksPfp.innerHTML = "";
      if (artist.pfp) {
        var pfp = document.createElement("img");
        pfp.alt = "";
        pfp.addEventListener("error", function () {
          linksPfp.innerHTML = '<i class="fas fa-user"></i>';
        });
        linksPfp.appendChild(pfp);
        pfp.src = "./" + artist.pfp;
      } else {
        linksPfp.innerHTML = '<i class="fas fa-user"></i>';
      }
      if (artist.color) {
        linksPfp.style.borderColor = String(artist.color).replace("hsl(", "hsla(").replace(")", ",0.35)");
        linksPfp.style.color = String(artist.color).replace("hsl(", "hsla(").replace(")", ",0.65)");
      }

      linksList.innerHTML = "";
      var links = artist.links || [];
      if (!links.length) {
        linksList.innerHTML = '<span class="cw-links-none">No links left</span>';
        return;
      }
      links.forEach(function (l) {
        if (!l || !l.url) return;
        var a = document.createElement("a");
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "cw-artist-link";
        if (artist.color) a.style.setProperty("--cw-color", artist.color);
        a.innerHTML = '<i class="' + linkIcon(l.icon) + '"></i><span>' +
          esc(l.text || l.url.replace(/^https?:\/\//, "")) + "</span>";
        linksList.appendChild(a);
      });
    }

    /* One place decides what is shown, so the chips and the names on the
       cards can never disagree about it. */
    function applyFilter(who) {
      chips.forEach(function (c) {
        var cName = c.getAttribute("data-cw-artist") || "";
        c.classList.toggle("is-on", cName === (who || ""));
      });
      var shown = 0;
      root.querySelectorAll("[data-cw-card]").forEach(function (card) {
        var match = !who || card.getAttribute("data-cw-artist") === who;
        card.style.display = match ? "" : "none";
        if (match) shown++;
      });
      /* The counter is made after this function is defined, so it is
         looked up here rather than captured up front. */
      var counter = root.querySelector(".cw-count");
      if (counter) counter.textContent = shown + " cover" + (shown === 1 ? "" : "s");
      showLinks(who || "");
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        applyFilter(chip.getAttribute("data-cw-artist") || "");
      });
    });

    /* Clicking a name on a card picks that artist in the filter. It does
       not open a panel - the wall shows their covers and their links. */
    root.querySelectorAll("[data-cw-open]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        applyFilter(btn.getAttribute("data-cw-open") || "");
      });
    });

    /* The way back to everything. */
    var clear = root.querySelector("[data-cw-clear]");
    if (clear) {
      clear.addEventListener("click", function () {
        applyFilter("");
      });
    }

    /* Clicking a cover opens it full size in the cover view. */
    var cards = root.querySelectorAll("[data-cw-card]");
    cards.forEach(function (card) {
      var idx = Array.prototype.indexOf.call(cards, card);
      function open() { openModal(entries[idx]); }
      card.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-cw-open]")) return;
        open();
      });
      card.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); }
      });
    });

    /* A small count in the corner, so the filter knows what it did. */
    var count = document.createElement("p");
    count.className = "cw-count";
    count.textContent = credited + " cover" + (credited === 1 ? "" : "s");
    var filters = root.querySelector(".cw-filters");
    if (filters) filters.insertAdjacentElement("afterend", count);
  }

  function mount() {
    if (built) return;
    built = true;
    build();
  }

  /* The page is built the first time it is opened, so the home page never
     pays for it. */
  function watch() {
    var sec = document.getElementById(ROOT_ID);
    if (!sec) return;
    var mo = new MutationObserver(function () {
      if (sec.classList.contains("active")) mount();
    });
    mo.observe(sec, { attributes: true, attributeFilter: ["class", "style"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch);
  } else {
    watch();
  }
})();
