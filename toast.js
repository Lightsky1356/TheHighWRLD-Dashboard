/* ============================================================================
   CENTRAL TOAST

   Exports window.toast.

   THE PROBLEM THIS FIXES
   Thirty-seven call sites across fourteen files are written as

       if (window.toast) window.toast(msg, kind);

   which reads as "use the shared toast if one is available". No such shared
   toast was ever assigned. `window.toast =` appears nowhere else in the
   codebase - the only other textual match is a guarded *call* inside
   profile-enhancements.js. So every one of those guards evaluated to false and
   every one of those toasts was silently dropped: 37 places that tell the user
   something happened, or did not, and say nothing at all.

   WHICH NAMES ARE AFFECTED
   window.toast only. window.showToast is a separate, already-working function
   that script.js defines (`function showToast(e, t, a)`) and that already
   delegates to the same simple-toast style used below. It is left alone here -
   assigning over it would only risk clobbering a working function.

   WHICH STYLE IS USED, AND WHY THAT ONE
   The .gtoast style from simple-toast.css, which is the site's own designated
   toast: script.js's showToast already routes everything through it, with the
   note that it is "styled consistently with the rest of the site's
   notifications".

   The other candidate was #toasts + .toast. That combination does not work and
   never has. Its CSS is scoped

       #account-page #toasts { ... }
       #account-page .toast   { ... }

   but the #toasts element is a direct child of <main>, with no #account-page
   ancestor - confirmed in the live DOM, not inferred. Those selectors therefore
   never match it, and there is no other .toast rule in any stylesheet. Every
   toast that went into that container rendered as an unstyled bare div in
   normal flow at the bottom of the page. Eight files still contain that
   pattern as a fallback behind an `if (window.toast)` guard; those guards now
   fire, so they take this path instead and come out styled.

   Consequence worth stating plainly: account-page toasts change appearance,
   from a bare unstyled div to a proper toast. That is a fix, not a regression -
   the old rendering was the broken one - but it is a visible change.
   ========================================================================== */
(function () {
  "use strict";

  /* simple-toast.js owns the real implementation, including its close button,
     reduced-motion handling and Escape dismissal. */
  function viaSimpleToast(msg, type, duration) {
    return window.showToastSimple(msg, { type: type, duration: duration });
  }

  /* Only reached if a toast is raised before simple-toast.js has run - an early
     inline script, or a slow first paint. It reproduces the same markup and
     classes so the toast still looks right, rather than being dropped on the
     floor because of load order. */
  function viaInlineFallback(msg, type, duration) {
    var box = document.getElementById("toasts-site");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts-site";
      /* simple-toast.css positions .gtoast itself; this supplies only the
         container's stacking context and corner placement. */
      box.style.cssText =
        "position:fixed;bottom:22px;right:22px;z-index:300;" +
        "display:flex;flex-direction:column;gap:10px;pointer-events:none";
      document.body.appendChild(box);
    }

    var node = document.createElement("div");
    node.className = type ? "gtoast gtoast--" + type : "gtoast";
    node.style.setProperty("--gtoast-dwell", (duration / 1000) + "s");
    /* Errors interrupt; everything else is announced politely. */
    node.setAttribute("role", type === "error" ? "alert" : "status");
    node.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

    /* textContent, not innerHTML. Several messages are built from
       server-supplied strings, and the per-file implementations this replaces
       interpolated them straight into innerHTML. */
    var label = document.createElement("p");
    label.className = "gtoast-text";
    label.textContent = msg;
    node.appendChild(label);

    box.appendChild(node);
    /* Force layout so the entrance transition has a start state to run from. */
    void node.offsetWidth;
    node.classList.add("is-in");

    window.setTimeout(function () {
      node.classList.remove("is-in");
      window.setTimeout(function () { node.remove(); }, 200);
    }, duration);

    return node;
  }

  /**
   * @param {string} msg
   * @param {string} [type]  "info" | "success" | "error". Anything else, or
   *   nothing at all, is treated as "info" - every caller omits it sometimes.
   * @param {number} [duration] ms on screen. A few callers pass one (gallery.js
   *   passes 2500); simple-toast.js's own default applies when omitted.
   */
  function toast(msg, type, duration) {
    var text = String(msg == null ? "" : msg);
    if (!text) return null;

    var kind = type === "success" || type === "error" || type === "info" ? type : "info";
    var ms = typeof duration === "number" && duration > 0 ? duration : 3200;

    if (typeof window.showToastSimple === "function") return viaSimpleToast(text, kind, ms);
    return viaInlineFallback(text, kind, ms);
  }

  window.toast = toast;
})();
