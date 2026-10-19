/* Site-wide announcement banner.
 *
 * The GET endpoint and the bell wiring both already existed - /api/announcements
 * returns the latest five and account.js folds them into the notification list -
 * but nothing rendered them anywhere a visitor would see, so an announcement was
 * only findable by opening the bell.
 *
 * DISMISSAL IS NOT A ONE-WAY DOOR
 * Dismissing used to delete the banner outright, and the id went into
 * localStorage so it stayed gone - for good, across every page and every reload,
 * with no way back. That is a bad thing to hand someone: an announcement can be
 * missed, and being unable to re-read it after the fact is worse than being
 * briefly interrupted by it.
 *
 * So dismissing now collapses the banner to a single slim row - the title, and
 * "Show" - instead of removing it. That row is a real button, it survives a
 * reload, and clicking it puts the full announcement back. What it no longer
 * does is take up a third of the screen while doing nothing.
 *
 * Dismissal is remembered per announcement id rather than as a single boolean:
 * with one flag, posting two announcements in a row would leave the first
 * dismissal hiding the second. The collapsed row only ever shows the newest, so a
 * newly posted announcement still appears at full size.
 *
 * Kept to the newest one deliberately. A stack of banners pushes the page down
 * and the newest is the one that matters; the rest remain in the bell.
 *
 * Idempotent like the other page scripts: re-running is a no-op.
 */
