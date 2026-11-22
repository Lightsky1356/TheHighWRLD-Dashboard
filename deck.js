/*
 * WRLD Deck - the bar at the foot of the page.
 *
 * The bar is the widget the mini player used to be, so the code that fills
 * it in (the cover, the title, the artist, the play button, the shuffle and
 * repeat states) is the page's own and is left alone. What is here is what
 * the Deck needed of itself: the times at the ends of its bar, the version
 * line under the title, the volume as a slider that lies down, a heart that
 * is held to the same Discord rule as the player's, and the two keys that
 * are about the Deck itself.
 */


(function () {
  "use strict";
  if (window.__floatingPlayerMounted) return;
  window.__floatingPlayerMounted = true;

  function el(id) {
    return document.getElementById(id);
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function audio() {
    return document.querySelector("audio");
  }

  /* ---- the bar and the times at its ends ---- */
  var lastBarGrad = "";
  function paintBarGradient() {
    var t = null;
    try {
      if (typeof trackList !== "undefined" && trackList && typeof currentTrackIndex === "number") {
        t = trackList[currentTrackIndex];
      }
    } catch (e) {}
    if (!t || typeof window.getCoverGradientValue !== "function") return;
    var g;
    try { g = window.getCoverGradientValue(t.cover || t.title); } catch (e) { return; }
    if (!g || g === lastBarGrad) return;
    lastBarGrad = g;
    var bar = el("deck-progress-bar");
    var vol = el("deck-volume-fill");
    if (bar) bar.style.background = g;
    if (vol) vol.style.background = g;
  }

  function paintProgress() {
    paintBarGradient();
    var a = audio();
    if (!a) return;
    var bar = el("deck-progress-bar");
    var cur = el("deck-current-time");
    var dur = el("deck-duration-time");
    if (bar && a.duration && isFinite(a.duration)) {
      bar.style.transform = "scaleX(" + Math.min(Math.max(a.currentTime / a.duration, 0), 1) + ")";
    }
    if (cur) cur.textContent = fmt(a.currentTime);
    if (dur) dur.textContent = a.duration && isFinite(a.duration) ? fmt(a.duration) : "0:00";
  }

  /* ---- the volume ---- */
  function paintVolume() {
    var a = audio();
    if (!a) return;
    var v = Math.max(0, Math.min(1, Number(a.volume) || 0));
    var fill = el("deck-volume-fill");
    var thumb = el("deck-volume-thumb");
    var icon = el("deck-volume-icon");
    var slider = el("deck-volume-slider");
    if (fill) fill.style.width = v * 100 + "%";
    if (thumb) thumb.style.left = v * 100 + "%";
    if (slider) slider.setAttribute("aria-valuenow", String(Math.round(v * 100)));
    if (icon) {
      icon.className = "fas " + (v === 0 ? "fa-volume-xmark" : v < 0.5 ? "fa-volume-low" : "fa-volume-up");
    }
  }

  function setVolume(v) {
    /* The page's own volume code is the one that knows about the mute
       button, the memory and the other slider - so it does the work and
       this bar only draws the answer. */
    if (typeof window.__setVolume === "function") window.__setVolume(v);
    else if (audio()) audio().volume = Math.max(0, Math.min(1, v));
    paintVolume();
  }

  /* ---- the version line under the title ---- */
  function paintTag() {
    var tag = el("deck-tag");
    if (!tag) return;
    var text = "";
    try {
      if (typeof trackList !== "undefined" && trackList && typeof currentTrackIndex === "number" && currentTrackIndex >= 0) {
        var t = trackList[currentTrackIndex];
        if (t) {
          if (typeof getTrackAlbum === "function") text = getTrackAlbum(t);
          else text = t.album || t.tag || "";
        }
      }
    } catch (e) {}
    tag.textContent = text || "";
    tag.style.display = text ? "" : "none";
  }

  /* ---- the heart, which is the player's heart ---- */
  function paintFav() {
    var fav = el("fav-btn");
    var mini = el("deck-fav-btn");
    if (!mini) return;
    if (!fav) { mini.style.display = "none"; return; }
    var on = fav.classList.contains("fav-active");
    mini.classList.toggle("fav-active", on);
    mini.style.display = "";
  }

  /* ---- the wiring ---- */
  function wire() {
    var a = audio();
    if (a) {
      a.addEventListener("timeupdate", paintProgress);
      a.addEventListener("loadedmetadata", paintProgress);
      a.addEventListener("durationchange", paintProgress);
      a.addEventListener("volumechange", paintVolume);
    }

    /* The heart: the same favourite the player page has. */
    var miniFav = el("deck-fav-btn");
    if (miniFav) {
      miniFav.addEventListener("click", function (e) {
        e.stopPropagation();
        try {
          if (typeof currentTrackIndex === "number" && currentTrackIndex >= 0 && typeof toggleFavorite === "function") {
            toggleFavorite(currentTrackIndex);
          }
          if (typeof updateFavBtn === "function") updateFavBtn();
        } catch (err) {}
        paintFav();
      });
    }
    /* And it follows the player's own heart, wherever that is changed. */
    var fav = el("fav-btn");
    if (fav && window.MutationObserver) {
      new MutationObserver(paintFav).observe(fav, { attributes: true, attributeFilter: ["class", "style"] });
    }

    /* The version line follows the title, and the title itself opens the track
       info panel (the same one the player's info button opens). */
    var title = el("deck-title");
    if (title) {
      if (window.MutationObserver) {
        new MutationObserver(paintTag).observe(title, { childList: true, characterData: true, subtree: true });
      }
      title.style.cursor = "pointer";
      title.setAttribute("role", "button");
      title.setAttribute("tabindex", "0");
      title.title = "Song details";
      function deckOpenInfo() {
        if (typeof window.showInfoPanel === "function") window.showInfoPanel();
        else if (typeof window.openSongPage === "function") window.openSongPage();
      }
      title.addEventListener("click", function (e) { e.stopPropagation(); deckOpenInfo(); });
      title.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); deckOpenInfo(); }
      });
    }

    /* The queue. */
    var queue = el("deck-queue-btn");
    if (queue) {
      queue.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof window.toggleQueuePanel === "function") window.toggleQueuePanel();
      });
    }

    /* The player's settings. */
    var settings = el("deck-settings-btn");
    if (settings) {
      settings.addEventListener("click", function (e) {
        e.stopPropagation();
        var cog = el("player-settings-cog");
        if (cog) cog.click();
      });
    }

    /* How see-through the bar is.
     *
     * The Deck sits over the page, so how much of the page shows through
     * it is a matter of taste. The steps are in the dropdown, and the
     * choice is remembered - a reader who likes to see the page behind
     * the bar does not want to set it again every morning. */
    var opacitySel = el("deck-opacity");
    if (opacitySel) {
      var OPACITY_KEY = "thw-deck-opacity";
      var applyOpacity = function () {
        var d = el("deck-player");
        var v = opacitySel.value;
        var isSolid = v === "solid";
        if (d) {
          d.classList.toggle("deck-solid", isSolid);
          d.style.opacity = isSolid ? "1" : String(parseFloat(v) || 1);
        }
        try { localStorage.setItem(OPACITY_KEY, isSolid ? "solid" : String(parseFloat(v) || 1)); } catch (e) {}
      };
      var remembered = "1";
      try { remembered = localStorage.getItem(OPACITY_KEY) || "1"; } catch (e) {}
      /* A remembered value that is not one of the steps is ignored. */
      var option = opacitySel.querySelector('option[value="' + remembered + '"]');
      if (option) opacitySel.value = remembered;
      opacitySel.addEventListener("change", applyOpacity);
      applyOpacity();
    }

    /* The volume: a slider that lies down. */
    var slider = el("deck-volume-slider");
    if (slider) {
      var from = function (e) {
        var r = slider.getBoundingClientRect();
        if (!r.width) return null;
        var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        return Math.max(0, Math.min(1, x / r.width));
      };
      slider.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var v = from(e);
        if (v === null) return;
        setVolume(v);
        var move = function (ev) { var nv = from(ev); if (nv !== null) setVolume(nv); };
        var up = function () {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      slider.addEventListener("touchstart", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var v = from(e);
        if (v === null) return;
        setVolume(v);
        var move = function (ev) { var nv = from(ev); if (nv !== null) setVolume(nv); };
        var end = function () {
          document.removeEventListener("touchmove", move);
          document.removeEventListener("touchend", end);
        };
        document.addEventListener("touchmove", move, { passive: false });
        document.addEventListener("touchend", end);
      }, { passive: false });
      slider.addEventListener("keydown", function (e) {
        var a = audio();
        if (!a) return;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setVolume(a.volume + 0.05); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setVolume(a.volume - 0.05); }
      });
    }

    /* The speaker: mute, and mute again to come back. */
    var volBtn = el("deck-volume-btn");
    if (volBtn) {
      var was = 0.75;
      volBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var a = audio();
        if (!a) return;
        if (a.volume > 0) { was = a.volume; setVolume(0); }
        else setVolume(was || 0.75);
        paintVolume();
      });
    }

    paintProgress();
    paintVolume();
    paintTag();
    paintFav();
  }

  /* Drag-to-seek on the deck's own bar. The full-screen player has its own
     scrubber; the deck bar previously only painted progress and ignored touch. */
  function wireSeek() {
    var progress = el("deck-progress");
    if (!progress) return;
    var dragging = false;
    function seek(clientX) {
      var a = audio();
      if (!a || !a.duration || !isFinite(a.duration)) return;
      var r = progress.getBoundingClientRect();
      if (!r.width) return;
      var ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      var bar = el("deck-progress-bar");
      if (bar) bar.style.transform = "scaleX(" + ratio + ")";
      try { a.currentTime = ratio * a.duration; } catch (e) {}
    }
    function move(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      seek(e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
    }
    function end() {
      dragging = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
    }
    progress.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      dragging = true;
      seek(e.clientX);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
    });
    progress.addEventListener("touchstart", function (e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      dragging = true;
      seek(e.touches[0] ? e.touches[0].clientX : 0);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", end);
    }, { passive: false });
  }

  function boot() {
    wire();
    wireSeek();
    /* The page may load the audio late, so the first paint is repeated a
       little while the page settles. */
    setTimeout(function () { paintProgress(); paintVolume(); paintTag(); paintFav(); }, 1200);
    setTimeout(function () { paintProgress(); paintVolume(); paintTag(); paintFav(); }, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();


(function () {
  "use strict";
  if (window.__deckMounted) return;
  window.__deckMounted = true;

  var KEY = "thw-deck-hidden";

  function el(id) {
    return document.getElementById(id);
  }

  function remembered() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }

  function remember(hidden) {
    try { localStorage.setItem(KEY, hidden ? "1" : "0"); } catch (e) {}
  }

  /* Whether the WRLD Player page is on the screen right now. The Deck is
     the player's little sibling everywhere else - on the player itself it
     is redundant, so it stays put away and cannot be summoned back. */
  function pageIsPlayer() {
    var active = document.querySelector(".app-page.active");
    return !!(active && active.id === "page-section-player");
  }

  var pageLocked = false;
  function pageLockedOn() { return pageLocked; }

  /* ---- putting the Deck away ---- */
  function setAway(away, keep) {
    var bar = el("deck-player");
    var handle = el("deck-handle");
    if (bar) {
      if (away) bar.classList.add("deck-away");
      else {
        bar.classList.remove("deck-away");
        /* The script's own showDeckPlayer() is shadowed by this file and its
           .hidden (Tailwind's, sliding the bar to display:none via
           #deck-player.hidden) is otherwise never removed: the Deck would
           stay invisible forever after leaving the WRLD Player. */
        bar.classList.remove("hidden");
      }
    }
    if (handle) handle.hidden = !away;
    if (document.body) document.body.classList.toggle("deck-hidden", away);
    /* "keep" is for locking on the WRLD Player: the Deck goes away without
       touching the saved preference, so it comes back where the reader
       left it the moment they leave the player. */
    if (!keep) remember(away);
    var toggle = el("deck-toggle");
    if (toggle) {
      toggle.title = away ? "Show WRLD Deck" : "Hide WRLD Deck";
      toggle.setAttribute("aria-label", toggle.title);
      var icon = toggle.querySelector("i");
      if (icon) icon.className = away ? "fas fa-chevron-up" : "fas fa-chevron-down";
    }
  }

  /* Push the Deck away when the WRLD Player page is the active page, and
     restore the reader's own choice the moment they leave it. Safe to call
     as often as we like - it only does work on a change. */
  function syncForPage() {
    var player = pageIsPlayer();
    if (player && !pageLocked) {
      pageLocked = true;
      if (document.body) document.body.classList.add("deck-page-locked");
      setAway(true, true);
      return;
    }
    if (!player && pageLocked) {
      pageLocked = false;
      if (document.body) document.body.classList.remove("deck-page-locked");
      setAway(remembered());
    }
  }

  /* The opacity steps do nothing on a phone - the phone has no room for
     them. The stylesheet hides them; this makes sure they are really gone
     even if an old copy of the stylesheet is cached on the device. */
  function removeOnPhones() {
    try {
      if (!window.matchMedia) return;
      var phone = window.matchMedia("(max-width:767px)").matches ||
        window.matchMedia("(orientation:landscape) and (max-height:500px) and (pointer:coarse)").matches;
      if (!phone) return;
      var op = document.querySelector(".deck-opacity");
      if (op && op.parentNode) op.parentNode.removeChild(op);
    } catch (e) {}
  }

  /* ---- the heart ---- */
  function paintFav() {
    var button = el("deck-fav");
    if (!button) return;
    var on = false;
    try {
      if (typeof isFavorite === "function" && typeof currentTrackIndex === "number" && currentTrackIndex >= 0) {
        on = !!isFavorite(currentTrackIndex);
      }
    } catch (e) {}
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    var icon = button.querySelector("i");
    if (icon) icon.className = on ? "fas fa-heart" : "far fa-heart";
    button.title = on ? "Remove from Favourites" : "Add to Favourites";
  }

  /* ---- the wiring ---- */
  function wire() {
    var toggle = el("deck-toggle");
    if (toggle) {
      toggle.addEventListener("click", function (e) {
        /* The toggle hides while the WRLD Player page is up. */
        if (pageLockedOn()) { e.preventDefault(); e.stopPropagation(); return; }
        e.stopPropagation();
        setAway(!document.body.classList.contains("deck-hidden"));
      });
    }

    var handle = el("deck-handle-btn");
    if (handle) {
      handle.addEventListener("click", function (e) {
        if (pageLockedOn()) { e.preventDefault(); e.stopPropagation(); return; }
        e.stopPropagation();
        setAway(false);
        try { if (typeof window.showDeckPlayer === "function") window.showDeckPlayer(); } catch (err) {}
      });
    }

    /* The list of shortcuts. */
    var keys = el("deck-keys-btn");
    if (keys) {
      keys.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleShortcuts();
      });
    }
    var keysClose = el("deck-shortcuts-close");
    if (keysClose) {
      keysClose.addEventListener("click", function (e) {
        e.stopPropagation();
        var panel = el("deck-shortcuts");
        if (panel) panel.hidden = true;
      });
    }

    var fav = el("deck-fav");
    if (fav) {
      fav.addEventListener("click", function (e) {
        e.stopPropagation();
        /* The player's own heart, which asks for a Discord link before it
           does anything - and says so when it cannot. */
        try {
          if (typeof currentTrackIndex === "number" && currentTrackIndex >= 0 && typeof toggleFavorite === "function") {
            toggleFavorite(currentTrackIndex);
          }
          if (typeof updateFavBtn === "function") updateFavBtn();
        } catch (err) {}
        paintFav();
      });
    }

    /* The Deck's heart follows the player's. */
    var playerFav = el("fav-btn");
    if (playerFav && window.MutationObserver) {
      new MutationObserver(paintFav).observe(playerFav, { attributes: true, attributeFilter: ["class", "style"] });
    }
    /* And it follows the song. */
    var title = el("deck-title");
    if (title && window.MutationObserver) {
      new MutationObserver(function () { paintFav(); }).observe(title, { childList: true, characterData: true, subtree: true });
    }

    /* Where it was left. The player page can win over the saved choice -
       it is checked again on every page switch and on the interval. */
    setAway(remembered());
    removeOnPhones();
    syncForPage();
    paintFav();
  }

  /* ---- the Deck's own keys ---- */
  function shortcutsOn() {
    /* The player has a setting for the keyboard shortcuts, and the Deck's
       keys are part of that: if they are turned off, they are off here
       too. */
    try {
      if (window.wrldPlayerSettings && !window.wrldPlayerSettings.get("keyboardShortcuts")) return false;
    } catch (e) {}
    return true;
  }

  function inAField(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }

  function toggleShortcuts() {
    var panel = el("deck-shortcuts");
    if (!panel) return;
    panel.hidden = !panel.hidden;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      var panel = el("deck-shortcuts");
      if (panel && !panel.hidden) {
        e.preventDefault();
        panel.hidden = true;
      }
      return;
    }
    if (inAField(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!shortcutsOn()) return;

    /* D - put WRLD Deck away, or bring it back. Not on the WRLD Player page:
       the Deck has no business there, so the key is dead there too. */
    if (e.key === "d" || e.key === "D") {
      if (pageLockedOn()) return;
      e.preventDefault();
      setAway(!document.body.classList.contains("deck-hidden"));
      return;
    }
    /* ? - the list of shortcuts. */
    if (e.key === "?") {
      e.preventDefault();
      toggleShortcuts();
    }
  }

  /* Whether a track is actually loaded. On a cold phone, no track means the
     phone is showing a dead bar at the bottom - so the Deck waits for a
     song instead of idling there.

     A deliberate play action (selecting a new song) acts as a signal the
     reader wants the Deck visible - if they had hidden it, route it back
     into view once. Inside every other situation the reader's own saved
     preference wins: pressing D puts the Deck away and it stays away until
     they bring it back or pick a new song. */
  var lastTrackForDeckHint = -1;
  function syncNoTrack(kicked) {
    var has = false;
    try { has = typeof currentTrackIndex === "number" && currentTrackIndex >= 0; } catch (e) {}
    if (document.body) document.body.classList.toggle("deck-no-track", !has);
    /* Only an actual play/load event brings a hidden Deck back into view on a
       deliberate track selection - not the heartbeat. The heartbeat merely
       keeps the away class honest; it must never undo a reader's hide. */
    if (kicked && has && window.currentTrackIndex !== lastTrackForDeckHint && !pageIsPlayer() && document.body.classList.contains("deck-hidden")) {
      lastTrackForDeckHint = window.currentTrackIndex;
      setAway(false, true);
    }
  }

  function boot() {
    wire();
    document.addEventListener("keydown", onKey);
    /* One page switch drives both the page and the Deck's locked state.
       The wrapper is only installed once, and it defers to syncForPage for
       the actual work. */
    try {
      var original = window.switchAppPage;
      if (typeof original === "function" && !original.__deckWrapped) {
        var wrapped = function () {
          var r = original.apply(this, arguments);
          try { syncForPage(); } catch (e) {}
          return r;
        };
        wrapped.__deckWrapped = true;
        window.switchAppPage = wrapped;
      }
    } catch (e) {}
    /* One call for any page that loads a track and wants the Deck back on
       screen right away. Exposed so the vault, the era pages and the queue
       can ask for it directly.
       Never on the WRLD Player page itself - the Deck is that page's job - and
       never sticks the bar on the reader's machine by overwriting the hidden
       preference; a reader who hides the Deck keeps it hidden. */
    window.showDeckPlayer = function () {
      try {
        if (pageIsPlayer()) return;
        setAway(false, true);
      } catch (e) {}
    };

    /* Hide the Deck behind an overlay (the mobile sheet, a dialog) without
       touching the reader's own hidden preference; show it again on close,
       falling back to whatever the reader had chosen. */
    window.THWDeckOverlayHide = function (hide) {
      try {
        if (hide) setAway(true, true);
        else setAway(remembered(), true);
      } catch (e) {}
    };
    /* The bar appears and goes with the player, so the Deck's own state
       is checked again now and then. */
    syncNoTrack(true);
    var audioEl = document.querySelector("audio");
    if (audioEl) {
      audioEl.addEventListener("loadedmetadata", function () { syncNoTrack(true); });
      audioEl.addEventListener("play", function () { syncNoTrack(true); });
    }

    setInterval(function () {
      syncForPage();
      removeOnPhones();
      syncNoTrack();
      var bar = el("deck-player");
      if (!bar) return;
      var away = document.body.classList.contains("deck-hidden");
      if (!away && bar.classList.contains("deck-away")) bar.classList.remove("deck-away");
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
