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
  var heads = [];

  /* ------------------------------------------------------------ select mode -- */

  /* A select mode over the queue, so several queued tracks can be binned in one
     go instead of one tap on x per row.

     The selection is a Set of track indices rather than queue positions.
     Positions are not stable - binning one row renumbers every row after it -
     but a track index is, and addToQueue already refuses duplicates, so an
     index identifies exactly one queue entry. That keeps a selection intact
     across removals, reorders and the row reconciler.

     Nothing here touches trackList: binning takes tracks out of the queue and
     nowhere else. No track is removed from the site for anyone. */

  var selectMode = false;
  var selected = new Set();

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

  /* One row skeleton, built once and then updated in place. The buttons are
     always present and hidden with [hidden] rather than omitted, so adding or
     removing them is a property change instead of a markup change - which is
     what lets a row survive a re-render at all. [hidden] also keeps them out of
     the accessibility tree, so a lone track still exposes no arrows. */
  var ROW_SKELETON =
    '<button type="button" draggable="false" class="queue-item-check" data-act="select" aria-pressed="false"><i class="fas fa-check"></i></button>' +
    '<div class="queue-item-cover"><img draggable="false" alt="" decoding="async" loading="lazy"></div>' +
    '<div class="queue-item-info"><p class="queue-item-title"></p><p class="queue-item-tag"></p></div>' +
    '<div class="queue-item-actions">' +
      '<button type="button" draggable="false" class="queue-act" data-act="up"><i class="fas fa-chevron-up"></i></button>' +
      '<button type="button" draggable="false" class="queue-act" data-act="down"><i class="fas fa-chevron-down"></i></button>' +
      '<button type="button" draggable="false" class="queue-act" data-act="playnext"><i class="fas fa-angle-double-up"></i></button>' +
      '<button type="button" draggable="false" class="queue-act queue-remove-btn" data-act="remove"><i class="fas fa-times"></i></button>' +
    '</div>';

  function buildRow() {
    var el = document.createElement("div");
    el.className = "queue-item";
    el.innerHTML = ROW_SKELETON;
    /* HTML5 drag is a mouse affordance, so it is left off on coarse pointers
       outright rather than trusting touch browsers to ignore it - that way a
       long press on a phone can never start one. */
    if (!coarsePointer()) el.setAttribute("draggable", "true");
    return el;
  }

  /* A lone track has nothing to reorder against and is already the next thing
     up, so every arrow is hidden rather than shown greyed out: on a single row
     the chevrons and Play Next are all no-ops, and dead controls beside a plain
     remove read as broken. At the edges of a longer queue the chevrons still
     disable, because there the row's position is meaningful. */
  function updateRow(el, qi) {
    var idx = trackQueue[qi];
    var t = trackList[idx];
    if (!t) return false;

    var cover = t.cover || "Juice-WRLD.png";
    var grad = getCoverGradientStyle(cover);
    var last = trackQueue.length - 1;
    var many = trackQueue.length > 1;
    var album = getTrackAlbum(t);

    el.setAttribute("data-qi", qi);
    el.setAttribute("data-idx", idx);

    var img = el.querySelector(".queue-item-cover img");
    /* Only touch src when it really changed: reassigning it restarts the fetch
       and shows a flash, which on a re-render of an unchanged row is the other
       half of the "it reloaded" impression. */
    if (img && img.getAttribute("src") !== cover) {
      img.setAttribute("src", cover);
      img.setAttribute("alt", "");
    }

    var title = el.querySelector(".queue-item-title");
    var tag = el.querySelector(".queue-item-tag");
    if (title.textContent !== t.title) title.textContent = t.title;
    if (tag.textContent !== album) tag.textContent = album;
    title.setAttribute("style", grad);
    tag.setAttribute("style", grad);

    el.classList.toggle("queue-item-current", idx === currentTrackIndex);

    var up = el.querySelector('[data-act="up"]');
    var down = el.querySelector('[data-act="down"]');
    var pn = el.querySelector('[data-act="playnext"]');
    var rm = el.querySelector('[data-act="remove"]');

    /* Selecting replaces the row's actions rather than joining them: while
       choosing, the only thing a row should do is toggle, so the chevrons and
       Play Next are pulled out of the way instead of competing for the tap. */
    var actionsOff = selectMode || !many;
    up.hidden = actionsOff;
    down.hidden = actionsOff;
    pn.hidden = actionsOff;
    up.setAttribute("data-qi", qi);
    down.setAttribute("data-qi", qi);
    pn.setAttribute("data-qi", qi);
    rm.setAttribute("data-qi", qi);
    up.disabled = qi === 0;
    down.disabled = qi === last;

    var check = el.querySelector('[data-act="select"]');
    var isSel = selectMode && selected.has(idx);
    check.hidden = !selectMode;
    check.setAttribute("data-qi", qi);
    check.setAttribute("aria-pressed", isSel ? "true" : "false");
    check.title = isSel ? "Deselect" : "Select";
    el.classList.toggle("queue-item-selected", isSel);

    var label = t.title;
    up.title = "Move up"; up.setAttribute("aria-label", "Move " + label + " up");
    down.title = "Move down"; down.setAttribute("aria-label", "Move " + label + " down");
    pn.title = "Play next"; pn.setAttribute("aria-label", "Play " + label + " next");
    rm.title = "Remove"; rm.setAttribute("aria-label", "Remove " + label + " from queue");
    return true;
  }

  /* Only a row that has just been added animates in. Rows that were already on
     screen keep their .visible class and lose the stagger delay, so a reorder
     or a removal does not make the whole list flash. */
  function revealRow(el, qi) {
    el.style.transitionDelay = 30 * qi + "ms";
    requestAnimationFrame(function () { el.classList.add("visible"); });
  }

  function renderInto(container, emptyHtml) {
    if (!container) return;
    if (containers.indexOf(container) === -1) {
      containers.push(container);
      container.addEventListener("click", onContainerClick);
      container.addEventListener("dragstart", onDragStart);
      container.addEventListener("dragover", onDragOver);
      container.addEventListener("drop", onDrop);
      container.addEventListener("dragend", onDragEnd);
    }

    if (!trackQueue.length) {
      /* The only wholesale content swap left, and it is a single frame either
         way with no rows worth preserving. */
      if (!container._queueEmpty) { container.innerHTML = emptyHtml; container._queueEmpty = true; }
      return;
    }
    if (container._queueEmpty) { container.innerHTML = ""; container._queueEmpty = false; }

    var needed = trackQueue.length;
    while (container.children.length > needed) container.removeChild(container.lastElementChild);

    for (var qi = 0; qi < needed; qi++) {
      var el = container.children[qi];
      var isNew = !el || !el.classList.contains("queue-item");
      if (isNew) {
        el = buildRow();
        container.appendChild(el);
      }
      if (!updateRow(el, qi)) continue;
      if (isNew) revealRow(el, qi);
      else { el.style.transitionDelay = ""; el.classList.add("visible"); }
    }
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
    /* Heads are mounted lazily: the queue can render before the dropdown header
       exists, and syncing here keeps the count and the bin button in step with
       the rows no matter which path triggered the render. */
    mountHeads();
    syncHeads();
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

  /* --------------------------------------------------- mouse drag reorder -- */

  /* HTML5 drag and drop rather than pointer events: it is built for exactly
     this - a mouse dragging a list row - and it keeps the pointer-event path
     free for the tap-to-play handler, which a drag would otherwise have to
     distinguish from a drag by movement threshold.

     Rows carry draggable="true" only when the pointer is fine (see rowHtml), so
     none of this can start from a touch. The buttons and the cover are
     explicitly draggable="false": an image is natively draggable and would
     otherwise start an image drag instead of a row drag, and Firefox makes
     buttons inside a draggable ancestor awkward to click.

     The handlers are delegated from the container so they survive a re-render.
     A plain click still plays the row, because the browser only fires
     dragstart once the mouse has actually moved. */

  var dragFrom = -1;
  var dropHint = null;

  function clearHint() {
    if (dropHint) { dropHint.classList.remove("queue-item-drop-before", "queue-item-drop-after"); dropHint = null; }
  }

  function endDrag() {
    dragFrom = -1;
    clearHint();
    var live = document.querySelectorAll(".queue-item-dragging");
    for (var i = 0; i < live.length; i++) live[i].classList.remove("queue-item-dragging");
  }

  function onDragStart(e) {
    /* Reordering while selecting would fight the checkboxes for the same tap,
       and moving a row would invalidate the position the user is looking at. */
    if (selectMode) { e.preventDefault(); return; }
    var item = e.target.closest && e.target.closest(".queue-item");
    if (!item) return;
    dragFrom = parseInt(item.getAttribute("data-qi"), 10);
    if (isNaN(dragFrom)) { dragFrom = -1; return; }
    item.classList.add("queue-item-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      /* Firefox refuses to begin a drag unless some payload is set. */
      try { e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (err) { /* older browsers */ }
    }
  }

  /* Where the pointer wants the row to land, as an index into the list *with
     the dragged row taken out*.

     That is exactly the index moveInQueue inserts at, because it splices the
     row out first and only then splices it back in. Indexing against the other
     rows rather than the on-screen ones is what keeps this free of an off-by-one
     when the dragged row sits above or below its target: dropping A on the
     bottom half of B resolves to 1 among [B,C,D], and moveInQueue(0,1) puts it
     straight after B. Indexing the visible rows instead would need the target
     shifted by one whenever the drag moved downwards, which is the usual way
     this ends up dropping a row in the wrong place. */
  function dropTarget(e, container) {
    var rows = container.querySelectorAll(".queue-item");
    var others = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains("queue-item-dragging")) continue;
      others.push(rows[i]);
    }
    if (!others.length) return { at: 0, before: null, after: null };
    for (var j = 0; j < others.length; j++) {
      var b = others[j].getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) {
        return { at: j, before: others[j], after: null };
      }
    }
    return { at: others.length, before: null, after: others[others.length - 1] };
  }

  function onDragOver(e) {
    if (dragFrom < 0) return;
    /* Without this the browser refuses the drop and no drop event ever fires. */
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    var h = dropTarget(e, e.currentTarget);
    if (!h.before && !h.after) return;
    var hint = h.before || h.after;
    var cls = h.before ? "queue-item-drop-before" : "queue-item-drop-after";
    if (dropHint !== hint || !hint.classList.contains(cls)) {
      clearHint();
      hint.classList.add(cls);
      dropHint = hint;
    }
  }

  function onDrop(e) {
    if (dragFrom < 0) return;
    e.preventDefault();
    e.stopPropagation();
    var from = dragFrom;
    var h = dropTarget(e, e.currentTarget);
    endDrag();
    if (h.at !== from) moveInQueue(from, h.at);
  }

  function onDragEnd() { endDrag(); }

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
      if (kind === "select") { toggleSelected(trackQueue[pos]); return; }
      if (kind === "remove") removeAt(pos);
      else if (kind === "up") moveInQueue(pos, pos - 1);
      else if (kind === "down") moveInQueue(pos, pos + 1);
      else if (kind === "playnext") playNextAt(pos);
      return;
    }
    /* While selecting, a tap anywhere on the row toggles it. Play-to-play is
       deliberately not offered here: it would pull tracks out of the queue
       mid-selection and leave the count lying. */
    if (selectMode) { toggleSelected(trackQueue[pos]); return; }
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

  /* ------------------------------------------------- select mode controls -- */

  /* The controls live in each queue header: the dropdown's, and the one in the
     "Up Next" panel if that panel is ever shown. Injected rather than added to
     index.html so both headers stay in step from one place and the markup is not
     duplicated across two containers. */
  function queueHeads() {
    var out = [];
    var dd = document.querySelector("#queue-dropdown .queue-dropdown-header");
    if (dd) out.push(dd);
    var panel = document.getElementById("queue-panel");
    if (panel && panel.firstElementChild && panel.firstElementChild.tagName === "DIV") out.push(panel.firstElementChild);
    return out;
  }

  function mountHeads() {
    var found = queueHeads();
    for (var i = 0; i < found.length; i++) {
      var h = found[i];
      /* Already mounted: skip it entirely. Pushing it again would grow heads by
         one per header on every render, and syncHeads then walks an array that
         only ever gets longer. */
      if (h.dataset.thwSelectMounted) continue;
      h.dataset.thwSelectMounted = "1";
      h.insertAdjacentHTML("beforeend",
        '<span class="queue-head-count" hidden></span>' +
        '<button type="button" class="queue-head-btn queue-bin-btn" hidden title="Remove selected"><i class="fas fa-trash"></i></button>' +
        '<button type="button" class="queue-head-btn queue-cancel-btn" hidden title="Cancel selecting"><i class="fas fa-times"></i></button>' +
        '<button type="button" class="queue-head-btn queue-select-btn" title="Select tracks"><i class="fas fa-list-check"></i></button>'
      );
      h.querySelector(".queue-select-btn").addEventListener("click", function () { setSelectMode(true); });
      h.querySelector(".queue-bin-btn").addEventListener("click", function () { binSelected(); });
      h.querySelector(".queue-cancel-btn").addEventListener("click", function () { setSelectMode(false); });
      heads.push(h);
    }
  }

  /* Reflect the current mode on every header. Called after anything that can
     change it, so the count and the bin button can never disagree with the rows. */
  function syncHeads() {
    var n = selected.size;
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var label = h.firstElementChild;
      var count = h.querySelector(".queue-head-count");
      var bin = h.querySelector(".queue-bin-btn");
      var cancel = h.querySelector(".queue-cancel-btn");
      var sel = h.querySelector(".queue-select-btn");
      var clear = h.querySelector("#queue-dropdown-clear") ||
                  (h.querySelector("button[onclick*='clearQueue']"));
      if (label && count) {
        if (selectMode) { label.hidden = true; count.hidden = false; count.textContent = n + " selected"; }
        else { label.hidden = false; count.hidden = true; }
      }
      if (bin) { bin.hidden = !selectMode; bin.disabled = n === 0; }
      if (cancel) cancel.hidden = !selectMode;
      /* Select mode and Clear All are two different ways to empty the list, so
         only one of them is offered at a time. */
      if (sel) sel.hidden = selectMode;
      if (clear) clear.hidden = selectMode;
    }
  }

  function setSelectMode(on) {
    if (selectMode === !!on) return;
    selectMode = !!on;
    if (!selectMode) selected.clear();
    renderAll();
    syncHeads();
  }

  function toggleSelected(idx) {
    if (!isValid(idx)) return;
    if (selected.has(idx)) selected.delete(idx);
    else selected.add(idx);
    renderAll();
    syncHeads();
  }

  function binSelected() {
    if (!selected.size) return;
    var n = selected.size;
    trackQueue = trackQueue.filter(function (idx) { return !selected.has(idx); });
    selected.clear();
    selectMode = false;
    commit();
    syncHeads();
    if (typeof toast === "function") {
      try { toast(n + (n === 1 ? " track removed from the queue" : " tracks removed from the queue"), "success"); } catch (e) {}
    }
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
