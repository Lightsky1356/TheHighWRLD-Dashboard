/* ============================================================================
   COVER PREVIEW
   The "View cover" button in the WRLD Player's info panel. It opens
   the site's existing cover lightbox (#cover-lightbox) on the currently playing
   track's artwork. It used to sit under the big artwork in the player itself;
   it lives in the info panel now, so the player column carries only controls.

   Deliberately thin: the lightbox already has its own markup, navigation,
   arrow-key handling and Escape handling, so this only supplies the trigger and
   a safe way to name the artwork to show.
   ========================================================================== */
(function () {
  "use strict";

  function currentArt() {
    var cover = document.getElementById("player-cover");
    if (!cover) return null;
    return {
      el: cover,
      title: (function () {
        var t = document.getElementById("track-title");
        return t ? (t.textContent || "").trim() : "";
      })(),
      artist: (function () {
        var a = document.getElementById("track-artist");
        return a ? (a.textContent || "").trim() : "";
      })()
    };
  }

  function openPreview() {
    var art = currentArt();
    if (!art) return;
    /* Close the player sidebar only if it happens to be open - the helper is a
       toggle, so calling it blind would open it instead of closing it. */
    var sb = document.getElementById("player-sidebar");
    if (sb && !sb.classList.contains("hidden") && typeof togglePlayerSidebar === "function") {
      try { togglePlayerSidebar(); } catch (e) { /* sidebar is optional */ }
    }

    /* showCoverArt() reads its image with e.querySelector("img"), which finds
       nothing when handed the <img decoding="async"> itself - that is the reason double-clicking
       the player cover used to do nothing. script.js now accepts either, so the
       element can be passed straight in; no wrapper, and crucially the player
       cover is never moved out of the DOM. */
    if (typeof showCoverArt === "function") {
      try {
        showCoverArt(art.el);
        /* The player cover carries no title attribute, so fill the caption in
           afterwards - showCoverArt only reads one. */
        var cap = document.getElementById("cover-lightbox-label");
        if (cap) cap.textContent = art.title || art.artist || "";
        return;
      } catch (e) { /* fall through to the direct path below */ }
    }

    /* Direct path, in case showCoverArt is unavailable. */
    var lb = document.getElementById("cover-lightbox");
    var img = document.getElementById("cover-lightbox-img");
    var label = document.getElementById("cover-lightbox-label");
    if (!lb || !img) return;
    img.src = art.el.getAttribute("src") || "";
    img.alt = art.title || "";
    if (label) label.textContent = art.title || "";
    lb.style.display = "flex";
    if (document.body) document.body.classList.add("blur-active");
  }

  function mount() {
    /* Under the artwork, but inside the info panel rather than beside the
       player's big vinyl. .info-panel-cover-row is a centred flex column, so the
       pill drops straight in below the cover image with no CSS change needed.
       .info-panel-cover-wrap was the other candidate and is wrong: it has a fixed
       size at every breakpoint (168px, 150px, 124px...), so a child would either
       overflow it or squash the image. */
    var wrapper = document.querySelector(".info-panel-cover-row");
    if (!wrapper) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-open";
    btn.id = "cover-preview-btn";
    btn.innerHTML = '<i class="fas fa-expand" aria-hidden="true"></i>View cover';
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", openPreview);
    wrapper.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.openCoverPreview = openPreview;
})();