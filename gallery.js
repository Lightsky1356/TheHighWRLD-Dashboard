/* Fan Art / Community Gallery page.
 * Grid of approved works (paged "load more"), upload with client-side resize
 * + preview, lightbox view, report + delete-own, owner moderation queue.
 * Images served by /api/gallery?id= (approved-only unless owner code). */
(function () {
  "use strict";
  if (window.__galleryMounted) return;
  window.__galleryMounted = true;

  var PAGE = 12;
  var page = 1, total = 0, loading = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function ownerCode() {
    try { return localStorage.getItem("ownerCode") || ""; } catch (e) { return ""; }
  }

  function css() {
    if (document.getElementById("gallery-style")) return;
    var st = document.createElement("style");
    st.id = "gallery-style";
    st.textContent =
      ".gal-wrap{max-width:72rem;margin:0 auto;width:100%;padding:0 1rem 2rem}" +
      ".gal-head{text-align:center;margin-bottom:16px}" +
      ".gal-title{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;background:linear-gradient(90deg,#f0abfc,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}" +
      ".gal-sub{font-size:11px;color:rgba(255,255,255,.45);font-style:italic;margin-top:4px}" +
      ".gal-upload{border:1px dashed rgba(255,255,255,.2);border-radius:14px;padding:14px;margin-bottom:16px}" +
      ".gal-upload h4{font-size:11px;color:#f0abfc;margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em}" +
      ".gal-upload input[type=file]{font-size:11px;color:rgba(255,255,255,.6);margin-bottom:8px}" +
      ".gal-upload input[type=text]{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-size:12px;padding:8px;margin-bottom:8px;outline:none}" +
      ".gal-prev{max-width:220px;border-radius:10px;margin:4px 0 8px;display:none}" +
      ".gal-btn{border:1px solid rgba(240,171,252,.45);background:rgba(240,171,252,.1);color:#f0abfc;border-radius:9px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".gal-btn:hover{background:rgba(240,171,252,.22);color:#fff}" +
      ".gal-btn:disabled{opacity:.45;cursor:default}" +
      ".gal-note{font-size:11px;color:rgba(255,255,255,.5);margin-top:6px}" +
      ".gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}" +
      ".gal-item{position:relative;border:1px solid rgba(255,255,255,.09);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.03);cursor:pointer;padding:0;text-align:left;color:#fff}" +
      ".gal-item:hover{border-color:rgba(240,171,252,.45)}" +
      ".gal-item img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#1c1530}" +
  /* Card cell: a plain div holding two sibling buttons, so the picture and the
     "open" control are separately focusable and the spoiler blur has something
     to toggle. A single wrapping button could not do both.
     The old .gal-item rules stay for "Your submissions", which renders its own
     compact rows with that class. */
  ".gal-cell{position:relative;border:1px solid rgba(255,255,255,.09);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.03);color:#fff;transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}" +
  ".gal-cell:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.4)}" +
  /* The title is the work's name and carries the weight; the artist line is
     secondary. Two lines of the same weight read as one block of small text. */
  ".gal-cap{padding:9px 10px 1px;font-size:12px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}" +
  ".gal-by{padding:1px 10px 10px;font-size:10.5px;opacity:.6;line-height:1.35;overflow-wrap:anywhere}" +
  ".gal-cell:hover{border-color:rgba(240,171,252,.45)}" +
  ".gal-cell.is-spoiler{border-color:rgba(240,171,252,.28)}" +
  ".gal-shot{display:block;width:100%;padding:0;border:0;background:none;cursor:pointer;position:relative;line-height:0}" +
  ".gal-shot img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#1c1530;transition:filter .22s ease,transform .22s ease}" +
  ".gal-shot:focus-visible{outline:2px solid #f0abfc;outline-offset:-3px}" +
  ".gal-open{position:absolute;right:7px;bottom:32px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:1px solid rgba(240,171,252,.5);background:rgba(12,6,24,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#f0abfc;font-size:11px;cursor:pointer;transition:opacity .18s ease}" +
  ".gal-open:focus-visible{outline:2px solid #f0abfc}" +
  /* Hidden only where hover actually exists. The control was opacity:0 and
     revealed on :hover, so on a touch screen - where nothing ever hovers - it
     never appeared and opening an image full size had no visible control.
     Scoping the hide to (hover: hover) gives touch devices it permanently
     while desktop keeps the quiet card. */
  "@media (hover:hover){" +
  ".gal-open{opacity:0}" +
  ".gal-cell:hover .gal-open,.gal-open:focus-visible{opacity:1}}" +
  /* Nothing to open full size while the picture is still blurred. */
  ".gal-cell.is-spoiler:not(.is-revealed) .gal-open{display:none}" +
  /* The closed form reads as an invitation, not a missing panel. */
  ".gal-upload-toggle{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;" +
  "border:1px dashed rgba(240,171,252,.34);border-radius:14px;padding:13px 16px;" +
  "background:rgba(240,171,252,.05);color:#f0abfc;font-size:12px;font-weight:700;" +
  "letter-spacing:.04em;cursor:pointer;transition:background .16s ease,border-color .16s ease}" +
  ".gal-upload-toggle:hover{background:rgba(240,171,252,.11);border-color:rgba(240,171,252,.6)}" +
  ".gal-upload-toggle:focus-visible{outline:2px solid #f0abfc;outline-offset:2px}" +
  /* The plus turns into an x when open, so it reads as a toggle with no
     second icon to load. */
  ".gal-upload-toggle .fa-plus{transition:transform .22s cubic-bezier(.16,1,.3,1)}" +
  ".gal-upload-toggle[aria-expanded=\"true\"] .fa-plus{transform:rotate(45deg)}" +
  ".gal-upload{margin-top:12px}" +
  /* Spoiler art: blurred until tapped. The badge sits above the blur and stays
     legible, so a spoiler is still visibly a spoiler after it is revealed. */
  ".gal-shot.is-spoiler img{filter:blur(26px) saturate(.6);transform:scale(1.12)}" +
  ".gal-cell.is-revealed .gal-shot img{filter:none;transform:none}" +
  ".gal-flag{position:absolute;left:7px;top:7px;z-index:2;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid rgba(240,171,252,.55);background:rgba(12,6,24,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f0abfc;pointer-events:none}" +
  ".gal-flag i{font-size:8px}" +
  ".gal-check{display:flex;align-items:center;gap:8px;margin:2px 0 10px;font-size:11px;color:rgba(255,255,255,.65);cursor:pointer;user-select:none}" +
  ".gal-check input{width:14px;height:14px;accent-color:#f0abfc;cursor:pointer;flex-shrink:0}" +
      ".gal-cap{padding:7px 9px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".gal-by{padding:0 9px 8px;font-size:10px;color:rgba(255,255,255,.5)}" +
      ".gal-more{display:block;margin:14px auto 0;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff;border-radius:9999px;padding:8px 22px;font-size:12px;cursor:pointer}" +
      ".gal-more:hover{border-color:rgba(240,171,252,.5);color:#f0abfc}" +
      ".gal-sec-t{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.55);margin:18px 0 10px}" +
      ".gal-own{display:flex;align-items:center;gap:9px;font-size:12px;color:#fff;padding:6px 2px}" +
      ".gal-own img{width:34px;height:34px;border-radius:8px;object-fit:cover;background:#1c1530}" +
      ".gal-own span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".gal-st{font-size:9px;font-weight:800;text-transform:uppercase;padding:2px 8px;border-radius:9999px;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.6)}" +
      ".gal-st.ok{border-color:rgba(52,211,153,.5);color:#34d399}" +
      ".gal-mini{border:none;background:transparent;color:rgba(255,255,255,.5);cursor:pointer;font-size:12px;padding:3px 6px}" +
      ".gal-mini:hover{color:#fb7185}" +
      ".gal-ov{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(4,2,12,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:16px}" +
      ".gal-box{max-width:min(640px,94vw);max-height:90vh;overflow:auto;background:#14101f;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px}" +
      ".gal-box img{width:100%;border-radius:12px;background:#1c1530}" +
      ".gal-box h3{font-size:15px;color:#fff;margin:10px 0 2px}" +
  ".gal-spoiler-note{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;border:1px solid rgba(240,171,252,.5);background:rgba(240,171,252,.12);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f0abfc;vertical-align:middle}" +
      ".gal-box p{font-size:12px;color:rgba(255,255,255,.6);margin:0 0 10px}" +
      ".gal-box .row{display:flex;gap:8px;flex-wrap:wrap}";
    (document.head || document.documentElement).appendChild(st);
  }

  function shell() {
    var sec = document.getElementById("page-section-gallery");
    if (!sec || document.getElementById("gal-root")) return null;
    css();
    var root = document.createElement("div");
    root.id = "gal-root";
    root.className = "gal-wrap";
    root.innerHTML =
      /* No heading of its own: the page hero already says "Fan Art Gallery" and
         "Made by the WRLD, for the WRLD", and the gallery repeated both
         verbatim a few hundred pixels lower.
         The form is collapsed. A real button with aria-expanded rather than a
         <details>, because the open state has to be scriptable - the form
         holds a file input and a preview. */
      '<button type="button" class="gal-upload-toggle" id="gal-upload-toggle"' +
      ' aria-expanded="false" aria-controls="gal-upload">' +
      '<i class="fas fa-plus" aria-hidden="true"></i> Submit your art</button>' +
      '<div class="gal-upload" id="gal-upload" hidden><h4>Submit your art</h4>' +
      '<input type="file" id="gal-file" accept="image/jpeg,image/png,image/webp,image/gif">' +
      '<img decoding="async" class="gal-prev" id="gal-prev" alt="">' +
      '<input type="text" id="gal-title" maxlength="80" placeholder="Title">' +
      '<input type="text" id="gal-cap" maxlength="300" placeholder="Caption (optional)">' +
      '<label class="gal-check"><input type="checkbox" id="gal-spoiler"><span>Mark as spoiler &mdash; blur the thumbnail until it is tapped</span></label>' +
      '<button type="button" class="gal-btn" id="gal-submit">Publish</button>' +
      '<p class="gal-note" id="gal-note">JPG / PNG / WebP / GIF · auto-resized · max 800KB · published as soon as you submit.</p></div>' +
      '<div id="gal-own-wrap"></div>' +
      '<div id="gal-queue-wrap"></div>' +
      '<div class="gal-sec-t">Fresh from the community</div>' +
      '<div class="gal-grid" id="gal-grid"></div>' +
      '<button type="button" class="gal-more" id="gal-more" hidden>Load more</button>';
    var host = sec.querySelector("section") || sec;
    host.appendChild(root);
    return root;
  }

  var pendingFile = null;

  /* Gallery uploads require a LINKED Discord account.

     Reuses the two helpers the rest of the site already gates on rather than
     taking a third opinion:

       isDiscordLinked()  script.js. The same check that gates favourites. It
                         already reconciles both sources - the Wanted payload
                         once it has been fetched, and the account fetch's
                         __plLinked flag before that - and _plHydrate() refreshes
                         it on DOMContentLoaded, focus and visibilitychange, so
                         it is current by the time anyone clicks Submit.

       showGateModal()   suggestions.js. The site's gate modal, which already
                         carries a "Link Discord" button, so this adds no new
                         wording and no new dialog.

     This is a courtesy gate, not enforcement - someone can call the API
     directly, which is why functions/api/gallery.js refuses the upload server
     side against the same discord_links row. All this saves is making someone
     choose a file, watch it resize on their CPU, and type a caption before
     finding out they cannot upload it. */
  function requireLinkedDiscord(action) {
    var linked = false;
    try { linked = !!(window.isDiscordLinked && window.isDiscordLinked()); } catch (e) { linked = false; }
    if (linked) return true;
    if (window.showGateModal) {
      window.showGateModal("Discord Required", action + " requires a LINKED Discord Account");
    } else if (window.toast) {
      window.toast("Link Discord to " + action.toLowerCase(), "error", 2500);
    }
    return false;
  }

  /* Read at submit time rather than captured, so it reflects the checkbox as it
     is when Publish is pressed. */
  function spoilerBox() {
    var el = document.getElementById("gal-spoiler");
    return !!(el && el.checked);
  }

  function bindUpload() {
    /* The collapse toggle. Wired here rather than at render time because this
       is the one place that already owns the form's elements and its lifecycle,
       and it already guards against double-binding with _bound. */
    var toggle = document.getElementById("gal-upload-toggle");
    var panel = document.getElementById("gal-upload");
    if (toggle && panel && !toggle._bound) {
      toggle._bound = true;
      toggle.addEventListener("click", function () {
        var open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
        panel.hidden = open;
      });
    }

    var file = document.getElementById("gal-file");
    var prev = document.getElementById("gal-prev");
    var note = document.getElementById("gal-note");
    var btn = document.getElementById("gal-submit");
    if (!file || file._bound) return;
    file._bound = true;
    file.addEventListener("change", function () {
      pendingFile = null;
      var f = file.files && file.files[0];
      if (!f) { prev.style.display = "none"; return; }
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) {
        note.textContent = "That file type is not allowed.";
        file.value = "";
        return;
      }
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var gif = f.type === "image/gif";
            var maxDim = 1600;
            var w = img.width, h = img.height;
            if (!gif && Math.max(w, h) > maxDim) {
              var sc = maxDim / Math.max(w, h);
              w = Math.round(w * sc); h = Math.round(h * sc);
            }
            var cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h);
            var mime = gif ? "image/gif" : "image/jpeg";
            var done = function (url) {
              pendingFile = { mime: mime, dataUrl: url };
              prev.src = url;
              prev.style.display = "block";
              note.textContent = "Ready — " + Math.round(url.length * 0.75 / 1024) + "KB. Publishes as soon as you submit.";
            };
            if (gif) {
              if (f.size > 819200) { note.textContent = "GIF is over 800KB."; file.value = ""; return; }
              var rd2 = new FileReader();
              rd2.onload = function () { done(rd2.result); };
              rd2.readAsDataURL(f);
            } else {
              done(cv.toDataURL("image/jpeg", 0.85));
            }
          } catch (e) { note.textContent = "Could not read that image."; }
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    btn.addEventListener("click", function () {
      if (!requireLinkedDiscord("Uploading artwork")) return;
      if (!pendingFile) { note.textContent = "Choose an image first."; return; }
      var title = document.getElementById("gal-title");
      var cap = document.getElementById("gal-cap");
      btn.disabled = true;
      note.textContent = "Uploading…";
      fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "submit",
          title: title ? title.value.trim() : "",
          caption: cap ? cap.value.trim() : "",
          mime: pendingFile.mime,
          data: pendingFile.dataUrl.split(",")[1] || "",
          spoiler: spoilerBox() ? 1 : 0
        })
      }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
        .then(function (d) {
          btn.disabled = false;
          if (d && d.ok) {
            note.textContent = "Published — everyone can see it now.";
            if (d.flagged && window.submissionRules) window.submissionRules.notice('gallery', d.flagged);
            file.value = "";
            prev.style.display = "none";
            pendingFile = null;
            if (title) title.value = "";
            if (cap) cap.value = "";
            loadMine();
          } else {
            var err = (d && d.error) || "sign in first";
            /* The Discord gate is a refusal to accept the upload, not a judgement
               on the artwork, so it should not arrive wearing "Rejected". */
            note.textContent = /discord/i.test(err) ? err : "Rejected: " + err;
          }
        });
    });
  }

  /* The card is a cell holding two sibling buttons rather than one button,
   because re-blurring needs its own control and a button cannot contain a
   button. `.gal-shot` is the picture: it toggles the blur on a spoiler, and
   opens the viewer on anything else. `.gal-open` opens the viewer, and only
   becomes visible once a spoiler has been revealed. */
  function cardHTML(it) {
    var sp = !!(Number(it.spoiler) || 0);
    var label = esc(it.title || "Untitled");
    return '<div class="gal-cell' + (sp ? " is-spoiler" : "") + '" data-gal="' + it.id + '">' +
      '<button type="button" class="gal-shot' + (sp ? " is-spoiler" : "") + '" data-gal-shot="' + it.id + '"' +
      (sp ? ' aria-pressed="false" aria-label="Spoiler image: ' + label + '. Show or hide this image."' : ' aria-label="Open ' + label + '"') + ">" +
      (sp ? '<span class="gal-flag"><i class="fas fa-eye-slash"></i>Spoiler</span>' : "") +
      '<img decoding="async" src="/api/gallery?id=' + it.id + '" alt="" loading="lazy">' +
      "</button>" +
      '<div class="gal-cap">' + label + "</div>" +
      '<div class="gal-by">by ' + esc(it.user_name || "anon") + "</div>" +
      '<button type="button" class="gal-open" data-gal-open="' + it.id + '" aria-label="Open ' + label + '"><i class="fas fa-expand"></i></button>' +
      "</div>";
  }

  function loadPage(reset) {
    if (loading) return;
    var grid = document.getElementById("gal-grid");
    var more = document.getElementById("gal-more");
    if (!grid) return;
    if (reset) { page = 1; grid.innerHTML = ""; }
    loading = true;
    fetch("/api/gallery?page=" + page + "&limit=" + PAGE, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        loading = false;
        if (!d || d.ok !== true) return;
        total = d.total || 0;
        (d.items || []).forEach(function (it) {
          if (!grid.querySelector('[data-gal="' + it.id + '"]')) {
            var tmp = document.createElement("div");
            tmp.innerHTML = cardHTML(it);
            grid.appendChild(tmp.firstChild);
          }
        });
        page++;
        if (more) more.hidden = !(grid.children.length < total);
      });
  }

  function loadMine() {
    var wrap = document.getElementById("gal-own-wrap");
    if (!wrap) return;
    fetch("/api/gallery?mine=1", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true || !(d.items || []).length) { wrap.innerHTML = ""; return; }
        var h = '<div class="gal-sec-t">Your submissions</div>';
        d.items.forEach(function (it) {
          var st = it.status === "approved" ? '<span class="gal-st ok">live</span>' : '<span class="gal-st">' + esc(it.status) + "</span>";
          h += '<div class="gal-own"><img decoding="async" src="/api/gallery?id=' + it.id + (it.status === "approved" ? "" : "") + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
            "<span>" + esc(it.title || "Untitled") + "</span>" + st +
            '<button type="button" class="gal-mini" data-gal-del="' + it.id + '" title="Delete"><i class="fas fa-trash"></i></button></div>';
        });
        wrap.innerHTML = h;
      });
  }

  function loadQueue() {
    var wrap = document.getElementById("gal-queue-wrap");
    if (!wrap) return;
    var code = ownerCode();
    if (!code) { wrap.innerHTML = ""; return; }
    fetch("/api/gallery?pending=1&code=" + encodeURIComponent(code), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        if (!d || d.ok !== true || !(d.items || []).length) { wrap.innerHTML = ""; return; }
        var h = '<div class="gal-sec-t">Review queue (' + d.items.length + ")</div>";
        d.items.forEach(function (it) {
          h += '<div class="gal-own"><img decoding="async" src="/api/gallery?id=' + it.id + "&code=" + encodeURIComponent(code) + '" alt="" loading="lazy">' +
            "<span>" + esc(it.title || "Untitled") + " — " + esc(it.user_name || "") + "</span>" +
            '<button type="button" class="gal-btn" data-gal-ok="' + it.id + '">Approve</button>' +
            '<button type="button" class="gal-mini" data-gal-no="' + it.id + '" title="Reject"><i class="fas fa-xmark"></i></button></div>';
        });
        wrap.innerHTML = h;
      });
  }

  function mod(id, status) {
    fetch("/api/gallery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "moderate", id: id, status: status, code: ownerCode() })
    }).then(function () { loadQueue(); loadPage(true); }).catch(function () {});
  }

  function lightbox(id) {    var old = document.getElementById("gal-ov");
    if (old) old.remove();
    fetch("/api/gallery?page=1&limit=" + PAGE * page, { cache: "no-store" })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
      .then(function (d) {
        var it = null;
        ((d && d.items) || []).forEach(function (x) { if (String(x.id) === String(id)) it = x; });
        var ov = document.createElement("div");
        ov.className = "gal-ov";
        ov.id = "gal-ov";
        var inner = it
          ? '<img decoding="async" src="/api/gallery?id=' + it.id + '" alt=""><h3>' + esc(it.title || "Untitled") + (Number(it.spoiler) ? ' <span class="gal-spoiler-note">spoiler</span>' : "") + "</h3><p>by " + esc(it.user_name || "anon") + (it.caption ? " — " + esc(it.caption) : "") + "</p>"
          : '<img decoding="async" src="/api/gallery?id=' + esc(String(id)) + '" alt="">';
        ov.innerHTML = '<div class="gal-box">' + inner +
          '<div class="row"><button type="button" class="gal-btn" data-gal-x="1">Close</button>' +
          (it ? '<button type="button" class="gal-btn" data-gal-rep="' + it.id + '"><i class="fas fa-flag"></i> Report</button>' : "") + "</div></div>";
        ov.addEventListener("click", function (e) {
          if (e.target === ov || (e.target.closest && e.target.closest('[data-gal-x]'))) { ov.remove(); return; }
          var rp = e.target.closest ? e.target.closest("[data-gal-rep]") : null;
          if (rp) {
            /* Reporting goes through the site's own panel - the same one the
               profile, direct message and suggestion flows already use.

               It used to be a window.prompt() posting to /api/gallery's own
               report action. That was a third reporting path with its own
               problems: a native prompt rather than a panel, so no scroll lock
               and no Discord gate; an uncontrolled free-text reason instead of
               the shared list; no reporter identity recorded at all
               (reporter_discord_id was written as an empty string); and rows
               inserted with target_type 'gallery' in lower case while every
               staff-side filter matches the upper-case VALID_TYPES - so the
               reports it created were effectively invisible in the very queue
               they were meant to reach.

               openReportModal handles the scroll lock, the gate and the reason
               list, and files the report where staff will see it. The lightbox
               is removed first so the two overlays never stack. */
            ov.remove();
            if (window.openReportModal) {
              window.openReportModal("GALLERY", rp.getAttribute("data-gal-rep"), (it && it.title) || "Untitled");
            }
            return;
          }
        });
        document.body.appendChild(ov);
      });
  }

  function boot() {
    window.openGalleryItem = lightbox;
    var root = shell();
    if (!root) return;
    bindUpload();
    root.addEventListener("click", function (e) {
      var more = e.target.closest ? e.target.closest("#gal-more") : null;
      if (more) { loadPage(false); return; }
      var ok = e.target.closest ? e.target.closest("[data-gal-ok]") : null;
      if (ok) { mod(Number(ok.getAttribute("data-gal-ok")), "approved"); return; }
      var no = e.target.closest ? e.target.closest("[data-gal-no]") : null;
      if (no) { mod(Number(no.getAttribute("data-gal-no")), "rejected"); return; }
      var del = e.target.closest ? e.target.closest("[data-gal-del]") : null;
      if (del) {
        var go = false;
        try { go = window.confirm("Delete your submission?"); } catch (err) {}
        if (!go) return;
        fetch("/api/gallery", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
          body: JSON.stringify({ action: "delete", id: Number(del.getAttribute("data-gal-del")) })
        }).then(function () { loadMine(); loadPage(true); }).catch(function () {});
        return;
      }
      /* "Open full size" wins over everything else in the cell. */
      var open = e.target.closest ? e.target.closest("[data-gal-open]") : null;
      if (open) { lightbox(open.getAttribute("data-gal-open")); return; }

      var shot = e.target.closest ? e.target.closest("[data-gal-shot]") : null;
      if (shot) {
        var cell = shot.closest("[data-gal]") || shot;
        if (cell.classList.contains("is-spoiler")) {
          /* Toggle, so a spoiler can be hidden again as well as shown. Tapping a
             blurred spoiler shows it without opening the viewer - otherwise the
             blur would be the only warning and the full image would be on screen
             before the reader had chosen to see it. */
          var revealed = cell.classList.toggle("is-revealed");
          shot.setAttribute("aria-pressed", revealed ? "true" : "false");
          return;
        }
        lightbox(shot.getAttribute("data-gal-shot"));
        return;
      }

      /* Anything else inside a card (the caption, the author line) opens it. */
      var card = e.target.closest ? e.target.closest("[data-gal]") : null;
      if (card) lightbox(card.getAttribute("data-gal"));
    });
    var sec = document.getElementById("page-section-gallery");
    var fired = false;
    var go = function () {
      if (fired) return;
      fired = true;
      loadPage(true);
      loadMine();
      loadQueue();
    };
    if (sec && sec.classList.contains("active")) go();
    if (sec && window.MutationObserver) {
      var galleryObserver = new MutationObserver(function () {
        if (sec.classList.contains("active")) {
          try { galleryObserver.disconnect(); galleryObserver = null; } catch (e) {}
          go();
        }
      });
      galleryObserver.observe(sec, { attributes: true, attributeFilter: ["class"] });
    }
    setInterval(function () {
      var s2 = document.getElementById("page-section-gallery");
      if (s2 && s2.classList.contains("active")) loadQueue();
    }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
