/* ============================================================================
   SIMPLE TOAST
   Companion to simple-toast.css. Exposes window.showToastSimple(message, opts).

   Every toast clears itself after opts.duration. The close button dismisses it
   sooner and cancels that pending timer, so a toast can never reappear after
   the user has already closed it.

   Does NOT rewrite the existing showToast() call sites elsewhere in the app -
   they are live and styled already. Route them through this style per call.
   ========================================================================== */
(function () {
  "use strict";

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { /* older browser: fall back to animating */ }

  /* Tracked so a second toast replaces the first instead of stacking, and so
     the pending auto-dismiss can be cancelled when the user closes it. */
  var current = null;
  var currentTimer = null;

  function dismiss() {
    if (currentTimer) {
      window.clearTimeout(currentTimer);
      currentTimer = null;
    }
    if (!current) return;
    var node = current;
    current = null;
    node.classList.remove("is-in");
    /* Remove after the fade, unless reduced motion made it instant. */
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, REDUCED ? 20 : 200);
  }

  /**
   * @param {string} message  Text to display.
   * @param {object} [opts]
   * @param {string} [opts.type]     "info" | "success" | "error" | omitted (neutral).
   * @param {number} [opts.duration] Milliseconds on screen (default 3200).
   * @param {boolean}[opts.sticky]  true to stay until closed (or Escape).
   * @param {boolean}[opts.closeButton] false to omit the close button (default true).
   */
  function showToastSimple(message, opts) {
    opts = opts || {};
    var text = String(message == null ? "" : message);
    if (!text) return null;

    var duration = typeof opts.duration === "number" ? opts.duration : 3200;
    var sticky = !!opts.sticky;
    dismiss();

    var node = document.createElement("div");
    node.className = opts.type ? "gtoast gtoast--" + String(opts.type) : "gtoast";
    if (sticky) node.classList.add("is-sticky");
    /* Seconds, so the CSS drain matches the real lifetime. */
    node.style.setProperty("--gtoast-dwell", (duration / 1000) + "s");
    /* Errors interrupt; everything else is announced politely. */
    node.setAttribute("role", opts.type === "error" ? "alert" : "status");
    node.setAttribute("aria-live", opts.type === "error" ? "assertive" : "polite");

    var label = document.createElement("p");
    label.className = "gtoast-text";
    label.textContent = text;
    node.appendChild(label);

    /* Close button. A real <button> so it is tabbable and announced, rather
       than a styled span that only answers to a mouse. */
    if (opts.closeButton !== false) {
      var close = document.createElement("button");
      close.type = "button";
      close.className = "gtoast-close";
      close.setAttribute("aria-label", "Dismiss notification");
      close.textContent = "×";
      close.addEventListener("click", dismiss);
      node.appendChild(close);
    }

    /* Dwell line, but only when there is a countdown to show. */
    if (!sticky) {
      var timer = document.createElement("span");
      timer.className = "gtoast-timer";
      timer.setAttribute("aria-hidden", "true");
      node.appendChild(timer);
    }

    document.body.appendChild(node);
    current = node;

    /* Force layout so the browser has a start state to transition from;
       without this the is-in class lands in the same frame and it just appears. */
    void node.offsetWidth;
    node.classList.add("is-in");

    if (!sticky) currentTimer = window.setTimeout(dismiss, duration);
    return node;
  }

  window.showToastSimple = showToastSimple;

  /* Escape dismisses, so a sticky toast is never stuck on screen. */
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && current) dismiss();
  });
})();