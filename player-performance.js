(function () {
  var ROW_HEIGHT = 64;
  var ROW_GAP = 8;
  var OVERSCAN = 12;
  var WINDOW_STEP = 4;
  var FULL_RENDER_MAX = 80;
  var measuredRowHeight = 0;
  var measuredColumns = 1;
  var cachedIsScroller = null;
  var state = { indexes: [], top: null, bottom: null, frame: 0, bound: false, start: -1, end: -1, sig: null, paint: null };
  var searchCache = [];
  var indexSig = null;
  var coverMemo = {};

  /* The window maths needs the *pitch* - the distance from one band to the next -
   not the box height. offsetHeight excludes the space-y-2 margin, so a list
   measured at 64px is really laid out at 72px; that 8px compounds with every row,
   the top spacer ends up short, scrollTop maps to the wrong row, and the error
   grows with scroll depth (measured at 27 rows of drift by the bottom of the
   list in page-flow mode). Grid view adds a 10px row-gap on top of a ~160px card.

   Pitch is therefore box + margin + (in grid) row-gap, read from the live
   computed style. Measuring it by walking sibling offsetTops instead looks
   tempting but is self-poisoning in grid: a row that has just been inserted
   shares its band with its neighbour until layout settles, so the walk skips a
   band and reports 722 instead of 178, then 1434, then 2858 - each wrong value
   inflates the spacer, which moves the rows, which inflates it again. The box
   and the gaps are fixed by CSS and cannot drift like that. */
  function rowHeight() {
    if (measuredRowHeight > 0) return measuredRowHeight;
    var node = state.top ? state.top.nextSibling : null;
    if (node && node !== state.bottom && node.offsetHeight > 0) {
      var style = getComputedStyle(node);
      var margin = parseFloat(style.marginTop) || 0;
      var gap = 0;
      /* In grid the vertical distance between bands is the row-gap, not a
       * margin: the cards themselves carry no margin-top. */
      if (isGrid()) gap = parseFloat(getComputedStyle(getContainer()).rowGap) || 0;
      var pitch = node.offsetHeight + margin + gap;
      if (pitch > 0) { measuredRowHeight = pitch; return pitch; }
    }
    return ROW_HEIGHT + ROW_GAP;
  }
  /* Grid view puts N tracks per band, so one "row" of the window is N tracks wide
   * and the window has to count bands, not tracks. The count is derived from
   * geometry - the row box plus the column gap, measured against the container's
   * content width - rather than by counting siblings that share an offsetTop.
   * That sibling count is unreliable for the same reason the pitch walk was: a
   * freshly inserted row can still be sitting in the previous band, so the count
   * comes back as 1 (or 3 instead of 4) and the spacers are sized in the wrong
   * unit. Geometry cannot drift like that, and it tracks the viewport, so the
   * column count still reflows correctly when the window is resized. */
  function columns() {
    if (measuredColumns > 1) return measuredColumns;
    var el = getContainer();
    if (!el) return 1;
    var node = state.top ? state.top.nextSibling : null;
    if (!node || node === state.bottom) return 1;
    var box = node.getBoundingClientRect().width;
    var style = getComputedStyle(el);
    var gap = parseFloat(style.columnGap) || 0;
    var inner = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    /* Sub-pixel widths at fractional zoom make this land just under the true
     * count, so add a small tolerance before flooring. */
    var fit = gap > 0 ? (inner + gap) / (box + gap) : inner / box;
    var count = Math.floor(fit + 0.01);
    if (count > 1) measuredColumns = count;
    return measuredColumns;
  }
  function isGrid() {
    var el = getContainer();
    return !!el && getComputedStyle(el).display === "grid";
  }
  function forgetRowHeight() { measuredRowHeight = 0; measuredColumns = 1; cachedIsScroller = null; }

  /* Whether this container is its own scroller decides between a windowed and a
     full render, and it only changes at a breakpoint. Reading overflow-y on every
     render would force a synchronous style recalc on every scroll frame - read it
     once and invalidate it alongside the row height, which is already invalidated
     on resize. */
  function isScroller() {
    if (cachedIsScroller !== null) return cachedIsScroller;
    var el = getContainer();
    if (!el) return false;
    var style = getComputedStyle(el);
    var hasOverflow = style.overflowY === "auto" || style.overflowY === "scroll";
    /* A finite height/max-height makes this an inner scroll viewport. Checking
     * scrollHeight instead is circular on the first render, when the list has
     * not been populated yet, and can mistake an unconstrained page-flow list
     * for an inner scroller after it has been populated. */
    var finiteHeight = style.maxHeight !== "none" ||
      (style.height !== "auto" && style.height !== "0px");
    /* Overflow-y plus a max-height is a *claim* to be a scroller, but the claim
     * is only true while the box actually has height. A container inside a hidden
     * page section reports clientHeight 0 while still advertising max-height:280px
     * and overflow-y:auto, and on a collapsed panel or a not-yet-laid-out frame
     * it reads the same way. Trusting that claim windows the list against a
     * viewport of 0px: visibleRows collapses to 1, the page-flow fallback never
     * engages, and mobile ends up rendering a window it can never scroll into
     * view. So the claim has to be backed by a real box before we window on it. */
    var hasBox = el.clientHeight > 0;
    var result = hasOverflow && finiteHeight && hasBox;
    /* Never cache a verdict read while the element has no box: that is a
     * transient, and latching it would strand the list in whatever mode the
     * first hidden render happened to see. */
    if (!hasBox) return false;
    if (document.readyState === "loading") return result;
    cachedIsScroller = result;
    return result;
  }

  /* Cover gradients are static, so the accent/gradient lookups (2 regex hits
   * each) are memoized instead of re-running for every rendered row. */
  /* The memo holds the gradient as it was when it was first looked up, so
     a change to the Cover Gradients setting has to drop it - otherwise
     the rows keep the gradient they were given the first time they were
     drawn, and the setting appears to do nothing until the page is
     reloaded. */
  window.__thwClearCoverMemo = function () {
    for (var k in coverMemo) delete coverMemo[k];
  };

  function accentFor(cover) {
    var m = coverMemo[cover];
    if (!m) m = coverMemo[cover] = { accent: getGradientAccentColor(cover), gradient: getCoverGradientStyle(cover) };
    return m;
  }

  /* Counted with a loop rather than Object.keys() because paintSig() runs on
   * every scroll frame and shouldn't allocate. */
  function favSig() {
    var n = 0;
    try { for (var k in favorites) if (Object.prototype.hasOwnProperty.call(favorites, k)) n++; } catch (e) {}
    return n;
  }

  /* Play/pause state and favourites change the row markup but not the row
   * window, so they're part of the render key (otherwise the visible rows keep
   * a stale play icon until you scroll).
   *
   * The Cover Gradients setting belongs in here for exactly the same reason.
   * The text colour of a row comes from it, so without it in the key the rows
   * kept the gradient they were drawn with when the toggle was flipped, and the
   * setting looked like it did nothing - the playlist still showed cover colours
   * with the gradients turned off, until a scroll or a track change happened to
   * force a repaint. */
  function paintSig() {
    var gradients = 1;
    try { gradients = (typeof coverGradientsOn === "function" && coverGradientsOn()) ? 1 : 0; } catch (e) {}
    return currentTrackIndex + "|" + (isPlaying ? 1 : 0) + "|" + favSig() + "|g" + gradients;
  }

  function getContainer() { return document.getElementById("scrollable-playlist"); }
  function getFilter(container) {
    var match = container.className.match(/filter-(\w+)/);
    return match && match[1] !== "all" ? match[1].toLowerCase() : "";
  }
  function rebuildIndexes() {
    var input = document.getElementById("playlist-search");
    var term = input ? input.value.toLowerCase().trim() : "";
    var filter = getFilter(getContainer());
    var indexes = [];
    for (var i = 0; i < trackList.length; i++) {
      var track = trackList[i];
      var matchesFilter = !filter || (filter === "favorites" ? isFavorite(i) : track.category === filter);
      if (matchesFilter && (!term || searchCache[i].indexOf(term) !== -1)) indexes.push(i);
    }
    state.indexes = indexes;
    return indexes;
  }
  /* Single source of truth: script.js owns the matcher and exports it on
     window. A local copy is kept only as a fallback, so rows still render if
     this file is ever loaded before script.js. */
  function _coverWebpFor(p) {
    if (typeof window !== "undefined" && typeof window._coverWebp === "function") return window._coverWebp(p);
    var s = String(p || "");
    if (!/\.png$/i.test(s)) return null;
    var m = s.match(/^(.*\/)?Covers\//i);
    if (!m) return null;
    return m[0] + "webp/" + s.slice(m[0].length).replace(/\.png$/i, ".webp");
  }

  function rowHtml(index) {
    var track = trackList[index];
    var cover = track.cover || "Juice-WRLD.png";
    /* Prefer the WebP derivative (Covers/webp/*.webp, ~11 MB for the whole set
       against ~98 MB of PNG) and fall back to the original if it is not
       deployed. Done here rather than in the shared helper because rows are
       built as an HTML string, and these are the images that actually get
       requested in bulk while scrolling.

       Same matcher as _coverWebp in script.js: anchor on the LAST "Covers/"
       segment. The old form assumed at most two path segments before Covers/,
       but raw.githubusercontent.com URLs are owner/repo/branch/Covers/x.png -
       one deeper - so it silently matched nothing and every row fell back to
       the full-size PNG. */
    /* The thumbnail first: 64px, which is 2x the 24-28 pixels the row
       actually draws it at. The old build asked for the full-size cover - up to
       11 MB of PNG - to paint a 24 pixel square, and one pass through the list
       was 122 MB. The row falls back to the original if the thumbnail is not
       deployed, so a missing tier costs nothing but the old behaviour. */
    var thumb = _coverThumb(cover, "64");
    var coverSrc = thumb || _coverWebpFor(cover) || cover;
    var coverFallback = "this.onerror=null;this.src='" + String(cover).replace(/'/g, "\\'") + "'";
    var tones = accentFor(cover);
    var accent = tones.accent;
    var gradient = tones.gradient;
    var favorite = isFavorite(index);
    var playing = index === currentTrackIndex && isPlaying;
    return '<div class="playlist-item p-3 flex items-center justify-between gap-3" data-idx="' + index + '" data-category="' + track.category + '">' +
      '<div class="flex items-center gap-3 min-w-0"><span class="playlist-track-num">' + (index + 1) + '</span><div class="cover-wrap w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-white/10 flex-shrink-0 flex items-center justify-center"><img src="' + coverSrc + '" class="w-full h-full object-cover" onerror="' + coverFallback + '" loading="lazy" decoding="async" fetchpriority="low"></div><div class="min-w-0 text-left"><p class="font-bold text-xs truncate playlist-title" style="' + gradient + '">' + track.title + '</p><p class="text-[10px] text-gray-400 truncate">' + (track.artist || "Juice WRLD") + ' · <span class="playlist-tag font-semibold" style="' + gradient + '">' + getTrackAlbum(track).replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</span></p></div></div>' +
      '<div class="flex items-center gap-1 flex-shrink-0 font-mono text-[9px] font-bold"><span class="track-duration text-gray-500 w-8 text-right">' + formatTime(track.duration || 0) + '</span><span class="playlist-cat-dot">' + getCategoryEmoji(track.category) + '</span><button data-fav-idx="' + index + '" class="fav-btn" style="color:' + (favorite ? "#f43f5e" : "rgba(255,255,255,0.25)") + '"><i class="' + (favorite ? "fas" : "far") + ' fa-heart"></i></button><button data-playlist-idx="' + index + '" class="add-to-playlist-btn" title="Add to Playlist" style="color:' + accent + '"><i class="fas fa-plus"></i></button><button data-queue-idx="' + index + '" class="queue-add-btn" title="Add to Queue" style="color:' + accent + '">+Q</button><div class="w-5 h-5 flex items-center justify-center text-xs text-gray-400 play-indicator">' + (playing ? '<i class="fas fa-volume-up text-cyan-400 animate-pulse"></i>' : '<i class="fas fa-play text-[9px]"></i>') + '</div></div></div>';
  }
  function renderVisible(scrollOnly) {
    var container = getContainer();
    if (!container) return;
    /* The windowed renderer owns this container's contents, so it also owns its
     * height. The pre-virtualization filter code pinned an inline max-height to
     * whatever scrollHeight happened to be at the time, to shrink-wrap a fully
     * rendered list; with a window, scrollHeight is only what the window happens
     * to reserve, so that pin is meaningless and self-latching. Clicking
     * Favorites with nothing favourited renders no rows, the container collapses
     * to its bare padding (16px), and the next category filter then pins
     * max-height:16px - which nothing clears except going back to "all". So
     * Sessions, Leaks and Halloween all came up as an empty 16px sliver.
     *
     * Dropped up here, before the signature short-circuits: if the window and
     * paint key are unchanged the render returns early, and a collapse that
     * happened for some other reason would then never be undone. The stylesheet
     * max-h-[280px] governs again, and the spacers below already reserve the
     * full scroll height. */
    if (container.style.maxHeight) container.style.maxHeight = "";
    if (!state.top) {
      state.top = document.createElement("div");
      state.bottom = document.createElement("div");
      state.top.setAttribute("aria-hidden", "true");
      state.bottom.setAttribute("aria-hidden", "true");
      /* Spacers must never take a grid cell of their own; see the note where
       * their heights are set. */
      state.top.style.gridColumn = "1 / -1";
      state.bottom.style.gridColumn = "1 / -1";
      container.innerHTML = "";
      container.appendChild(state.top);
      container.appendChild(state.bottom);
      if (!state.bound) {
        state.bound = true;
        function scheduleRender() {
          if (!state.frame) state.frame = requestAnimationFrame(function () {
            state.frame = 0;
            renderVisible(true);
          });
        }
        container.addEventListener("scroll", function () {
          scheduleRender();
        }, { passive: true });
        window.addEventListener("scroll", function () {
          var player = document.getElementById("page-section-player");
          if (!isScroller() && player && player.classList.contains("active")) scheduleRender();
        }, { passive: true });
      }
      if (typeof _playlistBuilt !== "undefined" && !_playlistBuilt) {
        _playlistBuilt = true;
        container.addEventListener("click", function (event) {
          var favorite = event.target.closest && event.target.closest(".fav-btn");
          if (favorite) { event.stopPropagation(); toggleFavorite(parseInt(favorite.getAttribute("data-fav-idx"), 10)); return; }
          var queue = event.target.closest && event.target.closest(".queue-add-btn");
          if (queue) {
            event.stopPropagation();
            var index = parseInt(queue.getAttribute("data-queue-idx"), 10);
            var position = trackQueue.indexOf(index);
            if (position !== -1) removeFromQueue(position); else addToQueue(index);
            return;
          }
          if (event.target.closest && event.target.closest(".add-to-playlist-btn")) { event.stopPropagation(); return; }
          var item = event.target.closest && event.target.closest(".playlist-item");
          if (item) {
            var selected = parseInt(item.dataset.idx, 10);
            if (selected === currentTrackIndex) { audio.currentTime = 0; if (!isPlaying) playAudio(); }
            else selectTrackFromList(selected);
          }
        });
      }
    }
    var indexes = state.indexes;
    /* Toggling grid view is a layout change, not a scroll: the cached pitch and
     * column count from the previous mode are both wrong the moment it flips,
     * and a stale one silently sizes the spacers in the old unit. Invalidate
     * before reading either, so both are re-measured in the new layout. */
    var grid = isGrid();
    if (state.grid !== grid) {
      state.grid = grid;
      forgetRowHeight();
      /* The rendered window is in the old unit, so the cached signature has to
       * go too or the repaint below is skipped as a no-op. */
      state.sig = null;
    }
    var rowH = rowHeight();
    var viewStart = 0;
    var viewEnd = indexes.length;
    var innerScroller = isScroller();
    var windowed = innerScroller || indexes.length > FULL_RENDER_MAX;
    if (windowed && indexes.length) {
      var scrollTop = innerScroller
        ? container.scrollTop
        : Math.max(0, -container.getBoundingClientRect().top);
      var viewportHeight = innerScroller ? container.clientHeight : window.innerHeight;
      /* Grid view lays N tracks per band, so a scroll position advances a whole
       * band at a time and the window has to be sized and stepped in bands too.
       * Treating it as a 1-D list of 64px rows is what made grid view render
       * nothing at all past the first screen. */
      var cols = grid ? columns() : 1;
      state.gridCols = cols;
      var perStep = WINDOW_STEP * cols;
      var firstRow = Math.floor(scrollTop / rowH) * cols;
      viewStart = Math.max(0, Math.floor(firstRow / perStep) * perStep - OVERSCAN * cols);
      var visibleRows = (Math.ceil(viewportHeight / rowH) + 1) * cols;
      viewEnd = Math.min(indexes.length, viewStart + visibleRows + OVERSCAN * 2 * cols);
      var lastStart = Math.max(0, indexes.length - 1);
      if (viewStart > lastStart) {
        viewStart = Math.max(0, Math.floor(Math.max(0, indexes.length - visibleRows) / perStep) * perStep);
        if (viewStart > lastStart) viewStart = lastStart;
      }
      if (viewEnd <= viewStart) viewEnd = Math.min(indexes.length, viewStart + 1);
    }
    if (scrollOnly && state.start === viewStart && state.end === viewEnd) return;
    var paint = paintSig();
    var sig = viewStart + ":" + viewEnd + "|" + paint;
    if (state.sig === sig) return;
    state.sig = sig;
    state.start = viewStart;
    state.end = viewEnd;
    var wanted = Object.create(null);
    var existing = Object.create(null);
    for (var i = viewStart; i < viewEnd; i++) wanted[indexes[i]] = true;
    var node = state.top.nextSibling;
    while (node && node !== state.bottom) {
      var next = node.nextSibling;
      var nodeIndex = node.getAttribute("data-idx");
      if (state.paint !== paint || !Object.prototype.hasOwnProperty.call(wanted, nodeIndex)) {
        node.remove();
      } else {
        existing[nodeIndex] = node;
      }
      node = next;
    }
    /* The spacers are measured in bands, so in grid view the track counts are
     * divided by the column count first - sizing them per-track inflated the
     * scroll height by a factor of cols and threw the scroll position out. */
    var spacerCols = state.gridCols || 1;
    /* In grid view the spacers are grid items like any other child, so without
     * spanning the full track width each one occupies its own cell: it steals a
     * column from the cards, shifts every band down, and the pitch measurement
     * then reads the spacer itself as part of a band. Spanning 1/-1 keeps them
     * out of the column flow while still reserving their height. */
    if (grid) {
      state.top.style.gridColumn = "1 / -1";
      state.bottom.style.gridColumn = "1 / -1";
    } else {
      state.top.style.gridColumn = "";
      state.bottom.style.gridColumn = "";
    }
    state.top.style.height = Math.round((viewStart / spacerCols) * rowH) + "px";
    state.bottom.style.height = Math.max(0, Math.round(((indexes.length - viewEnd) / spacerCols) * rowH)) + "px";
    var cursor = state.top.nextSibling;
    for (var j = viewStart; j < viewEnd; j++) {
      var idx = indexes[j];
      var row = existing[idx];
      if (!row) {
        var fragment = document.createRange().createContextualFragment(rowHtml(idx));
        row = fragment.firstElementChild;
        existing[idx] = row;
        container.insertBefore(fragment, cursor || state.bottom);
      } else if (row !== cursor) {
        container.insertBefore(row, cursor || state.bottom);
      }
      cursor = row.nextSibling;
    }
    state.paint = paint;
    /* Favorites mode counts favorites, not search/category matches, and has
     * its own wording - without this the repaint counter text flipped from
     * "N Favorited Tracks" to "N of M Tracks" the moment the list scrolled. */
    var favMode = false;
    try { favMode = typeof playerCurrentCategoryFilter !== "undefined" && playerCurrentCategoryFilter === "favorites"; } catch (e) {}
    var counter = document.getElementById("playlist-track-counter");
    if (counter) {
      counter.textContent = favMode
        ? indexes.length + " Favorited Track" + (indexes.length !== 1 ? "s" : "")
        : indexes.length + " of " + trackList.length + " Tracks";
    }
    var empty = document.getElementById("search-empty-state");
    var input = document.getElementById("playlist-search");
    /* An empty list has to explain itself. This used to show only when there was
     * search text, so landing on Favorites with nothing favourited left a bare
     * empty box under the panel - the state that then collapsed the scroller
     * into the bug above. Say which of the three reasons it is. */
    if (empty) {
      var nothing = !indexes.length;
      empty.classList.toggle("visible", nothing);
      if (nothing) {
        var text = empty.querySelector("p");
        var icon = empty.querySelector("i");
        var wanted = favMode ? "No favorites yet"
          : (input && input.value) ? "No tracks found"
          : "No tracks in this category";
        if (text && text.textContent !== wanted) text.textContent = wanted;
        if (icon) {
          var wantedIcon = favMode ? "fas fa-heart text-2xl mb-2 opacity-30"
            : "fas fa-search text-2xl mb-2 opacity-30";
          if (icon.className !== wantedIcon) icon.className = wantedIcon;
        }
      }
    }
    /* With nothing to list, the scroller has no rows and collapses to its own
     * padding - leaving a bare black bar (the container's own dark background)
     * stranded above the empty message. The message is a sibling of the
     * scroller inside the panel, so it stands on its own without it: hide the
     * scroller outright rather than showing an empty frame. Cleared back to ""
     * so the stylesheet's own display applies again once there are rows. */
    if (!indexes.length) {
      if (container.style.display !== "none") container.style.display = "none";
    } else if (container.style.display === "none") {
      container.style.display = "";
    }
  }
  /* Only rescan the library when the search text, filter or favourites can
   * actually change the result set. Play/pause, track changes and queue edits
   * all route through here, and used to pay a full 280-track scan each time. */
  function listSig() {
    var input = document.getElementById("playlist-search");
    var container = getContainer();
    var cat = "";
    try { cat = typeof playerCurrentCategoryFilter === "undefined" ? "" : playerCurrentCategoryFilter; } catch (e) {}
    return (input ? input.value : "") + "|" + (container ? container.className : "") + "|" + cat + "|" + favSig();
  }
  function optimizedRender() {
    var sig = listSig();
    if (sig !== indexSig) {
      rebuildIndexes();
      indexSig = sig;
      /* The old scroll offset can point past the end of a shorter result set,
       * so start at the top and force a repaint. */
      var container = getContainer();
      if (container && container.scrollTop) container.scrollTop = 0;
      state.sig = null;
    }
    renderVisible();
  }
  for (var i = 0; i < trackList.length; i++) {
    var track = trackList[i];
    searchCache[i] = (track.title + " " + (track.artist || "") + " " + getTrackAlbum(track) + " " + (track.producer || "") + " " + (track.recorded || "") + " " + (track.category || "")).toLowerCase();
  }
  window.renderPlaylistUI = optimizedRender;
  /* script.js already debounces keystrokes (100ms) before calling this, so the
   * search path stays immediate here rather than stacking a second delay. */
  window.applySearchFilter = optimizedRender;
  var panel = document.getElementById("playlist-panel");
  if (panel) panel.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest(".player-tab")) setTimeout(optimizedRender, 150);
  });
  /* Resize used to rebuild the whole index set on every resize event, which
   * fires continuously while a window is being dragged. */
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = 0; forgetRowHeight(); state.sig = null; optimizedRender(); }, 150);
  }, { passive: true });
  /* Belt and braces for the cache above: whatever it latched during load is
     re-read once the document is complete, which is after every stylesheet has
     applied. Cheap, happens once, and clears the signature so the next render
     re-evaluates the window. */
  window.addEventListener("load", function () {
    forgetRowHeight();
    state.sig = null;
    optimizedRender();
  }, { once: true });
})();

