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
    applyAccountRowState();
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


  /* Auth-aware label for the account row.
   *
   * "Account Settings" is the honest label: /account has no privacy controls.
   * Profile visibility lives on the self profile page and messaging privacy
   * lives in the Friends & Messages panel, so promising "& Privacy" here sent
   * people to a page that does not deliver it.
   *
   * Signed out there is no account to manage at all, so the row becomes a sign-in
   * prompt instead of a dead end. Uses the same localStorage signal the rest of
   * the site uses (auth.js writes it on sign-in and removes it on sign-out), and
   * re-evaluated on every open so it stays current after a sign-in. */
  function signedInNow() {
    try { return !!localStorage.getItem("wantedAuthUser"); } catch (e) { return false; }
  }

  function applyAccountRowState() {
    var link = document.getElementById("legal-account-link");
    if (!link) return;
    var label = link.querySelector("[data-legal-account-label]");
    var icon = link.querySelector("[data-legal-account-icon]");
    var on = signedInNow();
    if (label) label.textContent = on ? "Account Settings" : "Sign in to manage your settings";
    if (icon) icon.className = on ? "fas fa-gear" : "fas fa-right-to-bracket";
    /* Signed out, the href must not navigate to the account editor. The click
       handler intercepts it, but removing the href also means it is not a
       broken link if the handler is ever absent. */
    if (on) link.setAttribute("href", "/account");
    else link.removeAttribute("href");
    link.setAttribute("data-legal-signed-in", on ? "1" : "0");
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

    /* The links inside the panel are the trap this dialog was built to avoid.
       TOS/PP/DMCA/Wanted/Suggestions/Account/Roadmap are CLIENT-SIDE routes -
       switchAppPage builds the target id as `page-section-${page}`. Letting the
       browser follow href="/TOS" is a real document navigation: Pages serves
       index.html for the path (200, not a 404), so the whole app re-downloads
       and re-boots - which reads to the user as the tab refreshing and throws
       away all in-page state. Intercept them and route them through the SPA
       like every nav control does. External links (Discord) and /delete-request
       (a real Pages Function page) are deliberately left alone so they still
       perform a genuine navigation. */
    var SPROUTES = {
      "/TOS": "tos", "/PP": "pp", "/DMCA": "dmca", "/Copyright": "copyright",
      "/wanted": "wanted", "/suggestions": "suggestions",
      "/account": "account", "/roadmap": "roadmap"
    };
    overlay().addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest(".legal-info-link") : null;
      if (!link) return;
      /* Signed-out account row: send them to sign in rather than to an
         account editor with nothing they can use. */
      if (link.hasAttribute("data-legal-account") && !signedInNow()) {
        e.preventDefault();
        close();
        if (typeof window.showAuthPage === "function") { try { window.showAuthPage("login"); return; } catch (_) {} }
        if (typeof window.authGateSignIn === "function") { try { window.authGateSignIn(); } catch (_) {} }
        return;
      }
      var path = (link.getAttribute("href") || "").replace(/\/+$/, "") || "/";
      var page = SPROUTES[path];
      /* Not a known SPA route: leave the browser to handle it. */
      if (!page || typeof window.switchAppPage !== "function") return;
      e.preventDefault();
      /* Close first so the panel's overflow locks are released before the page
         switch scrolls the document to the top. */
      close();
      window.switchAppPage(page);
    });

    /* The Back button on TOS/PP/DMCA is onclick="history.back()", which walks
       BROWSER history rather than app history. Two problems:
         - TOS -> PP -> Back lands on PP again, so it reads as a broken button.
         - On a deep link (/TOS typed directly, or a shared link) there is no
           in-app history to return to, and history.back() can walk the user
           straight out of the site.
       Return to the lobby instead: deterministic, and it can never exit the
       site. Bound to the document rather than the three buttons so markup added
       later is covered too. */
    document.addEventListener("click", function (e) {
      var back = e.target.closest ? e.target.closest(".legal-page-back") : null;
      if (!back) return;
      e.preventDefault();
      if (typeof window.switchAppPage === "function") window.switchAppPage("home");
    });
  }

  window.openLegalInfo = open;
  window.closeLegalInfo = close;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();