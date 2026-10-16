/* WRLD LOG - Version History panel controller.

   Replaces a duplicated inline version list in index.html with one data file
   (wrldlog-data.js) and one panel. Opening it never navigates: the panel is an
   overlay above whatever page you are on.

   Design notes worth keeping:

   - No MutationObserver, no polling, no interval. The DOM is built once, on the
     first open, and after that only visibility and text content change.
   - No dependencies. The site's icon font is already loaded, so the chevron is a
     font glyph rather than an inline SVG.
   - Every release starts collapsed, including the newest. Searching is what opens
     entries, because a match you cannot read looks like no result.

   Accessibility: role="dialog" + aria-modal, a focus trap on Tab, Escape to
   close, focus returned to whatever opened it, and the trigger is a real button
   with an aria-label and aria-haspopup. */

(function () {
  "use strict";

  var OVERLAY_ID = "wrldlog-vh-overlay";
  var openButton = null;
  var built = false;
  var lastFocus = null;
  var nodes = {};

  var data = Array.isArray(window.THW_WRLDLOG) ? window.THW_WRLDLOG : [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function overlay() {
    return document.getElementById(OVERLAY_ID);
  }

  /* Entries carry a title only for v4.6. Everything else derives a headline from
     its own notes, so the collapsed row shows something useful rather than a
     bare version number. Never invents text - it is the first clause, trimmed. */
  function headline(entry) {
    if (entry.title) return entry.title;
    var n = String(entry.notes || "");
    var stop = n.indexOf(" · ");
    if (stop > 0) n = n.slice(0, stop);
    if (n.length > 90) n = n.slice(0, 90).replace(/\s+\S*$/, "") + "…";
    return n;
  }

  function matches(entry, q) {
    if (!q) return true;
    return (
      entry.version.toLowerCase().indexOf(q) !== -1 ||
      String(entry.notes || "").toLowerCase().indexOf(q) !== -1 ||
      String(entry.title || "").toLowerCase().indexOf(q) !== -1
    );
  }

  function build() {
    var o = overlay();
    if (!o) return;
    /* Guard on the panel actually existing, not on a flag alone. A boolean still
       said "built" after the overlay's children were gone, leaving a panel that
       opened to nothing and could never recover. */
    if (built && o.querySelector(".wrldlog-vh-panel")) return;
    built = false;

    var panel = el("div", "wrldlog-vh-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "wrldlog-vh-title");

    var head = el("div", "wrldlog-vh-head");
    var titles = el("div");
    var h = el("h2", null, "Version History");
    h.id = "wrldlog-vh-title";
    titles.appendChild(h);
    var count = el("span", "wrldlog-vh-count");
    titles.appendChild(count);
    head.appendChild(titles);

    var close = el("button", "wrldlog-vh-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Close version history");
    head.appendChild(close);
    panel.appendChild(head);

    var searchWrap = el("div", "wrldlog-vh-search");
    var input = el("input");
    input.type = "search";
    input.placeholder = "Search versions and release notes…";
    input.setAttribute("aria-label", "Search versions");
    searchWrap.appendChild(input);
    panel.appendChild(searchWrap);

    var list = el("div", "wrldlog-vh-list");
    var items = [];
    data.forEach(function (entry, i) {
      var item = el("div", "wrldlog-vh-item");

      var toggle = el("button", "wrldlog-vh-toggle");
      toggle.type = "button";
      /* Everything starts collapsed. Opening the panel to read the newest release
         is a reasonable guess, but it is still a guess: the panel also opens to
         search, to check a specific version, or out of plain curiosity, and an
         auto-opened block scrolls the list and hides the shape of the history.
         Thirty-one closed rows read as a scannable index; one open row reads as
         "this is the only release". */
      toggle.setAttribute("aria-expanded", "false");
      var ctrl = "wrldlog-vh-notes-" + i;
      toggle.setAttribute("aria-controls", ctrl);

      toggle.appendChild(el("span", "wrldlog-vh-v", entry.version));
      toggle.appendChild(el("span", "wrldlog-vh-title", headline(entry)));
      var chev = el("i", "fas fa-chevron-right wrldlog-vh-chev");
      chev.setAttribute("aria-hidden", "true");
      toggle.appendChild(chev);

      var notes = el("p", "wrldlog-vh-notes", entry.notes);
      notes.id = ctrl;
      notes.hidden = true;

      toggle.addEventListener("click", function () {
        var open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
        notes.hidden = open;
      });

      item.appendChild(toggle);
      item.appendChild(notes);
      list.appendChild(item);
      items.push({ entry: entry, item: item, notes: notes, toggle: toggle });
    });

    var empty = el("p", "wrldlog-vh-empty", "No release matches that search.");
    empty.hidden = true;

    panel.appendChild(list);
    panel.appendChild(empty);
    o.appendChild(panel);

    count.textContent =
      data.length + (data.length === 1 ? " release" : " releases") +
      (data.length ? " · " + data[data.length - 1].version + " to " + data[0].version : "");

    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      items.forEach(function (rec) {
        var hit = matches(rec.entry, q);
        rec.item.hidden = !hit;
        if (hit) {
          shown++;
          // A match you cannot read looks like no result. Open whatever the
          // search surfaced, but only when there is a query to explain it.
          if (q) {
            rec.toggle.setAttribute("aria-expanded", "true");
            rec.notes.hidden = false;
          }
        }
      });
      empty.hidden = shown !== 0;
    });

    close.addEventListener("click", closePanel);
    o.addEventListener("click", function (e) {
      if (e.target === o) closePanel();
    });

    nodes = { list: list, input: input, close: close, panel: panel };
    built = true;
  }

  function focusables() {
    var p = nodes.panel;
    if (!p) return [];
    return Array.prototype.filter.call(
      p.querySelectorAll('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'),
      function (n) { return n.offsetParent !== null; }
    );
  }

  function openPanel(trigger) {
    var o = overlay();
    if (!o) return;
    build();
    /* The trigger now lives in the WRLD LOG splash, so opening this from there
       would otherwise stack two full-screen overlays. Close the splash first -
       the user is going forward, not back. */
    var splash = document.getElementById("wrldlog-overlay");
    if (splash && getComputedStyle(splash).display !== "none" && typeof window.closeWrldLog === "function") {
      window.closeWrldLog();
    }
    lastFocus = trigger || document.activeElement;
    o.classList.add("open");
    o.removeAttribute("aria-hidden");
    document.documentElement.classList.add("wrldlog-vh-scrolllock");
    // Focus the search rather than the close button: opening this panel is
    // almost always a "what changed?" question, and typing is the fastest answer.
    if (nodes.input) nodes.input.focus();
    else if (nodes.close) nodes.close.focus();
  }

  function closePanel() {
    var o = overlay();
    if (!o || !o.classList.contains("open")) return;
    o.classList.remove("open");
    o.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("wrldlog-vh-scrolllock");
    if (lastFocus && lastFocus.focus) {
      /* The trigger usually sits inside the WRLD LOG splash, and opening the
         panel closes that splash - so the element we were about to return focus
         to is now display:none, and focusing it would move focus into a hidden
         subtree, which browsers then immediately drop.

         The Vault summary is the other way in, but it only exists visibly while
         the Vault page is the active one. So every candidate is checked before
         being focused, and if none is visible we simply leave focus alone rather
         than forcing it somewhere worse than it already is. */
      var candidates = [
        lastFocus,
        document.querySelector("[data-wrldlog-summary]"),
        document.querySelector("#wrldlog-overlay [data-wrldlog-history]"),
      ];
      for (var i = 0; i < candidates.length; i++) {
        var t = candidates[i];
        if (t && t.offsetParent !== null) {
          try { t.focus(); break; } catch (_) {}
        }
      }
    }
    lastFocus = null;
  }

  function isOpen() {
    var o = overlay();
    return !!(o && o.classList.contains("open"));
  }

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key !== "Tab") return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!nodes.panel.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  });

  /* Exposed so the existing inline onclick="showWrldLog()" call sites keep
     working, and so the new book button can use the same entry point. */
  window.openWrldLogHistory = function (trigger) { openPanel(trigger); };
  window.closeWrldLogHistory = closePanel;

  /* The v4.6 splash modal still hard-codes the newest release as literal HTML,
     which is a second copy of the same facts the data file now holds. Populate it
     from the data so there is genuinely one source, and so a future release
     needs one edit rather than two that can drift apart - which is exactly how
     the list ended at v4.5 while the badge said v4.6. */
  function hydrateSplash() {
    if (!data.length) return;
    var newest = data[0];
    var badge = document.querySelector("#wrldlog-overlay .wrldlog-badge");
    var title = document.querySelector("#wrldlog-overlay .wrldlog-title");
    var items = document.querySelector("#wrldlog-overlay .wrldlog-items");
    if (badge && newest.title) badge.textContent = newest.version + " — " + newest.title;
    if (title && newest.title) title.textContent = newest.title;
    if (items && newest.chips && newest.chips.length) {
      items.textContent = "";
      newest.chips.forEach(function (c) {
        var s = document.createElement("span");
        s.textContent = c;
        items.appendChild(s);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { hydrateSplash(); bind(); });
  } else {
    hydrateSplash();
    bind();
  }

  function bind() {
    /* The Vault's summary button had its count baked into the markup, written
       when the inline list still held 30 rows. The list then gained v4.6 from
       the splash badge, so the button said 30 while the panel listed 31. Counted
       from the data instead, so it cannot drift again. */
    var summaryLabel = document.querySelector("[data-wrldlog-summary] .wrldlog-vh-summary-label");
    if (summaryLabel && data.length) {
      summaryLabel.textContent = "View all " + data.length + " releases";
    }
    var summaryVersion = document.querySelector("[data-wrldlog-summary] .wrldlog-vh-v");
    if (summaryVersion && data.length) summaryVersion.textContent = data[0].version;

    var trigger = document.querySelector("[data-wrldlog-history]");
    if (trigger && !trigger.dataset.wrldlogBound) {
      trigger.dataset.wrldlogBound = "1";
      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        openPanel(trigger);
      });
    }
    var summary = document.querySelector("[data-wrldlog-summary]");
    if (summary && !summary.dataset.wrldlogBound) {
      summary.dataset.wrldlogBound = "1";
      summary.addEventListener("click", function (e) {
        e.stopPropagation();
        openPanel(summary);
      });
    }
  }
})();