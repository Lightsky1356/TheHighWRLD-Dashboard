(function () {
  "use strict";

  if (window.__thwSocialMounted) return;
  window.__thwSocialMounted = true;

  var API = "/api/social";
  var state = {
    open: false,
    tab: "friends",
    boot: null,
    searchTimer: null,
    searchText: "",
    conversation: null,
    messages: [],
    olderCursor: 0,
    hasOlder: false,
    blocked: false,
    typingStarted: false,
    /* The timestamps of the typing events sent for this conversation, so
       the limit can be counted without asking the server. */
    typingStamps: [],
    typingRefresh: null,
    replyTo: null,
    typingTimer: null,
    refreshTimer: null,
    focusBeforeOpen: null,
    rulesOpen: false,
    /* Whether the message menu is open, and whether the grammar check is
       showing. Both are closed when the panel closes and when the thread is
       re-rendered. */
    menuOpen: false,
    grammarOpen: false,
    /* Whether the new-group dialog is open, and who said what in the open
       thread (a group has to name its senders; a one-to-one already knows). */
    groupOpen: false,
    senders: {},
    /* Whether the friends list is folded away. Desktop only - see the toggle. */
    friendsCollapsed: false,
    /* Which list was open before the Settings button took over the panel, so
       closing Settings returns there instead of always landing on Friends. */
    tabBeforeSettings: null,
    /* Whether the panel is currently holding the page scroll lock. Tracked
       separately from the lock count so a resize can re-evaluate it without
       guessing how many holds are outstanding. */
    panelScrollLocked: false,
    /* Retry state. The "Reconnecting…" notice made a promise the panel did not
       keep: refresh() was only ever triggered by realtime events, so a failure
       during a quiet websocket left the notice up indefinitely with nothing
       behind it. These drive a bounded backoff so the notice is true. */
    retryTimer: null,
    retryDelay: 1000,
    lastSyncAt: 0,
    searching: false,
    recentSearches: []
  };

  /* One empty state for the whole panel. These three places used to be bare
     lines of grey text floating in a large void, which read as "broken" rather
     than "nothing here yet". An icon, a heading and a line of guidance gives
     each tab a reason to exist even when it has nothing in it. */
  function emptyState(icon, title, text) {
    var wrap = el("div", "thw-social-empty");
    var glyph = el("span", "thw-social-empty-icon");
    glyph.innerHTML = '<i class="fas ' + icon + '" aria-hidden="true"></i>';
    wrap.appendChild(glyph);
    if (title) wrap.appendChild(el("strong", "thw-social-empty-title", title));
    if (text) wrap.appendChild(el("span", "thw-social-empty-text", text));
    return wrap;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function api(path, options) {
    options = options || {};
    var headers = options.body ? { "Content-Type": "application/json" } : {};
    return fetch(API + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.message || data.error || "Social request failed");
          error.status = response.status;
          error.code = data.error || "";
          throw error;
        }
        return data;
      });
    });
  }

  /* A failure used to surface its raw message, so the panel showed strings like
     "Social request failed" or "Failed to fetch" - technical noise that says
     nothing about whether to retry, to sign in, or to wait. Map it onto
     something a person can act on, and never fall back to the original text. */
  function describeError(error) {
    var status = error && error.status;
    if (status === 401) return "Sign in to use Friends & Messages.";
    if (status === 403) return "You do not have permission to do that.";
    if (status === 404) return "That is no longer available.";
    if (status === 409) return "That no longer matches what is saved. Try again.";
    if (status === 429) return "Too many requests. Wait a moment and try again.";
    if (status >= 500) return "The server had a problem. Try again shortly.";
    /* fetch() rejects with a TypeError when the request never reached the server
       at all - dropped connection, offline, DNS failure. There is no status to
       read here, and this is the case that used to print "Failed to fetch". */
    if (error instanceof TypeError) return "No connection. Check your network and try again.";
    return "Something went wrong. Try again.";
  }

  /* kind is "error" when something failed, "warn" for a soft notice such as
     reconnecting, and empty for a neutral confirmation. */
  function showStatus(message, kind) {
    var status = document.getElementById("thw-social-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", kind === "error" || kind === true);
    status.classList.toggle("is-warn", kind === "warn");
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(function (s) {
      return s.charAt(0);
    }).join("").toUpperCase() || "?";
  }

  function avatarNode(user, size) {
    var box = el("span", "thw-social-avatar");
    if (size) box.style.width = size + "px", box.style.height = size + "px";
    var src = String((user && user.avatar) || "");
    if (src && (/^https?:\/\//i.test(src) || src.charAt(0) === "/")) {
      var image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = src;
      image.className = "thw-social-avatar";
      image.onerror = function () {
        var fallback = el("span", "thw-social-avatar", initials(user && user.name));
        image.replaceWith(fallback);
      };
      return image;
    }
    box.textContent = initials(user && user.name);
    return box;
  }

  function button(label, action, className, data) {
    var node = el("button", "thw-social-action" + (className ? " " + className : ""), label);
    node.type = "button";
    node.dataset.action = action;
    Object.keys(data || {}).forEach(function (key) { node.dataset[key] = String(data[key]); });
    return node;
  }

  function mount() {
    if (!document.body || document.getElementById("thw-social-root")) return;
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/social.css?v=thw-v34";
    document.head.appendChild(css);

    var root = el("div");
    root.id = "thw-social-root";
    root.innerHTML =
      '<button id="thw-social-fab" type="button" aria-label="Open Friends and Messages" aria-haspopup="dialog" aria-expanded="false" title="Friends & Messages">' +
        '<i class="fas fa-comments" aria-hidden="true"></i><span id="thw-social-badge" hidden></span>' +
      '</button>' +
      '<div id="thw-social-overlay" hidden>' +
        '<div id="thw-social-wash" aria-hidden="true"></div>' +
        '<section id="thw-social-panel" role="dialog" aria-modal="true" aria-labelledby="thw-social-title">' +
          '<header class="thw-social-head"><div><h2 class="thw-social-title" id="thw-social-title">Friends &amp; Messages</h2><p class="thw-social-subtitle">Your community, wherever you are</p></div>' +
            '<span class="thw-social-head-actions">' +
            '<button class="thw-social-rules-link" id="thw-social-rules-link" type="button" aria-haspopup="dialog" title="House rules"><i class="fas fa-shield-halved" aria-hidden="true"></i><span>Rules</span></button>' +
            '<button class="thw-social-settings-link" id="thw-social-settings-link" type="button" aria-controls="thw-social-settings-view" aria-pressed="false" title="Friends &amp; Messaging settings"><i class="fas fa-gear" aria-hidden="true"></i><span>Settings</span></button>' +
            '<button class="thw-social-expand" id="thw-social-expand" data-action="toggle-panel-size" type="button" aria-pressed="false" aria-controls="thw-social-panel" title="Make the panel bigger"><i class="fas fa-expand" aria-hidden="true"></i></button>' +
            '<button class="thw-social-close" id="thw-social-close" type="button" aria-label="Close Friends and Messages"><i class="fas fa-xmark" aria-hidden="true"></i></button></span></header>' +
          '<nav class="thw-social-tabs" role="tablist" aria-label="Social sections">' +
            '<button class="thw-social-tab" type="button" role="tab" data-tab="friends" aria-selected="true">Friends</button>' +
            '<button class="thw-social-tab" type="button" role="tab" data-tab="messages" aria-selected="false">Messages <span class="thw-social-tab-count" id="thw-social-message-count"></span></button>' +
            '<button class="thw-social-tab" type="button" role="tab" data-tab="requests" aria-selected="false">Requests <span class="thw-social-tab-count" id="thw-social-request-count"></span></button>' +
            /* There is no activity tab. What a friend is up to is said on
               their own row, next to whether they are here - a feed of posts
               was a second place to learn the same thing. */
          '</nav>' +
          '<div class="thw-social-status" id="thw-social-status" role="status" aria-live="polite"></div>' +
          '<div class="thw-social-freshness" id="thw-social-freshness" aria-live="off"></div>' +
          '<section class="thw-social-view active" data-view="friends" role="tabpanel">' +
            '<div class="thw-social-search"><label class="sr-only" for="thw-social-search">Search members</label><input id="thw-social-search" type="search" autocomplete="off" placeholder="Find people by name">' +
              '<button class="thw-social-search-clear" data-action="clear-search" type="button" aria-label="Clear search" hidden><i class="fas fa-xmark" aria-hidden="true"></i></button></div>' +
            '<div class="thw-social-search-meta" id="thw-social-search-meta" aria-live="polite"></div>' +
            '<div class="thw-social-list" id="thw-social-search-results" aria-live="polite"></div>' +
            '<div class="thw-social-section-label thw-social-friends-head">' +
              '<span>Your friends</span>' +
              '<span class="thw-social-friends-head-actions">' +
              '<button class="thw-social-new-group" type="button" data-action="new-group" title="Start a group chat"><i class="fas fa-users" aria-hidden="true"></i><span>New group</span></button>' +
              '<button class="thw-social-friends-toggle" type="button" data-action="toggle-friends" aria-expanded="true" aria-controls="thw-social-friends" title="Collapse the friends list">' +
                '<i class="fas fa-chevron-up" aria-hidden="true"></i></button>' +
              '</span>' +
            '</div><div class="thw-social-list" id="thw-social-friends"></div>' +
          '</section>' +
          '<section class="thw-social-view" data-view="messages" role="tabpanel">' +
            '<div class="thw-social-messages"><div class="thw-social-convos" id="thw-social-conversations" aria-label="Conversations"></div>' +
              '<div class="thw-social-thread"><header class="thw-social-thread-head" id="thw-social-thread-head"></header>' +
                '<div class="thw-social-thread-body" id="thw-social-thread-body"><div class="thw-social-thread-placeholder"><span class="thw-social-empty-icon"><i class="fas fa-comment-dots" aria-hidden="true"></i></span><strong class="thw-social-empty-title">No conversation open</strong><span class="thw-social-empty-text">Pick someone from your friends to start messaging.</span></div></div>' +
                '<div class="thw-social-typing" id="thw-social-typing" aria-live="polite"></div>' +
                '<div class="thw-social-replying" id="thw-social-replying"><span id="thw-social-reply-label"></span><button id="thw-social-reply-cancel" type="button" aria-label="Cancel reply">Cancel</button></div>' +
                '<form class="thw-social-composer" id="thw-social-composer"><label class="sr-only" for="thw-social-input">Write a message</label><textarea id="thw-social-input" maxlength="2000" rows="1" placeholder="Write a message" disabled></textarea><span class="thw-social-counter" id="thw-social-counter" aria-live="off"></span><button class="thw-social-send" id="thw-social-send" type="submit" disabled>Send</button></form>' +
              '</div></div>' +
          '</section>' +
          '<section class="thw-social-view" data-view="requests" role="tabpanel"><div class="thw-social-list" id="thw-social-requests"></div></section>' +
          '<section class="thw-social-view" data-view="settings" id="thw-social-settings-view" role="tabpanel"><div id="thw-social-settings-mount"></div></section>' +
        '</section>' +
      '</div>' +
      '<div class="thw-social-rules" id="thw-social-rules" role="dialog" aria-modal="true" aria-labelledby="thw-social-rules-title" hidden>' +
        '<div class="thw-social-rules-card">' +
          '<header class="thw-social-rules-head"><h3 class="thw-social-rules-title" id="thw-social-rules-title">Friends &amp; Messages rules</h3>' +
            '<button class="thw-social-rules-close" type="button" aria-label="Close rules"><i class="fas fa-xmark" aria-hidden="true"></i></button></header>' +
          '<div class="thw-social-rules-body"></div>' +
        '</div>' +
      '</div>' +
      /* A new group chat: a name, and the friends to put in it. It sits over
         the panel the way Rules does, and it closes the same three ways. */
      '<div class="thw-social-group" id="thw-social-group" role="dialog" aria-modal="true" aria-labelledby="thw-social-group-title" hidden>' +
        '<div class="thw-social-group-card">' +
          '<header class="thw-social-group-head"><h3 class="thw-social-group-title" id="thw-social-group-title">New group chat</h3>' +
            '<button class="thw-social-group-close" type="button" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></button></header>' +
          '<form class="thw-social-group-form" id="thw-social-group-form">' +
            '<label class="thw-social-group-label" for="thw-social-group-name">Name</label>' +
            '<input class="thw-social-group-name" id="thw-social-group-name" type="text" maxlength="40" autocomplete="off" placeholder="Name this group">' +
            '<span class="thw-social-group-label">People</span>' +
            '<div class="thw-social-group-people" id="thw-social-group-people"></div>' +
            '<div class="thw-social-group-foot">' +
              '<span class="thw-social-group-hint" id="thw-social-group-hint">Pick the people to put in it.</span>' +
              '<button class="thw-social-group-create" id="thw-social-group-create" type="submit" disabled>Create group</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    loadFriendsCollapse();
    applyFriendsCollapse();
    loadPanelSize();
    applyPanelSize();
    document.getElementById("thw-social-fab").addEventListener("click", function () { setOpen(!state.open); });
    document.getElementById("thw-social-close").addEventListener("click", function () { setOpen(false); });
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    /* Right-clicking a message opens its menu.
     *
     * This is the way the menu is meant to be reached, and it is why the
     * inline row of buttons went: seven buttons under every message made the
     * thread unreadable, and the menu holds all of them in one place.
     *
     * The browser's own menu is suppressed on a message, because it would
     * offer "copy" for the text of the message and nothing else useful. */
    root.addEventListener("contextmenu", function (event) {
      var bubble = event.target.closest && event.target.closest(".thw-social-message");
      if (!bubble) return;
      var id = bubble.dataset.messageId;
      var target = state.messages.find(function (m) { return String(m.id) === String(id); });
      if (!target || target.deleted) return;
      event.preventDefault();
      closeGrammarResult();
      openMessageMenu(target, event.clientX, event.clientY);
    });
    /* A click anywhere else closes the menu. It is a capture-phase listener on
       the document, so a click inside the menu does not close it before the
       menu's own button has been acted on. */
    document.addEventListener("click", function (event) {
      if (!state.menuOpen) return;
      var menu = document.getElementById("thw-social-menu");
      if (menu && event.target && menu.contains(event.target)) return;
      closeMessageMenu();
    }, true);
    document.getElementById("thw-social-composer").addEventListener("submit", sendMessage);
    document.getElementById("thw-social-reply-cancel").addEventListener("click", clearReply);
    document.getElementById("thw-social-rules-link").addEventListener("click", openRules);
    document.getElementById("thw-social-settings-link").addEventListener("click", toggleSettings);
    document.getElementById("thw-social-rules").addEventListener("click", function (event) {
      /* Backdrop click closes; clicks inside the card must not. */
      if (event.target === event.currentTarget) closeRules();
    });
    document.querySelector(".thw-social-rules-close").addEventListener("click", closeRules);
    document.getElementById("thw-social-group").addEventListener("click", function (event) {
      /* Backdrop click closes; clicks inside the card must not. */
      if (event.target === event.currentTarget) closeGroupDialog();
    });
    document.querySelector(".thw-social-group-close").addEventListener("click", closeGroupDialog);
    document.getElementById("thw-social-group-form").addEventListener("submit", createGroup);
    /* The count of picked people, and whether that is enough, follow the
       checkboxes rather than being decided when the form is sent. */
    document.getElementById("thw-social-group-people").addEventListener("change", syncGroupCount);
    document.addEventListener("keydown", function (event) {
      if (!state.open) return;
      /* The rules dialog sits above the panel, so Escape unwinds one level at a
         time rather than closing both at once. */
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.rulesOpen) closeRules();
        else if (state.groupOpen) closeGroupDialog();
        else if (state.grammarOpen) closeGrammarResult();
        else if (state.menuOpen) closeMessageMenu();
        else setOpen(false);
        return;
      }
      /* Keep Tab inside the dialog while the panel is modal. On a phone the page
         behind is inert, so letting focus walk out would strand a keyboard user
         on targets that answer nothing. On desktop the panel is a side sheet and
         the nav and player behind it are live - a loop that will not release
         focus is then a cage, and the user cannot Tab to the WRLD Player at all.
         Focus still returns to the trigger on close, and Escape always works. */
      if (event.key !== "Tab" || !panelIsModal()) return;
      var panel = document.getElementById("thw-social-panel");
      if (!panel) return;
      var focusable = panel.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])');
      var visible = Array.prototype.filter.call(focusable, function (node) {
        return node.offsetParent !== null || node === document.activeElement;
      });
      if (!visible.length) return;
      var first = visible[0];
      var last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    });
    window.addEventListener("thw:social", onRealtime);
    window.addEventListener("thw:notification", scheduleRefresh);
    window.addEventListener("thw:presence", function () { if (state.open) scheduleRefresh(); });
    /* The backoff alone can leave a gap of up to 30s at the end of a long
       outage, so a reconnecting browser retries immediately instead. */
    window.addEventListener("online", function () {
      if (!state.open) return;
      clearRetry();
      refresh();
    });
    window.addEventListener("offline", function () {
      if (state.open) showRetryStatus("You are offline.");
    });
    /* Leaving and returning to the tab is a common moment for a stale panel to
       be caught, so re-sync on the way back rather than trusting old data. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && state.open) { clearRetry(); refresh(); }
    });
    mountPrivacySettings();
    loadRecentSearches();
  }

  /* ---------------------------------------------------------- scroll lock */
  /* Two things can want the page frozen at once: the House Rules dialog (on
     every screen) and the panel itself on a phone, where it covers the whole
     viewport. The count means closing one does not unlock the page out from
     under the other - opening Rules from inside a panel-open phone holds two,
     and closing Rules leaves the panel's own hold intact.

     This deliberately does NOT reuse the site-wide "scroll-locked" class.
     reports.js, suggestions.js, account.js and user-menu.js all add and remove
     that one directly, so any of them running while this lock is held would
     silently drop it and let the page scroll again. */
  var scrollLocks = 0;

  function lockScroll() {
    scrollLocks++;
    if (scrollLocks === 1) {
      document.documentElement.classList.add("thw-social-scrolllock");
    }
  }

  function unlockScroll() {
    if (scrollLocks <= 0) return;
    scrollLocks--;
    if (scrollLocks === 0) {
      document.documentElement.classList.remove("thw-social-scrolllock");
    }
  }

  /* The panel covers the whole viewport on a phone, and only there. 680px is
     the width social.css uses to switch it to full-screen.

     Everything that treats the panel as modal hangs off this one width: the
     scroll lock, the inert background, the Tab loop and aria-modal. On desktop
     the panel is a side sheet beside the content, so taking the page behind it
     away is not a modal at all - it just stops the nav and the WRLD Player from
     working while the panel is open, which is what was happening. Every link in
     the nav and every control on the player was inert: clicks landed nowhere. */
  function panelIsModal() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  /* The panel only freezes the page where the panel is actually covering it. */
  function panelLocksScroll() {
    return panelIsModal();
  }

  /* Keeps the panel's hold in step with the panel across a resize or rotation,
     so crossing the breakpoint neither strands a lock nor misses one. */
  function syncPanelScrollLock() {
    var want = !!state.open && panelLocksScroll();
    if (want === state.panelScrollLocked) return;
    state.panelScrollLocked = want;
    if (want) lockScroll();
    else unlockScroll();
  }

  /* Rotating a phone or dragging a window across 680px changes whether the panel
     should be holding the page still. Re-check rather than locking on open and
     leaving a stranded hold behind.

     The same crossing decides whether the background is inert and whether the
     Community menu has room beside the panel, so all three settle here - a
     rotation to landscape must not strand an inert <main> on a wide window. */
  window.addEventListener("resize", function () {
    syncPanelScrollLock();
    syncPanelModality();
    syncCommMenuClearance();
  });

  /* Make the rest of the document inert while the panel is covering it.
   *
   * aria-modal="true" is only honest if the background really is
   * unavailable. The `inert` attribute does that in one step: it removes the
   * subtree from the tab order and the accessibility tree and blocks pointer
   * interaction, which a manual aria-hidden sweep would not do.
   *
   * Only where the panel is modal. On desktop the panel sits beside the page,
   * so <nav> and <main> have to stay live: they are what the user opened the
   * panel alongside, and inerting them is what made the nav and the WRLD Player
   * dead to every click while it was open. Nothing behind an open side sheet is
   * hidden, so nothing behind it may be taken away.
   *
   * Only direct children of <body> are marked, and the panel's own root is
   * skipped so the panel never inerting itself. Iterates a copy because
   * removeAttribute during iteration would otherwise skip an element. */
  function setBackgroundInert(on) {
    var root = document.getElementById("thw-social-root");
    if (!root) return;
    var kids = Array.prototype.slice.call(document.body.children);
    kids.forEach(function (el) {
      if (el === root || root.contains(el)) return;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  /* Everything that depends on the panel being modal, settled in one place, so
     opening, closing and crossing 680px all resolve it the same way. aria-modal
     is set from here rather than fixed in the markup because it describes a
     moment: true over a background that is genuinely unavailable, false over a
     background the reader is welcome to walk into. */
  function syncPanelModality() {
    var modal = !!state.open && panelIsModal();
    setBackgroundInert(modal);
    var panel = document.getElementById("thw-social-panel");
    if (panel) panel.setAttribute("aria-modal", modal ? "true" : "false");
  }

  /* The Community menu drops out of the middle of the nav; the panel is a sheet
     on the right of the window. How much of them collide depends on both
     widths, so it is not a decision one rule can make: at 1904px they are 280px
     apart, at 1440px 51px apart, and at 1280px they cross by 29. Hiding the
     menu outright, as this used to, took the whole nav dropdown away every time
     the panel was open in order to dodge a collision that only happens in some
     windows.

     So it is shifted instead - by exactly the distance that clears the panel -
     which keeps it working at every desktop width. Only horizontal position is
     touched: the menu keeps its layout, its hover and focus behaviour, and the
     shift is dropped the moment the panel closes. */
  function syncCommMenuClearance() {
    var menu = document.querySelector(".nav-comm-menu");
    if (!menu) return;
    var panel = document.getElementById("thw-social-panel");
    var shift = 0;
    if (state.open && panel && !panelIsModal()) {
      /* Measured while the menu is still hidden: visibility:hidden keeps it in
         layout, so this rect is the real one and nothing has to flash open to
         be measured. 12px is the gutter it gets to keep beside the panel. */
      var m = menu.getBoundingClientRect();
      var p = panel.getBoundingClientRect();
      if (m.width && p.width) {
        shift = m.right - (p.left - 12);
        if (shift < 0) shift = 0;
        /* Never slide it off the left edge to make room - a menu that is half
           under the panel beats one that is half off the screen. */
        if (shift > 0 && m.left - shift < 8) shift = Math.max(0, m.left - 8);
      }
    }
    menu.style.marginLeft = shift ? -Math.round(shift) + "px" : "";
  }

  function setOpen(open) {
    var overlay = document.getElementById("thw-social-overlay");
    var fab = document.getElementById("thw-social-fab");
    if (!overlay || !fab) return;
    if (open && !state.open) state.focusBeforeOpen = document.activeElement;
    state.open = !!open;
    overlay.hidden = !state.open;
    syncPanelModality();
    syncCommMenuClearance();
    fab.setAttribute("aria-expanded", state.open ? "true" : "false");
    /* Rules lives inside this panel, so closing the panel closes Rules with it.
       closeRules() drops its own lock hold; without this the count would be left
       one too high and the page would stay frozen after the panel is gone. */
    if (!state.open && state.rulesOpen) closeRules();
    if (!state.open && state.groupOpen) closeGroupDialog();
    if (state.open) {
      /* A Community menu left hovering would sit straight over the panel the
         moment focus moved into it, so it is closed once on open. It is not
         blocked after that on desktop: it reopens shifted clear of the panel
         (syncCommMenuClearance), so closing here costs nothing. */
      if (typeof closeCommMenu === "function") { try { closeCommMenu(); } catch (e) {} }
      refresh();
      document.getElementById("thw-social-close").focus();
      /* On a phone the on-screen keyboard shrinks the viewport, which used to
         cover the composer and leave no way to type. The viewport inset is the
         height actually left over, so the panel is pinned to that instead. */
      document.documentElement.classList.add("thw-social-open");
    } else {
      document.documentElement.classList.remove("thw-social-open");
      if (state.focusBeforeOpen && state.focusBeforeOpen.focus) {
        state.focusBeforeOpen.focus();
      }
    }
    /* Applied last: it reads the settled state.open and the current width, so
       opening and closing both stay correct in one place. */
    syncPanelScrollLock();
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll("#thw-social-root [data-tab]").forEach(function (node) {
      node.setAttribute("aria-selected", node.dataset.tab === tab ? "true" : "false");
    });
    document.querySelectorAll("#thw-social-root [data-view]").forEach(function (node) {
      node.classList.toggle("active", node.dataset.view === tab);
    });
    /* Settings are fetched when the panel is opened rather than at mount:
       signed out, /settings returns 401 and the card says so, and there is no
       reason to ask on every panel open. Re-asking on each visit keeps the
       selects honest if they were changed in another tab. */
    if (tab === "settings") loadPrivacySettings();
  }

  /* A group has no face of its own, so it gets the same box everybody else
     has, with the people glyph in it instead of initials. */
  function groupAvatarNode(conversation, size) {
    var box = el("span", "thw-social-avatar thw-social-avatar--group");
    if (size) box.style.width = size + "px", box.style.height = size + "px";
    box.innerHTML = '<i class="fas fa-users" aria-hidden="true"></i>';
    var count = Number(conversation && conversation.memberCount) || 0;
    box.title = count ? count + " people" : "Group chat";
    return box;
  }

  /* The new group chat.
   *
   * The list is the friends list - the people who can already be messaged -
     so there is nothing to search for and no way to add somebody who has not
     chosen to be reachable. */
  function openGroupDialog() {
    var dialog = document.getElementById("thw-social-group");
    if (!dialog) return;
    var nameField = document.getElementById("thw-social-group-name");
    if (nameField) nameField.value = "";
    var people = document.getElementById("thw-social-group-people");
    var friends = (state.boot && state.boot.friends) || [];
    if (people) {
      people.replaceChildren();
      if (!friends.length) {
        people.appendChild(el("div", "thw-social-empty",
          "Add some friends first - a group is made from the people you already talk to."));
      }
      friends.forEach(function (friend) {
        var label = el("label", "thw-social-group-person");
        var box = document.createElement("input");
        box.type = "checkbox";
        box.className = "thw-social-group-check";
        box.value = friend.uid;
        label.appendChild(box);
        var face = el("span", "thw-social-face");
        face.appendChild(avatarNode(friend, 26));
        label.appendChild(face);
        label.appendChild(el("span", "thw-social-name", friend.name));
        people.appendChild(label);
      });
    }
    state.groupOpen = true;
    dialog.hidden = false;
    syncGroupCount();
    if (nameField) nameField.focus();
  }

  function closeGroupDialog() {
    var dialog = document.getElementById("thw-social-group");
    state.groupOpen = false;
    if (dialog) dialog.hidden = true;
  }

  function pickedGroupMembers() {
    return Array.prototype.map.call(
      document.querySelectorAll("#thw-social-group-people input[type=checkbox]:checked"),
      function (box) { return box.value; }
    );
  }

  /* How many are picked, and whether that is enough to make one. A group of
     one other person is still a group - it has a name, and it is a different
     conversation from the one-to-one - so one is enough. */
  function syncGroupCount() {
    var picked = pickedGroupMembers();
    var hint = document.getElementById("thw-social-group-hint");
    if (hint) hint.textContent = picked.length ? picked.length + (picked.length === 1 ? " person picked" : " people picked") : "Pick the people to put in it.";
    var create = document.getElementById("thw-social-group-create");
    if (create) create.disabled = !picked.length;
  }

  function createGroup(event) {
    event.preventDefault();
    var nameField = document.getElementById("thw-social-group-name");
    var title = ((nameField && nameField.value) || "").trim();
    var uids = pickedGroupMembers();
    if (!title) { showStatus("Give the group a name.", "warn"); if (nameField) nameField.focus(); return; }
    if (!uids.length) { showStatus("Pick at least one person for the group.", "warn"); return; }
    var create = document.getElementById("thw-social-group-create");
    if (create) create.disabled = true;
    api("/conversations", { method: "POST", body: { title: title, uids: uids } }).then(function (data) {
      closeGroupDialog();
      openConversation({
        id: data.conversationId,
        kind: "group",
        uid: "",
        name: data.title || title,
        avatar: "",
        memberCount: (data.members || []).length || (uids.length + 1),
      });
      showStatus("Group created.");
      /* The list has to show it for everyone else too, and the server is the
         one that knows it exists. */
      refresh();
    }).catch(function (error) {
      showStatus(describeError(error), "error");
      if (create) create.disabled = false;
    });
  }

  /* Who said it. A one-to-one already knows: the thread is named after the
     one other person. A group has to say which of its people wrote each
     line, and that name comes back with the messages. */
  function senderName(message) {
    if (!state.conversation) return "Member";
    if (state.conversation.kind !== "group") return state.conversation.name || "Member";
    var uid = message && message.senderUid;
    return (state.senders && state.senders[uid]) || "Member";
  }

  /* Settings sits beside Rules as a header button rather than a fourth tab.
     It reads as a control for the whole panel, not as another place to look for
     people, and it keeps the tab bar to the three lists it has always held.

     Toggles: opening it swaps the view, pressing again returns to whichever
     list was open before, so the button never traps you on a settings page. */
  function toggleSettings() {
    var btn = document.getElementById("thw-social-settings-link");
    var view = document.getElementById("thw-social-settings-view");
    if (!btn || !view) return;
    var opening = !view.classList.contains("active");
    if (opening) {
      /* Remember the list so closing settings lands back where it was. */
      if (state.tab !== "settings") state.tabBeforeSettings = state.tab;
      setTab("settings");
    } else {
      setTab(state.tabBeforeSettings && state.tabBeforeSettings !== "settings" ? state.tabBeforeSettings : "friends");
    }
    btn.setAttribute("aria-pressed", opening ? "true" : "false");
    btn.classList.toggle("is-active", opening);
  }

  /* Pressing a real tab takes you away from settings, so the header button has
     to stop claiming it is still pressed. */
  function syncSettingsButton() {
    var btn = document.getElementById("thw-social-settings-link");
    var view = document.getElementById("thw-social-settings-view");
    if (!btn || !view) return;
    var on = view.classList.contains("active");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("is-active", on);
  }

  function onClick(event) {
    var tab = event.target.closest("[data-tab]");
    if (tab) {
      setTab(tab.dataset.tab);
      syncSettingsButton();
      return;
    }
    var convo = event.target.closest("[data-conversation-id]");
    if (convo) {
      var item = (state.boot && state.boot.conversations || []).find(function (c) { return c.id === convo.dataset.conversationId; });
      if (item) openConversation(item);
      return;
    }
    var action = event.target.closest("[data-action]");
    if (!action || action.disabled) return;
    event.preventDefault();
    runAction(action);
  }

  function onInput(event) {
    if (event.target.id === "thw-social-search") {
      state.searchText = event.target.value.trim();
      clearTimeout(state.searchTimer);
      if (state.searchText.length < 2) {
        renderSearchResults([]);
        updateSearchMeta();
        return;
      }
      var query = state.searchText;
      state.searchTimer = setTimeout(function () { search(query); }, 280);
      updateSearchMeta();
      var clearBtn = document.querySelector("#thw-social-root [data-action='clear-search']");
      if (clearBtn) clearBtn.hidden = event.target.value.length === 0;
    } else if (event.target.id === "thw-social-input") {
      scheduleTyping();
      /* Only warn as the hard 2000 limit approaches, so the counter is
         informative rather than permanently in the way. */
      var counter = document.getElementById("thw-social-counter");
      if (counter) {
        var left = 2000 - event.target.value.length;
        counter.textContent = left <= 200 ? String(left) : "";
        counter.classList.toggle("warn", left <= 200);
      }
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refresh, 300);
  }

  function onRealtime(event) {
    var msg = event.detail || {};
    if (msg.type === "social:typing") {
      if (state.conversation && state.conversation.id === msg.conversationId && msg.user?.uid !== (state.boot?.me?.uid || "")) {
        var typing = document.getElementById("thw-social-typing");
        typing.textContent = msg.typing ? ((msg.user && msg.user.name || "Someone") + " is typing…") : "";
        clearTimeout(state.typingTimer);
        /* It goes away on its own. Somebody who closes the tab in the middle
           of a word would otherwise leave "is typing…" on the other end for
           good, because the event that clears it was never sent. */
        if (msg.typing) state.typingTimer = setTimeout(function () { typing.textContent = ""; }, 6000);
      }
      return;
    }
    if (msg.type === "social:message") {
      if (state.open && state.conversation && state.conversation.id === msg.conversationId) {
        loadMessages(false, true);
      } else {
        scheduleRefresh();
      }
      return;
    }
    scheduleRefresh();
  }

  /* Bounded exponential backoff. Doubles from 1s and stops at 30s so a long
     outage does not turn into a request every few hundred milliseconds, and the
     notice is cleared the moment a refresh succeeds. */
  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    if (!state.open) return;
    var wait = state.retryDelay;
    state.retryDelay = Math.min(state.retryDelay * 2, 30000);
    state.retryTimer = setTimeout(function () { refresh(); }, wait);
  }

  function clearRetry() {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
    state.retryDelay = 1000;
  }

  /* The notice carries its own Retry so nobody has to wait out the backoff. */
  function showRetryStatus(message) {
    var status = document.getElementById("thw-social-status");
    if (!status) return;
    status.replaceChildren();
    status.classList.remove("is-error");
    status.classList.add("is-warn");
    status.appendChild(el("span", "", message + " "));
    var retry = el("button", "thw-social-retry", "Retry");
    retry.type = "button";
    retry.dataset.action = "retry";
    status.appendChild(retry);
  }

  function refresh() {
    return api("/bootstrap").then(function (data) {
      state.boot = data;
      state.lastSyncAt = Date.now();
      clearRetry();
      showStatus(data.presenceAvailable === false ? "Live status is temporarily unavailable." : "", "warn");
      renderFriends(data.friends || []);
      renderRequests(data.requests || []);
      renderConversations(data.conversations || []);
      updateBadge(data.counts || {});
      updateFreshness();
    }).catch(function (error) {
      /* Deliberately leave the lists alone. They used to be reset to empty,
         which made one dropped connection look exactly like having no friends
         at all - the panel would confidently say "No friends yet" while the
         data was merely unfetched, and the user could not tell the difference
         between a fact and a failure. Keep the last good render and say we are
         reconnecting; the next successful refresh puts everything back. */
      if (error && error.status === 401) { state.boot = null; showStatus(""); renderSignedOut(); return; }
      if (state.boot) { showRetryStatus("Reconnecting…"); scheduleRetry(); }
      else showStatus(describeError(error), "error");
    });
  }

  /* "Updated 2m ago" so stale data never quietly passes for current. */
  function updateFreshness() {
    var node = document.getElementById("thw-social-freshness");
    if (!node) return;
    if (!state.lastSyncAt) { node.textContent = ""; return; }
    node.textContent = "Updated " + relativeTime(new Date(state.lastSyncAt).toISOString());
  }

  function updateBadge(counts) {
    var count = (Number(counts.messages) || 0) + (Number(counts.requests) || 0);
    var badge = document.getElementById("thw-social-badge");
    if (!badge) return;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    badge.setAttribute("aria-label", count + " unread messages or requests");
    var messageCount = document.getElementById("thw-social-message-count");
    var requestCount = document.getElementById("thw-social-request-count");
    if (messageCount) messageCount.textContent = counts.messages ? "(" + counts.messages + ")" : "";
    if (requestCount) requestCount.textContent = counts.requests ? "(" + counts.requests + ")" : "";
  }

  /* A guest is the most common state this panel is in, so it gets a designed
     state rather than an error string over empty lists. Replaces every list in
     the panel and clears the freshness stamp, so nothing reads as stale data. */
  function renderSignedOut() {
    var friends = document.getElementById("thw-social-friends");
    var requests = document.getElementById("thw-social-requests");
    var convos = document.getElementById("thw-social-conversations");
    [friends, requests, convos].forEach(function (node) {
      if (node) node.replaceChildren();
    });
    var freshness = document.getElementById("thw-social-freshness");
    if (freshness) freshness.textContent = "";
    var badge = document.getElementById("thw-social-badge");
    if (badge) badge.hidden = true;
    if (!friends) return;

    var hero = el("div", "thw-social-gate");
    var icon = el("span", "thw-social-gate-icon");
    icon.innerHTML = '<i class="fas fa-user-friends" aria-hidden="true"></i>';
    hero.appendChild(icon);
    hero.appendChild(el("h3", "thw-social-gate-title", "Sign in to connect"));
    hero.appendChild(el("p", "thw-social-gate-text",
      "Link your account to add friends, send messages, and see who is around."));
    var cta = el("button", "thw-social-gate-btn", "Sign in");
    cta.type = "button";
    cta.addEventListener("click", function () {
      /* showAuthPage is the site's real sign-in entry point; the others are
         fallbacks for older builds where it may not be loaded yet. */
      if (typeof showAuthPage === "function") { try { showAuthPage("login"); return; } catch (e) {} }
      if (typeof authGateSignIn === "function") { try { authGateSignIn(); } catch (e) {} }
    });
    hero.appendChild(cta);
    friends.appendChild(hero);

    /* Requests and Messages get a compact note rather than the full hero. The
       full gate would be repeated three times over, and "No pending requests"
       would be a lie - it implies you have none, rather than that you cannot
       see them until you sign in. */
    if (requests) {
      var req = el("div", "thw-social-gate thw-social-gate--compact");
      req.appendChild(el("p", "thw-social-gate-text", "Sign in to see friend requests."));
      requests.appendChild(req);
    }
    if (convos) {
      var convo = el("div", "thw-social-gate thw-social-gate--compact");
      convo.appendChild(el("p", "thw-social-gate-text", "Sign in to see your conversations."));
      convos.appendChild(convo);
    }
  }

  /* Fold the friends list away, or back. */
  function applyFriendsCollapse() {
    var view = document.querySelector('#thw-social-root [data-view="friends"]');
    if (!view) return;
    view.classList.toggle("thw-social-friends-collapsed", state.friendsCollapsed);
    var toggle = view.querySelector(".thw-social-friends-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", state.friendsCollapsed ? "false" : "true");
      toggle.title = state.friendsCollapsed ? "Expand the friends list" : "Collapse the friends list";
      var glyph = toggle.querySelector("i");
      if (glyph) glyph.className = state.friendsCollapsed ? "fas fa-chevron-down" : "fas fa-chevron-up";
    }
  }

  /* Whether the panel is the bigger size, remembered between visits. */
  function loadPanelSize() {
    try {
      var wide = localStorage.getItem("thwSocialWide") === "1";
      document.documentElement.classList.toggle("thw-social-wide", wide);
    } catch (e) {}
  }

  function applyPanelSize() {
    var btn = document.getElementById("thw-social-expand");
    if (!btn) return;
    var wide = document.documentElement.classList.contains("thw-social-wide");
    btn.setAttribute("aria-pressed", wide ? "true" : "false");
    btn.title = wide ? "Make the panel the usual size" : "Make the panel bigger";
    var glyph = btn.querySelector("i");
    if (glyph) glyph.className = wide ? "fas fa-compress" : "fas fa-expand";
  }

  /* Whether the list is folded away, remembered between visits. */
  function loadFriendsCollapse() {
    try { state.friendsCollapsed = localStorage.getItem("thwSocialFriendsCollapsed") === "1"; } catch (e) { state.friendsCollapsed = false; }
  }

  function renderFriends(friends) {
    var list = document.getElementById("thw-social-friends");
    list.replaceChildren();
    if (!friends.length) {
      list.appendChild(emptyState("fa-user-plus", "No friends yet", "Search for someone by name above to send a friend request."));
      return;
    }
    friends.forEach(function (friend) {
      var row = el("div", "thw-social-row");
      var face = el("span", "thw-social-face");
      face.appendChild(avatarNode(friend));
      /* The dot sits on the corner of the avatar, so the state is next to
         the face. */
      face.appendChild(statusDot(friend));
      row.appendChild(face);
      var person = el("span", "thw-social-person");
      person.appendChild(el("span", "thw-social-name", friend.name));
      /* Whether they are here, always said - and under it what they are up
         to. Both are true at once, so neither stands in for the other: the
         activity used to replace the presence whenever there was one, and
         the online state disappeared behind it. */
      var meta = el("span", "thw-social-meta" + (friend.online ? " thw-social-online" : ""), statusOf(friend).label);
      person.appendChild(meta);
      if (friend.activity) person.appendChild(el("span", "thw-social-activity", friend.activity));
      row.appendChild(person);
      var actions = el("span", "thw-social-actions");
      actions.appendChild(button("Message", "message-user", "primary", { uid: friend.uid }));
      actions.appendChild(button("Remove", "remove-friend", "danger", { uid: friend.uid }));
      actions.appendChild(button("Block", "block-user", "danger", { uid: friend.uid }));
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function renderSearchResults(users) {
    var list = document.getElementById("thw-social-search-results");
    list.replaceChildren();
    if (!users.length) {
      /* This used to return early, which left a blank gap under the search box
         that read as a broken control rather than as "nobody matched". Say what
         happened and echo the term, so it is obvious the search ran. Only once a
         search is actually long enough to have run, though - the same function
         is called to clear the box, and "No people found" under an empty field
         is just noise. */
      var term = (state.searchText || "").trim();
      if (term.length >= 2) {
        var empty = el("div", "thw-social-empty", "No people found for “" + term + "”.");
        /* Recent searches only help someone who has searched before, and are
           noise on a first visit. */
        if (state.recentSearches.length > 1) {
          var recentWrap = el("div", "thw-social-recent");
          recentWrap.appendChild(el("div", "thw-social-section-label", "Recent searches"));
          state.recentSearches.forEach(function (item) {
            var chip = el("button", "thw-social-chip", item);
            chip.type = "button";
            chip.dataset.action = "recent-search";
            chip.dataset.term = item;
            recentWrap.appendChild(chip);
          });
          empty.appendChild(recentWrap);
        }
        list.appendChild(empty);
      }
      return;
    }
    list.appendChild(el("div", "thw-social-section-label", "People"));
    users.forEach(function (user) {
      var row = el("div", "thw-social-row");
      row.appendChild(avatarNode(user));
      var person = el("span", "thw-social-person");
      person.appendChild(el("span", "thw-social-name", user.name));
      person.appendChild(el("span", "thw-social-meta", user.relationship === "friends" ? "Friend" : "TheHighWRLD member"));
      row.appendChild(person);
      var actions = el("span", "thw-social-actions");
      if (user.relationship === "friends") {
        actions.appendChild(button("Message", "message-user", "primary", { uid: user.uid }));
      } else if (user.relationship === "incoming") {
        actions.appendChild(button("Accept", "accept-search-request", "primary", { uid: user.uid }));
      } else if (user.relationship === "outgoing") {
        /* This was a noop button: it looked like an action, took the click, and
           did nothing, so it read as broken. Say what is actually true and offer
           the one thing that can be done about it. */
        var pending = el("span", "thw-social-pending", "Request sent");
        actions.appendChild(pending);
        actions.appendChild(button("Cancel", "cancel-outgoing", "", { uid: user.uid }));
      } else {
        actions.appendChild(button("Add friend", "send-request", "primary", { uid: user.uid }));
      }
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function renderRequests(requests) {
    var list = document.getElementById("thw-social-requests");
    list.replaceChildren();
    if (!requests.length) {
      /* Used to say only "No pending friend requests.", which reads as a dead
         end. Say how one gets here, so an empty tab explains itself. */
      list.appendChild(emptyState("fa-user-clock", "No pending requests", "When someone adds you, their request shows up here."));
      return;
    }
    requests.forEach(function (request) {
      var card = el("div", "thw-social-request");
      var row = el("div", "thw-social-row");
      row.appendChild(avatarNode(request));
      var person = el("span", "thw-social-person");
      person.appendChild(el("span", "thw-social-name", request.name));
      person.appendChild(el("span", "thw-social-meta", request.direction === "incoming" ? "Wants to be your friend" : "Request sent"));
      row.appendChild(person);
      var actions = el("span", "thw-social-actions");
      if (request.direction === "incoming") {
        actions.appendChild(button("Accept", "accept-request", "primary", { requestId: request.id }));
        actions.appendChild(button("Decline", "decline-request", "danger", { requestId: request.id }));
      } else {
        actions.appendChild(button("Cancel", "cancel-request", "", { requestId: request.id }));
      }
      row.appendChild(actions);
      card.appendChild(row);
      list.appendChild(card);
    });
  }

  /* House rules for this panel. Written against what the code actually enforces
   rather than what would be nice to claim: blocking is real, bidirectional and
   immediate; reporting is real but needs a connected account; and nothing here
   scans message content automatically - so the copy says so instead of implying
   a moderation safety net that does not exist. The reason lists mirror
   reports.js (USER_REASONS / MESSAGE_REASONS) so people can only be pointed at
   options that genuinely exist. */
  var RULES = [
    ["Be decent", "No harassment, bullying, threats or targeted abuse. You would rather not receive what you would not send."],
    ["No spam or scams", "No unsolicited links, fake giveaways, or requests for money, codes or gift cards."],
    ["Do not impersonate", "Do not pose as another member, or as the site or its staff."],
    ["Keep it clean", "No sexual, graphic or NSFW content. The same standard that applies to artwork here applies to messages."],
    ["Respect privacy", "Do not share another person's personal details, contact information or screenshots without their permission."],
    ["Keep it legal", "Nothing that breaks the law, and nothing that helps someone else break it."]
  ];

  function openRules() {
    var overlay = document.getElementById("thw-social-rules");
    if (!overlay) return;
    var body = overlay.querySelector(".thw-social-rules-body");
    body.replaceChildren();
    RULES.forEach(function (rule) {
      var row = el("div", "thw-social-rule");
      row.appendChild(el("h3", "", rule[0]));
      row.appendChild(el("p", "", rule[1]));
      body.appendChild(row);
    });
    var help = el("div", "thw-social-rules-help");
    help.appendChild(el("h3", "", "If something goes wrong"));
    help.appendChild(el("p", "", "Block stops it immediately: it removes the friendship and neither of you can send new messages. Report sends it to the moderators to review, and needs a connected account."));
    help.appendChild(el("p", "thw-social-rules-note", "Messages here are private to you and the person you are talking to, and their content is not scanned automatically. That is why reporting matters."));
    body.appendChild(help);
    overlay.hidden = false;
    state.rulesOpen = true;
    lockScroll();
    overlay.querySelector(".thw-social-rules-close").focus();
  }

  function closeRules() {
    var overlay = document.getElementById("thw-social-rules");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    state.rulesOpen = false;
    unlockScroll();
    var link = document.getElementById("thw-social-rules-link");
    if (link) link.focus();
  }

  function renderConversations(conversations) {
    var list = document.getElementById("thw-social-conversations");
    list.replaceChildren();
    var unreadTotal = conversations.reduce(function (sum, c) { return sum + (Number(c.unread) || 0); }, 0);
    if (!conversations.length) {
      /* Point at the route that actually leads somewhere, instead of just
         reporting emptiness. */
      list.appendChild(el("div", "thw-social-empty", "No messages yet. Pick a friend and choose Message to start a conversation."));
      return;
    }
    /* Sort by most recent activity rather than whatever order the server
       returned, so an active conversation is never buried under a stale one.
       Falls back to name when there is no timestamp to compare. */
    var sorted = conversations.slice().sort(function (a, b) {
      var at = Date.parse(String(a.lastMessageAt || a.updatedAt || "").replace(" ", "T"));
      var bt = Date.parse(String(b.lastMessageAt || b.updatedAt || "").replace(" ", "T"));
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    /* The button is always there. It used to be hidden when there was
       nothing to mark, so pressing it was impossible - and the person
       pressing it was told nothing about why. */
    var markAll = el("button", "thw-social-mark-all", unreadTotal ? "Mark all read (" + unreadTotal + ")" : "Mark all read");
    markAll.type = "button";
    markAll.dataset.action = "mark-all-read";
    list.appendChild(markAll);
    sorted.forEach(function (conversation) {
      var row = el("button", "thw-social-convo" + (state.conversation && state.conversation.id === conversation.id ? " active" : ""));
      row.type = "button";
      row.dataset.conversationId = conversation.id;
      var face = el("span", "thw-social-face");
      if (conversation.kind === "group") {
        /* A group has no person on the other end, so it carries no dot - the
           glyph says what it is and the title says what it is called. */
        face.appendChild(groupAvatarNode(conversation, 29));
      } else {
        face.appendChild(avatarNode(conversation, 29));
        /* The same dot the friends list has, so a conversation carries the
           state of the person on the other end of it. */
        face.appendChild(statusDot(conversation));
      }
      row.appendChild(face);
      var copy = el("span", "thw-social-convo-copy");
      copy.appendChild(el("span", "thw-social-name", conversation.name || (conversation.kind === "group" ? "Group chat" : "")));
      copy.appendChild(el("span", "thw-social-preview",
        conversation.lastMessage || (conversation.kind === "group" ? "Say something to the group" : "Start a conversation")));
      /* When did they last talk? Useful on its own, and it is the timestamp the
         sort above is ordering by, so the two cannot disagree. */
      var stamp = relativeTime(conversation.lastMessageAt || conversation.updatedAt);
      if (stamp) copy.appendChild(el("span", "thw-social-convo-time", stamp));
      row.appendChild(copy);
      if (conversation.unread > 0) row.appendChild(el("span", "thw-social-unread", conversation.unread > 99 ? "99+" : String(conversation.unread)));
      list.appendChild(row);
    });
  }

  function relativeTime(value) {
    var time = Date.parse(String(value || "").replace(" ", "T"));
    if (!Number.isFinite(time)) return "";
    var seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }

  /* How long ago somebody was last here.
   *
   * The presence table keeps a last-seen time and the live presence set
   * says who is here now. Between them there is enough to say something
   * more useful than "offline" - which is what everybody was told,
   * always, because the query that lists the conversations never asked
   * for the presence at all. */
  function statusOf(person) {
    if (!person) return { key: "offline", label: "Offline" };
    if (person.online) return { key: "online", label: "Online" };
    var last = Date.parse(String(person.lastActive || "").replace(" ", "T"));
    if (!Number.isFinite(last)) return { key: "offline", label: "Offline" };
    var minutes = Math.floor((Date.now() - last) / 60000);
    if (minutes < 15) return { key: "recent", label: "Active recently" };
    if (minutes < 1440) return { key: "today", label: "Active today" };
    return { key: "offline", label: "Last active " + relativeTime(person.lastActive) };
  }

  /* The dot, which goes on the corner of the avatar.
   *
   * A dot on its own says nothing to anybody who cannot see it, so the
   * words are still there too - the dot is the quick read, the words are
   * the certain one. */
  function statusDot(person) {
    var status = statusOf(person);
    var dot = el("span", "thw-social-status thw-social-status--" + status.key);
    dot.title = status.label;
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  /* The reactions a message can carry.
   *
   * The same set the server accepts. It used to offer three of the six the
   * server had, so half the reactions could not be given without going
   * round the API - and the three that could be given were the only ones
   * anybody ever used. */
  var REACTIONS = ["❤️", "🔥", "😂", "😮", "👏", "💯", "👍", "👎", "🎉", "😢", "🤔", "🙏"];

  /* The message menu.
   *
   * Right-click a message and this opens: the reactions, and the things you
   * can do with it. It used to be a row of small buttons under every message
   * - seven of them for a message nobody had touched, which turned the
   * thread into a wall of buttons and pushed the actual conversation down the
   * page.
   *
   * The buttons are all still there. They are just in here now, where they
   * can be found when they are wanted rather than when the message is read. */
  function openMessageMenu(message, x, y) {
    closeMessageMenu();
    if (!message || message.deleted) return;

    var root = document.getElementById("thw-social-root");
    var panel = document.getElementById("thw-social-panel");
    if (!root || !panel) return;

    var menu = el("div", "thw-social-menu");
    menu.id = "thw-social-menu";
    menu.setAttribute("role", "menu");

    /* The reactions. The ones already given are shown with their count, so
       the menu says what is there as well as what can be added. */
    var reactRow = el("div", "thw-social-menu-reactions");
    reactRow.setAttribute("role", "group");
    reactRow.setAttribute("aria-label", "React to this message");
    var mine = {};
    (message.reactions || []).forEach(function (reaction) { mine[reaction.emoji] = reaction; });
    var every = REACTIONS.slice();
    Object.keys(mine).forEach(function (emoji) { if (every.indexOf(emoji) === -1) every.push(emoji); });
    every.forEach(function (emoji) {
      var reaction = mine[emoji];
      var node = el("button", "thw-social-menu-reaction" + (reaction && reaction.mine ? " mine" : ""),
        emoji + (reaction && reaction.count > 1 ? " " + reaction.count : ""));
      node.type = "button";
      node.dataset.action = "react";
      node.dataset.messageId = message.id;
      node.dataset.emoji = emoji;
      node.title = reaction ? (reaction.count + (reaction.count === 1 ? " reaction" : " reactions")) : "React";
      reactRow.appendChild(node);
    });
    menu.appendChild(reactRow);
    menu.appendChild(el("div", "thw-social-menu-divider"));

    var add = function (label, action) {
      var node = el("button", "thw-social-menu-item", label);
      node.type = "button";
      node.dataset.action = action;
      node.dataset.messageId = message.id;
      node.setAttribute("role", "menuitem");
      menu.appendChild(node);
      return node;
    };

    add("Reply", "reply");
    add("Copy", "copy-message");
    add("Grammar check", "grammar-check");
    var mineMessage = message.senderUid === (state.boot && state.boot.me && state.boot.me.uid);
    if (mineMessage) {
      add("Edit", "edit-message");
      add("Delete", "delete-message");
    } else {
      add("Report", "report-message");
    }

    /* On the page, and not inside the panel's root.
     *
     * The root is a positioned box with no height - it holds the button and
     * the overlay, and the overlay is fixed - so a menu put inside it and
     * positioned absolutely is placed against the bottom of the document,
     * about two thousand pixels below where the panel is. The menu was
     * opening. It was just opening where nobody could see it, which is the
     * same thing as not opening at all.
     *
     * So it is put on the page and positioned against the page, and it is
     * kept inside the panel - a menu that hangs off the edge of the panel is
     * a menu whose half the items cannot be reached. */
    document.body.appendChild(menu);
    var box = menu.getBoundingClientRect();
    var bounds = panel.getBoundingClientRect();
    var left = x;
    var top = y;
    if (left + box.width > bounds.right - 8) left = bounds.right - box.width - 8;
    if (left < bounds.left + 8) left = bounds.left + 8;
    if (top + box.height > bounds.bottom - 8) top = bounds.bottom - box.height - 8;
    if (top < bounds.top + 8) top = bounds.top + 8;
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";

    /* The menu is not inside the panel's root any more, so the root's own
       click handler does not see its buttons. It has its own. */
    menu.addEventListener("click", function (event) {
      var item = event.target.closest("[data-action]");
      if (!item || !menu.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      runAction(item);
    });

    state.menuOpen = true;
    return menu;
  }

  function closeMessageMenu() {
    var menu = document.getElementById("thw-social-menu");
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    state.menuOpen = false;
  }

  /* The grammar check.
   *
   * The result is a list of suggestions, and nothing is changed until the
   * person says so - a checker that rewrote your message as you typed would
   * be worse than no checker. */
  function openGrammarResult(message, suggestions) {
    closeMessageMenu();
    var root = document.getElementById("thw-social-root");
    if (!root) return;

    var panel = el("div", "thw-social-grammar");
    panel.id = "thw-social-grammar";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Grammar check");

    var head = el("div", "thw-social-grammar-head");
    head.appendChild(el("strong", "thw-social-grammar-title", "Grammar check"));
    var close = el("button", "thw-social-grammar-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close the grammar check");
    close.addEventListener("click", function () { closeGrammarResult(); });
    head.appendChild(close);
    panel.appendChild(head);

    if (!suggestions.length) {
      panel.appendChild(el("p", "thw-social-grammar-text",
        "Nothing to point out here. This is a short check for common slips - it does not judge how you write."));
    } else {
      panel.appendChild(el("p", "thw-social-grammar-text",
        "A few things worth a look. Nothing is changed until you say so."));
      var list = el("ul", "thw-social-grammar-list");
      suggestions.forEach(function (item) {
        var row = el("li", "thw-social-grammar-row");
        var text = el("div", "thw-social-grammar-row-text");
        text.appendChild(el("span", "thw-social-grammar-wrong", item.text));
        text.appendChild(el("span", "thw-social-grammar-right", item.fix));
        text.appendChild(el("span", "thw-social-grammar-why", item.why));
        row.appendChild(text);
        var use = el("button", "thw-social-grammar-use", "Use this");
        use.type = "button";
        use.addEventListener("click", function () { applyGrammarFix(message, item); });
        row.appendChild(use);
        list.appendChild(row);
      });
      panel.appendChild(list);

      var applyAll = el("button", "thw-social-grammar-all", "Use all of these");
      applyAll.type = "button";
      applyAll.addEventListener("click", function () { applyGrammarFix(message, null, suggestions); });
      panel.appendChild(applyAll);
    }

    /* On the page, for the same reason the menu is: the panel's root is a
       positioned box with no height, so anything placed inside it and
       positioned absolutely lands at the bottom of the document. */
    document.body.appendChild(panel);
    var box = panel.getBoundingClientRect();
    var bounds = document.getElementById("thw-social-panel");
    var area = bounds ? bounds.getBoundingClientRect() : { left: 12, right: window.innerWidth - 12, top: 78, bottom: window.innerHeight - 20 };
    var left = area.left + 12;
    var top = area.bottom - box.height - 12;
    if (top < area.top + 8) top = area.top + 8;
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
    state.grammarOpen = true;
  }

  function closeGrammarResult() {
    var panel = document.getElementById("thw-social-grammar");
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    state.grammarOpen = false;
  }

  /* Apply one suggestion, or all of them.
   *
   * The text is changed in the message that is on screen, and the change is
   * saved through the same endpoint the edit button uses - so it is the same
   * message, updated, rather than a new one. */
  function applyGrammarFix(message, one, all) {
    if (!message) return;
    var suggestions = all || (one ? [one] : []);
    if (!suggestions.length) return;

    var body = message.body || "";
    if (one && !all) {
      body = body.slice(0, one.start) + one.fix + body.slice(one.start + one.length);
    } else {
      var sorted = suggestions.slice().sort(function (a, b) { return b.start - a.start; });
      sorted.forEach(function (item) {
        body = body.slice(0, item.start) + item.fix + body.slice(item.start + item.length);
      });
    }

    message.body = body;
    closeGrammarResult();
    api("/conversations/" + encodeURIComponent(state.conversation.id) + "/messages/" + message.id, {
      method: "PATCH",
      body: { body: body },
    }).then(function () {
      renderMessages();
      showStatus("Message updated.");
    }).catch(function (error) {
      showStatus(describeError(error), "error");
    });
  }

  function search(query) {
    state.searching = true;
    updateSearchMeta();
    api("/search?q=" + encodeURIComponent(query)).then(function (data) {
      if (query === state.searchText) {
        state.lastSearchUsers = data.users || [];
        rememberSearch(query);
        renderSearchResults(state.lastSearchUsers);
      }
    }).catch(function (error) {
      showStatus(describeError(error), "error");
    }).finally(function () {
      if (query === state.searchText) { state.searching = false; updateSearchMeta(); }
    });
  }

  var RECENT_KEY = "thwSocialRecentSearches";
  function rememberSearch(term) {
    var value = String(term || "").trim();
    if (value.length < 2) return;
    state.recentSearches = [value].concat(state.recentSearches.filter(function (item) {
      return item.toLowerCase() !== value.toLowerCase();
    })).slice(0, 5);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recentSearches)); } catch (e) {}
  }
  function loadRecentSearches() {
    try {
      var raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Object.prototype.toString.call(raw) === "[object Array]") state.recentSearches = raw.slice(0, 5);
    } catch (e) { state.recentSearches = []; }
  }

  /* The count and the searching state used to be invisible, so the 280ms
     debounce just looked like the panel had frozen. */
  function updateSearchMeta() {
    var meta = document.getElementById("thw-social-search-meta");
    if (!meta) return;
    if (state.searching) { meta.textContent = "Searching…"; return; }
    var term = (state.searchText || "").trim();
    if (term.length < 2) { meta.textContent = ""; return; }
    var total = state.lastSearchUsers ? state.lastSearchUsers.length : 0;
    if (!total) { meta.textContent = ""; return; }
    meta.textContent = total === 1 ? "1 person" : total + " people";
  }

  function openConversation(conversation) {
    if (state.typingStarted && state.conversation) {
      api("/conversations/" + encodeURIComponent(state.conversation.id) + "/typing", {
        method: "POST", body: { typing: false }
      }).catch(function () {});
    }
    clearTimeout(state.typingTimer);
    /* The repeat has to be stopped as well, or it would keep saying "still
       typing" for a conversation nobody is in any more. */
    clearTimeout(state.typingRefresh);
    state.typingStarted = false;
    state.typingStamps = [];
    state.blocked = false;
    state.conversation = conversation;
    state.messages = [];
    /* The names of who said what belong to the thread being left. */
    state.senders = {};
    state.olderCursor = 0;
    state.hasOlder = false;
    state.replyTo = null;
    setTab("messages");
    syncSettingsButton();
    renderConversations(state.boot && state.boot.conversations || []);
    renderThreadHeader(conversation);
    loadMessages(false);
  }

  function renderThreadHeader(conversation) {
    var head = document.getElementById("thw-social-thread-head");
    head.replaceChildren();
    if (!conversation) {
      head.appendChild(el("span", "thw-social-thread-placeholder", "Select a conversation"));
      return;
    }
    /* A group is named by its title and sized by its members. It has no
       person on the other end, so there is no presence to report and no one
       person to Block or Report from here. */
    if (conversation.kind === "group") {
      head.appendChild(groupAvatarNode(conversation, 30));
      var group = el("span", "thw-social-thread-person");
      group.appendChild(el("span", "thw-social-name", conversation.name || "Group chat"));
      group.appendChild(el("span", "thw-social-meta", (Number(conversation.memberCount) || 0) + " people"));
      head.appendChild(group);
      return;
    }
    head.appendChild(avatarNode(conversation, 30));
    var person = el("span", "thw-social-thread-person");
    person.appendChild(el("span", "thw-social-name", conversation.name));
    /* "Private direct message" was static on every conversation. Presence and
       last-seen already come down with the conversation payload for friends, so
       use them when present rather than showing nothing at all. */
    var presence = conversation.online
      ? "Online"
      : (conversation.lastActive ? "Last active " + relativeTime(conversation.lastActive) : "Offline");
    person.appendChild(el("span", "thw-social-meta" + (conversation.online ? " thw-social-online" : ""), presence));
    /* A custom status, when they have set one - it says more than a
       presence does. */
    if (conversation.activity) person.appendChild(el("span", "thw-social-meta", conversation.activity));
    head.appendChild(person);
    head.appendChild(button("Block", "block-user", "danger", { uid: conversation.uid }));
    head.appendChild(button("Report", "report-user", "", { uid: conversation.uid }));
  }

  function loadMessages(older, preserveScroll) {
    if (!state.conversation) return Promise.resolve();
    var conversationId = state.conversation.id;
    var body = document.getElementById("thw-social-thread-body");
    var oldHeight = body.scrollHeight;
    var oldTop = body.scrollTop;
    var wasNearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    var path = "/conversations/" + encodeURIComponent(conversationId) + "/messages";
    if (older && state.olderCursor) path += "?before=" + encodeURIComponent(state.olderCursor);
    return api(path).then(function (data) {
      if (!state.conversation || state.conversation.id !== conversationId || data.messages == null) return;
      /* The server is the one that knows how big a group is and who is in
         it, so its answer fills in whatever the copy being drawn from did
         not carry - a thread opened from a notification, for instance. */
      if (data.conversation && state.conversation) {
        state.conversation.kind = data.conversation.kind || state.conversation.kind;
        if (data.conversation.title) state.conversation.name = state.conversation.name || data.conversation.title;
        if (data.conversation.memberCount) state.conversation.memberCount = data.conversation.memberCount;
        if (!older) renderThreadHeader(state.conversation);
      }
      /* Who said what. A one-to-one does not need it; a group does. */
      state.senders = data.senders || {};
      if (older) state.messages = (data.messages || []).concat(state.messages);
      else {
        /* Keep any message that failed to send. A reload replaces the whole
           list from the server, and the server has never heard of an unsent
           message - so without this, a realtime event or a tab switch silently
           deleted a failed send the user was about to retry. */
        var pending = state.messages.filter(function (m) { return m.pending; });
        state.messages = (data.messages || []).concat(pending);
      }
      state.hasOlder = (data.messages || []).length === 50;
      state.olderCursor = state.messages.length ? state.messages[0].id : 0;
      var input = document.getElementById("thw-social-input");
      var send = document.getElementById("thw-social-send");
      state.blocked = data.canSend === false;
      input.disabled = state.blocked;
      send.disabled = state.blocked;
      input.placeholder = state.blocked ? "Messaging is unavailable due to privacy settings or a block" : "Write a message";
      renderMessages();
      if (older) body.scrollTop = body.scrollHeight - oldHeight + oldTop;
      else if (!preserveScroll || wasNearBottom) body.scrollTop = body.scrollHeight;
      api("/conversations/" + encodeURIComponent(conversationId) + "/read", { method: "POST", body: {} })
        .then(function () { scheduleRefresh(); })
        .catch(function (error) { showStatus(describeError(error), "error"); });
    }).catch(function (error) { showStatus(describeError(error), "error"); });
  }

  function renderMessages() {
    var body = document.getElementById("thw-social-thread-body");
    body.replaceChildren();
    if (!state.conversation) {
      body.appendChild(el("div", "thw-social-thread-placeholder", "Choose a conversation or start a message from your friends list."));
      return;
    }
    if (state.hasOlder) {
      var older = el("button", "thw-social-load-older", "Load older messages");
      older.type = "button";
      older.dataset.action = "load-older";
      body.appendChild(older);
    }
    if (!state.messages.length) {
      body.appendChild(el("div", "thw-social-thread-placeholder", "Start the conversation."));
      return;
    }
    /* Jump-to-latest only appears once there is enough history for being
       scrolled up to be a real problem, and it hides itself again when the user
       is already at the bottom. */
    if (state.messages.length > 12) {
      var jump = el("button", "thw-social-jump", "Jump to latest");
      jump.type = "button";
      jump.dataset.action = "jump-latest";
      jump.hidden = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      body.appendChild(jump);
      body.addEventListener("scroll", function () {
        jump.hidden = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      }, { passive: true });
    }
    state.messages.forEach(function (message) {
      var mine = message.senderUid === (state.boot && state.boot.me && state.boot.me.uid);
      var bubble = el("article", "thw-social-message" + (mine ? " mine" : "") + (message.deleted ? " deleted" : "") + (message.failed ? " failed" : ""));
      bubble.dataset.messageId = message.id;
      var meta = el("div", "thw-social-message-meta");
      meta.appendChild(el("span", "", mine ? "You" : senderName(message)));
      meta.appendChild(el("time", "", relativeTime(message.createdAt)));
      if (message.editedAt) meta.appendChild(el("span", "", "edited"));
      if (message.failed) meta.appendChild(el("span", "thw-social-msg-state", "Not sent"));
      bubble.appendChild(meta);
      if (message.replyBody && !message.deleted) {
        bubble.appendChild(el("div", "thw-social-reply-quote", message.replyBody));
      }
      bubble.appendChild(el("p", "thw-social-message-text", message.deleted ? "Message deleted" : message.body));
      var tools = el("div", "thw-social-message-tools");
      if (message.failed) {
        /* The failed message offers exactly the two things you can do with it,
           rather than the reply/react/delete set that does not apply. */
        var again = el("button", "primary", "Retry");
        again.type = "button";
        again.dataset.action = "retry-message";
        again.dataset.messageId = message.id;
        tools.appendChild(again);
        var discard = el("button", "danger", "Discard");
        discard.type = "button";
        discard.dataset.action = "discard-message";
        discard.dataset.messageId = message.id;
        tools.appendChild(discard);
      } else if (!message.deleted) {
        /* The reactions that are already there stay on the message, because
           they are a fact about the message rather than a control: they say
           who has reacted and how many times. Everything else - the
           reactions you can add, Reply, Copy, Report - is in the message
           menu, which is what right-clicking a message opens.
        (message.reactions || []).forEach(function (reaction) {
          var reactionButton = el("button", reaction.mine ? "mine" : "", reaction.emoji + " " + reaction.count);
          reactionButton.type = "button";
          reactionButton.dataset.action = "react";
          reactionButton.dataset.messageId = message.id;
          reactionButton.dataset.emoji = reaction.emoji;
          tools.appendChild(reactionButton);
        });
        /* The one control that stays visible: how to open the menu. It is
           there because a menu that can only be reached by right-clicking
           is a menu nobody finds - and a phone has no right-click at all. */
        var more = el("button", "thw-social-message-more", "⋯");
        more.type = "button";
        more.dataset.action = "message-menu";
        more.dataset.messageId = message.id;
        more.setAttribute("aria-label", "Message options");
        more.title = "Message options";
        tools.appendChild(more);
      }
      bubble.appendChild(tools);
      body.appendChild(bubble);
    });
  }

  function clearReply() {
    state.replyTo = null;
    document.getElementById("thw-social-replying").classList.remove("active");
  }

  function setReply(message) {
    state.replyTo = message;
    var label = document.getElementById("thw-social-reply-label");
    label.textContent = "Replying to " + (message.senderUid === state.boot.me.uid ? "your message" : senderName(message)) + ": " + String(message.body || "").slice(0, 80);
    document.getElementById("thw-social-replying").classList.add("active");
    document.getElementById("thw-social-input").focus();
  }

  /* The typing limit.
   *
   * A typing indicator is a small thing that can be made to cost a great
   * deal. It used to be sent once at the start of a burst and once when it
   * stopped - which was cheap, but it meant the indicator on the other end
   * went dark after three seconds even though the person was still typing,
   * so it was both wrong and short-lived.
   *
   * So it is repeated while the typing continues, and it is bounded:
   *
   *   - at most TYPING_LIMIT events a minute for the conversation, so a
   *     long message costs a bounded number of requests rather than one
   *     every couple of seconds for as long as somebody is typing;
   *   - the indicator on the other end goes away on its own, so a person
   *     who closes the tab mid-word does not leave somebody looking at
   *     "is typing…" for ever.
   *
   * The "stopped" event is never withheld: it is the one that clears the
   * indicator, and withholding it would leave a lie on screen.
   */
  var TYPING_LIMIT = 24;
  var TYPING_WINDOW_MS = 60000;
  var TYPING_REFRESH_MS = 2500;
  var TYPING_IDLE_MS = 1800;

  /* Whether this conversation is still under its limit. */
  function typingUnderLimit() {
    var now = Date.now();
    var stamps = (state.typingStamps || []).filter(function (at) { return now - at < TYPING_WINDOW_MS; });
    state.typingStamps = stamps;
    return stamps.length < TYPING_LIMIT;
  }

  function sendTyping(typing) {
    if (!state.conversation) return;
    if (typing) {
      /* Under the limit, the event is counted and sent. Over it, it is
         not sent - and not counted either, so the window can recover. */
      if (!typingUnderLimit()) return;
      state.typingStamps.push(Date.now());
    }
    api("/conversations/" + encodeURIComponent(state.conversation.id) + "/typing", {
      method: "POST", body: { typing: typing }
    }).catch(function () {});
  }

  function scheduleTyping() {
    if (!state.conversation || state.blocked) return;
    clearTimeout(state.typingTimer);
    if (!state.typingStarted) {
      state.typingStarted = true;
      sendTyping(true);
    }
    /* The "still typing" repeat. It runs while the person keeps typing and
       stops when they stop - and it is bounded by the limit above. */
    state.typingRefresh = setTimeout(function () {
      if (!state.typingStarted || !state.conversation) return;
      sendTyping(true);
      scheduleTypingRefresh();
    }, TYPING_REFRESH_MS);
    /* And the stop, once the typing stops. */
    state.typingTimer = setTimeout(function () {
      state.typingStarted = false;
      clearTimeout(state.typingRefresh);
      sendTyping(false);
    }, TYPING_IDLE_MS);
  }

  function scheduleTypingRefresh() {
    if (!state.typingStarted || !state.conversation) return;
    state.typingRefresh = setTimeout(function () {
      if (!state.typingStarted || !state.conversation) return;
      sendTyping(true);
      scheduleTypingRefresh();
    }, TYPING_REFRESH_MS);
  }

  function sendMessage(event) {
    event.preventDefault();
    var input = document.getElementById("thw-social-input");
    var text = input.value.trim();
    if (!state.conversation || !text) return;
    var send = document.getElementById("thw-social-send");
    send.disabled = true;
    api("/conversations/" + encodeURIComponent(state.conversation.id) + "/messages", {
      method: "POST",
      body: { body: text, replyToId: state.replyTo ? state.replyTo.id : null }
    }).then(function (data) {
      state.messages.push(data.message);
      input.value = "";
      clearReply();
      var counterNode = document.getElementById("thw-social-counter");
      if (counterNode) { counterNode.textContent = ""; counterNode.classList.remove("warn"); }
      renderMessages();
      document.getElementById("thw-social-thread-body").scrollTop = document.getElementById("thw-social-thread-body").scrollHeight;
      scheduleRefresh();
    }).catch(function (error) {
      /* A failed send used to vanish into a status line while the text stayed
         in the box, so the message looked unsent and there was nothing to retry
         from - the user had to notice and resend it themselves. Keep it visible
         in the thread as an explicit failed row. */
      state.messages.push({
        id: "pending-" + Date.now(),
        pending: true,
        failed: true,
        body: text,
        senderUid: state.boot && state.boot.me && state.boot.me.uid,
        createdAt: new Date().toISOString()
      });
      showStatus(describeError(error), "error");
      renderMessages();
      document.getElementById("thw-social-thread-body").scrollTop = document.getElementById("thw-social-thread-body").scrollHeight;
    }).finally(function () {
      send.disabled = state.blocked;
      input.focus();
    });
  }

  /* Retry a failed send, or discard it. */
  function retryMessage(node) {
    var id = node.dataset.messageId;
    var index = state.messages.findIndex(function (m) { return m.id === id; });
    if (index === -1) return;
    var message = state.messages[index];
    state.messages.splice(index, 1);
    renderMessages();
    api("/conversations/" + encodeURIComponent(state.conversation.id) + "/messages", {
      method: "POST",
      body: { body: message.body, replyToId: null }
    }).then(function (data) {
      state.messages.push(data.message);
      renderMessages();
      document.getElementById("thw-social-thread-body").scrollTop = document.getElementById("thw-social-thread-body").scrollHeight;
      scheduleRefresh();
    }).catch(function (error) {
      message.failed = true;
      state.messages.push(message);
      showStatus(describeError(error), "error");
      renderMessages();
    });
    return input;
  }

  function runAction(node) {
    var action = node.dataset.action;
    var uid = node.dataset.uid;
    var requestId = node.dataset.requestId;
    var messageId = node.dataset.messageId;
    /* The menu closes when something in it is chosen. The click that chose
       it is still on its way, and the menu would otherwise stay open over
       a message that has just been reacted to or reported. */
    closeMessageMenu();
    if (action === "noop") return;
    if (action === "toggle-panel-size") {
      /* The panel can be made bigger, on a desktop only.
         *
         * The width is a variable - the player steps aside by it - so the
         * variable is what changes, and everything that follows the panel
         * moves with it. The choice is remembered, because a panel that
         * forgets it every time it is opened is a control that has to be
         * set every time it is opened. */
      var wide = !document.documentElement.classList.contains("thw-social-wide");
      document.documentElement.classList.toggle("thw-social-wide", wide);
      try { localStorage.setItem("thwSocialWide", wide ? "1" : "0"); } catch (e) {}
      var btn = document.getElementById("thw-social-expand");
      if (btn) {
        btn.setAttribute("aria-pressed", wide ? "true" : "false");
        btn.title = wide ? "Make the panel the usual size" : "Make the panel bigger";
        var glyph = btn.querySelector("i");
        if (glyph) glyph.className = wide ? "fas fa-compress" : "fas fa-expand";
      }
      /* Panel width is one of the two numbers the Community menu has to clear. */
      syncCommMenuClearance();
      return;
    }
    if (action === "new-group") {
      /* A group chat starts from the friends you already have: a name, and
         the people to put in it. */
      openGroupDialog();
      return;
    }
    if (action === "toggle-friends") {
      /* Folding the friends list away, and back again.
         *
         * The choice is remembered, because a panel that forgets it every
         * time it is opened is a control that has to be set every time it
         * is opened - which is how it stops being used.
         *
         * On a phone the control is not there at all: the list is the
         * panel, and there is nothing behind it to give the space to. */
      state.friendsCollapsed = !state.friendsCollapsed;
      try { localStorage.setItem("thwSocialFriendsCollapsed", state.friendsCollapsed ? "1" : "0"); } catch (e) {}
      applyFriendsCollapse();
      return;
    }
    if (action === "mark-all-read") {
      /* Each conversation has its own read endpoint, so this walks them rather
         than inventing a bulk one that does not exist. Sequential so a failure
         part-way leaves a truthful count instead of a half-applied lie. */
      var unreadOnes = (state.boot && state.boot.conversations || []).filter(function (c) { return Number(c.unread) > 0; });
      /* Nothing to mark. The button is always there now, so it has to say
         so rather than doing nothing at all. */
      if (!unreadOnes.length) {
        showStatus("There is nothing to mark as read.");
        return;
      }
      var chain = unreadOnes.reduce(function (p, c) {
        return p.then(function () {
          return api("/conversations/" + encodeURIComponent(c.id) + "/read", { method: "POST", body: {} }).catch(function () {});
        });
      }, Promise.resolve());
      chain.then(function () {
        /* Confirm only after the refresh lands. Showing it first meant refresh
           cleared the status strip a moment later and the confirmation was gone
           before it could be read. */
        return refresh().then(function () { showStatus("Marked all as read."); });
      });
      return;
    }
    if (action === "jump-latest") {
      var thread = document.getElementById("thw-social-thread-body");
      thread.scrollTop = thread.scrollHeight;
      return;
    }
    if (action === "copy-message") {
      var target = state.messages.find(function (m) { return String(m.id) === String(messageId); });
      if (!target) return;
      var done = function () { showStatus("Message copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(target.body || "")).then(done, function () { showStatus("Could not copy that message.", "error"); });
      } else done();
      return;
    }
    if (action === "message-menu") {
      /* The menu opens where the button is, so a touch does not have to guess
         where the pointer was. */
      var menuTarget = state.messages.find(function (m) { return String(m.id) === String(messageId); });
      if (!menuTarget) return;
      var anchor = node.getBoundingClientRect();
      closeGrammarResult();
      openMessageMenu(menuTarget, anchor.left, anchor.bottom + 4);
      return;
    }
    if (action === "grammar-check") {
      var grammarTarget = state.messages.find(function (m) { return String(m.id) === String(messageId); });
      if (!grammarTarget) return;
      var body = String(grammarTarget.body || "");
      var suggestions = [];
      /* The check runs here, in the page. Nothing is sent anywhere to be
         checked - there is no service to send it to. */
      if (window.THWGrammar && typeof window.THWGrammar.check === "function") {
        try { suggestions = window.THWGrammar.check(body); } catch (e) { suggestions = []; }
      }
      openGrammarResult(grammarTarget, suggestions);
      return;
    }
    if (action === "retry") {
      clearRetry();
      refresh();
      return;
    }
    if (action === "load-older") {
      loadMessages(true, true);
      return;
    }
    if (action === "retry-message") { retryMessage(node); return; }
    if (action === "discard-message") {
      var deadId = node.dataset.messageId;
      state.messages = state.messages.filter(function (m) { return m.id !== deadId; });
      renderMessages();
      return;
    }
    if (action === "message-user") {
      api("/conversations", { method: "POST", body: { uid: uid } }).then(function (data) {
        var friend = (state.boot && state.boot.friends || []).find(function (person) { return person.uid === uid; });
        var result = (state.lastSearchUsers || []).find(function (person) { return person.uid === uid; });
        openConversation({
          id: data.conversationId,
          uid: uid,
          name: (friend && friend.name) || (result && result.name) || "Member",
          avatar: (friend && friend.avatar) || (result && result.avatar) || ""
        });
        refresh();
      }).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "send-request") {
      api("/requests", { method: "POST", body: { uid: uid } }).then(function () {
        showStatus("Friend request sent.");
        scheduleRefresh();
        search(state.searchText);
      }).catch(function (error) {
        if (error.code === "incoming_request" && error.message) {
          showStatus("This person has already requested you. Open Requests to respond.", true);
        } else showStatus(describeError(error), "error");
      });
      return;
    }
    if (action === "accept-search-request") {
      var incoming = (state.boot && state.boot.requests || []).find(function (r) { return r.uid === uid && r.direction === "incoming"; });
      if (incoming) requestAction(incoming.id, "accept");
      else scheduleRefresh();
      return;
    }
    if (action === "accept-request" || action === "decline-request" || action === "cancel-request") {
      requestAction(requestId, action === "accept-request" ? "accept" : action === "decline-request" ? "decline" : "cancel");
      return;
    }
    if (action === "cancel-outgoing") {
      /* Search results carry no request id, so resolve it from the pending list
         we already hold rather than guessing at an endpoint. */
      var outgoing = (state.boot && state.boot.requests || []).find(function (r) { return r.uid === uid && r.direction === "outgoing"; });
      if (outgoing) requestAction(outgoing.id, "cancel");
      else { showStatus("That request is no longer pending.", "warn"); scheduleRefresh(); }
      return;
    }
    if (action === "recent-search") {
      var field = document.getElementById("thw-social-search");
      field.value = node.dataset.term || "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (action === "clear-search") {
      var box = document.getElementById("thw-social-search");
      box.value = "";
      state.searchText = "";
      state.lastSearchUsers = null;
      renderSearchResults([]);
      updateSearchMeta();
      /* The button hides itself in the input handler, which clearing the field
         programmatically never runs - so hide it here too, or it stays on
         screen with nothing to clear. */
      var clearButton = document.querySelector("#thw-social-root [data-action='clear-search']");
      if (clearButton) clearButton.hidden = true;
      box.focus();
      return;
    }
    if (action === "remove-friend") {
      if (!window.confirm("Remove this friend? Your message history will remain.")) return;
      api("/friends/" + encodeURIComponent(uid), { method: "DELETE" }).then(refresh).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "block-user") {
      if (!window.confirm("Block this user? This removes the friendship and prevents new messages.")) return;
      fetch("/api/users/" + encodeURIComponent(uid) + "/block", { method: "POST", credentials: "same-origin" })
        .then(function (response) { return response.json().then(function (data) { if (!response.ok) { var err = new Error(data.message || data.error || "Unable to block user"); err.status = response.status; throw err; } return data; }); })
        .then(function () {
          /* Blocking used to complete with no confirmation at all, so a success
             and a silent failure looked identical. Say it worked. */
          showStatus("Blocked. They can no longer message you.");
          if (state.conversation && state.conversation.uid === uid) {
            state.conversation = null;
            state.messages = [];
            renderThreadHeader(null);
            renderMessages();
          }
          return refresh();
        }).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "report-user") {
      var person = (state.conversation && state.conversation.uid === uid) ? state.conversation :
        (state.boot && state.boot.friends || []).find(function (friend) { return friend.uid === uid; });
      if (window.openReportModal) window.openReportModal("USER", "u:" + uid, person ? person.name : "Member");
      else showStatus("Reporting is unavailable right now.", true);
      return;
    }
    if (action === "reply") {
      var parent = state.messages.find(function (message) { return String(message.id) === String(messageId); });
      if (parent) setReply(parent);
      return;
    }
    if (action === "edit-message") {
      var original = state.messages.find(function (message) { return String(message.id) === String(messageId); });
      if (!original) return;
      var updated = window.prompt("Edit your message", original.body);
      if (updated == null || !updated.trim() || updated.trim() === original.body) return;
      api("/messages/" + encodeURIComponent(messageId), { method: "PATCH", body: { body: updated } })
        .then(function () { loadMessages(false, true); }).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "delete-message") {
      if (!window.confirm("Delete this message for everyone in the conversation?")) return;
      api("/messages/" + encodeURIComponent(messageId), { method: "DELETE", body: {} })
        .then(function () { loadMessages(false, true); }).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "react") {
      api("/messages/" + encodeURIComponent(messageId) + "/reactions", {
        method: "POST", body: { emoji: node.dataset.emoji }
      }).then(function (data) {
        var message = state.messages.find(function (item) { return String(item.id) === String(messageId); });
        if (message) message.reactions = data.reactions || [];
        renderMessages();
      }).catch(function (error) { showStatus(describeError(error), "error"); });
      return;
    }
    if (action === "report-message") {
      /* Who wrote it, said the way the thread says it: the person in a group,
         the other person in a one-to-one. */
      var reported = state.messages.find(function (item) { return String(item.id) === String(messageId); });
      var isGroup = state.conversation && state.conversation.kind === "group";
      if (window.openReportModal) {
        window.openReportModal("MESSAGE", String(messageId),
          isGroup ? "Message from " + senderName(reported) + " in " + (state.conversation.name || "a group")
                  : "Direct message from " + (state.conversation ? state.conversation.name : "a conversation"));
      } else showStatus("Reporting is unavailable right now.", true);
    }
  }

  function requestAction(id, action) {
    api("/requests/" + encodeURIComponent(id), { method: "PATCH", body: { action: action } })
      .then(function () { showStatus(action === "accept" ? "Friend request accepted." : "Request updated."); return refresh(); })
      .catch(function (error) { showStatus(describeError(error), "error"); });
  }

  function mountPrivacySettings() {
    if (document.getElementById("thw-social-settings")) return;
    /* Lives in the panel's Settings tab now, next to the Rules button, rather
       than buried in Account Settings. Same markup and same endpoints - only
       the host moved. Two copies would be worse: the card is guarded by its id,
       so a second mount could never exist anyway. */
    var mount = document.getElementById("thw-social-settings-mount");
    if (!mount) return;
    var card = el("section", "thw-social-settings-card");
    card.id = "thw-social-settings";
    card.innerHTML =
      '<h3>Friends &amp; Messaging privacy</h3>' +
      '<p>Choose who can send you friend requests and direct messages, and who can see your online and activity status. Following remains separate.</p>' +
      '<h4 class="thw-social-settings-group">Who can reach you</h4>' +
        '<div class="thw-social-settings-grid">' +
        '<label>Friend requests<select name="friend_requests"><option value="everyone">Everyone</option><option value="followers">People I follow</option><option value="nobody">No one</option></select></label>' +
        '<label>Direct messages<select name="direct_messages"><option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">No one</option></select></label>' +
        '<label>Online status<select name="online_status"><option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">No one</option></select></label>' +
        '<label>Activity status<select name="activity_status"><option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">No one</option></select></label>' +
      '</div>' +
        /* notifications_enabled lives in user_privacy and is read by the social
           notify(), which skips writing the notification when it is 0 - so this
           switch genuinely stops them rather than just recording a preference. */
        '<h4 class="thw-social-settings-group">Notifications</h4>' +
        '<label class="thw-social-switch-row">' +
          '<span class="thw-social-switch-copy"><b>Friends &amp; Messages notifications</b>' +
          '<small>Friend requests and new messages. Turning this off stops them being created.</small></span>' +
          /* checked by default, matching the server's default of 1. Signed out the fetch
             below cannot run, and defaulting to off would show a false "you have
             notifications off" to anyone who never loaded their real value. */
          '<input type="checkbox" name="notifications_enabled" class="thw-social-switch" role="switch" checked>' +
        '</label>' +
        /* The three sharing settings for the friend activity feed. All three
           are off to begin with - nothing is published until it is turned on,
           and turning it off takes down what was published. */
        '<h4 class="thw-social-settings-group">Friend activity feed</h4>' +
        '<p class="thw-social-settings-note">What your friends see in their activity feed. All of it is off until you turn it on. "Friends only" means only the people you have added can see it - never anybody else.</p>' +
        '<div class="thw-social-settings-grid">' +
          '<label>Listening activity<select name="activity_listening"><option value="nobody">Off</option><option value="friends">Friends only</option></select></label>' +
          '<label>Playlist activity<select name="activity_playlists"><option value="nobody">Off</option><option value="friends">Friends only</option></select></label>' +
          '<label>Community activity<select name="activity_community"><option value="nobody">Off</option><option value="friends">Friends only</option></select></label>' +
        '</div>' +
        '<button class="thw-social-settings-save" type="button">Save settings</button><span class="thw-social-settings-message" role="status"></span>';
    mount.appendChild(card);
    card.querySelector(".thw-social-settings-save").addEventListener("click", savePrivacySettings);
  }

  function loadPrivacySettings() {
    mountPrivacySettings();
    var card = document.getElementById("thw-social-settings");
    if (!card) return;
    api("/settings").then(function (data) {
      Object.keys(data.settings || {}).forEach(function (key) {
        var select = card.querySelector('select[name="' + key + '"]');
        if (select) select.value = data.settings[key];
      });
      /* The notification switch is stored by a different endpoint (user_privacy,
         not user_social_settings), so it is fetched separately. A failure here
         must not blank the selects that did load. */
      var toggle = card.querySelector('input[name="notifications_enabled"]');
      if (toggle) {
        toggle.disabled = true;
        /* Not /api/privacy - that endpoint only knows the four show_* flags.
           notifications_enabled is stored in user_privacy but written through
           the account endpoint, which is what returns the whole privacy row. */
        fetch("/api/account", { cache: "no-store", credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || d.ok !== true) return;
            var priv = d.privacy || {};
            /* A missing row means enabled, which is how the server defaults it. */
            toggle.checked = Number(priv.notifications_enabled) !== 0;
            toggle.disabled = false;
          })
          .catch(function () { toggle.disabled = false; });
      }
      card.querySelector(".thw-social-settings-message").textContent = "";
    }).catch(function (error) {
      card.querySelector(".thw-social-settings-message").textContent =
        error.status === 401 ? "Sign in to change these settings." : describeError(error);
    });
  }

  function savePrivacySettings() {
    var card = document.getElementById("thw-social-settings");
    var save = card.querySelector(".thw-social-settings-save");
    var message = card.querySelector(".thw-social-settings-message");
    var settings = {};
    card.querySelectorAll("select").forEach(function (select) { settings[select.name] = select.value; });
    var toggle = card.querySelector('input[name="notifications_enabled"]');
    save.disabled = true;
    message.textContent = "Saving\u2026";

    /* Two endpoints, because the two halves of this card live in two tables:
      the selects in user_social_settings, the switch in user_privacy. They
      are fired together but settled separately, so a failure in one is
      reported as exactly that - rather than the whole save reading as failed,
      or worse, silently reporting success for the half that did not save. */
    var socialSave = api("/settings", { method: "POST", body: settings });
    var notifySave = toggle
      ? fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "setPrivacy", notifications_enabled: toggle.checked })
        }).then(function (r) {
          if (!r.ok) throw new Error("notification setting rejected");
          return r.json().catch(function () { return {}; });
        })
      : Promise.resolve();

    var socialErr = null;
    var notifyErr = null;
    socialSave.catch(function (e) { socialErr = e; });
    notifySave.catch(function (e) { notifyErr = e; });

    Promise.all([
      socialSave.catch(function () {}),
      notifySave.catch(function () {})
    ]).then(function () {
      if (!socialErr && !notifyErr) {
        message.textContent = "Settings saved.";
      } else if (socialErr && notifyErr) {
        message.textContent = socialErr.status === 401
            ? "Sign in to change these settings."
            : "Could not save your settings. Try again.";
      } else if (socialErr) {
        message.textContent = "Notifications saved, but the privacy options were not.";
        } else {
        message.textContent = "Privacy options saved, but notifications were not.";
        }
      }).finally(function () { save.disabled = false; });
  }

  function wrapAccountSection() {
    var previous = window.accountSectionShown;
    if (typeof previous === "function" && !previous.__socialWrapped) {
      var wrapped = function () {
        previous.apply(this, arguments);
        mountPrivacySettings();
        loadPrivacySettings();
      };
      wrapped.__socialWrapped = true;
      window.accountSectionShown = wrapped;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mount(); wrapAccountSection(); });
  } else {
    mount();
    wrapAccountSection();
  }
    /* Public bridge for push-notification clicks. Exposes the panel's EXISTING
       navigation (setOpen / setTab / openConversation) rather than
       reimplementing it, so a notification lands in exactly the same view a
       click inside the panel would reach. Guarded so a second mount cannot
       redefine it, and defensive throughout: a push click must never throw. */
    if (!window.THWSocial) {
      window.THWSocial = {
        open: function () { try { setOpen(true); } catch (e) {} },
        goRequests: function () { this.open(); try { setTab("requests"); } catch (e) {} },
        goFriends: function () { this.open(); try { setTab("friends"); } catch (e) {} },
        goMessages: function () { this.open(); try { setTab("messages"); } catch (e) {} },
        /* The panel's own bootstrap, so another module can read what the
           panel has already been told - the settings, in particular - rather
           than asking for them a second time. */
        getBoot: function () { return state.boot; },
        /* The push payload carries a conversation id. Look it up in the
           already-loaded bootstrap so nothing is refetched or guessed; if it
           is not there yet, fall back to the Messages list rather than
           guessing. */
        goConversation: function (conversationId) {
          this.goMessages();
          if (!conversationId) return;
          try {
            var list = (state.boot && state.boot.conversations) || [];
            var found = list.filter(function (c) { return c && c.id === conversationId; })[0];
            if (found) openConversation(found);
          } catch (e) {}
        }
      };
    }
})();
