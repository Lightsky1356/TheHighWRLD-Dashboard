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

  /* The wall draws each cover at 150px, so it wants the 320px tier - twice
     that, for a retina screen. The full-size picture stays where it is: the
     big view and the download button both want the original bytes, and a
     download that handed over a thumbnail would be a different picture. */
  function thumbUrl(file, tier) {
    if (!file) return "";
    var t = window._coverThumb ? window._coverThumb("Covers/" + file, tier || "320") : null;
    return t || coverUrl(file);
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


  /* ---------- Scroll lock ----------
     A view over the wall must not let the wall scroll underneath it.
     The class is only removed when every view is closed, so opening one
     while another is open cannot unlock the page by accident. */
  var scrollLocked = 0;
  var savedScroll = 0;
  function lockScroll() {
    if (scrollLocked++ === 0) {
      savedScroll = window.scrollY || window.pageYOffset || 0;
      document.body.style.position = "fixed";
      document.body.style.top = "-" + savedScroll + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      document.body.classList.add("cw-modal-open");
    }
  }
  function unlockScroll() {
    if (scrollLocked > 0) scrollLocked--;
    if (scrollLocked === 0) {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.body.classList.remove("cw-modal-open");
      /* Put the page back where it was, not at the top. */
      window.scrollTo(0, savedScroll);
    }
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
      '<button type="button" class="cw-modal-download" data-cw-download>' +
      '<i class="fas fa-download"></i><span>Download the cover</span></button>' +
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
    /* The big picture, from this site's own CDN. The original is still
       what the download button fetches - a download that handed over a
       resized picture would be a different picture. */
    img.src = thumbUrl(entry.file, "640") || coverUrl(entry.file);
    img.alt = entry.title + " cover art";
    el.querySelector(".cw-modal-title").textContent = entry.title;
    var nameEl = el.querySelector("[data-cw-credit-name]");
    nameEl.textContent = entry.artist;
    /* The name is a control: it picks that artist in the wall's filter,
       so the view closes onto just their covers. */
    nameEl.classList.add("cw-modal-credit-link");
    nameEl.setAttribute("role", "button");
    nameEl.setAttribute("tabindex", "0");
    nameEl.title = "Show only " + entry.artist + "'s covers";
    nameEl.onclick = function () {
      closeModal();
      if (typeof window.__cwFilter === "function") window.__cwFilter(entry.artist);
    };
    nameEl.onkeydown = function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        nameEl.onclick();
      }
    };
    el.querySelector(".cw-dot").style.setProperty("--cw-color", entry.color || "#a855f7");
    /* The download button takes the picture itself. */
    var dlBtn = el.querySelector("[data-cw-download]");
    if (dlBtn) {
      dlBtn.onclick = function (ev) {
        ev.stopPropagation();
        var src = coverUrl(entry.file);
        dlBtn.disabled = true;
        fetch(src)
          .then(function (r) { if (!r.ok) throw new Error("failed"); return r.blob(); })
          .then(function (blob) {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = (entry.title || "cover") + ".png";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
              document.body.removeChild(a);
              URL.revokeObjectURL(a.href);
            }, 1200);
          })
          .catch(function () {
            /* No picture to fetch: open it instead of doing nothing. */
            window.open(src, "_blank", "noopener");
          })
          .then(function () { dlBtn.disabled = false; });
      };
    }
    el.hidden = false;
    lockScroll();
    lastFocus = document.activeElement;
    var x = el.querySelector(".cw-modal-x");
    if (x) x.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    unlockScroll();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && modal && !modal.hidden) closeModal();
  });


  /* How many covers are fetched at once when the page opens. */
  var EAGER = 24;

  /* The rest are warmed in the browser's cache while it is idle, so a
     member who scrolls never waits for a picture to arrive. */
  function prefetchCovers(list) {
    var i = 0;
    function batch(deadline) {
      var time = deadline && deadline.timeRemaining ? deadline.timeRemaining() : 8;
      while (i < list.length && (time > 4 || (deadline && deadline.didTimeout))) {
        var im = new Image();
        im.decoding = "async";
        im.src = list[i++];
        if (deadline && deadline.timeRemaining) time = deadline.timeRemaining();
        else time--;
      }
      if (i < list.length) {
        if (window.requestIdleCallback) window.requestIdleCallback(batch, { timeout: 2500 });
        else setTimeout(function () { batch(null); }, 400);
      }
    }
    if (window.requestIdleCallback) window.requestIdleCallback(batch, { timeout: 2500 });
    else setTimeout(function () { batch(null); }, 1200);
  }

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
    entries.forEach(function (e, i) {
      html += '<article class="cw-card" data-cw-card data-cw-artist="' + esc(e.artist) + '" ' +
        'tabindex="0" role="button" aria-label="View ' + esc(e.title) + ' cover art">';
      html += '<div class="cw-cover">';
      /* The first row is loaded at once - it is what is on screen when the
         page opens. The rest carry their address in data-src and are given
         it when their batch is wanted, so a reader who never scrolls past
         the first screen never downloads the other two hundred covers. */
      html += '<img ' + (i < EAGER
        ? 'loading="eager" fetchpriority="high" src="' + esc(thumbUrl(e.file)) + '"'
        : 'loading="lazy" fetchpriority="low" data-src="' + esc(thumbUrl(e.file)) + '"') +
        ' decoding="async" alt="' + esc(e.title) + ' cover art" onerror="this.closest(\'.cw-cover\')' +
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

    /* The loader. It sits at the foot of the wall, and it says what it is
       doing rather than leaving a reader to wonder why the page has
       stopped. */
    html += '<div class="cw-more" data-cw-more>' +
      '<span class="cw-more-spin" aria-hidden="true"></span>' +
      '<span class="cw-more-text">Scroll for More Covers</span>' +
      '</div>';

    /* The count is made with the markup, not after it, so the filter can
       always find it - the wall can open already filtered to one artist,
       and the count has to be right from the first paint. */
    html += '<p class="cw-count">' + credited + " cover" + (credited === 1 ? "" : "s") + '</p>';

    if (!entries.length) {
      html = '<p class="cw-empty">No cover art is credited yet.</p>';
    }

    root.innerHTML = html;

    /* ---------- Loading more ----------
       * The wall is long and every cover is a picture, so the pictures come
       * in batches. The next batch is fetched before the reader reaches it,
       * and the loader says what it is doing while it happens. */
    var grid = root.querySelector(".cw-grid");
    var moreEl = root.querySelector("[data-cw-more]");
    var moreText = moreEl ? moreEl.querySelector(".cw-more-text") : null;
    var cards = Array.prototype.slice.call(root.querySelectorAll("[data-cw-card]"));
    var PAGE = 36;
    var loaded = EAGER;
    var loading = false;
    var currentArtist = "";

    /* Give the pictures in a list of cards their addresses, and say when
       they are all there. */
    function loadIndexes(idxs, done) {
      var waiting = [];
      for (var i = 0; i < idxs.length; i++) {
        var card = cards[idxs[i]];
        if (!card) continue;
        var img = card.querySelector("img[data-src]");
        if (!img) continue;
        var src = img.getAttribute("data-src");
        img.removeAttribute("data-src");
        /* The browser does not fetch a lazy picture that is nowhere near the
           screen, so a batch of them would wait for ever for pictures that
           were never going to be asked for - and the wall stopped at the
           first twenty-four because of it. A thumbnail is a couple of
           kilobytes and a batch is thirty-six of them, so they are handed
           over as eager ones and fetched now. */
        img.loading = "eager";
        waiting.push({ img: img, src: src });
      }
      if (!waiting.length) { done(); return; }
      var left = waiting.length;
      var finished = false;
      var finish = function () {
        if (finished) return;
        if (--left > 0) return;
        finished = true;
        done();
      };
      /* And a picture that never answers - a broken address, a connection
         that went away - must not hold the whole wall hostage. */
      setTimeout(function () {
        if (finished) return;
        finished = true;
        done();
      }, 8000);
      for (var j = 0; j < waiting.length; j++) {
        var w = waiting[j];
        w.img.addEventListener("load", finish, { once: true });
        w.img.addEventListener("error", finish, { once: true });
        w.img.src = w.src;
      }
    }

    /* What is on screen: the covers that match the filter AND are in a
       batch that has been loaded. */
    function showUpTo(n, who) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var match = !who || card.getAttribute("data-cw-artist") === who;
        card.style.display = (match && i < n) ? "" : "none";
      }
    }

    /* Three states: waiting for a touch, working, and finished. The
       label says which one it is, so a reader is never left wondering
       why the wall has stopped. */
    function setLoader(text, state) {
      if (!moreEl) return;
      if (state === "done") {
        moreEl.hidden = true;
        moreEl.disabled = true;
        moreEl.classList.remove("is-loading");
        return;
      }
      moreEl.hidden = false;
      moreEl.disabled = false;
      moreEl.classList.toggle("is-loading", state === "loading");
      if (moreText) moreText.textContent = text;
    }

    function loadMore() {
      if (loading || loaded >= entries.length) return;
      loading = true;
      setLoader("Loading More Covers", "loading");
      var from = loaded;
      var to = Math.min(from + PAGE, entries.length);
      var idxs = [];
      for (var i = from; i < to; i++) idxs.push(i);
      loadIndexes(idxs, function () {
        loaded = to;
        loading = false;
        showUpTo(loaded, currentArtist);
        if (loaded >= entries.length) {
          setLoader("", "done");
        } else {
          setLoader("Scroll for More Covers", "more");
        }
      });
    }

    /* The first batch is the one on screen when the page opens. */
    showUpTo(loaded, "");
    if (entries.length <= loaded) setLoader("", "done");

    /* The wall grows as the reader goes down it. The loader says so, and
       the next batch is fetched before the reader reaches it, so the
       covers are already there when they arrive. */
    if (moreEl && typeof IntersectionObserver === "function") {
      var io = new IntersectionObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].isIntersecting) loadMore();
        }
      }, { rootMargin: "600px 0px" });
      io.observe(moreEl);
    }

    /* The count sits under the filters, where the filter's own doing is
       read. */
    var filtersEl = root.querySelector(".cw-filters");
    var countEl = root.querySelector(".cw-count");
    if (filtersEl && countEl) filtersEl.insertAdjacentElement("afterend", countEl);

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
        pfp.src = "/Credits/" + artist.pfp;
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
      currentArtist = who || "";
      var shown = 0;
      if (currentArtist) {
        /* One artist: every cover they made, loaded at once. They made a
           handful, so there is nothing to batch. */
        var idxs = [];
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].getAttribute("data-cw-artist") === currentArtist) {
            idxs.push(i);
            shown++;
          }
        }
        loadIndexes(idxs, function () { showUpTo(cards.length, currentArtist); });
        showUpTo(cards.length, currentArtist);
        setLoader("", "done");
      } else {
        /* Every cover: the ones that have been loaded, and no more. */
        for (var j = 0; j < cards.length; j++) {
          if (j < loaded) shown++;
        }
        showUpTo(loaded, "");
        if (entries.length > loaded) setLoader("Scroll for More Covers", "more");
        else setLoader("", "done");
      }
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

    /* The cover view asks the wall to pick an artist, so the filter is
       reachable from outside the page's own code. */
    window.__cwFilter = applyFilter;

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

    /* The Info Panel can send a member here to one artist, so the
       wall opens already filtered to them. */
    var wanted = window.__cwArtistWanted || "";
    try {
      if (!wanted) wanted = sessionStorage.getItem("thwCreditsArtist") || "";
      if (wanted) sessionStorage.removeItem("thwCreditsArtist");
    } catch (_) {}
    if (wanted) {
      window.__cwArtistWanted = "";
      applyFilter(wanted);
    }

    /* The count is already in the markup - see above. */
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
