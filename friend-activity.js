/* The friend activity feed.
 *
 * WHAT THIS IS
 * A stream of what your friends are up to: what they are listening to,
 * which playlists they have shared, what they have done in the community.
 *
 * WHAT IT IS NOT
 * It is not a notification. A notification is a message to one person; this
 * is a stream that whoever looks at it reads. Nothing here sends anybody
 * anything, and nothing here is a copy of the notifications system - the
 * rows live in their own table and are read on their own terms.
 *
 * THE RULES ARE THE SERVER'S
 * The server decides who may see a row, every time a row is read. This
 * module asks for a feed and draws what it is given. It never decides that
 * a row may be shown, because a rule that only exists in the interface is
 * not a rule - it is a suggestion that somebody can ignore.
 *
 * SO THE SETTINGS ARE KEPT OFF UNLESS THE PERSON SAYS OTHERWISE
 * Nothing is published until the sharing setting for that kind of thing is
 * turned on, and turning it off takes down what was published. The player
 * asks this module to publish what is playing, and this module checks the
 * setting first - so a person who never opens the settings is never in
 * anybody else's feed.
 *
 * THE COST
 * The site is on a free tier, so the feed is asked for once, then only
 * when the person asks for it again. It is not polled. There is no
 * observer watching the page for changes.
 */
