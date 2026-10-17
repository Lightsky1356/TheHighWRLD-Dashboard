// URL routing for the About and Partnership pages.
//
// WHAT THIS IS FOR
// /about and /partner load the right page on a cold load, on refresh, and on
// back/forward. Before this, the site had no routing at all: no pushState, no
// popstate, nothing reading location.pathname anywhere in the codebase. A page
// change only ever touched the DOM, so reloading anywhere always threw the
// visitor back to the home page, and a link to /partner could not be shared.
//
// WHY IT HOOKS switchAppPage INSTEAD OF EDITING script.js
// switchAppPage is the single funnel every page change already passes through -
// the nav buttons, the mobile bottom nav, showTOS/showPP/showDMCA, and deep
// calls inside script.js all go through it. script.js also already wraps it once
// at its end, for the mobile bottom nav, which proves the wrap-and-replace
// pattern is safe here.
//
// This file loads after script.js (all scripts are deferred, so they run in
// document order), so it captures that existing wrapper and wraps it once more.
// That means routing applies to every entry point automatically, and script.js
// stays minified and untouched - which matters, because it is 274 KB across
// about five lines and every edit to it has to be made against an exact marker
// string rather than a line number.
//
// A Map, not an object literal: switchAppPage is called with values from the DOM
// and from data. A plain object would answer ROUTES["toString"] with a function,
// which is truthy, and then try to use that function as a path.
//
// WHY THE BOOT FLAG EXISTS
// script.js ends with
//   setTimeout(function(){ try{ window.switchAppPage("home") }catch(e){} showWrldLog() }, 0)
// which hard-forces the home page on every load. Left alone, that would overwrite
// a deep link a moment after the router resolved it, so /partner would flash home
// and then partner, and a refresh would land on home.
//
// So the first switchAppPage("home") is treated as the boot call and redirected to
// the routed page. The flag is cleared from a setTimeout(0) registered after
// script.js registered its own, and timers of equal delay fire in registration
// order - so the flag is still set when the boot call happens, and is cleared
// immediately after. Everything the user does later is an ordinary navigation.
//
// showWrldLog() is left alone. That overlay opening on load is intended.

/* path -> page name. Only these two pages are routed; everything else keeps the
   existing behaviour of changing the DOM without touching the URL. */
const PATHS = new Map([
  ["/about", "about"],
  ["/partner", "partner"],
]);

/* The inverse. Built from PATHS so the two can never drift apart. */
const PAGES = new Map([...PATHS].map(([path, page]) => [page, path]));

/* Tolerates /About, /about/, and a trailing slash, without matching /about-us. */
function normalize(pathname) {
  let p = String(pathname || "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.toLowerCase();
}

function pageFromPath(pathname) {
  return PATHS.get(normalize(pathname)) || null;
}

/* Exposed for tests and for debugging from the console. */
window.__thwRouter = { PATHS, PAGES, normalize, pageFromPath };

const prevSwitch = window.switchAppPage;
if (typeof prevSwitch !== "function") {
  /* Without the funnel there is nothing to wrap. Failing loudly here beats
     leaving a half-installed router that silently does nothing. */
  console.warn("[router] window.switchAppPage is missing; URL routing is not active");
} else {
  let booting = true;

  window.switchAppPage = function (page) {
    let target = page;

    /* The one boot call: honour the URL instead of the hard-coded "home". */
    if (booting && page === "home") {
      const routed = pageFromPath(location.pathname);
      if (routed) target = routed;
    }

    prevSwitch.call(window, target);

    /* Not during boot: the URL is already correct if we got here from it, and
       pushing on a cold load would put a duplicate entry in history. */
    if (!booting && typeof target === "string") {
      const path = PAGES.get(target);
      if (path && normalize(location.pathname) !== path) {
        history.pushState({ page: target }, "", path);
      }
    }
  };

  setTimeout(function () {
    booting = false;
  }, 0);
}

/* Back and forward. Calls the captured wrapper directly rather than going back
   through window.switchAppPage, so responding to a history move never pushes a
   new history entry - otherwise back would push, and the button would stop
   going back. */
window.addEventListener("popstate", function () {
  if (typeof prevSwitch !== "function") return;
  prevSwitch.call(window, pageFromPath(location.pathname) || "home");
});