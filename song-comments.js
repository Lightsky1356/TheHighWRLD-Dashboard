/*
 * Song comments — the panel that opens from the player's comment button.
 *
 * A thread per song, the way the song pages on juicewrld.io carry one.
 * The panel shows the song at the top, then the comments: who wrote it,
 * when, the moment of the song it was written at, the comment itself, and
 * the heart under it. A comment can be answered, and the answer sits
 * under the comment it answers.
 *
 * The moment is the part that makes a comment worth reading: "1:12 on
 * Fenty" says exactly which version of the song is being talked about,
 * and the arrow beside it takes the player there.
 *
 * Nothing here is trusted about who the writer is - the server works that
 * out from the session.
 */
(function () {
  "use strict";
  if (window.__songCommentsMounted) return;
  window.__songCommentsMounted = true;

  var API = "/api/song-comments";
  var state = {
    open: false,
    track: "",
    comments: [],
    count: 0,
    replyTo: 0,
    busy: false,
    signedIn: false,
    mode: "moment", /* "moment" pins the comment to the second of the song; "song" means the whole song */
  };

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

  function api(path, options) {
    options = options || {};
    var headers = options.body ? { "Content-Type": "application/json" } : {};
    return fetch(API + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.message || data.error || "The comment could not be saved");
          error.status = response.status;
          error.code = data.error || "";
          throw error;
        }
        return data;
      });
    });
  }

  /* ---- the song ---- */
  function currentTrack() {
    try {
      if (typeof trackList !== "undefined" && trackList && trackList.length &&
          typeof currentTrackIndex === "number" && currentTrackIndex >= 0) {
        return trackList[currentTrackIndex] || null;
      }
    } catch (e) {}
    return null;
  }

  function currentTitle() {
    var t = currentTrack();
    if (t && t.title) return String(t.title);
    /* The player's own title is the fallback: it is what is on screen. */
    var node = document.getElementById("track-title");
    var text = node ? String(node.textContent || "").trim() : "";
    return text && text !== "Select a Track" ? text : "";
  }

  /* The moment of the song the player is at, and the label that goes
     with it. In "whole song" mode there is no moment - the comment is
     about the song as a whole. */
  function nowMoment() {
    if (state && state.mode === "song") return { seconds: 0, label: "" };
    var seconds = 0;
    try {
      var audio = document.querySelector("audio");
      if (audio && isFinite(audio.currentTime)) seconds = Math.max(0, Math.round(audio.currentTime));
    } catch (e) {}
    return { seconds: seconds, label: fmtTime(seconds) };
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function signedIn() {
    try {
      if (typeof window.__thwAuthSignedIn === "boolean") return window.__thwAuthSignedIn;
    } catch (e) {}
    /* The account button only shows when somebody is signed in. */
    var wrap = document.getElementById("nav-account-wrap");
    if (wrap && wrap.style.display !== "none") return true;
    return false;
  }

  /* The user's avatar, the same one the nav carries. Rebuilt rarely and
     cached: the nav node is not ours to re-render. */
  var myAvatarCache = null;
  function myAvatarHTML() {
    if (myAvatarCache !== null) return myAvatarCache;
    var html = '<i class="fas fa-user" aria-hidden="true"></i>';
    try {
      var holder = document.getElementById("navAvatarInner");
      var img = holder && holder.querySelector ? holder.querySelector("img") : null;
      if (img && img.src) html = '<img decoding="async" src="' + esc(img.src) + '" alt="">';
    } catch (e) {}
    myAvatarCache = html;
    return html;
  }

  /* Paint only the parts of the composer that follow the song's clock -
     the same way juicewrld.io's composer moves with the moment. No thread
     re-render, just the two labels. */
  function paintMomentLabels() {
    var m = nowMoment();
    var wholeSong = state.mode === "song";
    var input = document.getElementById("song-comments-input");
    if (input && state.signedIn && !wholeSong) {
      input.placeholder = "Comment at " + (m.label || "0:00");
    }
    var postAt = document.getElementById("song-comments-post-at");
    if (postAt) {
      postAt.textContent = wholeSong ? "Post" : (state.track && m.label ? "Post at " + m.label : "Post");
    }
  }

  /* ---- the markup ---- */
  function mount() {
    if (document.getElementById("song-comments-root")) return;

    var root = el("div");
    root.id = "song-comments-root";
    root.innerHTML =
      '<div id="song-comments-overlay" hidden>' +
        '<div id="song-comments-wash" aria-hidden="true"></div>' +
        '<section id="song-comments-panel" role="dialog" aria-modal="true" aria-labelledby="song-comments-title">' +
          '<header class="song-comments-head">' +
            '<div class="song-comments-head-text">' +
              '<h2 class="song-comments-title" id="song-comments-title">Comments</h2>' +
              '<p class="song-comments-subtitle" id="song-comments-song">No song playing</p>' +
            '</div>' +
            '<button id="song-comments-close" type="button" class="song-comments-close" aria-label="Close comments">' +
              '<i class="fas fa-xmark" aria-hidden="true"></i>' +
            '</button>' +
          '</header>' +
          '<div class="song-comments-tabs" role="tablist">' +
            '<button type="button" class="song-comments-tab is-active" data-tab="comments" role="tab" aria-selected="true">Comments <span id="song-comments-tab-count">0</span></button>' +
            '<button type="button" class="song-comments-tab" data-tab="upnext" role="tab" aria-selected="false">Up next</button>' +
            '<button type="button" class="song-comments-tab" data-tab="credits" role="tab" aria-selected="false">Credits</button>' +
          '</div>' +
          '<div class="song-comments-body">' +
            '<div id="song-comments-list" class="song-comments-list"></div>' +
            '<div id="song-comments-upnext" class="song-comments-upnext" hidden></div>' +
            '<div id="song-comments-credits" class="song-comments-credits" hidden></div>' +
          '</div>' +
          '<div class="song-comments-compose">' +
            '<div id="song-comments-replying" class="song-comments-replying" hidden>' +
              '<span id="song-comments-replying-label"></span>' +
              '<button id="song-comments-replying-cancel" type="button">Cancel</button>' +
            '</div>' +
            '<div class="scc-row">' +
              '<span class="scc-avatar" id="song-comments-avatar"><i class="fas fa-user" aria-hidden="true"></i></span>' +
              '<input id="song-comments-input" class="scc-input" type="text" maxlength="2000" enterkeyhint="send" placeholder="Comment at 0:00" aria-label="Write a comment">' +
              '<button id="song-comments-send" type="button" class="scc-send" aria-label="Send the comment"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
            '</div>' +
            '<div class="scc-moment-row">' +
              '<div class="song-moment-toggle" role="group" aria-label="When this comment applies to">' +
                '<button type="button" class="song-moment-btn is-on" data-mode="moment">This moment</button>' +
                '<button type="button" class="song-moment-btn" data-mode="song">Whole song</button>' +
              '</div>' +
              '<button id="song-comments-post-at" type="button" class="scc-post-at is-on">Post at 0:00</button>' +
            '</div>' +
            '<p id="song-comments-note" class="song-comments-note"></p>' +
          '</div>' +
        '</section>' +
      '</div>';
    document.body.appendChild(root);

    document.getElementById("song-comments-close").addEventListener("click", function () { setOpen(false); });
    document.getElementById("song-comments-wash").addEventListener("click", function () { setOpen(false); });
    document.getElementById("song-comments-send").addEventListener("click", send);
    document.getElementById("song-comments-replying-cancel").addEventListener("click", function () {
      state.replyTo = 0;
      render();
    });
    document.getElementById("song-comments-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); send(); }
    });
    document.getElementById("song-comments-input").addEventListener("input", function () {
      document.getElementById("song-comments-note").textContent = "";
    });

    Array.prototype.forEach.call(document.querySelectorAll(".song-comments-tab"), function (tab) {
      tab.addEventListener("click", function () { showTab(tab.dataset.tab); });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".song-moment-btn"), function (btn) {
      btn.addEventListener("click", function () {
        state.mode = btn.getAttribute("data-mode") === "song" ? "song" : "moment";
        render();
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) {
        e.preventDefault();
        setOpen(false);
      }
    });

    /* The player opens it. */
    var btn = document.getElementById("song-comments-btn");
    if (btn) btn.addEventListener("click", function () { setOpen(true); });
  }

  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".song-comments-tab"), function (tab) {
      var on = tab.dataset.tab === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("song-comments-list").hidden = name !== "comments";
    document.getElementById("song-comments-upnext").hidden = name !== "upnext";
    document.getElementById("song-comments-credits").hidden = name !== "credits";
    if (name === "upnext") renderUpNext();
    if (name === "credits") renderCredits();
  }

  /* ---- opening and closing ---- */
  function setOpen(open, track) {
    state.open = open;
    var overlay = document.getElementById("song-comments-overlay");
    if (!overlay) return;
    overlay.hidden = !open;
    if (open) {
      state.track = track || currentTitle();
      state.signedIn = signedIn();
      render();
      load();
      var input = document.getElementById("song-comments-input");
      if (input) setTimeout(function () { input.focus(); }, 60);
    }
  }

  /* ---- the data ---- */
  function load() {
    var track = state.track;
    if (!track) {
      state.comments = [];
      state.count = 0;
      render();
      return;
    }
    api("?track=" + encodeURIComponent(track)).then(function (data) {
      state.comments = data.comments || [];
      state.count = Number(data.count) || 0;
      render();
    }).catch(function () {
      state.comments = [];
      state.count = 0;
      render();
    });
  }

  function send() {
    if (state.busy) return;
    var input = document.getElementById("song-comments-input");
    var note = document.getElementById("song-comments-note");
    var text = input.value.trim();
    if (!text) { note.textContent = "Write something first."; return; }
    if (!state.signedIn) {
      note.textContent = "Sign in to comment.";
      return;
    }
    var moment = nowMoment();
    state.busy = true;
    note.textContent = "";
    api("", {
      method: "POST",
      body: {
        track: state.track,
        body: text,
        parentId: state.replyTo || 0,
        atSeconds: moment.seconds,
        atLabel: moment.label,
      },
    }).then(function (data) {
      input.value = "";
      state.replyTo = 0;
      state.busy = false;
      if (data.comment) {
        if (data.comment.parentId) {
          var parent = findComment(data.comment.parentId);
          if (parent) parent.replies.push(data.comment);
          else state.comments.push(data.comment);
        } else {
          state.comments.push(data.comment);
        }
        state.count++;
      }
      render();
    }).catch(function (err) {
      state.busy = false;
      note.textContent = err && err.message ? err.message : "The comment could not be saved.";
    });
  }

  function findComment(id) {
    for (var i = 0; i < state.comments.length; i++) {
      var c = state.comments[i];
      if (c.id === id) return c;
      var replies = c.replies || [];
      for (var j = 0; j < replies.length; j++) if (replies[j].id === id) return replies[j];
    }
    return null;
  }

  function toggleLike(comment, after) {
    if (!state.signedIn) return;
    api("/likes", { method: "POST", body: { id: comment.id } }).then(function (data) {
      comment.likes = Number(data.likes) || 0;
      comment.likedByMe = !!data.liked;
      if (after) after();
      else render();
    }).catch(function () {});
  }

  /* ---- the drawing ---- */
  /* ---- the drawing ---- */
  /* The thread, drawn into a box. The panel and a song's own page draw
     the same thread, so they draw it the same way. */
  function drawComments(list, comments, after, onReply) {
    if (!list) return;
    if (!comments || !comments.length) {
      list.appendChild(el("p", "song-comments-empty", "No comments on this song yet."));
      return;
    }
    comments.forEach(function (comment) {
      list.appendChild(commentNode(comment, false, after, onReply));
      (comment.replies || []).forEach(function (reply) {
        list.appendChild(commentNode(reply, true, after, onReply));
      });
    });
  }

  /* ---- the same thread, on a song's own page ----
   *
   * A song's page shows its thread in place rather than behind a button,
   * and the page asks for it here. The reply button opens the panel,
   * which is where the writing is done. */
  function renderThreadInto(container, title) {
    if (!container) return Promise.resolve();
    container.textContent = "";
    return api("?track=" + encodeURIComponent(title)).then(function (data) {
      container.textContent = "";
      drawComments(container, data.comments || [], function () {
        renderThreadInto(container, title);
      }, function () {
        setOpen(true, title);
      });
    }).catch(function () {
      container.textContent = "";
      container.appendChild(el("p", "song-comments-empty", "The comments could not be loaded."));
    });
  }

  function commentNode(comment, isReply, after, onReply) {
    var row = el("div", "song-comment" + (isReply ? " is-reply" : ""));

    var avatar = el("span", "song-comment-avatar");
    if (comment.authorAvatar) {
      var img = document.createElement("img");
      img.src = comment.authorAvatar;
      img.alt = "";
      img.loading = "lazy";
      avatar.appendChild(img);
    } else {
      avatar.appendChild(el("i", "fas fa-user" + " song-comment-avatar-fallback"));
    }
    row.appendChild(avatar);

    var body = el("div", "song-comment-body");

    var head = el("div", "song-comment-head");
    head.appendChild(el("span", "song-comment-name", comment.authorName || "Member"));
    if (comment.createdAt) {
      head.appendChild(el("span", "song-comment-time", when(comment.createdAt)));
    }
    body.appendChild(head);

    if (comment.deleted) {
      body.appendChild(el("p", "song-comment-gone", "This comment was deleted."));
    } else {
      /* The moment of the song, and the arrow that takes the player there. */
      if (comment.atSeconds > 0 || comment.atLabel) {
        var at = el("button", "song-comment-at");
        at.type = "button";
        at.title = "Play from " + (comment.atLabel || fmtTime(comment.atSeconds));
        at.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i>' +
          '<span>' + esc(comment.atLabel || fmtTime(comment.atSeconds)) + "</span>";
        at.addEventListener("click", function () { seekTo(comment); });
        body.appendChild(at);
      }
      body.appendChild(el("p", "song-comment-text", comment.body || ""));

      var actions = el("div", "song-comment-actions");
      var like = el("button", "song-comment-like" + (comment.likedByMe ? " is-on" : ""));
      like.type = "button";
      like.setAttribute("aria-pressed", comment.likedByMe ? "true" : "false");
      like.innerHTML = '<i class="fas fa-heart" aria-hidden="true"></i><span>' + (comment.likes || 0) + "</span>";
      like.addEventListener("click", function () { toggleLike(comment, after); });
      actions.appendChild(like);

      var reply = el("button", "song-comment-reply", "Reply");
      reply.type = "button";
      reply.addEventListener("click", function () {
        if (onReply) { onReply(comment); return; }
        state.replyTo = comment.id;
        render();
        var input = document.getElementById("song-comments-input");
        if (input) input.focus();
      });
      actions.appendChild(reply);

      body.appendChild(actions);
    }

    row.appendChild(body);
    return row;
  }

  function seekTo(comment) {
    var audio = document.querySelector("audio");
    if (!audio) return;
    try {
      audio.currentTime = Math.max(0, Number(comment.atSeconds) || 0);
      if (audio.paused && typeof audio.play === "function") audio.play().catch(function () {});
    } catch (e) {}
  }

  function when(iso) {
    var t = Date.parse(iso);
    if (!t) return "";
    var diff = Date.now() - t;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    var day = Math.floor(hr / 24);
    if (day < 7) return day + "d ago";
    try {
      return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function render() {
    var list = document.getElementById("song-comments-list");
    if (!list) return;
    list.textContent = "";

    var song = document.getElementById("song-comments-song");
    if (song) song.textContent = state.track || "No song playing";

    var count = document.getElementById("song-comments-tab-count");
    if (count) count.textContent = String(state.count || 0);

    /* The count on the player's button. */
    var badge = document.getElementById("song-comments-count");
    if (badge) {
      badge.textContent = String(state.count || 0);
      badge.classList.toggle("on", state.count > 0);
    }

    if (!state.track) {
      var empty = el("p", "song-comments-empty", "Play a song to see its comments.");
      list.appendChild(empty);
    } else {
      drawComments(list, state.comments);
    }

    /* The reply banner. */
    var banner = document.getElementById("song-comments-replying");
    var label = document.getElementById("song-comments-replying-label");
    if (banner) {
      if (state.replyTo) {
        var parent = findComment(state.replyTo);
        banner.hidden = false;
        if (label) label.textContent = "Replying to " + ((parent && parent.authorName) || "a comment");
      } else {
        banner.hidden = true;
        if (label) label.textContent = "";
      }
    }

    /* The composer. */
    var send = document.getElementById("song-comments-send");
    var input = document.getElementById("song-comments-input");
    var postAt = document.getElementById("song-comments-post-at");
    var avatar = document.getElementById("song-comments-avatar");
    var mm = nowMoment();
    var wholeSong = state.mode === "song";
    if (send) send.disabled = !state.signedIn;
    if (input) {
      input.disabled = !state.signedIn;
      input.placeholder = !state.signedIn
        ? "Sign in to comment"
        : wholeSong ? "Comment on the song" : "Comment at " + (mm.label || "0:00");
    }
    if (avatar) {
      var html = myAvatarHTML();
      if (avatar.__sccAvatar !== html) { avatar.__sccAvatar = html; avatar.innerHTML = html; }
    }
    var note = document.getElementById("song-comments-note");
    if (note && !state.signedIn) note.textContent = "Sign in to comment on this song.";

    /* The moment toggle and the post button follow the mode. */
    var modeBtns = document.querySelectorAll(".song-moment-btn");
    Array.prototype.forEach.call(modeBtns, function (btn) {
      var on = btn.getAttribute("data-mode") === state.mode;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (postAt) {
      postAt.textContent = wholeSong ? "Post" : (state.track && mm.label ? "Post at " + mm.label : "Post");
      postAt.classList.toggle("is-on", !wholeSong);
      postAt.setAttribute("aria-pressed", wholeSong ? "false" : "true");
    }
  }

  /* ---- the other two tabs ---- */
  function renderUpNext() {
    var box = document.getElementById("song-comments-upnext");
    if (!box) return;
    box.textContent = "";
    /* The queue lives in the player; the panel shows what is lined up
       behind the song. */
    var queue = [];
    try {
      if (typeof trackQueue !== "undefined" && trackQueue) queue = trackQueue.slice();
    } catch (e) {}
    if (!queue.length) {
      box.appendChild(el("p", "song-comments-empty", "Nothing is lined up after this song."));
      return;
    }
    queue.forEach(function (idx, i) {
      var t = null;
      try { t = (typeof trackList !== "undefined" ? trackList[idx] : null); } catch (e) {}
      var row = el("div", "song-upnext-row");
      row.appendChild(el("span", "song-upnext-num", String(i + 1)));
      row.appendChild(el("span", "song-upnext-title", (t && t.title) || "Track " + (idx + 1)));
      box.appendChild(row);
    });
  }

  /* Era codes, display names and slugs - same table the era pages use. */
  var ERA_INFO = {
    "GB&GR": { name: "Goodbye & Good Riddance", slug: "gbgr" },
    "WOD":   { name: "WRLD ON DRUGS",           slug: "wod" },
    "DRFL":  { name: "Death Race For Love",     slug: "drfl" },
    "JW3":   { name: "Legends Never Die",       slug: "jw3" },
    "POST":  { name: "Posthumous",              slug: "post" },
    "OUT":   { name: "Outsiders",               slug: "out" },
    "AF":    { name: "affliction",              slug: "af" },
    "ND":    { name: "NOTHING'S DIFFERENT",     slug: "nd" },
    "BDM":   { name: "BINGEDRINKINGMUSIC",      slug: "bdm" },
    "SOUNDCLOUD": { name: "SoundCloud era",     slug: "soundcloud" },
  };
  var ERA_RE = /\((GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|SOUNDCLOUD)\)/i;

  function eraInfoOf(t) {
    try {
      var m = String((t || {}).tag || "").match(ERA_RE);
      var code = m ? m[1].toUpperCase() : ((t && t.category === "halloween") ? "POST" : "");
      if (code && ERA_INFO[code]) return { code: code };
    } catch (e) {}
    return null;
  }

  /* The number of vault songs a given producer credits - one lookup, used once
     per credits render, on a catalogue of a few hundred tracks. */
  function producerSongCount(name) {
    try {
      if (typeof trackList === "undefined" || !trackList) return 0;
      var want = String(name || "").trim().toLowerCase();
      if (!want) return 0;
      var n = 0;
      for (var i = 0; i < trackList.length; i++) {
        if (String((trackList[i] && trackList[i].producer) || "").trim().toLowerCase() === want) n++;
      }
      return n;
    } catch (e) { return 0; }
  }

  /* Which artist drew the cover, from the site's own credit table. */
  function coverCreditOf(t) {
    try {
      if (typeof artistData === "undefined" || !artistData) return "";
      var file = String((t || {}).cover || "")
        .replace("https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/", "")
        .replace(/^Covers\//, "");
      try { file = decodeURIComponent(file); } catch (e) {}
      if (!file) return "";
      for (var i = 0; i < artistData.length; i++) {
        var list = (artistData[i] && artistData[i].tracks) || [];
        for (var j = 0; j < list.length; j++) {
          if (String(list[j][1] || "").toLowerCase() === file.toLowerCase()) return artistData[i].name || "";
        }
      }
    } catch (e) {}
    return "";
  }

  function statusLabel(t) {
    var c = String((t || {}).category || "").toLowerCase();
    return c === "leaks" ? "Leaked" : c === "sessions" ? "Session" : c === "halloween" ? "Halloween" : "";
  }

  function renderCredits() {
    var box = document.getElementById("song-comments-credits");
    if (!box) return;
    box.textContent = "";
    var t = currentTrack();
    if (!t) {
      box.appendChild(el("p", "song-comments-empty", "No song playing."));
      return;
    }
    var grid = el("div", "song-credits-grid");
    function cell(label, value, opts) {
      opts = opts || {};
      var c = el("div", "song-credit-cell" + (opts.wide ? " song-credit-cell--wide" : ""));
      c.appendChild(el("span", "song-credit-label", label));
      var b = opts.link
        ? (function () { var a = el("a", "song-credit-value song-credit-link", String(value)); a.href = opts.link; return a; })()
        : el("b", "song-credit-value", String(value));
      c.appendChild(b);
      grid.appendChild(c);
    }
    var status = statusLabel(t);
    if (status) cell("Status", status);
    var era = eraInfoOf(t);
    if (era) cell("Era", ERA_INFO[era.code].name, { link: "/era/" + ERA_INFO[era.code].slug });
    var album = "";
    try { if (typeof getTrackAlbum === "function") album = getTrackAlbum(t); } catch (e) {}
    if (album) cell("Version", album, { wide: true });
    if (t.producer) {
      var n = producerSongCount(t.producer);
      cell("Produced by", n ? t.producer + " · " + n + (n === 1 ? " song" : " songs") : t.producer, { wide: true });
    }
    if (t.year) cell("Year", t.year);
    if (t.duration) cell("Length", fmtTime(t.duration));
    if (t.artist) cell("Artist", t.artist);
    var credit = coverCreditOf(t);
    if (credit) cell("Cover art", "Made by " + credit);
    if (grid.children.length) box.appendChild(grid);
    else box.appendChild(el("p", "song-comments-empty", "No credits on record for this song."));
  }

  function boot() {
    mount();
    var audio = document.querySelector("audio");
    if (audio) {
      audio.addEventListener("timeupdate", paintMomentLabels);
      audio.addEventListener("seeked", paintMomentLabels);
    }
    /* timeupdate is enough, and this catches anything it misses. */
    setInterval(paintMomentLabels, 1000);
    /* The count on the player's button, kept fresh without a request for
       every song: the panel loads the thread when it opens, and the badge
       follows the song that is playing. */
    setInterval(function () {
      if (state.open) return;
      var track = currentTitle();
      if (!track || track === state.track) return;
      state.track = track;
      api("?track=" + encodeURIComponent(track)).then(function (data) {
        state.count = Number(data.count) || 0;
        var badge = document.getElementById("song-comments-count");
        if (badge) {
          badge.textContent = String(state.count || 0);
          badge.classList.toggle("on", state.count > 0);
        }
      }).catch(function () {});
    }, 20000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* The thread, for a song's own page to draw in place. */
  window.SongComments = {
    renderThreadInto: renderThreadInto,
    open: function (title) { setOpen(true, title); },
  };
})();