(function () {
  "use strict";

  if (window.THWActivity) return;

  var API = "/api/activity";

  /* The kinds of thing the feed can show. */
  var FILTERS = [
    { key: "all", label: "All" },
    { key: "listening", label: "Listening" },
    { key: "playlist", label: "Playlists" },
    { key: "community", label: "Community" },
  ];

  var PAGE_SIZE = 20;

  /* What is being shown right now. One feed at a time - the panel shows one
     at a time, so there is no reason to keep more. */
  var state = {
    type: "all",
    cursor: "",
    items: [],
    loading: false,
    error: "",
    done: false,
    container: null,
    onOpenProfile: null,
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = String(text);
    return node;
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

  function api(path, options) {
    var opts = options || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "request_failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* The settings, from the site's own bootstrap - the same one that already
     carries the other privacy settings, so nothing extra is asked for.
     *
     * The site bootstrap is the one that is always there: the player runs
     * before the friends panel is ever opened, and the player is what
     * publishes listening activity. The panel's own bootstrap is a second
     * place to look, for when the site bootstrap has not been asked for. */
  function settingsFrom(data) {
    var s = (data && data.settings) || {};
    return {
      listening: s.activity_listening || "nobody",
      playlist: s.activity_playlists || "nobody",
      community: s.activity_community || "nobody",
    };
  }

  function settingsSync() {
    var fromSite = null;
    if (window.THWBootstrap && typeof window.THWBootstrap.from === "function") {
      try { fromSite = window.THWBootstrap.from("activitySettings"); } catch (e) { fromSite = null; }
    }
    if (fromSite && fromSite.settings) return settingsFrom(fromSite);

    var boot = null;
    if (window.THWSocial && typeof window.THWSocial.getBoot === "function") {
      try { boot = window.THWSocial.getBoot(); } catch (e) { boot = null; }
    }
    if (boot && boot.settings) return settingsFrom(boot);
    return { listening: "nobody", playlist: "nobody", community: "nobody" };
  }

  /* The settings, once they are known.
   *
   * The site's bootstrap is asked for if it has not arrived - it is asked for
   * once, and it is already on its way because the site asks for it at the
   * top of every page. */
  function settingsWhenKnown() {
    if (window.THWBootstrap && typeof window.THWBootstrap.take === "function") {
      return window.THWBootstrap.take("activitySettings", function () { return null; })
        .then(function (data) {
          if (data && data.settings) return settingsFrom(data);
          return settingsSync();
        })
        .catch(function () { return settingsSync(); });
    }
    return Promise.resolve(settingsSync());
  }

  function shared(type, known) {
    var s = known || settingsSync();
    if (type === "listening") return s.listening === "friends";
    if (type === "playlist") return s.playlist === "friends";
    if (type === "community") return s.community === "friends";
    return false;
  }

  /* ---- publishing ---- */

  /* Publish something of yours.
   *
   * The setting is checked here so that nothing is asked of the server
   * that the server would only refuse - and, more to the point, so that a
   * person who has sharing off never makes a request about it at all. */
  function publish(payload) {
    var type = (payload && payload.type) || "";
    return settingsWhenKnown().then(function (known) {
      if (!shared(type, known)) return { ok: true, published: false, reason: "not_shared" };
      return api("", {
        method: "POST",
        body: JSON.stringify(payload),
      }).catch(function () {
        return { ok: false };
      });
    });
  }

  /* Take down what you published.
   *
   * Turning a setting off has to take the rows down too - the setting says
   * "do not share this", and leaving the rows would mean it was a lie until
   * they expired on their own. */
  function clear(type) {
    return api("/clear", {
      method: "POST",
      body: JSON.stringify({ type: type || "" }),
    }).catch(function () {
      return { ok: false };
    });
  }

  /* ---- the feed ---- */

  function skeletonRow() {
    var row = el("div", "thw-activity-card thw-activity-card--skeleton");
    row.appendChild(el("div", "thw-activity-skel thw-activity-skel--avatar"));
    var body = el("div", "thw-activity-card-body");
    body.appendChild(el("div", "thw-activity-skel thw-activity-skel--line thw-activity-skel--short"));
    body.appendChild(el("div", "thw-activity-skel thw-activity-skel--line"));
    body.appendChild(el("div", "thw-activity-skel thw-activity-skel--line thw-activity-skel--mid"));
    row.appendChild(body);
    return row;
  }

  function emptyState() {
    var wrap = el("div", "thw-activity-empty");
    wrap.appendChild(el("span", "thw-activity-empty-icon", "◦"));
    wrap.appendChild(el("strong", "thw-activity-empty-title", "Nothing here yet"));
    wrap.appendChild(el("span", "thw-activity-empty-text",
      "When your friends share what they are listening to, or the playlists they have made, it shows up here."));
    return wrap;
  }

  function errorState(message, onRetry) {
    var wrap = el("div", "thw-activity-empty thw-activity-empty--error");
    wrap.appendChild(el("span", "thw-activity-empty-icon", "!"));
    wrap.appendChild(el("strong", "thw-activity-empty-title", "The feed could not be loaded"));
    wrap.appendChild(el("span", "thw-activity-empty-text", message || "Try again in a moment."));
    var retry = el("button", "thw-activity-retry", "Try again");
    retry.type = "button";
    retry.addEventListener("click", onRetry);
    wrap.appendChild(retry);
    return wrap;
  }

  function avatarNode(item, size) {
    var wrap = el("span", "thw-activity-avatar");
    if (size) wrap.style.width = size + "px", wrap.style.height = size + "px";
    if (item.avatar) {
      var img = el("img");
      img.src = item.avatar;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () { img.remove(); });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(el("span", "thw-activity-initial", (item.name || "?").slice(0, 1).toUpperCase()));
    }
    return wrap;
  }

  function trackCard(item) {
    var card = el("article", "thw-activity-card thw-activity-card--listening");
    card.appendChild(avatarNode(item, 38));
    var body = el("div", "thw-activity-card-body");
    var head = el("div", "thw-activity-card-head");
    var name = el("button", "thw-activity-name", item.name || "Member");
    name.type = "button";
    name.addEventListener("click", function () { openProfile(item.uid); });
    head.appendChild(name);
    head.appendChild(el("span", "thw-activity-kind", "is listening to"));
    body.appendChild(head);

    var now = el("div", "thw-activity-track");
    if (item.artwork) {
      var art = el("img", "thw-activity-art");
      art.src = item.artwork;
      art.alt = "";
      art.loading = "lazy";
      art.addEventListener("error", function () { art.remove(); });
      now.appendChild(art);
    }
    var text = el("div", "thw-activity-track-text");
    /* The site has no address for one track on its own - the track lives in
       the vault, and the vault is reached by searching for it. So the title
       is a search link, which is a place that really does find the track,
       rather than a link to nowhere. */
    var title = el("a", "thw-activity-track-title", item.title || "Unknown track");
    if (item.title) title.href = "/?q=" + encodeURIComponent(item.title);
    text.appendChild(title);
    if (item.artist) text.appendChild(el("span", "thw-activity-track-artist", item.artist));
    now.appendChild(text);
    body.appendChild(now);
    card.appendChild(body);
    return card;
  }

  function plainCard(item) {
    var card = el("article", "thw-activity-card thw-activity-card--" + (item.type || "community"));
    card.appendChild(avatarNode(item, 38));
    var body = el("div", "thw-activity-card-body");
    var head = el("div", "thw-activity-card-head");
    var name = el("button", "thw-activity-name", item.name || "Member");
    name.type = "button";
    name.addEventListener("click", function () { openProfile(item.uid); });
    head.appendChild(name);
    var kind = item.type === "playlist" ? "shared a playlist" : "in the community";
    head.appendChild(el("span", "thw-activity-kind", kind));
    body.appendChild(head);
    if (item.label) body.appendChild(el("div", "thw-activity-label", item.label));
    if (item.detail) body.appendChild(el("div", "thw-activity-detail", item.detail));

    /* Where the link goes.
     *
     * A playlist lives on its owner's profile - there is no separate address
     * for one - so it goes there. Anything else that carries a link goes
     * there. A link that is not on this site was dropped by the server when
     * the event was written, so there is never one to follow. */
    var link = el("a", "thw-activity-link", item.type === "playlist" ? "View profile" : "Open");
    if (item.type === "playlist" || !item.link) {
      link.href = "/Profile/" + encodeURIComponent(item.uid || "");
      link.addEventListener("click", function (event) {
        event.preventDefault();
        openProfile(item.uid);
      });
    } else {
      link.href = item.link;
    }
    body.appendChild(link);
    card.appendChild(body);
    return card;
  }

  function openProfile(uid) {
    if (state.onOpenProfile) { state.onOpenProfile(uid); return; }
    if (!uid) return;
    /* The site opens profiles itself - it has to, because a profile address
       can be a uid, a name or a handle and the site resolves all three. */
    if (typeof window.openProfile === "function") {
      try { window.openProfile(uid); return; } catch (e) {}
    }
    window.location.href = "/Profile/" + encodeURIComponent(uid);
  }

  function renderItems() {
    var list = document.getElementById("thw-activity-list");
    if (!list) return;
    list.replaceChildren();
    if (!state.items.length) {
      list.appendChild(emptyState());
      return;
    }
    state.items.forEach(function (item) {
      list.appendChild(item.type === "listening" ? trackCard(item) : plainCard(item));
    });
  }

  function renderChrome() {
    var filters = document.getElementById("thw-activity-filters");
    if (filters) {
      filters.replaceChildren();
      FILTERS.forEach(function (f) {
        var button = el("button", "thw-activity-filter" + (state.type === f.key ? " active" : ""), f.label);
        button.type = "button";
        button.dataset.type = f.key;
        button.setAttribute("aria-pressed", state.type === f.key ? "true" : "false");
        filters.appendChild(button);
      });
    }
    var more = document.getElementById("thw-activity-more");
    if (more) {
      more.hidden = state.done || state.loading || !state.items.length;
      more.textContent = "Load more";
    }
    var count = document.getElementById("thw-activity-count");
    if (count) {
      count.textContent = state.items.length
        ? state.items.length + (state.items.length === 1 ? " update" : " updates")
        : "";
    }
  }

  function renderLoading() {
    var list = document.getElementById("thw-activity-list");
    if (!list) return;
    list.replaceChildren();
    for (var i = 0; i < 4; i++) list.appendChild(skeletonRow());
  }

  function renderError(message) {
    var list = document.getElementById("thw-activity-list");
    if (!list) return;
    list.replaceChildren();
    list.appendChild(errorState(message, function () { load(true); }));
  }

  function load(reset) {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    state.error = "";
    if (reset) {
      state.cursor = "";
      state.items = [];
      state.done = false;
      renderLoading();
    } else {
      var more = document.getElementById("thw-activity-more");
      if (more) more.textContent = "Loading…";
    }
    renderChrome();

    var query = "?type=" + encodeURIComponent(state.type) + "&limit=" + PAGE_SIZE;
    if (!reset && state.cursor) query += "&cursor=" + encodeURIComponent(state.cursor);

    return api(query, { method: "GET" }).then(function (data) {
      var items = data.items || [];
      state.items = reset ? items : state.items.concat(items);
      state.cursor = data.nextCursor || "";
      state.done = !state.cursor;
      state.loading = false;
      renderItems();
      renderChrome();
      return data;
    }).catch(function (err) {
      state.loading = false;
      state.error = err && err.status === 401
        ? "Sign in to see what your friends are up to."
        : "The feed could not be loaded.";
      if (reset) renderError(state.error);
      else renderChrome();
      return null;
    });
  }

  function setType(type) {
    if (state.type === type) return;
    state.type = type;
    load(true);
  }

  function refresh() {
    load(true);
  }

  /* Draw the whole thing - the heading, the filters, the list, the refresh
     button and the load more button. */
  function mount(container, options) {
    if (!container) return;
    state.container = container;
    state.onOpenProfile = (options && options.onOpenProfile) || null;

    container.replaceChildren();
    var head = el("div", "thw-activity-head");
    var title = el("h3", "thw-activity-title", "Friend activity");
    head.appendChild(title);
    var refreshButton = el("button", "thw-activity-refresh", "Refresh");
    refreshButton.type = "button";
    refreshButton.title = "Refresh the feed";
    refreshButton.addEventListener("click", function () { refresh(); });
    head.appendChild(refreshButton);
    container.appendChild(head);

    var filters = el("div", "thw-activity-filters");
    filters.id = "thw-activity-filters";
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Filter friend activity");
    container.appendChild(filters);

    var count = el("div", "thw-activity-count");
    count.id = "thw-activity-count";
    container.appendChild(count);

    var list = el("div", "thw-activity-list");
    list.id = "thw-activity-list";
    list.setAttribute("aria-live", "polite");
    container.appendChild(list);

    var more = el("button", "thw-activity-more", "Load more");
    more.id = "thw-activity-more";
    more.type = "button";
    more.hidden = true;
    more.addEventListener("click", function () { load(false); });
    container.appendChild(more);

    container.addEventListener("click", function (event) {
      var filter = event.target.closest("[data-type]");
      if (filter && container.contains(filter)) setType(filter.dataset.type);
    });

    renderChrome();
    load(true);
  }

  /* ---- the player ---- */

  /* What was published last, and when.
   *
   * The same track played again in the same breath is not news, and every
   * publish is a request and a row written. So the same track is not
   * published twice inside a couple of minutes - which is well inside the
   * five minutes a listening row lasts, so the feed never goes quiet while
   * the person is still listening to it. */
  var lastPublished = { trackId: "", at: 0 };
  var SAME_TRACK_MS = 2 * 60 * 1000;

  /* The player says what is playing, rather than this module reaching into
     the player to find out. The player is the thing that knows. */
  function onTrackPlaying(event) {
    var detail = (event && event.detail) || {};
    var trackId = String(detail.trackId || detail.title || "");
    var now = Date.now();
    if (!trackId) return;
    if (lastPublished.trackId === trackId && now - lastPublished.at < SAME_TRACK_MS) return;
    lastPublished = { trackId: trackId, at: now };

    publish({
      type: "listening",
      trackId: trackId,
      title: String(detail.title || "").slice(0, 160),
      artist: String(detail.artist || "").slice(0, 120),
      artwork: String(detail.cover || "").slice(0, 300),
    });
  }

  /* Playback stopped - the track ended.
   *
   * The row would expire on its own in five minutes, but a person who has
   * stopped listening should stop being shown as listening, and "up to five
   * minutes ago" is not as good as now. */
  function onTrackEnded() {
    lastPublished = { trackId: "", at: 0 };
    clear("listening");
  }

  var listeningHooked = false;
  function hookPlayer() {
    if (listeningHooked) return;
    listeningHooked = true;
    window.addEventListener("thw:trackplaying", onTrackPlaying);

    /* The audio element is created by the player and put in the document, so
       it is found by looking for it rather than by being handed over. It is
       only there once the player has run, so this is looked for when the
       first track arrives - by which time it exists. */
    var findAudio = function () {
      try { return document.querySelector("audio"); } catch (e) { return null; }
    };
    var audio = findAudio();
    if (audio) {
      audio.addEventListener("ended", onTrackEnded);
    } else {
      window.addEventListener("thw:trackplaying", function () {
        var a = findAudio();
        if (a && !a.__thwActivityHooked) {
          a.__thwActivityHooked = true;
          a.addEventListener("ended", onTrackEnded);
        }
      });
    }
  }

  window.THWActivity = {
    mount: mount,
    refresh: refresh,
    publish: publish,
    clear: clear,
    shared: shared,
    settings: settingsSync,
    hookPlayer: hookPlayer,
    FILTERS: FILTERS,
  };

  /* Listen for the player from the start.
   *
   * The player is the thing that knows what is playing, so it says so. This
   * module only has to be listening when it happens. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hookPlayer);
  } else {
    hookPlayer();
  }
})();
