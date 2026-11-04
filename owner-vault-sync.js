/* ==========================================================================
   owner-vault-sync.js - Owner Dashboard "Vault Sync" tab
   --------------------------------------------------------------------------
   What it does (all READ-ONLY):
     1. "Scan for New Songs/Covers" lists exactly what the track-sync pipeline
        will add to tracks.js on its next run: the Audio/ mp3s whose core
        title is not in the vault (matching the pipeline's own coreTitle,
        bare-title and stem rules, including the (vN) copy skips).
     2. It reports covers that will land with a new song, covers that match
        no vault song at all (orphans), vault songs with no cover, and vault
        songs whose cover has no entry in the gradient table yet.
     3. Live timers: the track-sync workflow runs every 30 minutes on GitHub
        Actions (cron every :00 and :30) - the tab counts down to the next sync,
        shows the last run's status, and can auto-rescan on a timer while the
        dashboard is open.
   The browser cannot write to the repo, so nothing here pushes - the writes
   stay in scripts/auto-sync-tracks.cjs (cron / manual node run).
   ========================================================================== */
(function () {
  "use strict";

  var AUDIO_REPO = "Lightsky1356/TheHighWRLD";
  var DASH_REPO = "Lightsky1356/TheHighWRLD-Dashboard";
  var BRANCH = "main";
  var CRON_MIN = 30;       /* track-sync.yml: every 30 min */
  var AUTO_MIN = 15;       /* auto-rescan cadence while the panel is open */
  var AUTO_KEY = "thwVaultSyncAuto";

  var els = {};
  var lastTreeTs = 0;      /* timestamp of the last successful repo fetch */
  var timer = null;
  var scanning = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------- the same
     shapers the Node pipeline uses (scripts/auto-sync-tracks.cjs) - the scan
     must report what THAT script decides is new, not a lookalike. */
  var ERA_SET = ["WOD", "DRFL", "JW3", "GB&GR", "OUT", "AF", "LTR", "LPD", "JW2", "JUICE",
    "DR", "FL", "JW1", "DE", "QB", "BT", "EP", "DEMO", "DLX", "TPNE", "PTX"];
  var VERSION_RE = /^\(v[0-9]+(?:\.\d+)?\)$/i;
  function coreStem(stem) {
    var groups = stem.match(/\([^()]*\)/g) || [];
    var out = stem;
    for (var i = 0; i < groups.length; i++) {
      var inner = groups[i].slice(1, -1).trim();
      if (ERA_SET.indexOf(inner.toUpperCase()) >= 0 || VERSION_RE.test(groups[i]) ||
        /^(Sessions|Halloween)$/i.test(inner)) {
        out = out.replace(groups[i], " ");
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }
  var norm = function (s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var bareKey = function (s) { return norm((s || "").replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim()); };
  /* first filename segment of a vault track url */
  function stemOfTrack(t) { try { return decodeURIComponent(String(t.url || "").split("/Audio/")[1] || ""); } catch (e) { return ""; } }
  function coverOfTrack(t) { try { return decodeURIComponent(String(t.cover || "").split("/Covers/")[1] || ""); } catch (e) { return ""; } }
  /* coverFor's three passes, on the client */
  function coverFor(stem, coverNames) {
    var core = norm(coreStem(stem));
    var stemNorm = norm(String(stem).replace(VERSION_RE, " ").replace(/\s+/g, " "));
    var i, f, n, best = "", bestLen = 0;
    for (i = 0; i < coverNames.length; i++) { f = coverNames[i]; if (norm(f.replace(/\.png$/i, "")) === core) return f; }
    for (i = 0; i < coverNames.length; i++) { f = coverNames[i]; if (norm(f.replace(/\.png$/i, "")) === stemNorm) return f; }
    for (i = 0; i < coverNames.length; i++) {
      f = coverNames[i]; n = norm(f.replace(/\.png$/i, ""));
      if (n && core.indexOf(n) === 0 && n.length > bestLen) { best = f; bestLen = n.length; }
    }
    return best;
  }

  function trackListNow() {
    return (typeof trackList !== "undefined" && trackList && trackList.length) ? trackList : null;
  }
  /* kept for future callers; scan() inlines the check itself */

  /* ------------------------------------------------------------------ scan */

  function scan(manual) {
    if (scanning || !els.results) return;
    var list = (typeof trackList !== "undefined" && trackList && trackList.length) ? trackList : null;
    if (!list) {
      els.results.innerHTML = ['<p class="vs-empty">The vault list is still loading - try again in a moment.</p>'].join("");
      return;
    }
    scanning = true;
    if (els.scanBtn) {
      els.scanBtn.disabled = true;
      els.scanBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Scanning the audio repo...';
    }
    var p1 = fetch("https://api.github.com/repos/" + AUDIO_REPO + "/git/trees/" + BRANCH + "?recursive=1",
      { headers: { Accept: "application/vnd.github+json" } }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "ratelimit" : ("HTTP " + r.status));
        return r.json();
      });
    var p2 = fetch("https://api.github.com/repos/" + DASH_REPO + "/actions/runs?per_page=1",
      { headers: { Accept: "application/vnd.github+json" } }).then(function (r) {
        return (r.ok ? r.json() : null);
      }).catch(function () { return null; });
    Promise.all([p1, p2]).then(function (a) {
      var data = a[0], runs = a[1];
      var paths = (data && data.tree) ? data.tree : [];
      var truncated = !!(data && data.truncated);
      var audio = [], covers = [];
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i].path || "";
        if (/^Audio\/[^/]+\.mp3$/i.test(p)) audio.push(p.slice(6));
        else if (/^Covers\/[^/]+\.png$/i.test(p)) covers.push(p.slice(7));
      }
      if (truncated) { /* tree too big - fall back to the two-dir contents API */
        return Promise.all([
          fetch("https://api.github.com/repos/" + AUDIO_REPO + "/contents/Audio?ref=" + BRANCH, { headers: { Accept: "application/vnd.github+json" } }),
          fetch("https://api.github.com/repos/" + AUDIO_REPO + "/contents/Covers?ref=" + BRANCH, { headers: { Accept: "application/vnd.github+json" } })
        ]).then(function (rs) {
          if (rs[0].ok && rs[1].ok) {
            return rs[0].json().then(function (a2) {
              return rs[1].json().then(function (c2) {
                audio = a2.filter(function (x) { return x.type === "file" && /\.mp3$/i.test(x.name); }).map(function (x) { return x.name; });
                covers = c2.filter(function (x) { return x.type === "file" && /\.png$/i.test(x.name); }).map(function (x) { return x.name; });
                got(a2, c2);
              });
            });
          }
          throw new Error("ratelimit");
        });
      }
      got(audio, covers, runs);

      function got(audioFiles, coverFiles, runsDataPassed) {
        lastTreeTs = Date.now();
        var runsData = window.__vsRuns = runsDataPassed;
        /* the vault, through the pipeline's eyes */
        var stemsIn = {}, coresIn = {}, baresIn = {};
        for (i = 0; i < list.length; i++) {
          var ts = stemOfTrack(list[i]); if (!ts) continue;
          stemsIn[ts] = 1; coresIn[norm(coreStem(ts))] = 1; baresIn[bareKey(ts)] = 1;
        }
        var usedCovers = {};
        for (i = 0; i < list.length; i++) { var c = coverOfTrack(list[i]); if (c) usedCovers[c] = 1; }

        var newSongs = [], pairedCovers = {};
        for (i = 0; i < audioFiles.length; i++) {
          var name = audioFiles[i];
          var stem = String(name).replace(/\.mp3$/i, "");
          if (stemsIn[stem] !== undefined) continue;
          if (coresIn[norm(coreStem(stem))] !== undefined || baresIn[bareKey(stem)] !== undefined) continue;
          var isSessions = /\(Sessions\)/i.test(stem);
          var disp = coreStem(stem).replace(VERSION_RE, " ").replace(/\s+/g, " ").trim();
          if (isSessions && !/\(Sessions\)/i.test(disp)) disp += " (Sessions)";
          var cov = coverFor(stem, coverFiles);
          if (cov) pairedCovers[cov] = 1;
          newSongs.push({ file: name, title: disp, sessions: isSessions, cover: cov });
        }
        var orphanCovers = [];
        for (i = 0; i < coverFiles.length; i++) {
          if (pairedCovers[coverFiles[i]] !== undefined || usedCovers[coverFiles[i]] !== undefined) continue;
          orphanCovers.push(coverFiles[i]);
        }
        var noCover = [], noGradient = [];
        var gmap = (typeof coverGradientMap !== "undefined") ? coverGradientMap : {};
        for (i = 0; i < list.length; i++) {
          var tCover = coverOfTrack(list[i]);
          if (!tCover) noCover.push(list[i]);
          else if (gmap["Covers/" + tCover] === undefined) noGradient.push(list[i]);
        }
        render(newSongs, orphanCovers, noCover, noGradient, audioFiles.length, coverFiles.length,
          runsData && runsData.workflow_runs && runsData.workflow_runs[0]);
        if (els.badge) {
          var hit = newSongs.length;
          if (hit > 0) { els.badge.textContent = hit > 99 ? "99+" : String(hit); els.badge.style.display = ""; }
          else els.badge.style.display = "none";
        }
      }
    }).catch(function (e) {
      lastTreeTs = Date.now(); /* slow the auto-rescan loop after a failure too */
      if (els.summary) els.summary.innerHTML = '';
      if (els.results) {
        els.results.innerHTML =
          ['<p class="vs-empty">',
           e && e.message === "ratelimit"
             ? 'GitHub politely rate-limited the scan (unauthenticated IP quota). It frees up shortly; the next timer tick will retry automatically.'
             : ('The scan could not reach the repo (' + esc(e && e.message || "network error") + ').'),
           '</p>'].join("");
      }
      resetBtn(false);
    });
  }

  /* restore the scan button after a run (success or failure) */
  function resetBtn(running) {
    scanning = false;
    if (els.scanBtn && !running) {
      els.scanBtn.disabled = false;
      els.scanBtn.innerHTML = '<i class="fas fa-magnifying-glass"></i> Scan for New Songs/Covers';
    }
  }

  /* ----------------------------------------------------------------- render */

  function relTime(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    return Math.floor(s / 3600) + "h ago";
  }

  function render(newSongs, orphans, noCover, noGradient, nAudio, nCovers, run) {
    var chip = function (cls, txt) { return '<span class="vs-chip ' + cls + '">' + txt + '</span>'; };
    var chips = [
      chip("b", "Audio repo: " + nAudio + " mp3"),
      chip("b", "Covers: " + nCovers + " png"),
      chip("gold", newSongs.length + ' new song' + (newSongs.length === 1 ? '' : 's') + ' waiting to sync'),
      chip("green", newSongs.filter(function (x) { return x.cover; }).length + " covers will land with them"),
      chip("amber", noCover.length + ' vault song' + (noCover.length === 1 ? '' : 's') + ' without a cover'),
      chip(orphans.length ? "grey" : "dim", orphans.length + " orphan cover" + (orphans.length === 1 ? '' : 's')),
      chip("cyan", noGradient.length + " missing gradient" + (noGradient.length === 1 ? '' : 's'))
    ];
    if (els.summary) els.summary.innerHTML = chips.join("");

    var out = "";
    function section(title, note, rows) {
      if (!rows.length) return "";
      var body = rows.slice(0, 200).map(function (r) {
        return '<div class="vs-row"' + (r[2] ? ' data-vs-file="' + esc(r[2]) + '"' : "") + '>' +
          '<span class="vs-row-name">' + esc(r[0]) + '</span>' +
          '<span class="vs-row-meta">' + esc(r[1]) + '</span></div>';
      }).join("");
      var more = rows.length > 200 ? '<div class="vs-row"><span class="vs-row-meta">(+' + (rows.length - 200) + ' more)</span></div>' : "";
      out += '<div class="vs-block"><div class="vs-block-title">' + esc(title) +
        '<span class="vs-block-note">' + esc(note) + '</span></div>' +
        '<div class="vs-list">' + body + more + '</div></div>';
    }
    section("New songs - the next sync adds " + newSongs.length, "matches the pipeline's own add rules; this is its exact diff", newSongs.map(function (x) {
      return [x.file, (x.sessions ? "sessions" : "leaks") + (x.cover ? " - cover " + x.cover : " - NO cover in Covers/"), x.file];
    }));
    if (noCover.length) section("Vault songs without a cover", "drop a matching png in Covers/ and the cover appears", noCover.map(function (t) {
      return [String(t.title || ""), String(t.tag || "")];
    }));
    if (noGradient.length) section("Vault songs with a cover but no gradient", "the entry renders with the fallback gradient; re-upload or re-sync repairs these", noGradient.map(function (t) {
      return [String(t.title || ""), coverOfTrack(t)];
    }));
    section("Orphan covers", "no vault song matches these by name", orphans.map(function (c) { return [c, "Covers/"]; }));

    if (run) {
      var st = (run.status === "COMPLETED" && run.conclusion === "success") ? "success"
        : (run.status === "COMPLETED" ? ("COMPLETED." + run.conclusion) : run.status);
      out += '<div class="vs-run">Last track-sync run: ' + esc(st) + " - " +
        esc(relTime(new Date(run.run_started_at || run.created_at).getTime())) + "</div>";
    } else {
      out += '<div class="vs-run">Last track-sync run: could not be read this time.</div>';
    }
    if (els.results) els.results.innerHTML = out;
    resetBtn(false);
    window.__vsRunTime = Date.now();
    /* the producer / year / alt-names preview arrives separately (per-song
       metadata requests), filling in after the rows are on the screen */
    enrichSongs(newSongs);
  }

  /* --------------------------------------------------- producer/alt/year */

  /* For every NEW song, ask juicewrldapi.com what the pipeline's own metadata
     lookup will answer when it adds the song: producer(s), year and aka
     titles. juicewrld.io's tracker would be ideal here, but its whole index
     is ~1.8 MB per scan - too heavy for a browser tab, so the API search is
     used for these few rows (CORS-open, small budget of one request/song). */
  function enrichSongs(newSongs) {
    if (!els.results) return;
    var list = newSongs.slice(0, 12);
    if (!list.length) return;
    var rowFor = {};
    var nodes = els.results.querySelectorAll(".vs-row[data-vs-file]");
    for (var i = 0; i < nodes.length; i++) rowFor[nodes[i].getAttribute("data-vs-file")] = nodes[i];
    list.forEach(function (song) {
      var row = rowFor[song.file];
      if (!row) return;
      var q = String(song.title || "").replace(/\s*\((Sessions|Halloween)\)\s*/i, " ").trim();
      var target = norm(coreStem(String(song.file).replace(/\.mp3$/i, "")));
      var bareT = bareKey(String(song.file).replace(/\.mp3$/i, ""));
      fetch("https://juicewrldapi.com/juicewrld/songs/?search=" + encodeURIComponent(q),
        { headers: { Accept: "*/*" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (data) {
          if (!row.isConnected) return;
          var results = (data && data.results) || [];
          var best = null, bestScore = 0;
          var titles = function (s) { return [s.name].concat(s.track_titles || []); };
          for (var s = 0; s < results.length; s++) {
            var tl = titles(results[s]);
            for (var j = 0; j < tl.length; j++) {
              var n = norm(tl[j]);
              if (!n) continue;
              var score = 0;
              if (n === target) score = 8;
              else if (n.length && bareT.indexOf(n) === 0) score = 6;
              else if (bareT && n.indexOf(bareT) === 0) score = 5;
              else if (bareT && n.indexOf(bareT) >= 0) score = 3;
              if (score > bestScore) { bestScore = score; best = results[s]; }
            }
          }
          if (!best || bestScore < 3) return;
          var y = (String(best.record_dates || "") + " " + String(best.release_date || "") +
            " " + String(best.dates || "") + " " +
            String((best.era && best.era.time_frame) || "")).match(/\b(?:19|20)\d{2}\b/);
          var bits = [];
          if (best.producers) bits.push(best.producers);
          if (y) bits.push(y[0]);
          var alts = (best.track_titles || []).slice(0, 2);
          if (alts.length) bits.push("aka " + alts.join(", "));
          if (!bits.length) return;
          var meta = row.querySelector(".vs-row-meta");
          if (meta && !row.__vsEnriched) {
            row.__vsEnriched = 1;
            meta.textContent = meta.textContent + "   |   " + bits.join(" | ");
          }
        });
    });
  }

  /* ------------------------------------------------------------------ timer */

  function tick() {
    if (!els.nextEl) return;
    /* the scheduled run fires at every :00 and :30 */
    var ms = CRON_MIN * 60 * 1000;
    var next = Math.ceil((Date.now() + 1000) / ms) * ms;
    var s = Math.round((next - Date.now()) / 1000);
    els.nextEl.textContent = "Next scheduled sync in " + Math.floor(s / 60) + ":" +
      String(s % 60).padStart(2, "0");
  }

  function autoOn() { return els.auto && els.auto.checked; }
  function maybeAutoRescan() {
    if (!autoOn()) return;
    if (!els.panel || els.panel.style.display === "none") return;
    if (Date.now() - lastTreeTs < AUTO_MIN * 60 * 1000 - 30 * 1000) return;
    scan(false);
  }

  /* ------------------------------------------------------------------ init */

  function buildSkeleton() {
    els.panel.innerHTML =
      '<div class="vs-head">' +
      '<div class="vs-title">Scan for New Songs/Covers</div>' +
      '<div class="vs-sub">Reads the audio repo and compares it to the vault with the same rules the track-sync pipeline uses, so this list is exactly what the next sync writes into tracks.js. The pipeline runs every 30 minutes.</div>' +
      '</div>' +
      '<div class="vs-actions">' +
      '<button type="button" id="vs-scan-btn" class="vs-btn"><i class="fas fa-magnifying-glass"></i> Scan for New Songs/Covers</button>' +
      '<label class="vs-auto"><input type="checkbox" id="vs-auto-toggle"> auto-rescan every ' + AUTO_MIN + ' min</label>' +
      '<span class="vs-next" id="vs-next"></span>' +
      '</div>' +
      '<div id="vs-summary" class="vs-summary"></div>' +
      '<div id="vs-results"><p class="vs-empty">Press the button - or switch this tab on again later, it rescans automatically when the timer is on.</p></div>';
    els.results = $("vs-results");
    els.summary = $("vs-summary");
    els.scanBtn = $("vs-scan-btn");
    els.nextEl = $("vs-next");
    els.auto = $("vs-auto-toggle");
    if (els.scanBtn) els.scanBtn.addEventListener("click", function () { scan(true); });
    try {
      els.auto.checked = localStorage.getItem(AUTO_KEY) === "1";
      els.auto.addEventListener("change", function () {
        localStorage.setItem(AUTO_KEY, els.auto.checked ? "1" : "0");
      });
    } catch (e) {}
  }

  function init() {
    els.panel = $("owner-vaultsync");
    els.badge = $("owner-vaultsync-badge");
    if (!els.panel || els.panel.__vsInit) return;
    els.panel.__vsInit = true;
    buildSkeleton();
    tick(); timer = setInterval(tick, 1000);
    setInterval(maybeAutoRescan, 30 * 1000);
    if (autoOn()) scan(false);
  }

  /* the panel starts empty and hidden until the Owner Dashboard's unlock -
     init once either exists at load or appears later (the overlay markup is
     static; the unlock listener picks this up). */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else init();

  /* Tab visibility. reports.js owns the shared switch (it hides every other
     panel on any tab click) but knows nothing about this one, so we show and
     hide our own panel here - listener order on document gives both a turn. */
  document.addEventListener("click", function (e) {
    var tab = e.target && e.target.closest ? e.target.closest('[data-otab]') : null;
    if (!tab || !els.panel) return;
    if (tab.getAttribute("data-otab") !== "vaultsync") { els.panel.style.display = "none"; return; }
    els.panel.style.display = "";
    /* entering the tab: rescan when the auto timer is due (or first time) */
    if (!window.__vsRunTime || Date.now() - window.__vsRunTime > AUTO_MIN * 60 * 1000) {
      if (autoOn()) scan(false);
    }
  });
})();
