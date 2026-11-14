/* Comment markers — the little avatars along the progress bar
 *
 * The juicewrld.io bottom bar shows who wrote at which moment of the song,
 * as avatars docked on the scrubber. Any surface with a progress bar gets
 * the same treatment here: markers for the moment pins, clustered when
 * comments bunch up, an avatar or two and a "+N" badge when a moment is
 * busy, and a tap seeks the song to the moment the comment was made.
 *
 * Whole-song comments (posted with no clock) are left out — they are not
 * a point on the bar. Anything older than a minute is not re-fetched;
 * surfaces call refresh() on track change and on their own tick anyway.
 */
(function () {
  "use strict";
  if (window.__thwMarkersMounted) return;
  window.__thwMarkersMounted = true;

  var cssInjected = false;
  function css() {
    if (cssInjected || document.getElementById("thw-markers-style")) { cssInjected = true; return; }
    cssInjected = true;
    var st = document.createElement("style");
    st.id = "thw-markers-style";
    st.textContent =
      ".thw-markers{position:relative;display:block;height:22px;margin-top:4px;pointer-events:none}" +
      ".thw-mk{position:absolute;top:0;transform:translateX(-50%);pointer-events:auto;display:flex;align-items:center;padding:0;border:none;background:transparent;cursor:pointer;z-index:1}" +
      ".thw-mk-avatar{width:20px;height:20px;border-radius:50%;border:1.5px solid #0e0c0a;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#3b2d5a;font-size:9px;color:rgba(255,255,255,.85);flex-shrink:0}" +
      ".thw-mk-avatar img{width:100%;height:100%;object-fit:cover;display:block}" +
      ".thw-mk-stack{margin-left:-9px}" +
      ".thw-mk-badge{margin-left:4px;min-width:17px;height:16px;padding:0 4px;border-radius:8px;background:#e879f9;color:#1c0f1e;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center}" +
      ".thw-mk:hover{z-index:5}" +
      ".thw-mk:hover .thw-mk-avatar{border-color:#e879f9}" +
      "@media (max-width:767px){.thw-mk-avatar{width:18px;height:18px}}";
    (document.head || document.documentElement).appendChild(st);
  }

  var cache = {};
  var TTL = 60000;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function currentTitle() {
    try {
      if (typeof currentTrackIndex === "number" && typeof trackList !== "undefined" && trackList[currentTrackIndex]) {
        return String(trackList[currentTrackIndex].title || "");
      }
    } catch (e) {}
    return "";
  }
  function audio() { try { return document.querySelector("audio"); } catch (e) { return null; } }

  function loadComments(title, cb) {
    var hit = cache[title];
    var now = Date.now();
    if (hit && now - hit.at < TTL) return cb(hit.comments);
    fetch("/api/song-comments?track=" + encodeURIComponent(title), { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        var list = (d && Array.isArray(d.comments)) ? d.comments : [];
        list = list.filter(function (c) {
          return c && (Number(c.atSeconds) > 0 || (typeof c.atLabel === "string" && c.atLabel.trim() !== ""));
        });
        cache[title] = { at: now, comments: list };
        cb(list);
      })
      .catch(function () { cb([]); });
  }

  function cluster(list, duration) {
    var win = Math.max(6, duration * 0.03);
    var sorted = list.slice().sort(function (a, b) { return (Number(a.atSeconds) || 0) - (Number(b.atSeconds) || 0); });
    var out = [];
    var cur = null;
    for (var i = 0; i < sorted.length; i++) {
      var c = sorted[i];
      var s = Number(c.atSeconds) || 0;
      if (!cur || s - cur.start > win) {
        cur = { start: s, comments: [c] };
        out.push(cur);
      } else {
        cur.comments.push(c);
      }
    }
    return out;
  }

  function render(strip, title, duration) {
    loadComments(title, function (comments) {
      if (!strip.isConnected) return;
      if (strip.getAttribute("data-for") !== title) return;
      strip.textContent = "";
      var clusters = cluster(comments, duration);
      if (!clusters.length) { strip.style.height = "0px"; strip.style.marginTop = "0px"; return; }
      strip.style.height = "";
      strip.style.marginTop = "";
      for (var i = 0; i < clusters.length; i++) {
        (function (cl) {
          var avg = 0;
          for (var j = 0; j < cl.comments.length; j++) avg += Number(cl.comments[j].atSeconds) || 0;
          avg /= cl.comments.length;
          var pct = Math.max(0, Math.min(100, (avg / duration) * 100));
          var n = cl.comments.length;
          var first = cl.comments[0];
          var names = first.authorName || "Member";
          var snippet = String(first.body || "").trim();
          var titleText = names + (n > 1 ? " +" + (n - 1) + " others" : "") + (first.atLabel ? " · " + first.atLabel : "") + (snippet ? " — " + snippet.slice(0, 90) : "");

          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "thw-mk";
          btn.style.left = pct + "%";
          btn.title = titleText;
          btn.setAttribute("aria-label", "Go to " + (first.atLabel || "the comment"));

          var shown = cl.comments.slice(0, Math.min(2, n));
          for (var k = 0; k < shown.length; k++) {
            var c = shown[k];
            var aEl = document.createElement("span");
            aEl.className = "thw-mk-avatar" + (k === 1 ? " thw-mk-stack" : "");
            if (c.authorAvatar) {
              aEl.innerHTML = '<img decoding="async" loading="lazy" src="' + esc(c.authorAvatar) + '" alt="" onerror="this.onerror=null;this.innerHTML=\'<i class=&quot;fas fa-user&quot;></i>\'">';
            } else {
              aEl.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i>';
            }
            btn.appendChild(aEl);
          }
          if (n > 1) {
            var badge = document.createElement("span");
            badge.className = "thw-mk-badge";
            badge.textContent = String(n);
            btn.appendChild(badge);
          }
          btn.addEventListener("click", function () {
            var au = audio();
            if (au && au.duration && isFinite(au.duration)) {
              au.currentTime = Math.max(0, Math.min(au.duration, avg));
            }
          });
          strip.appendChild(btn);
        })(clusters[i]);
      }
    });
  }

  /* each surface calls this; finds every [data-thw-markers] strip under root and paints it */
  function refresh(root) {
    if (!root) return;
    css();
    var strips = root.querySelectorAll("[data-thw-markers]");
    for (var i = 0; i < strips.length; i++) paint(strips[i]);
  }

  function paint(strip) {
    var title = currentTitle();
    var au = audio();
    var duration = au && isFinite(au.duration) && au.duration > 0 ? au.duration : 0;
    if (!title) { strip.textContent = ""; return; }
    strip.setAttribute("data-for", title);
    if (!duration) {
      setTimeout(function () { paint(strip); }, 700);
      return;
    }
    render(strip, title, duration);
  }

  window.THWCommentMarkers = { refresh: refresh };

  function refreshAll() {
    var strips = document.querySelectorAll("[data-thw-markers]");
    for (var i = 0; i < strips.length; i++) {
      var root = strips[i].closest("[data-markers-root]") || document;
      refresh(root);
    }
  }

  document.addEventListener("thw:trackplaying", function () { setTimeout(refreshAll, 150); });
  /* metadata can land a beat late (or the user seeks); a slow poll catches it */
  setInterval(refreshAll, 15000);
})();