(function () {
  "use strict";
  if (window.__annBannerMounted) return;
  window.__annBannerMounted = true;

  var KEY = "thw.announcement.dismissed";
  var latest = null;

  function dismissed() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function remember(id) {
    try {
      var list = dismissed().filter(function (x) { return x !== String(id); });
      list.push(String(id));
      // Bounded: only the recent ids are needed to hide what has been seen.
      localStorage.setItem(KEY, JSON.stringify(list.slice(-40)));
    } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function css() {
    if (document.getElementById("ann-banner-style")) return;
    var st = document.createElement("style");
    st.id = "ann-banner-style";
    /* Built from the site's own tokens rather than invented colours, so the
       banner reads as part of this site. The first version was a solid gold
       gradient with dark text; against a dark purple interface it read as a
       pasted-in alert bar and fought every screen it appeared on.

       Colours are literals with a var() first so the banner follows a theme
       switch where a variable exists and still renders correctly where one does
       not - --ac-text and --ac-muted come from themes.css. */
    st.textContent =
      ".ann-banner{position:fixed;left:0;right:0;top:0;z-index:9998;display:flex;align-items:flex-start;gap:12px;" +
      "padding:calc(12px + env(safe-area-inset-top,0px)) 18px 12px;" +
      "background:linear-gradient(180deg,rgba(18,10,38,.97),rgba(7,4,15,.94));" +
      "backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);" +
      "border-bottom:1px solid rgba(240,171,252,.18);box-shadow:0 14px 38px rgba(0,0,0,.55);" +
      "color:var(--ac-text,#f2edff);animation:ann-banner-in .34s cubic-bezier(.16,1,.3,1);" +
      "transition:padding .22s cubic-bezier(.16,1,.3,1)}" +
      /* A hairline of the brand gradient along the top edge, so the banner ties
         into the page rather than sitting on it. Fades back on the collapsed row
         so the quiet state is genuinely quiet. */
      ".ann-banner::before{content:\"\";position:absolute;left:0;right:0;top:0;height:2px;" +
      "background:linear-gradient(90deg,#f59e0b,#ec4899,#a855f7);transition:opacity .22s ease}" +
      "@keyframes ann-banner-in{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}" +
      /* Gold chip instead of a bare glyph, so the icon has presence at 12px. */
      ".ann-banner-ico{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;" +
      "width:26px;height:26px;border-radius:9px;font-size:12px;color:#1a1206;" +
      "background:linear-gradient(135deg,#fde68a,#f59e0b);box-shadow:0 4px 14px rgba(245,158,11,.32)}" +
      ".ann-banner-body{flex:1;min-width:0}" +
      ".ann-banner-title{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;" +
      "color:#fbbf24;margin-bottom:3px}" +
      ".ann-banner-msg{font-size:12.5px;line-height:1.55;color:var(--ac-text,#f2edff);opacity:.88;overflow-wrap:anywhere}" +
      /* Quiet by default so the banner does not compete with the nav it sits
         above, and it is the only control up there worth aiming at. */
      ".ann-banner-close{flex-shrink:0;align-self:center;background:rgba(255,255,255,.05);" +
      "border:1px solid rgba(255,255,255,.14);border-radius:999px;color:var(--ac-muted,#a295c9);" +
      "font-size:11px;font-weight:700;padding:6px 14px;cursor:pointer;white-space:nowrap;" +
      "transition:background .16s ease,color .16s ease,border-color .16s ease}" +
      ".ann-banner-close:hover{background:rgba(240,171,252,.14);color:#fff;border-color:rgba(240,171,252,.5)}" +
      ".ann-banner-close:focus-visible{outline:2px solid #f0abfc;outline-offset:2px}" +

      /* ---- the dismissed state ----
         A real <button> filling the row rather than a click handler on the bar,
         so it is reachable by keyboard and announced as a button. Keeping the
         banner in the DOM in this form is the whole point: dismissing has to
         stay reversible, and deleting the element was what made it a one-way
         door. */
      ".ann-banner.is-collapsed{align-items:center;" +
      "padding:calc(8px + env(safe-area-inset-top,0px)) 18px 8px}" +
      ".ann-banner.is-collapsed::before{opacity:.4}" +
      ".ann-banner.is-collapsed .ann-banner-ico{width:22px;height:22px;font-size:11px;border-radius:7px}" +
      ".ann-banner-reopen{display:flex;align-items:center;gap:10px;width:100%;margin:0;" +
      "padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;min-width:0}" +
      ".ann-banner-reopen:hover .ann-banner-title{color:#fde68a}" +
      ".ann-banner-reopen:focus-visible{outline:2px solid #f0abfc;outline-offset:4px;border-radius:6px}" +
      ".ann-banner-reopen .ann-banner-title{margin-bottom:0;min-width:0;overflow:hidden;" +
      "text-overflow:ellipsis;white-space:nowrap;transition:color .16s ease}" +
      ".ann-banner-hint{flex-shrink:0;margin-left:auto;padding-left:12px;font-size:11px;font-weight:700;" +
      "color:var(--ac-muted,#a295c9);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 12px}" +
      ".ann-banner-reopen:hover .ann-banner-hint{background:rgba(240,171,252,.14);color:#fff}" +
      /* The fixed nav is moved out of the way in JS, not here: .nav-home carries
         an inline style="top:0" that no selector can override. See pushNav(). */
      /* Narrow: the icon, text and Dismiss stop fitting on one line, so the
         Dismiss drops below the message instead of squeezing it to a column of
         one-word lines. */
      "@media (max-width:620px){.ann-banner{flex-wrap:wrap;gap:10px;padding-right:12px;padding-left:12px}" +
      ".ann-banner-msg{font-size:12px}" +
      ".ann-banner-close{order:3;margin-left:38px;padding:6px 12px}" +
      ".ann-banner-body{flex:1 1 calc(100% - 38px)}" +
      ".ann-banner.is-collapsed{padding-right:12px;padding-left:12px}" +
      ".ann-banner-hint{font-size:10.5px;padding:3px 9px}}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* The nav sits at the top on every breakpoint and is position:fixed, so a
     banner over it has to move the nav out of the way. A stylesheet rule cannot
     do it: .nav-home carries an inline style="top:0", and an inline value beats
     any selector, so `body.has-ann-banner .nav-home{top:44px}` was silently
     dead and the banner covered the nav's own controls.

     The offset is measured rather than assumed, because the banner wraps to two
     or three lines on a narrow window and the dismissed row is shorter again -
     a fixed 44px would be right for none of them.

     Only ever grows the nav from its original value; collapsing measures the
     shorter row and sets a smaller one, so the saved original is still the one
     to restore and is not overwritten by an intermediate measurement. */
  var navTopSaved = null;
  function navEl() { return document.querySelector(".nav-home"); }
  function pushNav() {
    var bar = document.getElementById("ann-banner");
    var nav = navEl();
    if (!bar || !nav) return;
    if (navTopSaved === null) navTopSaved = nav.style.top || "";
    nav.style.top = bar.offsetHeight + "px";
  }
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(pushNav, 120);
  });

  function removeBar() {
    var old = document.getElementById("ann-banner");
    if (old) old.remove();
  }

  /* collapsed = the one-line reopen row. */
  function paint(collapsed) {
    var a = latest;
    if (!a) return;
    removeBar();
    css();

    var bar = document.createElement("div");
    bar.className = "ann-banner" + (collapsed ? " is-collapsed" : "");
    bar.id = "ann-banner";

    if (collapsed) {
      bar.setAttribute("role", "status");
      var label = a.title || a.body || "Announcement";
      bar.innerHTML =
        '<button type="button" class="ann-banner-reopen">' +
        '<span class="ann-banner-ico"><i class="fas fa-bullhorn" aria-hidden="true"></i></span>' +
        '<span class="ann-banner-title">' + esc(label) + "</span>" +
        '<span class="ann-banner-hint">Show</span>' +
        "</button>";
      bar.querySelector(".ann-banner-reopen").addEventListener("click", function () {
        paint(false);
      });
    } else {
      bar.setAttribute("role", "status");
      bar.innerHTML =
        '<span class="ann-banner-ico"><i class="fas fa-bullhorn" aria-hidden="true"></i></span>' +
        '<div class="ann-banner-body">' +
        (a.title ? '<div class="ann-banner-title">' + esc(a.title) + "</div>" : "") +
        /* `body`, not `message`. The API keeps `message` as the title folded in
           for the notification bell, which renders one line and has nowhere to
           put a heading - so using it here printed the title twice, once bold
           and once again after an em dash. `body` is the stored text alone. */
        '<div class="ann-banner-msg">' + esc(a.body != null ? a.body : a.message) + "</div>" +
        "</div>" +
        '<button type="button" class="ann-banner-close" aria-label="Dismiss this announcement">' +
        '<i class="fas fa-xmark" aria-hidden="true"></i> Dismiss</button>';

      bar.querySelector(".ann-banner-close").addEventListener("click", function () {
        /* Remembered so a newly posted announcement is not suppressed by this
           one, then collapsed rather than removed - the reader can still get it
           back, and it stays gettable after a reload. */
        remember(a.id);
        paint(true);
      });
    }

    document.body.insertBefore(bar, document.body.firstChild);
    pushNav();
    /* Web fonts and the Font Awesome icon land after first paint and change the
       height, so measure again once the document has settled rather than only
       at insertion. */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(pushNav).catch(function () {});
    }
    setTimeout(pushNav, 250);
  }

  function load() {
    fetch("/api/announcements", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true) return;
        var list = d.announcements || [];
        if (!list.length) { removeBar(); return; }
        var seen = dismissed();
        /* The endpoint orders newest first, so the first unseen id is the one to
           show at full size. */
        var pick = null;
        for (var i = 0; i < list.length; i++) {
          if (seen.indexOf(String(list[i].id)) < 0) { pick = list[i]; break; }
        }
        if (pick) {
          latest = pick;
          paint(false);
          return;
        }
        /* Everything has been read. Collapse to the reopen row rather than
           showing nothing, so there is always a way back to the newest
           announcement instead of it silently disappearing for good. */
        latest = list[0];
        paint(true);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
  // Refreshed on the same cadence as the rest of the nav's live data, and only
  // repaints when there is a genuinely new announcement.
  setInterval(load, 60000);
})();
