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
     with it. */
  function nowMoment() {
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
            '<textarea id="song-comments-input" class="song-comments-input" rows="2" maxlength="2000" ' +
              'placeholder="Say something about this song"></textarea>' +
            '<div class="song-comments-compose-foot">' +
              '<span id="song-comments-moment" class="song-comments-moment"></span>' +
              '<button id="song-comments-send" type="button" class="song-comments-send">Post</button>' +
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
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
    });
    document.getElementById("song-comments-input").addEventListener("input", function () {
      document.getElementById("song-comments-note").textContent = "";
    });

    Array.prototype.forEach.call(document.querySelectorAll(".song-comments-tab"), function (tab) {
      tab.addEventListener("click", function () { showTab(tab.dataset.tab); });
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
  function setOpen(open) {
    state.open = open;
    var overlay = document.getElementById("song-comments-overlay");
    if (!overlay) return;
    overlay.hidden = !open;
    if (open) {
      state.track = currentTitle();
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

  function toggleLike(comment) {
    if (!state.signedIn) return;
    api("/likes", { method: "POST", body: { id: comment.id } }).then(function (data) {
      comment.likes = Number(data.likes) || 0;
      comment.likedByMe = !!data.liked;
      render();
    }).catch(function () {});
  }

  /* ---- the drawing ---- */
  function commentNode(comment, isReply) {
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
      like.addEventListener("click", function () { toggleLike(comment); });
      actions.appendChild(like);

      var reply = el("button", "song-comment-reply", "Reply");
      reply.type = "button";
      reply.addEventListener("click", function () {
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
    } else if (!state.comments.length) {
      var none = el("p", "song-comments-empty", "No comments on this song yet.");
      list.appendChild(none);
    } else {
      state.comments.forEach(function (comment) {
        list.appendChild(commentNode(comment, false));
        (comment.replies || []).forEach(function (reply) {
          list.appendChild(commentNode(reply, true));
        });
      });
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
    var moment = document.getElementById("song-comments-moment");
    if (send) send.disabled = !state.signedIn;
    if (input) {
      input.disabled = !state.signedIn;
      input.placeholder = state.signedIn
        ? "Say something about this song"
        : "Sign in to comment on this song";
    }
    if (moment) {
      var m = nowMoment();
      moment.textContent = state.track ? ("at " + m.label) : "";
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
    [
      ["Song", t.title],
      ["Artist", t.artist],
      ["Version", t.tag],
      ["Producer", t.producer],
      ["Year", t.year],
      ["Category", t.category],
      ["Length", t.duration ? fmtTime(t.duration) : ""],
    ].forEach(function (pair) {
      if (!pair[1]) return;
      var cell = el("div", "song-credit-cell");
      cell.appendChild(el("span", "song-credit-label", pair[0]));
      cell.appendChild(el("b", "song-credit-value", String(pair[1])));
      grid.appendChild(cell);
    });
    box.appendChild(grid);
  }

  function boot() {
    mount();
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
})();