/* Pause the decorative background motion while the user is scrolling.
 * The page keeps 90+ always-animating blurred layers, which are composited on
 * every scroll frame; pausing them for the duration of a gesture roughly halves
 * the frame time of the track list. One passive listener in the capture phase,
 * so the window and every inner scroller (track list, queue, sidebar) trigger
 * it, and motion resumes ~140ms after the last scroll event. Styling lives in
 * player-settings.css (html.is-scrolling). */
(function () {
  var idle = 0;
  window.addEventListener("scroll", function () {
    var root = document.documentElement;
    if (!root.classList.contains("is-scrolling")) root.classList.add("is-scrolling");
    if (idle) clearTimeout(idle);
    idle = setTimeout(function () {
      idle = 0;
      root.classList.remove("is-scrolling");
    }, 140);
  }, { passive: true, capture: true });
})();
/* ===== Idle pause =====
   The decorative background keeps moving until the page is closed. It is
   paused while the member scrolls, but at REST - which is most of the
   time - sixty-four layers are still animating, each promoted to its own
   compositor layer. That is the site burning a phone's battery for
   decoration nobody is looking at.

   So it is paused when there is nothing happening: a few seconds after
   the last touch, and whenever the tab is not on screen. Any movement
   brings it straight back, so it is never caught out. */
