(function () {
  var ROW_HEIGHT = 64;
  var OVERSCAN = 12;
  var WINDOW_STEP = 4;
  var state = { indexes: [], top: null, bottom: null, frame: 0, bound: false, start: -1, end: -1 };
  var searchCache = [];

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
    var accent = getGradientAccentColor(cover);
    var gradient = getCoverGradientStyle(cover);
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
    var firstRow = Math.floor(container.scrollTop / ROW_HEIGHT);
    var viewStart = Math.max(0, Math.floor(firstRow / WINDOW_STEP) * WINDOW_STEP - OVERSCAN);
    var visibleRows = Math.ceil(container.clientHeight / ROW_HEIGHT);
    var viewEnd = Math.min(indexes.length, viewStart + visibleRows + OVERSCAN * 2);
    if (state.start === viewStart && state.end === viewEnd) return;
    state.start = viewStart;
    state.end = viewEnd;
    var html = "";
    for (var i = viewStart; i < viewEnd; i++) html += rowHtml(indexes[i]);
    state.top.style.height = (viewStart * ROW_HEIGHT) + "px";
    state.bottom.style.height = ((indexes.length - viewEnd) * ROW_HEIGHT) + "px";
    var node = state.top.nextSibling;
    while (node && node !== state.bottom) { var next = node.nextSibling; node.remove(); node = next; }
    container.insertBefore(document.createRange().createContextualFragment(html), state.bottom);
    var counter = document.getElementById("playlist-track-counter");
    if (counter) counter.textContent = indexes.length + " of " + trackList.length + " Tracks";
    var empty = document.getElementById("search-empty-state");
    var input = document.getElementById("playlist-search");
    if (empty) empty.classList.toggle("visible", !!(input && input.value) && !indexes.length);
  }
  function optimizedRender() { rebuildIndexes(); renderVisible(); }
  for (var i = 0; i < trackList.length; i++) {
    var track = trackList[i];
    searchCache[i] = (track.title + " " + (track.artist || "") + " " + getTrackAlbum(track) + " " + (track.producer || "") + " " + (track.recorded || "") + " " + (track.category || "")).toLowerCase();
  }
  window.renderPlaylistUI = optimizedRender;
  window.applySearchFilter = optimizedRender;
  var panel = document.getElementById("playlist-panel");
  if (panel) panel.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest(".player-tab")) setTimeout(optimizedRender, 150);
  });
  window.addEventListener("resize", optimizedRender, { passive: true });
})();