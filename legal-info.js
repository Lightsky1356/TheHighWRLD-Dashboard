/* Legal & Info — one entry point in the footer instead of a row of legal links.
 *
 * Only destinations that actually exist are listed. Verified against the live
 * markup before writing this: /TOS, /PP and /DMCA are real page sections
 * (page-section-tos / -pp / -dmca, routed by account.js NAV_URL), /roadmap and
 * /account are real routes, and /delete-request is a real Pages Function page.
 *
 * Deliberately absent, because no such page exists and this must not link to
 * something fake: Community Guidelines and Moderation Policy (both exist only as
 * prose inside the Terms of Service section), Appeals (an API at
 * functions/api/appeals.js with no user-facing page), Accessibility, Help/FAQ and
 * Contact. They are omitted rather than stubbed; see the report for the list.
 *
 * Desktop: centred modal. Mobile: bottom sheet that sits above the mobile bottom
 * nav and respects env(safe-area-inset-bottom). The backdrop is a real overlay
 * with backdrop-filter - never a filter:blur() on the parent, which would blur
 * the panel too and create a containing block that breaks fixed positioning.
 */
(function () {
  "use strict";

  var OVERLAY_ID = "legal-info-overlay";
  var lastFocus = null;
  var previousBodyOverflow = null;
  var previousRootOverflow = null;

  function overlay() { return document.getElementById(OVERLAY_ID); }
  function panel() { return overlay() ? overlay().querySelector(".legal-info-panel") : null; }

  function open() {
    var o = overlay();
    if (!o || o.classList.contains("open")) return;
    lastFocus = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = document.documentElement.style.overflow;
    o.classList.add("open");
    o.removeAttribute("aria-hidden");
    var close = o.querySelector(".legal-info-close");
    if (close) close.focus();
    /* Match how the rest of the site stops the page behind a modal. */
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.classList.add("legal-info-open");
  }

  function close() {
    var o = overlay();
    if (!o || !o.classList.contains("open")) return;
    o.classList.remove("open");
    o.setAttribute("aria-hidden", "true");
    document.body.style.overflow = previousBodyOverflow == null ? "" : previousBodyOverflow;
    document.documentElement.style.overflow = previousRootOverflow == null ? "" : previousRootOverflow;
    document.documentElement.classList.remove("legal-info-open");
    /* Return focus where it came from, so keyboard users are not dropped at the
       top of the document. */
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    previousBodyOverflow = null;
    previousRootOverflow = null;
  }

  /* Keep Tab inside the dialog while it is open. Only moves between the focusable
     things the panel actually contains, and wraps at both ends - it does not
     permanently trap focus, because Escape and the close button always work. */
  function onKeydown(e) {
    var o = overlay();
    if (!o || !o.classList.contains("open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    var f = panel().querySelectorAll('a[href], button:not([disabled])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function boot() {
    if (!overlay()) return;

    document.addEventListener("keydown", onKeydown, true);

    overlay().addEventListener("click", function (e) {
      /* Backdrop click closes; clicks inside the panel must not. */
      if (e.target === overlay()) close();
    });

    var closeBtn = overlay().querySelector(".legal-info-close");
    if (closeBtn) closeBtn.addEventListener("click", close);

    /* Put the one entry point in the site-wide footer rather than the WRLD
       Player's section footer, so it remains a single global footer control.
       Only a trigger that is not already in a footer gets moved: index.html
       already places it in the global footer, and relocating it used to move it
       into the first `footer.w-full`, which is the collapsed footer inside a
       hidden page section - a 0x0 box, so the button simply disappeared. */
    var trigger = document.querySelector("[data-legal-info]");
    if (trigger && !trigger.closest("footer")) {
      /* Several footers carry the w-full utility, one per page section, and the
         section ones are inside a hidden .app-page when the page is not open.
         Pick the global footer - the one that is not inside a page section -
         rather than the first match in document order. */
      var footers = Array.prototype.filter.call(document.querySelectorAll("footer"), function (f) {
        return !f.closest(".app-page");
      });
      var siteFooter = footers[0];
      if (siteFooter) {
        var tagline = Array.prototype.find.call(siteFooter.querySelectorAll("p"), function (p) {
          return (p.textContent || "").indexOf("LLJW") !== -1;
        });
        if (tagline && tagline.parentNode) {
          var triggerWrap = document.createElement("div");
          triggerWrap.className = "flex justify-center sm:justify-start mt-3";
          tagline.parentNode.insertBefore(triggerWrap, tagline.nextSibling);
          triggerWrap.appendChild(trigger);
        }
      }
    }

    /* Every [data-legal-info] opens it, so the footer button and any future
       entry point share one code path. */
    document.querySelectorAll("[data-legal-info]").forEach(function (btn) {
      btn.addEventListener("click", function (e) { e.preventDefault(); open(); });
    });
  }

  window.openLegalInfo = open;
  window.closeLegalInfo = close;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();