(function () {
  if (window.__thwIdlePause) return;
  window.__thwIdlePause = true;

  var IDLE_MS = 4000;
  var timer = null;
  var root = document.documentElement;

  function wake() {
    root.classList.remove("is-idle");
    if (timer) clearTimeout(timer);
    timer = setTimeout(sleep, IDLE_MS);
  }

  function sleep() {
    root.classList.add("is-idle");
  }

  /* Any sign of life wakes it. All passive: none of these may hold up
     the thing that fired them. */
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, wake, { passive: true });
  });

  /* A tab nobody is looking at does not need to animate. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      root.classList.add("is-idle");
      if (timer) clearTimeout(timer);
    } else {
      wake();
    }
  });

  wake();
})();

/* PERFORMANCE: the floating chrome gets out of the footer's way.
 *
 * The presence badges, the chat button, the night light and the
 * scroll-to-top are fixed to the screen. The footer scrolls under them,
 * so its own bottom bar ended up underneath theirs - the two read as one
 * jumble of text on a phone.
 *
 * So while the footer is on screen they get out of the way. The class is
 * the signal, the same way the scroll and idle pauses are. */
(function () {
  if (window.__thwFooterChrome) return;
  window.__thwFooterChrome = true;

  var foot = document.querySelector("footer.foot");
  if (!foot || !window.MutationObserver) return;
  var root = document.documentElement;
  var seen = false;

  new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      /* A single observer for the whole footer: any part of it on screen
         counts, because the badges sit over the columns as well as over
         the bottom bar. */
      var on = entries[i].isIntersecting;
      if (on === seen) continue;
      seen = on;
      if (on) root.classList.add("foot-in-view");
      else root.classList.remove("foot-in-view");
    }
  }, { threshold: 0 }).observe(foot);
})();
