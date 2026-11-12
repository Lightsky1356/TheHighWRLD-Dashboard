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
  function paintProgress() {
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

    /* The version line follows the title. */
    var title = el("deck-title");
    if (title && window.MutationObserver) {
      new MutationObserver(paintTag).observe(title, { childList: true, characterData: true, subtree: true });
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

  function boot() {
    wire();
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

  /* ---- putting the Deck away ---- */
  function setAway(away) {
    var bar = el("deck-player");
    var handle = el("deck-handle");
    if (bar) {
      if (away) bar.classList.add("deck-away");
      else bar.classList.remove("deck-away");
    }
    if (handle) handle.hidden = !away;
    if (document.body) document.body.classList.toggle("deck-hidden", away);
    remember(away);
    var toggle = el("deck-toggle");
    if (toggle) {
      toggle.title = away ? "Show WRLD Deck" : "Hide WRLD Deck";
      toggle.setAttribute("aria-label", toggle.title);
      var icon = toggle.querySelector("i");
      if (icon) icon.className = away ? "fas fa-chevron-up" : "fas fa-chevron-down";
    }
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
        e.stopPropagation();
        setAway(!document.body.classList.contains("deck-hidden"));
      });
    }

    var handle = el("deck-handle-btn");
    if (handle) {
      handle.addEventListener("click", function (e) {
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

    /* Where it was left. */
    setAway(remembered());
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

    /* D - put WRLD Deck away, or bring it back. */
    if (e.key === "d" || e.key === "D") {
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

  function boot() {
    wire();
    document.addEventListener("keydown", onKey);
    /* The bar appears and goes with the player, so the Deck's own state
       is checked again now and then. */
    setInterval(function () {
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
