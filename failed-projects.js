/* ============================================================================
   THEHIGHWRLD - FAILED PROJECTS RENDERER
   ----------------------------------------------------------------------------
   A post-mortem page, not a plan. Reads window.THW_FAILED_PROJECTS and renders
   it into #page-section-failed. No API calls, no polling, no dependencies - it
   runs once, the first time the page is opened, then only re-filters on input.

   Deliberately mirrors roadmap.js (build once, lazy-render on open, wrap
   switchAppPage) so the two pages behave identically from the user's side.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.THW_FAILED_PROJECTS || null;
  var REASONS = (DATA && DATA.reasons) || {};

  var state = { reason: "all", category: "all", q: "" };
  var built = false;
  var listCount = 0;

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

  function prefersMotion() {
    try {
      return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  /* Free text the search box actually matches against. Built from the same
     fields the card renders, so a hit always reveals something on screen. */
  function haystack(item) {
    return (
      String(item.title || "") + " " +
      String(item.description || "") + " " +
      String(item.why || "") + " " +
      (item.category || []).map(function (k) {
        return (DATA.categories && DATA.categories[k] && DATA.categories[k].label) || k;
      }).join(" ")
    ).toLowerCase();
  }

  function matches(item) {
    if (state.reason !== "all" && item.reason !== state.reason) return false;
    if (state.category !== "all" && (item.category || []).indexOf(state.category) < 0) return false;
    if (state.q && haystack(item).indexOf(state.q) < 0) return false;
    return true;
  }

  /* Category chips, free-text tags and the optional download, shared by the
     grid cards and the spotlight so the two can never drift apart. */
  function appendExtras(host, item, metaClass) {
    var meta = el("div", metaClass || "fp-card-meta");
    (item.category || []).forEach(function (k) {
      var c = DATA.categories && DATA.categories[k];
      var chip = el("span", "fp-cat");
      if (c && c.icon) chip.appendChild(el("i", c.icon));
      chip.appendChild(el("span", null, (c && c.label) || k));
      meta.appendChild(chip);
    });
    /* Tags are the project's own words (stack, shape), so they render as
       plain monospace chips - deliberately unlike the icon'd categories. */
    (item.tags || []).forEach(function (t) {
      meta.appendChild(el("span", "fp-tag", t));
    });
    if (meta.childNodes.length) host.appendChild(meta);

    if (!item.download || !(item.download.url || item.download.file)) return;

    /* An entry may point at a same-origin file or an absolute URL (a GitHub
       release asset). Only the local case gets the "./" prefix - blindly
       prefixing an absolute URL produces a broken relative path. */
    var dFile = item.download.file || "download";
    var dHref = item.download.url || ("./" + dFile);

    var dl = el("a", "fp-dl");
    dl.href = dHref;
    /* The download attribute is ignored for cross-origin links; the GitHub
       asset sends Content-Disposition: attachment, so it still saves. Setting
       it only for local files keeps the intent honest. */
    if (!item.download.url) dl.setAttribute("download", dFile);
    dl.appendChild(el("i", "fas fa-download"));

    var main = el("span", "fp-dl-main");
    main.appendChild(el("span", "fp-dl-label", item.download.label || "Download"));

    var sub = el("span", "fp-dl-meta");
    sub.appendChild(el("span", "fp-dl-file", dFile));
    if (item.download.size) sub.appendChild(el("span", "fp-dl-size", item.download.size));
    /* Stated before the click, not after - someone should know the archive is
       clean before they download it, not after. */
    if (item.download.note) sub.appendChild(el("span", "fp-dl-note", item.download.note));
    main.appendChild(sub);

    dl.appendChild(main);
    host.appendChild(dl);
  }

  /* ------------------------------------------------------------------ cards */
  function buildCard(item) {
    var card = el("article", "fp-card");
    card.id = "fp-" + item.id;
    card.setAttribute("data-fp-reason", item.reason || "abandoned");

    var r = REASONS[item.reason] || REASONS.abandoned || { label: "Abandoned", icon: "fas fa-ban" };
    var badge = el("span", "fp-badge");
    badge.setAttribute("data-fp-reason", item.reason || "abandoned");
    badge.appendChild(el("i", r.icon || "fas fa-ban"));
    badge.appendChild(el("span", null, r.label || "Abandoned"));
    card.appendChild(badge);

    card.appendChild(el("h3", "fp-card-title", item.title || "Untitled"));

    if (item.description) card.appendChild(el("p", "fp-card-desc", item.description));

    /* The post-mortem itself - the reason this page exists, so it is never
       omitted silently. Falls back to the bare reason label only if the data
       is missing a "why". */
    var why = el("div", "fp-card-why");
    why.appendChild(el("b", null, "Why it failed"));
    why.appendChild(document.createTextNode(item.why || r.label || "No reason recorded."));
    card.appendChild(why);

    appendExtras(card, item, "fp-card-meta");

    return card;
  }

  /* ----------------------------------------------------------------- render */
  function apply() {
    var root = $("#page-section-failed");
    if (!root) return;

    var grid = $(".fp-grid", root);
    var empty = $(".fp-empty", root);
    var section = $(".fp-sec", root);
    var items = (DATA && DATA.items) || [];
    var shown = 0;

    /* Every project is the spotlight, so the list has nothing of its own to
       show. Retract the whole list block rather than claiming "nothing to
       show" while a full-size panel sits directly above it. */
    if (!listCount) {
      if (grid) grid.hidden = true;
      if (empty) empty.hidden = true;
      if (section) section.hidden = true;
      var noneEl = $("[data-fp-shown]", root);
      if (noneEl) noneEl.textContent = "0";
      return;
    }

    items.forEach(function (item) {
      var card = document.getElementById("fp-" + item.id);
      if (!card) return;
      var ok = matches(item);
      card.hidden = !ok;
      if (ok) shown++;
    });

    /* The heading count reflects what is on screen, not the total, so the two
       can never disagree. */
    var shownEl = $("[data-fp-shown]", root);
    if (shownEl) shownEl.textContent = String(shown);

    if (grid) grid.hidden = shown === 0;
    if (empty) empty.hidden = shown !== 0;
    if (section) section.hidden = shown === 0;

    /* Keep the "nothing here" copy honest about which filter emptied the grid. */
    var sub = $(".fp-empty-sub", root);
    if (sub) {
      sub.textContent = state.q
        ? "Nothing matches “" + state.q + "”."
        : "No projects with that filter yet.";
    }
  }

  /* ------------------------------------------------------------------ build */
  function build() {
    if (built) return;
    var root = $("#page-section-failed");
    if (!root || !DATA) return;

    var host = $(".fp-mount", root);
    if (!host) return;

    var items = DATA.items || [];

    /* The featured project is already shown at full size in the spotlight, so
       it is not repeated in the list below. Everything list-shaped - the grid,
       the filter counts, the "showing N" counter - is built from the remaining
       items, so the counts can never disagree with what is on screen. The
       summary pills above still count the whole page, spotlight included. */
    var listItems = items.filter(function (it) { return !it.featured; });
    listCount = listItems.length;

    var listReasons = Object.keys(REASONS).filter(function (key) {
      return listItems.some(function (it) { return it.reason === key; });
    });

    host.innerHTML = "";

    /* Everything renders inside .fp-page - it carries the page padding that
       clears the fixed site nav and centres the column. The mount point in the
       markup is deliberately bare so this stays the single source of truth. */
    var page = el("div", "fp-page");
    host.appendChild(page);

    /* header */
    var header = el("header", "fp-header");
    header.appendChild(el("span", "fp-eyebrow", "Failed Projects"));
    header.appendChild(el("h1", "fp-title", "Things that didn't make it."));
    header.appendChild(
      el("p", "fp-sub", "Features that were built, started, or planned and then dropped. Kept here so the same dead ends don't get picked up twice.")
    );

    var summary = el("ul", "fp-summary");
    summary.setAttribute("aria-label", "Failed project summary");
    Object.keys(REASONS).forEach(function (key) {
      var n = items.filter(function (it) { return it.reason === key; }).length;
      if (!n) return; /* don't render a chip that can only ever show nothing */
      var li = el("li", "fp-sum");
      li.setAttribute("data-fp-reason", key);
      li.appendChild(el("i", REASONS[key].icon || "fas fa-circle"));
      var b = el("b", null, String(n));
      b.setAttribute("data-fp-count", key);
      li.appendChild(b);
      li.appendChild(el("span", null, REASONS[key].label || key));
      summary.appendChild(li);
    });
    var total = el("li", "fp-sum");
    total.setAttribute("data-fp-reason", "all");
    total.appendChild(el("i", "fas fa-box-archive"));
    total.appendChild(el("b", null, String(items.length)));
    total.appendChild(el("span", null, "Total"));
    summary.appendChild(total);
    header.appendChild(summary);
    page.appendChild(header);

    /* Spotlight: the one failure worth reading before the list. Driven by
       featured:true in the data file so which project it is can be changed
       without touching this module. Renders nothing when no item is flagged. */
    var featured = items.filter(function (it) { return it.featured; })[0] || null;
    if (featured) {
      var fr = REASONS[featured.reason] || REASONS.abandoned || { label: "Abandoned", icon: "fas fa-ban" };

      var spotSec = el("section", "fp-spot-sec");
      spotSec.setAttribute("aria-labelledby", "fp-spot-title");

      /* .fp-spot is the visible panel - it carries the border, gradient wash
         and padding. spotSec is only the spacing/landmark wrapper. Everything
         below goes into spot, not spotSec. */
      var spot = el("div", "fp-spot");
      spotSec.appendChild(spot);

      var spotHead = el("div", "fp-spot-head");
      var eyebrow = el("span", "fp-spot-eyebrow");
      eyebrow.appendChild(el("i", "fas fa-star"));
      eyebrow.appendChild(el("span", null, "Spotlight"));
      spotHead.appendChild(eyebrow);

      var spotBadge = el("span", "fp-badge");
      spotBadge.setAttribute("data-fp-reason", featured.reason || "abandoned");
      spotBadge.appendChild(el("i", fr.icon || "fas fa-ban"));
      spotBadge.appendChild(el("span", null, fr.label || "Abandoned"));
      spotHead.appendChild(spotBadge);
      spot.appendChild(spotHead);

      var h3 = el("h3", null, featured.title || "Untitled");
      h3.id = "fp-spot-title";
      spot.appendChild(h3);

      if (featured.description) spot.appendChild(el("p", "fp-spot-desc", featured.description));

      var spotWhy = el("div", "fp-spot-why");
      spotWhy.appendChild(el("b", null, "Why it failed"));
      spotWhy.appendChild(document.createTextNode(featured.why || fr.label || "No reason recorded."));
      spot.appendChild(spotWhy);

      appendExtras(spot, featured, "fp-spot-foot");

      page.appendChild(spotSec);
    }

    /* controls: reason chips + category chips + search */
    var controls = el("div", "fp-controls hub-panel");
    var row1 = el("div", "fp-controls-row");
    row1.setAttribute("role", "group");
    row1.setAttribute("aria-label", "Filter failed projects by reason");

    function chip(sel, key, label, icon, count, pressed) {
      var b = el("button", "fp-chip");
      b.type = "button";
      b.setAttribute(sel, key);
      b.setAttribute("aria-pressed", pressed ? "true" : "false");
      if (icon) b.appendChild(el("i", icon));
      b.appendChild(el("span", null, label));
      b.appendChild(el("span", "fp-chip-n", String(count)));
      return b;
    }

    var allBtn = chip("data-fp-filter", "all", "All", "fas fa-layer-group", listItems.length, true);
    row1.appendChild(allBtn);
    listReasons.forEach(function (key) {
      var n = listItems.filter(function (it) { return it.reason === key; }).length;
      row1.appendChild(chip("data-fp-filter", key, REASONS[key].label || key, REASONS[key].icon, n, false));
    });
    controls.appendChild(row1);

    var row2 = el("div", "fp-controls-row");
    var cats = DATA.categories || {};
    var catKeys = Object.keys(cats).filter(function (k) {
      return listItems.some(function (it) { return (it.category || []).indexOf(k) >= 0; });
    });
    if (catKeys.length) {
      var catsWrap = el("div", "fp-cats");
      catsWrap.setAttribute("role", "group");
      catsWrap.setAttribute("aria-label", "Filter failed projects by area");
      catsWrap.appendChild(chip("data-fp-cat", "all", "All areas", "fas fa-grip", listItems.length, true));
      catKeys.forEach(function (k) {
        var n = listItems.filter(function (it) { return (it.category || []).indexOf(k) >= 0; }).length;
        catsWrap.appendChild(chip("data-fp-cat", k, (cats[k] && cats[k].label) || k, (cats[k] && cats[k].icon) || null, n, false));
      });
      row2.appendChild(catsWrap);
    }

    var search = el("div", "fp-search");
    search.appendChild(el("i", "fas fa-magnifying-glass"));
    var input = document.createElement("input");
    input.id = "failed-search";
    input.type = "search";
    input.placeholder = "Search failed projects...";
    input.autocomplete = "off";
    input.spellcheck = false;
    search.appendChild(input);
    row2.appendChild(search);
    controls.appendChild(row2);
    page.appendChild(controls);

    /* section head + grid + empty state */
    var sec = el("section", "fp-sec");
    var secHead = el("div", "fp-sec-head");
    secHead.appendChild(el("span", "fp-bar"));
    var h2 = el("h2", null, "All failed projects");
    h2.id = "failed-grid-title";
    secHead.appendChild(h2);
    var shown = el("b", "fp-shown", "0");
    shown.setAttribute("data-fp-shown", "");
    secHead.appendChild(shown);
    sec.appendChild(secHead);

    var grid = el("div", "fp-grid");
    grid.setAttribute("aria-labelledby", "failed-grid-title");
    listItems.forEach(function (item) { grid.appendChild(buildCard(item)); });
    sec.appendChild(grid);
    page.appendChild(sec);

    var empty = el("div", "fp-empty");
    empty.hidden = true;
    empty.appendChild(el("i", "fas fa-filter-circle-xmark"));
    empty.appendChild(el("p", null, "Nothing to show."));
    empty.appendChild(el("p", "fp-empty-sub", "No projects with that filter yet."));
    page.appendChild(empty);

    /* --------------------------------------------------------- interactions */
    row1.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-fp-filter]");
      if (!b) return;
      state.reason = b.getAttribute("data-fp-filter");
      row1.querySelectorAll("[data-fp-filter]").forEach(function (x) {
        x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      apply();
    });

    if (catsWrap) {
      catsWrap.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-fp-cat]");
        if (!b) return;
        state.category = b.getAttribute("data-fp-cat");
        catsWrap.querySelectorAll("[data-fp-cat]").forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        apply();
      });
    }

    input.addEventListener("input", function () {
      state.q = input.value.trim().toLowerCase();
      apply();
    });

    built = true;
    apply();
  }

  /* ------------------------------------------------------------ deep linking */
  /* /failed#fp-<id> scrolls to a card and flashes it. Any filter that would hide
     the target is cleared first, otherwise the link would land on nothing. */
  function revealFromHash() {
    var root = $("#page-section-failed");
    if (!root) return;
    var id = "";
    try { id = (location.hash || "").replace(/^#fp-/, ""); } catch (e) {}
    if (!id) return;
    var card = document.getElementById("fp-" + id);
    if (!card) return;
    if (card.hidden) {
      state.reason = "all";
      state.category = "all";
      state.q = "";
      var input = $("#failed-search");
      if (input) input.value = "";
      root.querySelectorAll("[data-fp-filter]").forEach(function (x) {
        x.setAttribute("aria-pressed", x.getAttribute("data-fp-filter") === "all" ? "true" : "false");
      });
      root.querySelectorAll("[data-fp-cat]").forEach(function (x) {
        x.setAttribute("aria-pressed", x.getAttribute("data-fp-cat") === "all" ? "true" : "false");
      });
      apply();
    }
    if (card.scrollIntoView) card.scrollIntoView({ block: "center", behavior: prefersMotion() ? "smooth" : "auto" });
    card.classList.add("fp-flash");
  }

  function onShown() {
    build();
    if (built) revealFromHash();
  }

  function init() {
    if (!DATA) return;

    var base = window.switchAppPage;
    if (typeof base === "function" && !base.__fp) {
      var wrapped = function (page) {
        var r = base.apply(window, arguments);
        if (page === "failed") onShown();
        return r;
      };
      wrapped.__fp = true;
      window.switchAppPage = wrapped;
    }

    window.addEventListener("hashchange", function () {
      if (built) revealFromHash();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();