/* Submission rules panel for the Suggestions, Wanted Vault, and Gallery tabs.
 *
 * The text is fetched from /api/submission-rules, which serves the exact same
 * module (_lib/submissionRules.js) that the APIs enforce on submit — so the
 * rules shown here can never drift from the rules applied. Panels mount
 * themselves against known anchors, including ones created later by gallery.js.
 *
 * window.submissionRules.notice(surface, flagged) renders the "sent to staff
 * review" acknowledgement when an API returns a flag. */
(function () {
  "use strict";
  if (window.__subRulesMounted) return;
  window.__subRulesMounted = true;

  var API = "/api/submission-rules";
  var CACHE_KEY = "thw-submission-rules-v1";
  var data = null;
  var inflight = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function css() {
    if (document.getElementById("subrules-style")) return;
    var st = document.createElement("style");
    st.id = "subrules-style";
    st.textContent =
      ".srules{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.03);margin:0 0 12px;overflow:hidden}" +
      ".srules>summary{list-style:none;cursor:pointer;padding:9px 12px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6);display:flex;align-items:center;gap:7px}" +
      ".srules>summary::-webkit-details-marker{display:none}" +
      ".srules>summary:hover{color:#c4b5fd}" +
      ".srules>summary .srules-chev{margin-left:auto;transition:transform .18s ease;font-size:9px}" +
      ".srules[open]>summary .srules-chev{transform:rotate(90deg)}" +
      ".srules-body{padding:0 12px 12px;border-top:1px solid rgba(255,255,255,.07)}" +
      ".srules-intro{font-size:11px;line-height:1.55;color:rgba(255,255,255,.55);margin:10px 0}" +
      ".srules-h{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.4);margin:12px 0 6px}" +
      ".srules ul{margin:0;padding-left:16px}" +
      ".srules li{font-size:11px;line-height:1.6;color:rgba(255,255,255,.68);margin-bottom:3px}" +
      ".srules-tag{display:inline-block;font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:1px 5px;border-radius:9999px;margin-left:5px;vertical-align:1px;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.45)}" +
      ".srules-tag.auto{border-color:rgba(196,181,253,.4);color:#c4b5fd}" +
      ".srules-foot{font-size:10px;line-height:1.55;color:rgba(255,255,255,.4);margin-top:11px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)}" +
      ".srules-notice{display:flex;gap:8px;align-items:flex-start;font-size:11px;line-height:1.5;padding:9px 11px;border-radius:10px;margin:0 0 12px;border:1px solid rgba(251,191,36,.32);background:rgba(251,191,36,.09);color:#fcd34d}" +
      ".srules-notice b{color:#fde68a}" +
      ".srules-notice i{margin-top:1px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function load() {
    if (data) return Promise.resolve(data);
    data = readCache();
    if (data) return Promise.resolve(data);
    if (inflight) return inflight;
    inflight = fetch(API, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && d.surfaces) {
          data = d.surfaces;
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
        }
        inflight = null;
        return data;
      })
      .catch(function () { inflight = null; return data; });
    return inflight;
  }

  function li(text, auto) {
    return "<li>" + esc(text) +
      (auto ? '<span class="srules-tag auto">auto</span>' : '<span class="srules-tag">staff</span>') +
      "</li>";
  }

  function panelHtml(surface) {
    var s = data && data[surface];
    if (!s) return "";
    var html =
      '<details class="srules" id="srules-body-' + surface + '">' +
      '<summary><i class="fas fa-scroll-to-dossier"></i> ' + esc(s.title) + " posting rules" +
      '<i class="fas fa-chevron-right srules-chev"></i></summary>' +
      '<div class="srules-body">' +
      '<p class="srules-intro">' + esc(s.intro) + "</p>";

    if (s.requirements && s.requirements.length) {
      html += '<div class="srules-h">Before you post</div><ul>' +
        s.requirements.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
    }
    if (s.limits && s.limits.length) {
      html += '<div class="srules-h">Limits</div><ul>' +
        s.limits.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
    }
    if (s.rules && s.rules.length) {
      html += '<div class="srules-h">Rules</div><ul>' +
        s.rules.map(function (r) { return li(r.text, r.automated); }).join("") + "</ul>";
    }
    html += '<p class="srules-foot">Rules marked <b>auto</b> are checked when you post. ' +
      "Nothing is deleted automatically — if a rule trips, your submission goes to staff for review " +
      "and you'll get a notification. Flagged or removed submissions can be appealed from My Reports." +
      "</p></div></details>";
    return html;
  }

  // Insert the panel immediately before the surface's submit box. The Suggestions
  // and Wanted forms have no <form> element (index.html wraps them in a
  // div.hub-panel), so each surface names the container to sit above. Idempotent.
  var attempts = {};
  function mount(surface) {
    if (document.getElementById("srules-body-" + surface)) return true;
    var cfg = MOUNTS[surface];
    if (!cfg) return false;
    if (!data) {
      // Retry the rules fetch a few times, then give up: if /api/submission-rules
      // is down, stop re-queueing instead of spinning. The interval below will
      // try again later if it comes back.
      var n = (attempts[surface] = (attempts[surface] || 0) + 1);
      if (n > 3) return false;
      load().then(function () { mount(surface); });
      return false;
    }
    var anchor = document.querySelector(cfg.sel);
    if (!anchor) return false;
    css();
    var host = anchor;
    if (cfg.closest) {
      try { host = anchor.closest(cfg.closest) || anchor; } catch (e) {}
    }
    var panel = document.createElement("div");
    panel.id = "srules-" + surface;
    panel.innerHTML = panelHtml(surface);
    if (!host.parentNode) return false;
    host.parentNode.insertBefore(panel, host);
    return true;
  }

  // Acknowledgement shown after a submit that came back flagged.
  function notice(surface, flagged) {
    if (!flagged) return;
    var id = "srules-notice-" + surface;
    var el = document.getElementById(id);
    if (!el) {
      var panel = document.getElementById("srules-" + surface);
      if (!panel) { mount(surface); return; }
      el = document.createElement("div");
      el.id = id;
      el.className = "srules-notice";
      panel.parentNode.insertBefore(el, panel.nextSibling);
    }
    var names = (flagged.codes || []).map(function (code) {
      var s = data && data[surface];
      var rule = s && (s.rules || []).filter(function (r) { return r.code === code; })[0];
      return rule ? rule.text : code;
    });
    el.innerHTML = '<i class="fas fa-flag"></i><div><b>Sent to staff review.</b> ' +
      "Your submission was accepted and is live, but staff will take a look because it tripped: " +
      esc(names.join(" ")) + "</div>";
  }

  // Where each panel mounts. The Gallery box is built at runtime by gallery.js,
  // so its anchor only exists once that script has mounted.
  var MOUNTS = {
    suggestions: { sel: "#sugg-title", closest: ".hub-panel" },
    wanted: { sel: "#wanted-title", closest: ".hub-panel" },
    gallery: { sel: ".gal-upload", closest: null },
  };

  function mountAll() {
    for (var k in MOUNTS) {
      if (Object.prototype.hasOwnProperty.call(MOUNTS, k)) mount(k);
    }
    stopObserverIfDone();
  }

  function allMounted() {
    for (var k in MOUNTS) {
      if (!Object.prototype.hasOwnProperty.call(MOUNTS, k)) continue;
      if (!document.getElementById("srules-body-" + k)) return false;
    }
    return true;
  }

  /* Once every panel exists the observer has nothing left to do. It only watches
   * the gallery section, because that upload form is created at runtime; a
   * document.body subtree observer would run on unrelated player mutations too. */
  function stopObserverIfDone() {
    if (!allMounted()) return;
    try {
      if (window.__subRulesObserver) {
        window.__subRulesObserver.disconnect();
        window.__subRulesObserver = null;
      }
    } catch (e) {}
  }

  function start() {
    css();
    var tries = 0;
    var iv = 0;
    load().then(function () {
      mountAll();
      if (allMounted()) clearInterval(iv);
    });
    // Catch anchors created later (gallery) and re-mount if a tab is re-rendered.
    iv = setInterval(function () {
      mountAll();
      if (++tries > 40 || allMounted()) clearInterval(iv);
    }, 500);
    try {
      var gallerySection = document.getElementById("page-section-gallery");
      var mo = new MutationObserver(function () { mountAll(); });
      if (gallerySection) {
        mo.observe(gallerySection, { childList: true, subtree: true });
        window.__subRulesObserver = mo;
      }
    } catch (e) {}
  }

  window.submissionRules = {
    mount: mount,
    mountAll: mountAll,
    notice: notice,
    load: load,
    rules: function () { return data; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
