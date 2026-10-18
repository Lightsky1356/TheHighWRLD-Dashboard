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

  /* --------------------------------------------------------------------------
     BACKDROP TAP TO DISMISS

     The lightbox had no pointer route out at all. Escape and the arrow keys are
     wired, and the close button works - but on a phone there is no Escape key, the
     body scroll is locked while the lightbox is open (blur-active sets
     overflow:hidden), and the close button was a 26x30 target tucked 12px from the
     top and 14px from the right. So on mobile that one small corner button was the
     only way out, and both reported routes into this overlay - "View cover" on a
     track, and tapping a cover in an artist panel - land in the same lightbox and
     were equally stuck.

     Bound once on the lightbox element rather than per open, so it covers both
     entry points, and it is delegated because the close and arrow buttons are
     created per open by showCoverArt().

     Only the backdrop and the caption dismiss. The arrow buttons and the artwork
     wrapper are left alone deliberately: the markup already stops propagation on
     .lb-nav and .lb-img-wrap (index.html), so tapping the artwork was never meant
     to close the lightbox, and this does not quietly reverse that. The artwork is
     inset on a phone - about 370x470 inside 390x844, leaving wide bands above and
     below - so the backdrop is a large, easy target rather than a sliver. The
     selectors are repeated here anyway, so the intent is legible in this file
     instead of only in the HTML, and survives if the inline handlers change. */
  function mountDismiss() {
    var lb = document.getElementById("cover-lightbox");
    if (!lb || lb.dataset.thwDismissBound) return;
    lb.dataset.thwDismissBound = "1";

    lb.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest(".lb-nav, .lb-close, .lb-img-wrap")) return;
      if (typeof hideCoverArt === "function") {
        try { hideCoverArt(); return; } catch (err) { /* fall through */ }
      }
      /* hideCoverArt is script.js's; if it ever goes away the overlay still has to
         come down, or the page is stuck scroll-locked behind it. */
      lb.style.display = "none";
      if (document.body) document.body.classList.remove("blur-active");
      if (typeof _unlockScroll === "function") { try { _unlockScroll(); } catch (err2) {} }
    });
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
    document.addEventListener("DOMContentLoaded", function () {
      mount();
      mountDismiss();
    });
  } else {
    mount();
    mountDismiss();
  }

  window.openCoverPreview = openPreview;
})();