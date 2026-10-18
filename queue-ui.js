/* ============================================================================
   QUEUE
   The WRLD Player's Up Next list, on both the dropdown and the "Up Next" panel.

   This takes over from script.js's queue functions rather than editing them in
   place, so the behaviour is readable and reviewable instead of minified. The
   script.js versions stay loaded underneath as a fallback: everything here is
   assigned over the same globals (addToQueue, removeFromQueue, clearQueue,
   playNextFromQueue, renderQueueUI, renderQueueDropdown, updateQueueBadge and
   toggleQueuePanel), and script.js's nextTrack() resolves playNextFromQueue
   through the global scope, so it picks these up without being touched.

   What was wrong, all reproduced against the running player:

   1. removeFromQueue deferred its splice by 280ms to let a slide-out animation
      finish, but spliced by position. Two removals inside that window spliced
      stale positions against an already-shifted array, so tapping x on rows 1
      and 2 of [Analog, Benjamin, Body Bag] left Benjamin - the row that was
      not tapped. Mutating the array is now immediate and the list is re-rendered
      from it straight away, so a row's data-qi is never stale. The exit
      animation is given up deliberately: correctness about which song gets
      deleted is worth more than a 280ms fade, and it cannot be had both ways
      while the animation is driven off the same array.

   2. The playback-error path called nextTrack(), which already shifts the queue,
      and then shifted again - so one failed track silently ate two queue
      entries. Fixed at the source in script.js rather than patched over here.

   3. Tapping a queue row played it AND spliced it out, and pushed nothing onto
      trackHistory, so Previous could not get you back to where you were. Tapping
      now plays it and leaves it queued, recording history like every other
      track change.

   4. clearQueue() had the same deferred-splice race, so anything queued during
      its 280ms window was wiped too. It is immediate now.

   script.js kept two near-identical renderers, one per container, each building
   its own HTML and binding its own listeners. There is one renderer here, and
   the listeners are delegated from the container so they survive a re-render.

   Added: Play Next, reordering with the per-row up and down buttons (which
   work the same on a phone as on a desktop, with no drag gesture to get wrong),
   the queue surviving a reload, and a duplicate guard on add.

   trackQueue is a script-scoped `let` in script.js, shared by every classic
   script. It is read and written by identifier throughout and never cached in a
   local, because clearing rebinds it to a fresh array and a saved reference
   would go stale.
   ========================================================================== */
