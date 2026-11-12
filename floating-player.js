/*
 * The floating bar - the parts the mini player never had.
 *
 * The widget itself is the mini player, and the code that fills it in
 * (the cover, the title, the artist, the play button, the shuffle and
 * repeat states) is the mini player's own. What was missing is here:
 *
 *   - the version line under the title, and the heart beside it
 *   - the times at the two ends of the bar
 *   - the volume, as a slider that lies down
 *   - the queue button and the player's settings
 *
 * Nothing here is trusted about the state of the player: it is read from
 * the audio element and from the page, which is where the truth is.
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
    var bar = el("mini-progress-bar");
    var cur = el("mini-current-time");
    var dur = el("mini-duration-time");
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
    var fill = el("mini-volume-fill");
    var thumb = el("mini-volume-thumb");
    var icon = el("mini-volume-icon");
    var slider = el("mini-volume-slider");
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
    var tag = el("mini-tag");
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
    var mini = el("mini-fav-btn");
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
    var miniFav = el("mini-fav-btn");
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
    var title = el("mini-title");
    if (title && window.MutationObserver) {
      new MutationObserver(paintTag).observe(title, { childList: true, characterData: true, subtree: true });
    }

    /* The queue. */
    var queue = el("mini-queue-btn");
    if (queue) {
      queue.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof window.toggleQueuePanel === "function") window.toggleQueuePanel();
      });
    }

    /* The player's settings. */
    var settings = el("mini-settings-btn");
    if (settings) {
      settings.addEventListener("click", function (e) {
        e.stopPropagation();
        var cog = el("player-settings-cog");
        if (cog) cog.click();
      });
    }

    /* The volume: a slider that lies down. */
    var slider = el("mini-volume-slider");
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
    var volBtn = el("mini-volume-btn");
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
