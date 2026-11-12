/*
 * A page for every song.
 *
 * The Vault is a list of two hundred and ninety-odd songs, and each of
 * them is a thing somebody has a relationship with: a version they prefer,
 * a producer they follow, a comment they wrote. juicewrld.io gives each
 * song its own address, and so does this now - /song/fenty-sessions.
 *
 * The page is drawn out of what the browser already holds. The catalogue
 * is in memory, the credits are in the page, the eras are in the page - so
 * opening a song's page asks the server for nothing at all. The only
 * thing it fetches is the thread of comments, and only when the thread
 * is on the screen.
 */

(function () {
  "use strict";
  if (window.__songPageMounted) return;
  window.__songPageMounted = true;

  var ROOT = "/song";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* The catalogue, from the page. tracks.js declares it with const, so it
     is a lexical global and not a property of window. */
  function getTL() {
    try { if (typeof trackList !== "undefined" && trackList && trackList.length) return trackList; } catch (e) {}
    try { if (window.trackList && window.trackList.length) return window.trackList; } catch (e2) {}
    return [];
  }

  function slug(title) {
    return String(title == null ? "" : title)
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* The song, out of the catalogue. The address carries the title, so the
     title is the first thing looked for; then the version line, because
     two songs can share a name. */
  function findTrack(title) {
    var tl = getTL();
    if (!tl.length) return null;
    var want = String(title == null ? "" : title).trim().toLowerCase();
    if (!want) return null;
    var i, t;
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      if (String(t.title || "").trim().toLowerCase() === want) return { track: t, index: i };
    }
    /* The address may carry the version too: /song/fenty-sessions-gbgr. */
    var bare = want.replace(/-/g, " ");
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      if (slug(t.title) === want) return { track: t, index: i };
      if (String(t.title || "").toLowerCase() === bare) return { track: t, index: i };
    }
    for (i = 0; i < tl.length; i++) {
      t = tl[i] || {};
      if (String(t.title || "").toLowerCase().indexOf(bare) >= 0) return { track: t, index: i };
    }
    return null;
  }

  /* The name of the song, without its version, so the songs that belong
     together can be found beside each other. */
  function baseTitle(title) {
    return String(title == null ? "" : title).split("(")[0].trim().toLowerCase();
  }

  function versionsOf(track) {
    var tl = getTL();
    var base = baseTitle(track && track.title);
    if (!base) return [];
    var out = [];
    for (var i = 0; i < tl.length; i++) {
      if (baseTitle((tl[i] || {}).title) === base) out.push({ track: tl[i], index: i });
    }
    return out;
  }

  /* The other songs from the same era, and the other songs by the same
     producer. Every song in the catalogue is its own name - there are no
     two tracks called the same thing - so the songs that belong together
     are found by the era they are from and the hands that made them. */
  function eraTracks(track, limit) {
    var tl = getTL();
    var era = eraOf(track);
    if (!era || era === "Other") return [];
    var out = [];
    for (var i = 0; i < tl.length && out.length < (limit || 8); i++) {
      var t = tl[i] || {};
      if (t === track) continue;
      if (eraOf(t) === era) out.push({ track: t, index: i });
    }
    return out;
  }

  function producerTracks(track, limit) {
    var tl = getTL();
    var producer = String((track || {}).producer || "").trim().toLowerCase();
    if (!producer) return [];
    var out = [];
    for (var i = 0; i < tl.length && out.length < (limit || 8); i++) {
      var t = tl[i] || {};
      if (t === track) continue;
      if (String(t.producer || "").trim().toLowerCase() === producer) out.push({ track: t, index: i });
    }
    return out;
  }

  /* Who made the picture, if anybody is credited with it. */
  function coverCredit(track) {
    try {
      if (typeof artistData === "undefined" || !artistData || !artistData.length) return "";
      var file = String((track || {}).cover || "")
        .replace("https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/", "")
        .replace(/^Covers\//, "");
      if (!file) return "";
      try { file = decodeURIComponent(file); } catch (e) {}
      for (var v = 0; v < artistData.length; v++) {
        var list = artistData[v].tracks || [];
        for (var b = 0; b < list.length; b++) {
          if (list[b][1] === file) return artistData[v].name || "";
        }
      }
    } catch (e) {}
    return "";
  }

  /* The era, the way the timeline reads it. */
  function eraOf(track) {
    try {
      var m = String((track || {}).tag || "").match(/\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i);
      if (m) return m[1].toUpperCase();
    } catch (e) {}
    return (track && track.category === "halloween") ? "POST" : "Other";
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function smallCover(src) {
    try {
      if (typeof window._coverThumb === "function") return window._coverThumb(src, "320") || src;
    } catch (e) {}
    return src;
  }

  function bigCover(src) {
    try {
      if (typeof window._coverThumb === "function") return window._coverThumb(src, "640") || src;
    } catch (e) {}
    return src;
  }

  /* ---- the facts, in the order they are read ---- */
  function facts(track) {
    var out = [];
    function add(label, value, href) {
      if (!value) return;
      out.push({ label: label, value: value, href: href || "" });
    }
    var album = "";
    try { if (typeof getTrackAlbum === "function") album = getTrackAlbum(track); } catch (e) {}
    add("Producer", track && track.producer);
    add("Year", track && track.year);
    add("Length", track && track.duration ? fmtTime(track.duration) : "");
    add("Era", eraOf(track));
    add("Category", track && track.category ? String(track.category).charAt(0).toUpperCase() + String(track.category).slice(1) : "");
    var credit = coverCredit(track);
    add("Cover art", credit ? "Made by " + credit : "");
    add("Version", album);
    return out;
  }

  /* ---- the page ---- */
  function render(track, index) {
    var page = document.getElementById("song-page");
    if (!page) return;
    page.textContent = "";

    var wrap = el("div", "song-page-wrap");

    /* A way back, and a way to the song itself. */
    var back = el("button", "song-back");
    back.type = "button";
    back.innerHTML = '<i class="fas fa-arrow-left" aria-hidden="true"></i><span>Back</span>';
    back.addEventListener("click", function () {
      if (typeof window.switchAppPage === "function") window.switchAppPage("hub");
    });
    wrap.appendChild(back);

    /* The head: the picture, the name, and what to do with it. */
    var hero = el("div", "song-hero");

    var cover = el("div", "song-cover");
    var img = document.createElement("img");
    img.src = bigCover((track && track.cover) || "Juice-WRLD.png");
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", function () { this.onerror = null; this.src = "Juice-WRLD.png"; });
    cover.appendChild(img);
    hero.appendChild(cover);

    var head = el("div", "song-head");
    var eyebrow = el("div", "song-eyebrow");
    eyebrow.textContent = [eraOf(track), track && track.year].filter(Boolean).join(" - ");
    head.appendChild(eyebrow);

    var title = el("h1", "song-title");
    title.textContent = (track && track.title) || "A song";
    head.appendChild(title);

    var version = el("div", "song-version");
    var album = "";
    try { if (typeof getTrackAlbum === "function") album = getTrackAlbum(track); } catch (e) {}
    version.textContent = album || "";
    if (album) head.appendChild(version);

    var artist = el("div", "song-artist");
    artist.textContent = (track && track.artist) || "Juice WRLD";
    head.appendChild(artist);

    var actions = el("div", "song-actions");

    var play = el("button", "song-action is-primary");
    play.type = "button";
    play.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i><span>Play</span>';
    play.addEventListener("click", function () {
      if (typeof window.selectTrackFromList === "function") window.selectTrackFromList(index);
      if (typeof window.switchAppPage === "function") window.switchAppPage("player");
    });
    actions.appendChild(play);

    var queue = el("button", "song-action");
    queue.type = "button";
    queue.innerHTML = '<i class="fas fa-list" aria-hidden="true"></i><span>Queue</span>';
    queue.addEventListener("click", function () {
      try { if (typeof window.addToQueue === "function") window.addToQueue(index); } catch (e) {}
    });
    actions.appendChild(queue);

    var fav = el("button", "song-action");
    fav.type = "button";
    fav.id = "song-page-fav";
    fav.innerHTML = '<i class="fas fa-heart" aria-hidden="true"></i><span>Favourite</span>';
    fav.addEventListener("click", function () {
      try {
        if (typeof window.toggleFavorite === "function") window.toggleFavorite(index);
        if (typeof window.updateFavBtn === "function") window.updateFavBtn();
      } catch (e) {}
      paintFav(fav, index);
    });
    actions.appendChild(fav);

    var share = el("button", "song-action");
    share.type = "button";
    share.innerHTML = '<i class="fas fa-share-nodes" aria-hidden="true"></i><span>Copy link</span>';
    share.addEventListener("click", function () {
      var url = location.origin + ROOT + "/" + slug(track && track.title);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
        else {
          var box = el("input");
          box.value = url;
          document.body.appendChild(box);
          box.select();
          document.execCommand("copy");
          box.remove();
        }
        var span = share.querySelector("span");
        if (span) {
          var was = span.textContent;
          span.textContent = "Copied";
          setTimeout(function () { span.textContent = was; }, 1400);
        }
      } catch (e) {}
    });
    actions.appendChild(share);

    head.appendChild(actions);
    hero.appendChild(head);
    wrap.appendChild(hero);

    /* The facts. */
    var factList = facts(track);
    if (factList.length) {
      var factsBox = el("div", "song-facts");
      factList.forEach(function (f) {
        var cell = el("div", "song-fact");
        cell.appendChild(el("span", "song-fact-label", f.label));
        cell.appendChild(el("b", "song-fact-value", f.value));
        factsBox.appendChild(cell);
      });
      wrap.appendChild(factsBox);
    }

    /* The songs that belong beside this one: the same era, and the same
       hands. */
    var groups = [
      { title: "More from the " + eraOf(track) + " era", list: eraTracks(track, 8) },
      { title: track && track.producer ? "More by " + track.producer : "", list: producerTracks(track, 8) },
    ];

    groups.forEach(function (group) {
      if (!group.title || group.list.length < 1) return;
      var sec = el("section", "song-section");
      var h2 = el("h2", "song-section-title", group.title);
      h2.appendChild(el("span", "song-section-count", String(group.list.length)));
      sec.appendChild(h2);
      var list = el("div", "song-versions");
      group.list.forEach(function (v) {
        var row = el("button", "song-version-row");
        row.type = "button";
        var vimg = document.createElement("img");
        vimg.className = "song-version-cover";
        vimg.src = smallCover((v.track && v.track.cover) || "Juice-WRLD.png");
        vimg.alt = "";
        vimg.loading = "lazy";
        row.appendChild(vimg);
        var vtext = el("span", "song-version-text");
        vtext.appendChild(el("span", "song-version-title", (v.track && v.track.title) || ""));
        var valbum = "";
        try { if (typeof getTrackAlbum === "function") valbum = getTrackAlbum(v.track); } catch (e) {}
        if (valbum) vtext.appendChild(el("span", "song-version-album", valbum));
        row.appendChild(vtext);
        var vlen = el("span", "song-version-length", v.track && v.track.duration ? fmtTime(v.track.duration) : "");
        row.appendChild(vlen);
        row.addEventListener("click", function () { openSong(v.track && v.track.title); });
        list.appendChild(row);
      });
      sec.appendChild(list);
      wrap.appendChild(sec);
    });

    /* The thread. It is the one thing on the page that has to be asked
       for, and it is asked for when the page is drawn. */
    var csec = el("section", "song-section");
    var ch2 = el("h2", "song-section-title", "Comments");
    ch2.appendChild(el("span", "song-section-count", ""));
    csec.appendChild(ch2);
    var thread = el("div", "song-thread");
    thread.id = "song-page-comments";
    csec.appendChild(thread);
    wrap.appendChild(csec);

    page.appendChild(wrap);

    /* The heart, if it is already a favourite. */
    paintFav(fav, index);

    /* And the thread. */
    try {
      if (window.SongComments && window.SongComments.renderThreadInto) {
        window.SongComments.renderThreadInto(thread, track && track.title).then(function () {
          var count = thread.querySelectorAll(".song-comment").length;
          var badge = ch2.querySelector(".song-section-count");
          if (badge) badge.textContent = String(count);
        });
      }
    } catch (e) {}
  }

  function paintFav(button, index) {
    try {
      if (typeof isFavorite === "function" && isFavorite(index)) button.classList.add("is-on");
      else button.classList.remove("is-on");
    } catch (e) {}
  }

  /* ---- opening a song ---- */
  function openSong(title, noPush) {
    var hit = findTrack(title);
    if (!hit) return false;
    if (typeof window.switchAppPage === "function") window.switchAppPage("song");
    render(hit.track, hit.index);
    try {
      document.title = (hit.track.title || "A song") + " - TheHighWRLD Dashboard";
    } catch (e) {}
    if (!noPush) {
      var path = ROOT + "/" + slug(hit.track.title);
      try {
        if ((location.pathname || "").replace(/\/+$/, "") !== path) {
          history.pushState({ page: "song", title: hit.track.title }, "", path);
        }
      } catch (e) {}
    }
    return true;
  }

  /* The path of a song, for anything that wants to link to it. */
  function pathFor(title) {
    return ROOT + "/" + slug(title);
  }

  window.openSongPage = openSong;
  window.songPagePath = pathFor;
  window.songPageSlug = slug;
})();