(function () {
  "use strict";

  var STORE_KEY = "thw.queue.v1";

  var lastBadge = -1;
  var containers = [];

  /* ---------------------------------------------------------------- state -- */

  function isValid(i) {
    return typeof i === "number" && isFinite(i) && i >= 0 && i < trackList.length && i === (i | 0);
  }

  /* trackList is rebuilt when tracks.js changes, so a saved index can outlive
     the track it pointed at. A stale index renders as a blank row and would
     still be shifted on playback, so they are dropped on every commit. */
  function pruneInvalid() {
    if (!trackQueue.some(function (i) { return !isValid(i); })) return false;
    trackQueue = trackQueue.filter(isValid);
    return true;
  }

  /* --------------------------------------------------------- persistence -- */

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(trackQueue.slice())); } catch (e) { /* private mode, quota - queue just won't survive a reload */ }
  }

  function restore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    var kept = arr.filter(isValid);
    if (!kept.length) return;
    trackQueue = kept;
    renderAll();
  }

  /* ------------------------------------------------------------ rendering -- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* script.js injected the cover gradient straight onto the title and tag with
     data-gradient attributes to match on later; the style is applied inline
     here instead, which is all those attributes ever did. */
  function rowHtml(qi) {
    var idx = trackQueue[qi];
    var t = trackList[idx];
    if (!t) return "";
    var cover = t.cover || "Juice-WRLD.png";
    var grad = getCoverGradientStyle(cover);
    var last = trackQueue.length - 1;
    var playing = idx === currentTrackIndex;

    /* A lone track has nothing to reorder against and is already the next thing
       up, so every arrow is left out of the markup rather than rendered greyed
       out: on a single row the chevrons and Play Next are all no-ops, and dead
       controls beside a plain remove read as broken. At the edges of a longer
       queue the chevrons still disable, because there the row's position is
       meaningful - first row cannot move up, last cannot move down. */
    var many = trackQueue.length > 1;
    var reorder = many
      ? '<button type="button" class="queue-act" data-act="up" data-qi="' + qi + '"' + (qi === 0 ? " disabled" : "") +
          ' title="Move up" aria-label="Move ' + esc(t.title) + ' up"><i class="fas fa-chevron-up"></i></button>' +
        '<button type="button" class="queue-act" data-act="down" data-qi="' + qi + '"' + (qi === last ? " disabled" : "") +
          ' title="Move down" aria-label="Move ' + esc(t.title) + ' down"><i class="fas fa-chevron-down"></i></button>'
      : "";
    var playNext = many
      ? '<button type="button" class="queue-act" data-act="playnext" data-qi="' + qi + '"' +
          ' title="Play next" aria-label="Play ' + esc(t.title) + ' next"><i class="fas fa-angle-double-up"></i></button>'
      : "";

    return '<div class="queue-item' + (playing ? " queue-item-current" : "") + '" data-qi="' + qi +
      '" data-idx="' + idx + '">' +
      '<div class="queue-item-cover"><img src="' + esc(cover) + '" alt="" decoding="async" loading="lazy" onerror="this.src=\'Juice-WRLD.png\'"></div>' +
      '<div class="queue-item-info">' +
        '<p class="queue-item-title" style="' + grad + '">' + esc(t.title) + '</p>' +
        '<p class="queue-item-tag" style="' + grad + '">' + esc(getTrackAlbum(t)) + '</p>' +
      '</div>' +
      '<div class="queue-item-actions">' + reorder + playNext +
        '<button type="button" class="queue-act queue-remove-btn" data-act="remove" data-qi="' + qi + '"' +
          ' title="Remove" aria-label="Remove ' + esc(t.title) + ' from queue"><i class="fas fa-times"></i></button>' +
      '</div>' +
    '</div>';
  }

  function renderInto(container, emptyHtml) {
    if (!container) return;
    if (containers.indexOf(container) === -1) {
      containers.push(container);
      container.addEventListener("click", onContainerClick);
    }
    if (!trackQueue.length) { container.innerHTML = emptyHtml; return; }
    var html = "";
    for (var i = 0; i < trackQueue.length; i++) html += rowHtml(i);
    container.innerHTML = html;
    if (typeof staggerQueueItems === "function") { try { staggerQueueItems(container); } catch (e) {} }
  }

  var EMPTY_PANEL = '<p class="queue-empty">Queue is empty &#x2728; add tracks from the playlist</p>';
  var EMPTY_DROPDOWN = '<div class="queue-empty">Queue is empty</div>';

  function renderQueueUI() { renderInto(document.getElementById("queue-container"), EMPTY_PANEL); }
  function renderQueueDropdown() { renderInto(document.getElementById("queue-dropdown-container"), EMPTY_DROPDOWN); }

  /* Pop the badge only when the count actually changes - script.js re-triggered
     the pop on every re-render, so a reorder or a remove made the badge bounce
     for no reason. */
  function updateQueueBadge() {
    var b = document.getElementById("queue-badge");
    if (!b) return;
    var n = trackQueue.length;
    if (n > 0) {
      b.textContent = n;
      b.style.display = "flex";
      if (n !== lastBadge) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    } else {
      b.style.display = "none";
    }
    lastBadge = n;
    if (typeof updateMiniQueueBadge === "function") { try { updateMiniQueueBadge(); } catch (e) {} }
  }

  function renderAll() {
    renderQueueUI();
    renderQueueDropdown();
    updateQueueBadge();
  }

  function commit() {
    pruneInvalid();
    save();
    renderAll();
  }

  /* ------------------------------------------------------------- mutation -- */

  function addToQueue(idx) {
    if (!isValid(idx)) return false;
    /* One copy of a track is the useful behaviour, and it keeps the row's +Q
       toggle honest: player-performance.js decides queued-or-not with
       indexOf, so duplicates would leave the button claiming to remove something
       that is still there. */
    if (trackQueue.indexOf(idx) !== -1) return false;
    trackQueue.push(idx);
    commit();
    return true;
  }

  function removeAt(pos) {
    if (typeof pos !== "number" || pos < 0 || pos >= trackQueue.length) return false;
    trackQueue.splice(pos, 1);
    commit();
    return true;
  }

  function clearQueue() {
    if (!trackQueue.length) return;
    trackQueue = [];
    commit();
  }

  function moveInQueue(from, to) {
    if (from === to || !trackQueue.length) return false;
    if (from < 0 || from >= trackQueue.length) return false;
    to = Math.max(0, Math.min(trackQueue.length - 1, to));
    if (to === from) return false;
    trackQueue.splice(to, 0, trackQueue.splice(from, 1)[0]);
    commit();
    return true;
  }

  /* Pull one entry to the front without playing it. */
  function playNextAt(pos) {
    if (pos < 0 || pos >= trackQueue.length) return false;
    trackQueue.unshift(trackQueue.splice(pos, 1)[0]);
    commit();
    return true;
  }

  function startPlaying(idx) {
    if (typeof trackHistory !== "undefined" && typeof currentTrackIndex === "number") {
      trackHistory.push(currentTrackIndex);
    }
    currentTrackIndex = idx;
    loadTrack(currentTrackIndex);
    playAudio();
    if (typeof renderPlaylistUI === "function") renderPlaylistUI();
  }

  /* Tapping a row plays it now and leaves it in the queue. */
  function playFromQueueAt(pos) {
    var idx = trackQueue[pos];
    if (!isValid(idx)) return false;
    startPlaying(idx);
    renderAll();
    return true;
  }

  function playNextFromQueue() {
    while (trackQueue.length) {
      var idx = trackQueue.shift();
      if (!isValid(idx)) continue;
      startPlaying(idx);
      commit();
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- handlers -- */

  function onContainerClick(e) {
    var item = e.target && e.target.closest && e.target.closest(".queue-item");
    if (!item) return;
    var pos = parseInt(item.getAttribute("data-qi"), 10);
    if (isNaN(pos)) return;

    var act = e.target.closest("[data-act]");
    if (act) {
      e.stopPropagation();
      var kind = act.getAttribute("data-act");
      if (kind === "remove") removeAt(pos);
      else if (kind === "up") moveInQueue(pos, pos - 1);
      else if (kind === "down") moveInQueue(pos, pos + 1);
      else if (kind === "playnext") playNextAt(pos);
      return;
    }
    playFromQueueAt(pos);
  }

  /* ------------------------------------------------- dropdown open / close -- */

  /* The dropdown is a popover, so locking the page behind it on a desktop would
     be heavy-handed for a 260px panel. On a touch device it covers enough of
     the screen that scrolling the list scrolls the page out from under it, which
     is the same trap the global search had. */
  function coarsePointer() {
    try { return window.matchMedia("(pointer:coarse)").matches; } catch (e) { return false; }
  }

  var dropdownLocked = false;

  function toggleQueuePanel() {
    var dd = document.getElementById("queue-dropdown");
    if (!dd) return;
    var opening = dd.classList.contains("hidden");
    dd.classList.toggle("hidden");
    var sc = document.getElementById("shortcuts-dropdown");
    if (sc) sc.classList.add("hidden");
    if (opening) {
      renderQueueDropdown();
      if (coarsePointer()) {
        dropdownLocked = true;
        if (typeof _lockScroll === "function") _lockScroll();
      }
    } else if (dropdownLocked) {
      dropdownLocked = false;
      if (typeof _unlockScroll === "function") _unlockScroll();
    }
  }

  /* Any of these closing the dropdown has to give the scroll lock back, or the
     page stays frozen behind a panel that is no longer on screen. */
  function releaseDropdownLock() {
    if (!dropdownLocked) return;
    dropdownLocked = false;
    if (typeof _unlockScroll === "function") _unlockScroll();
  }

  /* ------------------------------------------------------------------ wire -- */

  window.addToQueue = addToQueue;
  window.removeFromQueue = removeAt;
  window.clearQueue = clearQueue;
  window.playNextFromQueue = playNextFromQueue;
  window.renderQueueUI = renderQueueUI;
  window.renderQueueDropdown = renderQueueDropdown;
  window.updateQueueBadge = updateQueueBadge;
  window.toggleQueuePanel = toggleQueuePanel;
  window.moveQueueItem = moveInQueue;
  window.playNextInQueue = playNextAt;
  window.renderQueue = renderAll;

  /* player-performance.js calls removeFromQueue(position) with the position it
     got from indexOf, so the signature already matches. */

  /* The playlist "Queue all" path in script.js writes trackQueue directly and
     then re-renders; wrap it so the result is persisted like everything else. */
  var origQueueTracks = window.queueTracks;
  if (typeof origQueueTracks === "function") {
    window.queueTracks = function (titles) {
      var r = origQueueTracks.apply(this, arguments);
      commit();
      return r;
    };
  }

  /* Anything that closes the dropdown behind our back - Escape, a page switch,
     the queue button's own toggle - must still release the lock. */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") releaseDropdownLock();
  }, true);
  document.addEventListener("click", function (e) {
    var dd = document.getElementById("queue-dropdown");
    if (!dd || dd.classList.contains("hidden")) return;
    var btn = document.getElementById("queue-btn");
    if (btn && (e.target === btn || btn.contains(e.target))) return;
    if (!dd.contains(e.target)) releaseDropdownLock();
  }, true);
  window.addEventListener("pagehide", releaseDropdownLock);

  /* The dropdown clear button is wired to clearQueue() in script.js, which this
     has taken over, so it needs no rewiring here. */

  function start() {
    /* Wait for tracks.js: restoring before the list exists would validate every
       index against an empty array and throw the whole queue away. */
    var tries = 0;
    (function wait() {
      if (typeof trackList !== "undefined" && trackList.length) {
        restore();
        renderAll();
        return;
      }
      if (++tries > 100) return;
      setTimeout(wait, 100);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
