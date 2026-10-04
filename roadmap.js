/* ============================================================================
   THEHIGHWRLD - ROADMAP RENDERER
   ----------------------------------------------------------------------------
   Reads every item from roadmap-data.js and renders the page. No API calls, no
   polling, no MutationObserver, no dependencies - it runs once, the first time
   the Roadmap is opened, then only re-filters on user input.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.THW_ROADMAP || null;
  var STATUS_ORDER = (DATA && DATA.statusOrder) || ["in-progress", "planned", "considering", "completed"];
  var STATUSES = (DATA && DATA.statuses) || {};
  var CATEGORIES = (DATA && DATA.categories) || {};

  var state = { status: "all", category: "all", q: "" };
  var built = false;

  /* ------------------------------------------------------------- utilities */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* "2026-10-03" -> "3 Oct 2026" (parsed locally so the day never slips). */
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return parseInt(m[3], 10) + " " + months[parseInt(m[2], 10) - 1] + " " + m[1];
  }

  function haystack(item) {
    return (
      String(item.title || "") + " " +
      String(item.description || "") + " " +
      (item.category || []).map(function (k) {
        return (CATEGORIES[k] && CATEGORIES[k].label) || k;
      }).join(" ")
    ).toLowerCase();
  }

  /* Progress is optional. Completed items always read 100%; a bare 0% is not
     worth a bar, so nothing is drawn when there is no real signal. */
  function progressOf(item) {
    if (item.status === "completed") return 100;
    var n = typeof item.progress === "number" ? item.progress : null;
    if (n == null || isNaN(n) || n <= 0) return null;
    return Math.max(1, Math.min(100, Math.round(n)));
  }

  function statusMeta(key) {
    return STATUSES[key] || { label: key, badge: key, icon: "" };
  }

  function categoryMeta(key) {
    return CATEGORIES[key] || { label: key, icon: "" };
  }

  /* ------------------------------------------------------------ card build */
  function buildBadge(item) {
    var meta = statusMeta(item.status);
    var b = el("span", "rm-badge");
    b.setAttribute("data-rm-status", item.status);
    if (meta.icon) {
      var i = el("i", null);
      i.className = meta.icon;
      i.setAttribute("aria-hidden", "true");
      b.appendChild(i);
    }
    b.appendChild(el("span", null, meta.badge || meta.label));
    return b;
  }

  function buildProgress(item) {
    var pct = progressOf(item);
    if (pct == null) return null;

    var wrap = el("div", "rm-prog");
    wrap.appendChild(el("span", "rm-prog-label", "Progress"));

    var track = el("div", "rm-prog-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-label", (item.title || "Item") + " progress");

    var fill = el("span", "rm-prog-fill");
    fill.style.width = pct + "%";
    track.appendChild(fill);

    wrap.appendChild(track);
    wrap.appendChild(el("span", "rm-prog-val", pct + "%"));
    return wrap;
  }

  function buildCard(item) {
    var card = el("article", "rm-card");
    /* The id is what makes /roadmap#rm-<item> a real deep link. */
    card.id = "rm-" + item.id;
    card.setAttribute("data-rm-id", item.id);
    card.setAttribute("data-rm-status", item.status);
    card.setAttribute("data-rm-cats", (item.category || []).join(" "));
    /* Pre-lowercased search index: title + description + category labels. */
    card.setAttribute("data-rm-hay", haystack(item));
    var titleId = "rm-t-" + item.id;
    card.setAttribute("aria-labelledby", titleId);

    card.appendChild(buildBadge(item));

    var h = el("h3", "rm-card-title", item.title);
    h.id = titleId;
    card.appendChild(h);

    if (item.description) card.appendChild(el("p", "rm-card-desc", item.description));

    var prog = buildProgress(item);
    if (prog) card.appendChild(prog);

    var meta = el("div", "rm-card-meta");
    (item.category || []).forEach(function (key) {
      var cm = categoryMeta(key);
      var tag = el("span", "rm-tag");
      if (cm.icon) {
        var i = el("i", null);
        i.className = cm.icon;
        i.setAttribute("aria-hidden", "true");
        tag.appendChild(i);
      }
      tag.appendChild(el("span", null, cm.label));
      meta.appendChild(tag);
    });

    var date = fmtDate(item.lastUpdated);
    if (date) {
      var u = el("span", "rm-updated", "Updated " + date);
      u.title = "Last updated " + date;
      meta.appendChild(u);
    }
    if (meta.childNodes.length) card.appendChild(meta);

    /* A link to this one card, so an item can be shared on its own. */
    var link = el("button", "rm-linkbtn");
    link.type = "button";
    link.setAttribute("data-rm-link", item.id);
    link.title = "Copy a link to this item";
    link.setAttribute("aria-label", "Copy a link to " + item.title);
    var li = el("i", null, "");
    li.className = "fas fa-link";
    li.setAttribute("aria-hidden", "true");
    link.appendChild(li);
    link.appendChild(el("span", "rm-linktxt", "Link"));
    card.appendChild(link);
    return card;
  }

  /* ------------------------------------------------------- deep links */
  /* /roadmap#rm-<id> scrolls to that card and flashes it. Any filter or search
     that would hide the target is cleared first, otherwise the link would land
     on nothing. */
  function revealFromHash(push) {
    var root = $("#page-section-roadmap");
    if (!root) return;
    var id = "";
    try { id = (location.hash || "").replace(/^#rm-/, ""); } catch (e) {}
    var prev = document.querySelector(".rm-card.rm-flash");
    if (prev) prev.classList.remove("rm-flash");
    if (!id) return;
    var card = document.getElementById("rm-" + id);
    if (!card) return;
    if (card.hidden) {
      state.status = "all";
      state.category = "all";
      state.q = "";
      var input = $("#roadmap-search");
      if (input) input.value = "";
      root.querySelectorAll("[data-rm-filter]").forEach(function (x) {
        x.setAttribute("aria-pressed", x.getAttribute("data-rm-filter") === "all" ? "true" : "false");
      });
      root.querySelectorAll("[data-rm-cat]").forEach(function (x) {
        x.setAttribute("aria-pressed", x.getAttribute("data-rm-cat") === "all" ? "true" : "false");
      });
      apply();
    }
    if (card.scrollIntoView) card.scrollIntoView({ block: "center", behavior: prefersMotion() ? "smooth" : "auto" });
    card.classList.add("rm-flash");
    if (push) {
      try { history.replaceState(null, "", "#rm-" + id); } catch (e) {}
    }
  }

  function linkFor(id) {
    var base = "";
    try {
      base = location.origin + location.pathname;
    } catch (e) {
      base = "/roadmap";
    }
    return base + "#rm-" + id;
  }

  function copyLink(btn) {
    var url = linkFor(btn.getAttribute("data-rm-link"));
    var card = btn.closest ? btn.closest(".rm-card") : null;
    function done() {
      btn.classList.add("rm-link-done");
      var txt = btn.querySelector(".rm-linktxt");
      if (txt) txt.textContent = "Copied";
      setTimeout(function () {
        btn.classList.remove("rm-link-done");
        if (txt) txt.textContent = "Link";
      }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else {
      fallbackCopy(url, done);
    }
    if (card && card.scrollIntoView) card.scrollIntoView({ block: "center", behavior: prefersMotion() ? "smooth" : "auto" });
  }

  function fallbackCopy(url, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* nothing else to try */ }
  }

  /* ---------------------------------------------------------------- counts */
  function countsByStatus() {
    var out = { all: 0 };
    STATUS_ORDER.forEach(function (k) { out[k] = 0; });
    (DATA.items || []).forEach(function (i) {
      out.all++;
      if (out[i.status] != null) out[i.status]++;
    });
    return out;
  }

  function countsByCategory() {
    var out = {};
    (DATA.items || []).forEach(function (i) {
      (i.category || []).forEach(function (k) { out[k] = (out[k] || 0) + 1; });
    });
    return out;
  }

  /* --------------------------------------------------------- what's next */
  /* First item flagged featured that is in-progress; otherwise the first
     in-progress item; otherwise the panel hides itself. */
  function featuredItem() {
    var items = DATA.items || [];
    var inProgress = items.filter(function (i) { return i.status === "in-progress"; });
    if (!inProgress.length) return null;
    for (var i = 0; i < inProgress.length; i++) {
      if (inProgress[i].featured) return inProgress[i];
    }
    return inProgress[0];
  }

  function buildFeatured() {
    var host = $("#rm-featured");
    var slot = $("#rm-next");
    if (!host || !slot) return;

    var item = featuredItem();
    if (!item) { host.hidden = true; return; }
    host.hidden = false;

    slot.textContent = "";
    var meta = statusMeta(item.status);

    var head = el("div", "rm-next-head");
    head.appendChild(buildBadge(item));
    /* No duplicate label here: the section heading above already reads
       "What's Next?" - repeating it on wide screens just adds noise. */
    slot.appendChild(head);

    var h = el("h3", null, item.title);
    h.id = "rm-next-title";
    slot.appendChild(h);
    slot.setAttribute("aria-labelledby", "rm-next-title");

    if (item.description) slot.appendChild(el("p", null, item.description));

    var foot = el("div", "rm-next-foot");

    var prog = buildProgress(item);
    if (prog) foot.appendChild(prog);

    var cta = el("button", "rm-next-cta");
    cta.type = "button";
    var ci = el("i", "fas fa-arrow-right");
    ci.setAttribute("aria-hidden", "true");
    cta.appendChild(ci);
    cta.appendChild(el("span", null, "See all " + meta.label.toLowerCase()));
    cta.addEventListener("click", function () {
      setStatusFilter("in-progress");
      var sec = document.getElementById("rm-sec-in-progress");
      if (sec) sec.scrollIntoView({ behavior: prefersMotion() ? "smooth" : "auto", block: "start" });
      var chip = document.querySelector('.rm-chip[data-rm-filter="in-progress"]');
      if (chip) chip.focus({ preventScroll: true });
    });
    foot.appendChild(cta);
    slot.appendChild(foot);
  }

  function prefersMotion() {
    try {
      return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  /* --------------------------------------------------------------- filters */
  function setStatusFilter(key) {
    state.status = key;
    document.querySelectorAll("[data-rm-filter]").forEach(function (x) {
      x.setAttribute("aria-pressed", x.getAttribute("data-rm-filter") === key ? "true" : "false");
    });
    apply();
  }

  function buildCategoryRow() {
    var host = $("[data-rm-cats]");
    if (!host) return;
    host.textContent = "";

    var counts = countsByCategory();

    /* "All" always comes first so a category choice can always be undone. */
    var all = el("button", "rm-chip rm-cat");
    all.type = "button";
    all.setAttribute("data-rm-cat", "all");
    all.setAttribute("aria-pressed", "true");
    var allIcon = el("i", "fas fa-layer-group");
    allIcon.setAttribute("aria-hidden", "true");
    all.appendChild(allIcon);
    all.appendChild(el("span", null, "All"));
    all.appendChild(el("span", "rm-chip-n", String((DATA.items || []).length)));
    host.appendChild(all);

    /* Only offer categories that are actually used. */
    Object.keys(CATEGORIES).forEach(function (key) {
      if (!counts[key]) return;
      var b = el("button", "rm-chip rm-cat");
      b.type = "button";
      b.setAttribute("data-rm-cat", key);
      b.setAttribute("aria-pressed", "false");
      var m = categoryMeta(key);
      if (m.icon) {
        var i = el("i", null);
        i.className = m.icon;
        i.setAttribute("aria-hidden", "true");
        b.appendChild(i);
      }
      b.appendChild(el("span", null, m.label));
      b.appendChild(el("span", "rm-chip-n", String(counts[key])));
      host.appendChild(b);
    });
  }

  function buildStatusCounts() {
    var counts = countsByStatus();
    document.querySelectorAll("[data-rm-count]").forEach(function (n) {
      var k = n.getAttribute("data-rm-count");
      n.textContent = String(counts[k] != null ? counts[k] : 0);
    });
    document.querySelectorAll("[data-rm-filter]").forEach(function (b) {
      var k = b.getAttribute("data-rm-filter");
      var slot = b.querySelector(".rm-chip-n");
      if (slot) slot.textContent = String(counts[k] != null ? counts[k] : 0);
    });
  }

  /* ---------------------------------------------------------------- render */
  function build() {
    if (built || !DATA) return;
    var root = $("#page-section-roadmap");
    if (!root) return;

    buildStatusCounts();

    /* Cards into their status section. */
    STATUS_ORDER.forEach(function (key) {
      var grid = document.querySelector('[data-rm-grid="' + key + '"]');
      if (!grid) return;
      grid.textContent = "";
      (DATA.items || []).forEach(function (item) {
        if (item.status !== key) return;
        grid.appendChild(buildCard(item));
      });
      /* Heading emoji + label come from the data, not hand-written twice. */
      var meta = statusMeta(key);
      var emo = document.querySelector('[data-rm-emoji="' + key + '"]');
      if (emo && meta.emoji) emo.textContent = meta.emoji;
      var lbl = document.querySelector('[data-rm-label="' + key + '"]');
      if (lbl) lbl.textContent = meta.label;
    });

    buildCategoryRow();
    buildFeatured();
    buildFreshness();
    wire();
    built = true;
    apply();
  }

  /* One honest line about how current the page is, taken from the data rather
     than typed in by hand. */
  function buildFreshness() {
    var slot = document.getElementById("rm-fresh");
    if (!slot || !DATA) return;
    var items = DATA.items || [];
    var dates = [];
    items.forEach(function (i) {
      if (i.lastUpdated) dates.push(String(i.lastUpdated));
    });
    dates.sort();
    var newest = dates.length ? dates[dates.length - 1] : "";
    var open = items.filter(function (i) { return i.status !== "completed"; }).length;
    var bits = [];
    if (newest) bits.push("last updated " + (fmtDate(newest) || newest));
    if (open) bits.push(open + " still open");
    slot.textContent = bits.join(" · ");
  }

  /* ------------------------------------------------------------------ wire */
  function wire() {
    var root = $("#page-section-roadmap");
    if (!root || root.dataset.rmWired === "1") return;
    root.dataset.rmWired = "1";

    root.addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest("[data-rm-link]") : null;
      if (link) { copyLink(link); return; }
      var b = e.target.closest ? e.target.closest("button[data-rm-filter],button[data-rm-cat]") : null;
      if (!b) return;
      if (b.hasAttribute("data-rm-filter")) {
        state.status = b.getAttribute("data-rm-filter");
        root.querySelectorAll("[data-rm-filter]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      } else {
        state.category = b.getAttribute("data-rm-cat");
        root.querySelectorAll("[data-rm-cat]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      }
      apply();
    });

    var input = $("#roadmap-search");
    if (input) {
      input.addEventListener("input", function () {
        state.q = input.value.trim().toLowerCase();
        apply();
      });
      /* Escape clears the box - no page reload, no navigation. */
      input.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && input.value) {
          input.value = "";
          state.q = "";
          apply();
        }
      });
    }

    /* Following a link while already on the page has to work too, otherwise a
       pasted /roadmap#rm-... URL does nothing. */
    window.addEventListener("hashchange", function () {
      if (!root.classList.contains("active")) return;
      revealFromHash(true);
    });
  }

  /* ----------------------------------------------------------------- apply */
  function apply() {
    var root = $("#page-section-roadmap");
    if (!root) return;

    var total = 0;
    STATUS_ORDER.forEach(function (key) {
      var grid = document.querySelector('[data-rm-grid="' + key + '"]');
      var sec = document.getElementById("rm-sec-" + key);
      var empty = document.querySelector('[data-rm-empty="' + key + '"]');
      if (!grid) return;

      var shown = 0;
      grid.querySelectorAll(".rm-card").forEach(function (card) {
        var okStatus = state.status === "all" || card.getAttribute("data-rm-status") === state.status;
        var okCat = state.category === "all" || (" " + card.getAttribute("data-rm-cats") + " ").indexOf(" " + state.category + " ") > -1;
        var okText = !state.q || (card.getAttribute("data-rm-hay") || "").indexOf(state.q) > -1;
        var visible = okStatus && okCat && okText;
        card.hidden = !visible;
        if (visible) shown++;
      });

      total += shown;
      if (sec) sec.hidden = shown === 0 && !!(state.q || state.status !== "all" || state.category !== "all");
      if (empty) empty.hidden = shown !== 0;

      var sc = document.querySelector('[data-rm-seccount="' + key + '"]');
      if (sc) sc.textContent = shown === 1 ? "1 item" : shown + " items";
    });

    var nos = $("#rm-nos");
    if (nos) nos.hidden = total !== 0;

    var counter = $("#rm-count");
    if (counter) {
      counter.textContent = total === (DATA.items || []).length
        ? (DATA.items || []).length + " items"
        : "Showing " + total + " of " + (DATA.items || []).length + " items";
    }
  }

  /* --------------------------------------------------------------- routing */
  /* The site already owns clean-URL routing (NAV_URL in account.js), so this
     only follows along: lazy-render the page and keep the mobile bottom bar on
     Community, because the Roadmap lives inside the Community menu there. */
  function onShown() {
    build();
    revealFromHash(false);
    try {
      if (typeof window._updateMBN === "function") window._updateMBN("community");
    } catch (e) {}
  }

  /* The site's shared router owns clean URLs (NAV_URL in account.js), so the
     Roadmap plugs into it rather than adding a second one. One wrinkle: the
     router's own deep-link boot reads NAV_URL_REV before NAV_URL is assigned,
     so it throws and no page deep-links on a cold load (/vault and /wanted are
     affected the same way). That shared bug is left alone on purpose - the
     Roadmap simply handles its own entry, and during the boot window it undoes
     script.js's forced jump back to the Lobby, restoring the clean URL with
     replaceState so no bogus history entry is left behind. */
  var bootIntent = false;
  var bootWindow = true;

  function showRoadmap() {
    if (typeof window.switchAppPage === "function") window.switchAppPage("roadmap");
  }

  function init() {
    if (!DATA) return;

    /* Capture the requested URL while it is still readable (script.js rewrites
       it to "/" from a boot timer). */
    bootIntent = /\/roadmap\/?$/i.test(window.location.pathname || "");

    var base = window.switchAppPage;
    if (typeof base === "function" && !base.__rm) {
      var wrapped = function (page) {
        var r = base.apply(window, arguments);
        if (page === "roadmap") onShown();
        else if (page === "home" && bootWindow && bootIntent) {
          bootIntent = false; /* only rescue the boot jump, never a real click */
          var path = window.location.pathname || "";
          if (!/\/roadmap\/?$/i.test(path)) {
            try { history.replaceState(history.state, "", "/roadmap"); } catch (e) {}
          }
          setTimeout(showRoadmap, 0);
        }
        return r;
      };
      wrapped.__rm = true;
      window.switchAppPage = wrapped;
    }

    if (bootIntent) {
      onShown();
      showRoadmap();
    }

    window.addEventListener("load", function () {
      /* Once the page has settled, stop fighting anything. */
      bootWindow = false;
      if (bootIntent) {
        bootIntent = false;
        showRoadmap();
      }
    }, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();