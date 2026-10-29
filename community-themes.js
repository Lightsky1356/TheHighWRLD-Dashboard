/* Community Themes
 *
 * The page behind the Community tab's "Community Themes" entry. Members
 * design a theme with the color-slot builder - five pickers, a name and a
 * description - the server generates every byte of CSS from validated hex
 * values, and a submission publishes the moment it passes that validation.
 *
 * The rules on the page are the moderation for that: colors cannot be
 * anything but colors, so what is left to police is only what people write
 * beside them. The owner and the author can take a theme down afterwards,
 * which hides it from the gallery without breaking anyone already wearing
 * it: the slug keeps rendering and their save keeps working.
 */
(function () {
  "use strict";

  /* Escapes what can only ever be page text: names, descriptions, authors,
     slugs. Colors go through HEX_OK before anything else, and even then only
     once parsed - they are never concatenated blindly. */
  var AMP = String.fromCharCode(38);
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, AMP + "amp;")
      .replace(/</g, AMP + "lt;")
      .replace(/>/g, AMP + "gt;")
      .replace(/"/g, AMP + "quot;")
      .replace(/'/g, AMP + "#39;");
  }

  var SLOTS = [
    { key: "accent", label: "Accent" },
    { key: "accent2", label: "Second accent" },
    { key: "bg", label: "Background" },
    { key: "card", label: "Card tint" },
    { key: "text", label: "Text tone" },
  ];
  var DEFAULT_SLOTS = {
    accent: "#a855f7", accent2: "#22d3ee",
    bg: "#120a26", card: "#1a1138", text: "#f2edff",
  };
  var HEX_OK = /^#[0-9a-fA-F]{6}$/;

  var ROOT = null;
  var formEl = null;
  var galleryEl = null;
  var statsEl = null;
  var list = [];

  function viewer() {
    return (window.thwViewer && window.thwViewer()) || { uid: "", isOwner: false };
  }

  function apiPost(body) {
    return fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { status: r.status, data: d };
      });
    });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------------------------------------------------------------- mount */

  function build() {
    if (!ROOT || ROOT.dataset.ctBuilt) return;
    ROOT.dataset.ctBuilt = "1";

    var head = el("div", "ct-head",
      '<span class="ct-eyebrow">Community</span>' +
      '<h1 class="ct-title">Community Themes</h1>' +
      '<p class="ct-sub">Themes the members designed themselves - wear one with a click, or make your own.</p>');
    ROOT.appendChild(head);

    ROOT.appendChild(rulesCard());

    var left = el("div", "ct-left");
    left.appendChild(formCard());

    var right = el("div", "ct-right");
    galleryEl = el("div", "ct-card");
    statsEl = el("div", "ct-card ct-stats-card");
    right.appendChild(galleryEl);
    right.appendChild(statsEl);

    var grid = el("div", "ct-grid");
    grid.appendChild(left);
    grid.appendChild(right);
    ROOT.appendChild(grid);

    watchVisibility();
    refresh();
  }

  function rulesCard() {
    var card = el("div", "ct-card ct-rules");
    card.innerHTML =
      '<h2 class="ct-card-title"><i class="fas fa-scale-balanced"></i> The rules</h2>' +
      '<p class="ct-rule-note">Publishing is instant, so the rules are short and enforced the hard way:</p>';
    var ul = el("ul", "ct-rules-list");
    var rules = [
      ["fa-palette", "<b>Colors only.</b> The form picks five colors; the site writes the whole stylesheet from them. Nothing pasted can ever climb into the CSS."],
      ["fa-comment-dots", "<b>Kind names and descriptions.</b> The same rules the rest of the community follows: nothing offensive, no slurs, no advertising - in any language."],
      ["fa-user", "<b>Be yourself.</b> Your display name is shown as the theme&#39;s author. No names impersonating staff or bots."],
      ["fa-compass-drafting", "<b>Original work.</b> Recreating a built-in look is fine; re-submitting a member&#39;s theme under a new name is not."],
      ["fa-hourglass-half", "<b>Twenty per member</b> keeps the gallery open for everyone, and you can take your own down at any time."],
      ["fa-shield", "<b>The owner can remove</b> any theme that breaks these rules - the takedown is quiet and instant."],
    ];
    for (var i = 0; i < rules.length; i++) {
      ul.appendChild(el("li", null, '<i class="fas ' + rules[i][0] + '"></i><span>' + rules[i][1] + "</span>"));
    }
    card.appendChild(ul);
    return card;
  }

  /* ---------------------------------------------------------------- form */

  function formCard() {
    var card = el("div", "ct-card ct-form-area");
    if (!viewer().uid) {
      card.innerHTML =
        '<h2 class="ct-card-title"><i class="fas fa-wand-magic-sparkles"></i> Make one</h2>' +
        '<p class="ct-signin-text">Designing a theme takes an account, so every theme stays credited to its author.</p>';
      var b = el("button", "ct-btn ct-btn-gold",
        '<i class="fas fa-right-to-bracket"></i> Sign in to submit a theme');
      b.type = "button";
      b.id = "ct-signin-btn";
      b.addEventListener("click", function () {
        if (window.showAuthPage) window.showAuthPage("login");
      });
      card.appendChild(b);
      return card;
    }

    formEl = el("form", "ct-form");
    var parts = [
      '<h2 class="ct-card-title"><i class="fas fa-wand-magic-sparkles"></i> Make one</h2>',
    ];
    parts.push('<div class="ct-label">Name <span class="ct-req">*</span></div>' +
      '<input id="ct-name" maxlength="24" autocomplete="off" placeholder="Midnight Bloom" class="ct-input">' +
      '<div class="ct-count"><span id="ct-name-count">0</span>/24</div>');
    parts.push('<div class="ct-label">What is the theme about? <span class="ct-req">*</span></div>' +
      '<textarea id="ct-desc" maxlength="280" rows="3" placeholder="A night garden in violet and cyan - built for slow listening." class="ct-input"></textarea>' +
      '<div class="ct-count"><span id="ct-desc-count">0</span>/280</div>');
    var slotsHtml = "";
    for (var i = 0; i < SLOTS.length; i++) {
      var s = SLOTS[i];
      slotsHtml +=
        '<div class="ct-slot"><label class="ct-label" for="ct-c-' + s.key + '">' + s.label + "</label>" +
        '<div class="ct-slot-row">' +
        '<input type="color" id="ct-c-' + s.key + '" value="' + DEFAULT_SLOTS[s.key] + '">' +
        '<input type="text" id="ct-t-' + s.key + '" value="' + DEFAULT_SLOTS[s.key] + '" maxlength="7" class="ct-input ct-hextext" autocomplete="off" spellcheck="false">' +
        "</div></div>";
    }
    parts.push('<div class="ct-slots">' + slotsHtml + "</div>");
    parts.push('<div class="ct-preview-shell"><div class="ct-label">Preview</div>' +
      '<div class="ct-preview"><div class="ct-preview-card"></div>' +
      '<span class="ct-preview-note">updates live - the mockup and the hex codes change as you pick</span></div></div>');
    parts.push('<button type="submit" class="ct-btn ct-btn-gold" id="ct-submit">' +
      '<i class="fas fa-paper-plane"></i> Submit theme</button>' +
      '<p class="ct-form-msg" id="ct-form-msg"></p>');
    formEl.innerHTML = parts.join("");
    card.appendChild(formEl);

    formEl.querySelector("#ct-name").addEventListener("input", function () {
      formEl.querySelector("#ct-name-count").textContent = String(this.value.length);
    });
    formEl.querySelector("#ct-desc").addEventListener("input", function () {
      formEl.querySelector("#ct-desc-count").textContent = String(this.value.length);
    });
    for (var k = 0; k < SLOTS.length; k++) {
      (function (s) {
        var color = formEl.querySelector("#ct-c-" + s.key);
        var text = formEl.querySelector("#ct-t-" + s.key);
        color.addEventListener("input", function () { text.value = color.value; paintPreview(); });
        text.addEventListener("input", function () {
          if (HEX_OK.test(text.value)) color.value = text.value;
          paintPreview();
        });
      })(SLOTS[k]);
    }
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      submit();
    });
    paintPreview();
    return card;
  }

  function slotsFromForm() {
    var out = {};
    for (var i = 0; i < SLOTS.length; i++) {
      var t = formEl.querySelector("#ct-t-" + SLOTS[i].key);
      var c = formEl.querySelector("#ct-c-" + SLOTS[i].key);
      var v = ((t && t.value) || "").trim() || (c && c.value) || "";
      out[SLOTS[i].key] = HEX_OK.test(v) ? v.toLowerCase() : "";
    }
    return out;
  }

  function paintPreview() {
    if (!formEl) return;
    var c = slotsFromForm();
    var pv = formEl.querySelector(".ct-preview-card");
    if (!pv) return;
    var accent = c.accent || "#555";
    var accent2 = c.accent2 || "#555";
    var bg = c.bg || "#111";
    var card = c.card || "#181818";
    var text = c.text || "#eee";
    /* A tiny mock of the site itself - nav, hero, cards, a play button -
       painted from the five slots, so the member sees the shape of the
       theme, not just five strips. Every value here came through HEX_OK or
       is a fixed default, and the only variable text is the (escaped) name. */
    var name = (formEl.querySelector("#ct-name").value || "").trim();
    pv.innerHTML =
      '<span class="ct-mini" style="background:' + bg + ';color:' + text + '">' +
        '<span class="ct-mini-nav" style="background:' + card + '">' +
          '<b style="color:' + accent + '">' + esc(name || "Your theme") + "</b>" +
          '<span class="ct-mini-links">Home&nbsp;&nbsp;Queue&nbsp;&nbsp;Vault</span>' +
        "</span>" +
        '<span class="ct-mini-hero" style="background:linear-gradient(135deg,' + accent + "," + accent2 + ')"></span>' +
        '<span class="ct-mini-main">' +
          '<span class="ct-mini-card" style="background:' + card + ';border-top-color:' + accent + '">' +
            '<b>Now playing</b><span class="ct-mini-sub">a track by someone</span>' +
            '<span class="ct-mini-btnrow">' +
              '<i class="ct-mini-btn" style="background:' + accent + '"></i>' +
              '<i class="ct-mini-btn" style="background:' + card + ';border:2px solid ' + accent2 + '"></i>' +
            "</span>" +
          "</span>" +
          '<span class="ct-mini-card" style="background:' + card + ';border-top-color:' + accent2 + '">' +
            "<b>Community</b><span class=\"ct-mini-sub\">three themes live</span>" +
            '<span class="ct-mini-wear" style="color:' + text + ';border:1px solid ' + text + '">Wear it</span>' +
          "</span>" +
        "</span>" +
        '<span class="ct-mini-foot">' +
          '<span class="ct-mini-hex" style="color:' + text + '">accent ' + accent + " &#183; accents " + accent2 + " &#183; bg " + bg + " &#183; card " + card + " &#183; text " + text + "</span>" +
        "</span>" +
      "</span>";
  }

  function submit() {
    if (!formEl) return;
    var msg = formEl.querySelector("#ct-form-msg");
    var btn = formEl.querySelector("#ct-submit");
    msg.textContent = "";
    msg.className = "ct-form-msg";
    var c = slotsFromForm();
    for (var i = 0; i < SLOTS.length; i++) {
      if (!HEX_OK.test(c[SLOTS[i].key])) {
        msg.textContent = "Each color must be a hex value like " + DEFAULT_SLOTS[SLOTS[i].key] + ".";
        msg.className = "ct-form-msg ct-form-err";
        return;
      }
    }
    var name = (formEl.querySelector("#ct-name").value || "").trim();
    var desc = (formEl.querySelector("#ct-desc").value || "").trim();
    if (name.length < 2 || desc.length < 8) {
      msg.textContent = "Give the theme a name (2+ characters) and a short description (8+).";
      msg.className = "ct-form-msg ct-form-err";
      return;
    }
    btn.disabled = true;
    apiPost({ action: "submitTheme", name: name, description: desc, colors: c }).then(function (r) {
      btn.disabled = false;
      var d = r.data;
      if (r.status === 401 || (d && d.error === "sign in required")) {
        msg.textContent = "Your session ended - sign in again to submit.";
        msg.className = "ct-form-msg ct-form-err";
        return;
      }
      if (!d || !d.ok) {
        msg.textContent = (d && d.error) || "Couldn't submit - try again in a moment.";
        msg.className = "ct-form-msg ct-form-err";
        return;
      }
      if (window.toast) window.toast("Theme submitted - " + name + " is live in the gallery.", "success", 4000);
      /* Its option lands in the pickers first, so wearing works right away. */
      syncMemberPickers([{ slug: d.theme, name: name }]);
      if (window.thwWearTheme) window.thwWearTheme(d.theme);
      SLOTS.forEach(function (s) {
        formEl.querySelector("#ct-c-" + s.key).value = DEFAULT_SLOTS[s.key];
        formEl.querySelector("#ct-t-" + s.key).value = DEFAULT_SLOTS[s.key];
      });
      formEl.querySelector("#ct-name").value = "";
      formEl.querySelector("#ct-desc").value = "";
      formEl.querySelector("#ct-name-count").textContent = "0";
      formEl.querySelector("#ct-desc-count").textContent = "0";
      paintPreview();
      msg.textContent = "Published! Find it in the gallery above and in your theme pickers.";
      msg.className = "ct-form-msg ct-form-ok";
      refresh();
    });
  }

  /* ------------------------------------------------------------ pickers */

  /* Both theme pickers grow a "Community" group: without an option there is
     nothing to select, and the wear path - from a gallery row or the field
     together - sets and dispatches on that option. Rebuilt on every gallery
     refresh, with the wearer's current pick restored afterwards. */
  function syncMemberPickers(extra) {
    var merged = list.slice();
    if (extra) merged = extra.concat(merged);
    ["setTheme", "ftTheme"].forEach(function (selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var group = sel.querySelector("optgroup[data-member-group]");
      if (!group) {
        group = document.createElement("optgroup");
        group.setAttribute("data-member-group", "");
        group.label = "Community";
        sel.appendChild(group);
      }
      group.textContent = "";
      for (var i = 0; i < merged.length; i++) {
        var seg = merged[i];
        if (!seg || !seg.slug || !/^u-[a-z0-9-]{2,40}$/.test(seg.slug)) continue;
        var existing = group.querySelector('option[value="' + seg.slug + '"]');
        if (existing) continue;
        var opt = document.createElement("option");
        opt.value = seg.slug;
        opt.textContent = seg.name;
        opt.setAttribute("data-member", "1");
        group.appendChild(opt);
      }
      /* The wearer's current pick may be a member theme that only now got an
         option: applyThemeLang's value= assignment ran before this option
         existed and the select would have dropped it to the first option. */
      var cur = document.documentElement.getAttribute("data-theme") || "";
      for (var m = 0; m < merged.length; m++) {
        if (cur === merged[m].slug) { sel.value = cur; break; }
      }
    });
  }

  /* ------------------------------------------------------------ gallery */

  function swatchRow(colors) {
    var frag = document.createDocumentFragment();
    var keys = ["accent", "accent2", "bg", "card", "text"];
    for (var i = 0; i < keys.length; i++) {
      var v = colors && colors[keys[i]];
      if (v && HEX_OK.test(v)) {
        var sw = el("span", "ct-swatch");
        sw.style.background = v;
        sw.title = keys[i] + " " + v;
        frag.appendChild(sw);
      }
    }
    return frag;
  }

  function themeCard(theme) {
    var v = viewer();
    var canRemove = v.isOwner || theme.owned;
    var row = el("article", "ct-theme-row");
    row.setAttribute("data-theme-ct", theme.slug);

    var top = el("div", "ct-row-top");
    var flag = el("span", "ct-row-flag");
    flag.style.background = "linear-gradient(120deg," +
      ((theme.colors && theme.colors.accent) || "#555") + "," +
      ((theme.colors && theme.colors.accent2) || "#555") + ")";
    top.appendChild(flag);
    top.appendChild(el("span", "ct-row-name", esc(theme.name)));
    if (canRemove) {
      var rm = el("button", "ct-remove", '<i class="fas fa-trash-can"></i> Remove');
      rm.type = "button";
      rm.title = "Take this theme down";
      rm.addEventListener("click", function () {
        if (!window.confirm("Take down \u00ab" + theme.name + "\u00bb? Anyone wearing it keeps it until they switch.")) return;
        apiPost({ action: "removeTheme", theme: theme.slug }).then(function (r) {
          if (r && r.data && r.data.ok) {
            if (window.toast) window.toast("Theme taken down.", "success", 3000);
            refresh();
          } else if (window.toast) {
            window.toast("Couldn't take it down - try again.", "error", 3000);
          }
        });
      });
      top.appendChild(rm);
    }
    row.appendChild(top);

    if (theme.description) row.appendChild(el("p", "ct-row-desc", esc(theme.description)));

    var foot = el("div", "ct-row-foot");
    foot.appendChild(el("span", "ct-swatches")).appendChild(swatchRow(theme.colors));
    foot.appendChild(el("span", "ct-row-author", "by " + esc(theme.author || "Member")));
    var wear = el("button", "ct-btn ct-btn-wear", "Wear it");
    wear.type = "button";
    wear.addEventListener("click", function () {
      if (window.thwWearTheme) window.thwWearTheme(theme.slug);
    });
    foot.appendChild(wear);
    row.appendChild(foot);
    return row;
  }

  function refresh() {
    apiPost({ action: "memberThemes" }).then(function (r) {
      if (!r || !r.data || !r.data.ok) return;
      list = (r.data.themes || []).filter(function (t) { return t && t.slug; });
      syncMemberPickers();
      renderGallery();
      renderStats();
    }).catch(function () {});
  }

  function renderGallery() {
    if (!galleryEl) return;
    galleryEl.textContent = "";
    galleryEl.appendChild(el("h2", "ct-card-title", '<i class="fas fa-images"></i> The gallery'));
    galleryEl.appendChild(el("p", "ct-rule-note", "Every theme the community has submitted - newest first."));
    var back = backChip();
    if (back) galleryEl.appendChild(back);
    if (!list.length) {
      galleryEl.appendChild(el("p", "ct-empty", "No themes yet - yours could be the first."));
      return;
    }
    for (var i = 0; i < list.length; i++) galleryEl.appendChild(themeCard(list[i]));
  }

  /* The chip that takes a member back to whatever theme they were wearing
     before the latest wear. It only lives while that older theme is still a
     different one from what is on - running back is one click. */
  var prevEl = null;
  function backChip() {
    if (!window.thwPrevTheme) return null;
    var prev = window.thwPrevTheme();
    var cur = document.documentElement.getAttribute("data-theme") || "";
    if (!prev || prev === cur) {
      /* Nothing to go back to: take any chip off the page and forget it. */
      if (prevEl) { prevEl.remove(); prevEl = null; }
      return null;
    }
    var name = prev;
    var sel = document.getElementById("setTheme");
    var opt = sel && sel.querySelector('option[value="' + prev + '"]');
    if (opt) name = opt.textContent || prev;
    var chip = el("button", "ct-btn ct-btn-back",
      '<i class="fas fa-rotate-left"></i> Back to what you were wearing: <b>' + esc(name) + "</b>");
    chip.type = "button";
    prevEl = chip;
    chip.addEventListener("click", function () {
      if (window.thwWearTheme) window.thwWearTheme(prev);
      /* The chip now flaps the other way - take it off (the member is wearing
         what they put off, so there is nothing to go back to) and let the
         gallery stand until the next refresh. */
      if (prevEl) { prevEl.remove(); prevEl = null; }
    });
    return chip;
  }

  function renderStats() {
    apiPost({ action: "themeStats" }).then(function (r) {
      if (!statsEl || !r || !r.data || !r.data.ok) return;
      var themes = (r.data.themes || []).slice(0, 12);
      var total = 0;
      for (var i = 0; i < themes.length; i++) total += themes[i].count;
      var names = {};
      for (var k = 0; k < list.length; k++) names[list[k].slug] = list[k].name;
      statsEl.textContent = "";
      statsEl.appendChild(el("h2", "ct-card-title",
        '<i class="fas fa-chart-simple"></i> What the community wears'));
      statsEl.appendChild(el("p", "ct-rule-note", "Counts only - never who wears what."));
      var rows = el("div", "ct-stat-rows");
      if (!themes.length || !total) {
        statsEl.appendChild(el("p", "ct-empty", "No theme has been picked yet."));
      } else {
        for (var m = 0; m < themes.length; m++) {
          var t = themes[m];
          var pct = total ? Math.round((t.count / total) * 100) : 0;
          var line = el("div", "ct-stat-row");
          line.appendChild(el("span", "ct-stat-name", esc(names[t.theme] || t.theme)));
          var bar = el("span", "ct-stat-bar");
          var fill = el("i");
          fill.style.width = Math.max(2, pct) + "%";
          bar.appendChild(fill);
          line.appendChild(bar);
          line.appendChild(el("span", "ct-stat-pct", pct + "%"));
          rows.appendChild(line);
        }
        statsEl.appendChild(rows);
      }
    }).catch(function () {});
  }

  /* ---------------------------------------------------------- visibility */

  function watchVisibility() {
    /* The .active/.display mutations land on the section, not on the mount -
       deferred scripts run before account.js has the account answer, so the
       first build is whichever branch it guessed. Coming (or returning) to
       the page fires a section mutation: refill the gallery, and rebuild
       whenever what is on screen is not the branch the viewer should see. */
    if (typeof MutationObserver === "undefined" || !ROOT) return;
    if (ROOT.dataset.ctObserved) return; // a rebuild is still the same watcher
    ROOT.dataset.ctObserved = "1";
    var sec = document.getElementById("page-section-community-themes");
    if (!sec) return;
    var mo = new MutationObserver(function () {
      if (!sec.classList.contains("active")) return;
      if (ROOT.dataset.ctBuilt) {
        var signed = !!viewer().uid;
        var builtForm = !!document.getElementById("ct-name");
        var builtSignin = !!document.getElementById("ct-signin-btn");
        if ((signed && !builtForm) || (!signed && !builtSignin)) {
          ROOT.dataset.ctBuilt = "";
          ROOT.textContent = "";
          formEl = null;
          build();
        } else {
          /* Coming back to a built page: the member may have worn a different
             theme or another device may have changed the gallery - refill,
             which also re-decides the wear-back chip. */
          refresh();
        }
      }
    });
    mo.observe(sec, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function mountWhenReady() {
    ROOT = document.querySelector("#page-section-community-themes .ct-mount");
    if (!ROOT) return;
    build();
    watchVisibility();
    /* A theme switch (picker, seasonal row, gallery Wear) can land any time -
       the wear-back chip follows the current pair of "what I put off" and
       "what is on", so re-render the gallery when it changes. */
    document.addEventListener("thw-theme-change", function () {
      if (ROOT && ROOT.dataset.ctBuilt) renderGallery();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWhenReady);
  } else {
    mountWhenReady();
  }
})();
