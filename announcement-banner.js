/* Site-wide announcement banner.
 *
 * The GET endpoint and the bell wiring both already existed - /api/announcements
 * returns the latest five and account.js folds them into the notification list -
 * but nothing rendered them anywhere a visitor would see, so an announcement was
 * only findable by opening the bell.
 *
 * This shows the newest announcement that has not been dismissed on this device.
 * Dismissal is remembered per announcement id rather than as a single boolean:
 * with one flag, posting two announcements in a row would leave the first
 * dismissal hiding the second, and an announcement nobody can surface again is
 * worse than none.
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
    st.textContent =
      ".ann-banner{position:fixed;left:0;right:0;top:0;z-index:9998;display:flex;align-items:flex-start;gap:12px;" +
      "padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;" +
      "background:linear-gradient(135deg,rgba(251,191,36,.96),rgba(245,158,11,.96));" +
      "color:#1a1206;border-bottom:1px solid rgba(0,0,0,.18);box-shadow:0 6px 20px rgba(0,0,0,.28)}" +
      ".ann-banner-ico{flex-shrink:0;margin-top:2px;font-size:15px}" +
      ".ann-banner-body{flex:1;min-width:0}" +
      ".ann-banner-title{font-size:12px;font-weight:800;letter-spacing:.04em;margin-bottom:2px}" +
      ".ann-banner-msg{font-size:12px;line-height:1.5;overflow-wrap:anywhere}" +
      ".ann-banner-close{flex-shrink:0;background:none;border:1px solid rgba(0,0,0,.22);border-radius:8px;" +
      "color:#1a1206;font-size:11px;font-weight:800;padding:5px 11px;cursor:pointer}" +
      ".ann-banner-close:hover{background:rgba(0,0,0,.09)}" +
      ".ann-banner-close:focus-visible{outline:2px solid #1a1206;outline-offset:2px}" +
      /* The fixed nav sits at the top on every breakpoint, so the banner pushes
         it down rather than covering it. Without this the nav's own controls
         would be unreachable while a banner is up. */
      "body.has-ann-banner .nav-home{top:44px}" +
      "@media (max-width:640px){.ann-banner{padding-right:10px;padding-left:10px}" +
      ".ann-banner-msg{font-size:11px}}" +
      ".ann-banner-close{padding:5px 9px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function paint() {
    var a = latest;
    if (!a) return;
    var old = document.getElementById("ann-banner");
    if (old) old.remove();
    css();
    var bar = document.createElement("div");
    bar.className = "ann-banner";
    bar.id = "ann-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<span class="ann-banner-ico"><i class="fas fa-bullhorn"></i></span>' +
      '<div class="ann-banner-body">' +
      (a.title ? '<div class="ann-banner-title">' + esc(a.title) + "</div>" : "") +
      '<div class="ann-banner-msg">' + esc(a.message) + "</div>" +
      "</div>" +
      '<button type="button" class="ann-banner-close" aria-label="Dismiss announcement">Dismiss</button>';

    bar.querySelector(".ann-banner-close").addEventListener("click", function () {
      remember(a.id);
      bar.remove();
      try { document.body.classList.remove("has-ann-banner"); } catch (e) {}
    });

    document.body.insertBefore(bar, document.body.firstChild);
    try { document.body.classList.add("has-ann-banner"); } catch (e) {}
  }

  function load() {
    fetch("/api/announcements", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true) return;
        var list = d.announcements || [];
        if (!list.length) return;
        var seen = dismissed();
        /* The endpoint orders newest first, so the first unseen id is the one to
           show. If they have all been seen, nothing is painted. */
        var pick = null;
        for (var i = 0; i < list.length; i++) {
          if (seen.indexOf(String(list[i].id)) < 0) { pick = list[i]; break; }
        }
        if (!pick) return;
        latest = pick;
        paint();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
  // Refreshed on the same cadence as the rest of the nav's live data, and only
  // repaints when there is a genuinely new announcement.
  setInterval(load, 60000);
})();
