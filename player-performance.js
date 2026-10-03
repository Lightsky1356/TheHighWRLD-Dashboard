(function () {
  var ROW_HEIGHT = 64;
  var OVERSCAN = 6;
  var WINDOW_STEP = 4;
  var FULL_RENDER_MAX = 400;
  var measuredRowHeight = 0;
  var state = { indexes: [], top: null, bottom: null, frame: 0, bound: false, start: -1, end: -1, sig: null };
  var searchCache = [];
  var indexSig = null;
  var coverMemo = {};

  /* The row height is not a constant: the list is 64px, but the card/grid
   * layout is ~160px and the phone breakpoints shrink it again. Dividing
   * scrollTop by a stale 64 made the window overshoot the end of the list, the
   * render loop produced nothing, and every row was removed - a blank list that
   * only came back after a click. So learn it from the DOM and keep measuring
   * whenever the layout can have changed. */
  function rowHeight() {
    if (measuredRowHeight > 0) return measuredRowHeight;
    var node = state.top ? state.top.nextSibling : null;
    while (node && node !== state.bottom) {
      if (node.offsetHeight > 0) { measuredRowHeight = node.offsetHeight; break; }
      node = node.nextSibling;
    }
    return measuredRowHeight || ROW_HEIGHT;
  }
  function forgetRowHeight() { measuredRowHeight = 0; }

  /* Cover gradients are static, so the accent/gradient lookups (2 regex hits
   * each) are memoized instead of re-running for every rendered row. */
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
   * a stale play icon until you scroll). */
  function paintSig() {
    return currentTrackIndex + "|" + (isPlaying ? 1 : 0) + "|" + favSig();
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
  function rowHtml(index) {
    var track = trackList[index];
    var cover = track.cover || "Juice-WRLD.png";
    var tones = accentFor(cover);
    var accent = tones.accent;
    var gradient = tones.gradient;
    var favorite = isFavorite(index);
    var playing = index === currentTrackIndex && isPlaying;
    return '<div class="playlist-item p-3 flex items-center justify-between gap-3" data-idx="' + index + '" data-category="' + track.category + '">' +
      '<div class="flex items-center gap-3 min-w-0"><span class="playlist-track-num">' + (index + 1) + '</span><div class="cover-wrap w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-white/10 flex-shrink-0 flex items-center justify-center"><img src="' + cover + '" class="w-full h-full object-cover" onerror="this.src=\'Juice-WRLD.png\'" loading="lazy"></div><div class="min-w-0 text-left"><p class="font-bold text-xs truncate playlist-title" style="' + gradient + '">' + track.title + '</p><p class="text-[10px] text-gray-400 truncate">' + (track.artist || "Juice WRLD") + ' · <span class="playlist-tag font-semibold" style="' + gradient + '">' + getTrackAlbum(track).replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</span></p></div></div>' +
      '<div class="flex items-center gap-1 flex-shrink-0 font-mono text-[9px] font-bold"><span class="track-duration text-gray-500 w-8 text-right">' + formatTime(track.duration || 0) + '</span><span class="playlist-cat-dot">' + getCategoryEmoji(track.category) + '</span><button data-fav-idx="' + index + '" class="fav-btn" style="color:' + (favorite ? "#f43f5e" : "rgba(255,255,255,0.25)") + '"><i class="' + (favorite ? "fas" : "far") + ' fa-heart"></i></button><button data-playlist-idx="' + index + '" class="add-to-playlist-btn" title="Add to Playlist" style="color:' + accent + '"><i class="fas fa-plus"></i></button><button data-queue-idx="' + index + '" class="queue-add-btn" title="Add to Queue" style="color:' + accent + '">+Q</button><div class="w-5 h-5 flex items-center justify-center text-xs text-gray-400 play-indicator">' + (playing ? '<i class="fas fa-volume-up text-cyan-400 animate-pulse"></i>' : '<i class="fas fa-play text-[9px]"></i>') + '</div></div></div>';
  }
  function renderVisible() {
    var container = getContainer();
    if (!container) return;
    if (!state.top) {
      state.top = document.createElement("div");
      state.bottom = document.createElement("div");
      state.top.setAttribute("aria-hidden", "true");
      state.bottom.setAttribute("aria-hidden", "true");
      container.innerHTML = "";
      container.appendChild(state.top);
      container.appendChild(state.bottom);
      if (!state.bound) {
        state.bound = true;
        container.addEventListener("scroll", function () {
          if (!state.frame) state.frame = requestAnimationFrame(function () { state.frame = 0; renderVisible(); });
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
    var rowH = rowHeight();
    var viewStart = 0;
    var viewEnd = indexes.length;
    /* Some breakpoints turn the scroller off (overflow:visible, max-height:none)
     * and let the page scroll instead. A window can't help there because
     * scrollTop never moves, so render the whole (bounded) set instead of
     * showing the first slice and nothing else. */
    var scrollable = indexes.length > FULL_RENDER_MAX || container.scrollHeight > container.clientHeight + 4;
    if (scrollable && indexes.length) {
      var firstRow = Math.floor(container.scrollTop / rowH);
      viewStart = Math.max(0, Math.floor(firstRow / WINDOW_STEP) * WINDOW_STEP - OVERSCAN);
      var visibleRows = Math.ceil(container.clientHeight / rowH) + 1;
      viewEnd = Math.min(indexes.length, viewStart + visibleRows + OVERSCAN * 2);
      /* The hard stop: a window that starts past the last track renders an
       * empty string and then deletes every row, which is the blank list. */
      var lastStart = Math.max(0, indexes.length - 1);
      if (viewStart > lastStart) {
        viewStart = Math.max(0, Math.floor(Math.max(0, indexes.length - visibleRows) / WINDOW_STEP) * WINDOW_STEP);
        if (viewStart > lastStart) viewStart = lastStart;
      }
      if (viewEnd <= viewStart) viewEnd = Math.min(indexes.length, viewStart + 1);
    } else if (viewEnd > FULL_RENDER_MAX) {
      viewEnd = FULL_RENDER_MAX;
    }
    var sig = viewStart + ":" + viewEnd + "|" + paintSig();
    if (state.sig === sig) return;
    state.sig = sig;
    state.start = viewStart;
    state.end = viewEnd;
    var html = "";
    for (var i = viewStart; i < viewEnd; i++) html += rowHtml(indexes[i]);
    state.top.style.height = (viewStart * rowH) + "px";
    state.bottom.style.height = Math.max(0, (indexes.length - viewEnd) * rowH) + "px";
    var node = state.top.nextSibling;
    while (node && node !== state.bottom) { var next = node.nextSibling; node.remove(); node = next; }
    container.insertBefore(document.createRange().createContextualFragment(html), state.bottom);
    var counter = document.getElementById("playlist-track-counter");
    if (counter) {
      /* Favorites mode counts favorites, not search/category matches, and has
       * its own wording - without this the repaint counter text flipped from
       * "N Favorited Tracks" to "N of M Tracks" the moment the list scrolled. */
      var favMode = false;
      try { favMode = typeof playerCurrentCategoryFilter !== "undefined" && playerCurrentCategoryFilter === "favorites"; } catch (e) {}
      counter.textContent = favMode
        ? indexes.length + " Favorited Track" + (indexes.length !== 1 ? "s" : "")
        : indexes.length + " of " + trackList.length + " Tracks";
    }
    var empty = document.getElementById("search-empty-state");
    var input = document.getElementById("playlist-search");
    if (empty) empty.classList.toggle("visible", !!(input && input.value) && !indexes.length);
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