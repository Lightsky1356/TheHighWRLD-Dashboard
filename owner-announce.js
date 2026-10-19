/* Owner: announcement composer and manage list, inside #owner-panel.
 *
 * Appears when unlocked (localStorage.ownerCode). Posts to /api/announcements
 * with the owner code. Announcements surface in every user's bell and in the
 * banner across the top of the site.
 *
 * WHY THERE IS A MANAGE LIST
 * An announcement could previously only be added. A typo in the title, or a
 * notice that went out with the wrong wording, stayed that way for ever - the
 * only remedy was posting a corrected one, which left the mistake sitting above
 * it, because the API returns the newest five and nothing was ever removable.
 * So an announcement can now be edited or deleted from here.
 *
 * WHY "NOTIFY AGAIN" IS A BOX AND NOT A SETTING
 * Dismissal is remembered per announcement plus its revision, so a corrected
 * announcement is normally still hidden for anyone who already dismissed it.
 * That is right for a typo fix and wrong for an announcement that was itself
 * incorrect, where the people who dismissed it are exactly the people who need
 * the correction. Only the owner can tell those apart, so the edit form asks
 * rather than guessing - ticked, it bumps the revision and the banner returns
 * for everyone; unticked, the correction is silent for anyone already read it. */
(function () {
  "use strict";
  if (window.__announceMounted) return;
  window.__announceMounted = true;

  var editingId = null;   // null when the form is composing a new announcement

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function ownerCode() {
    try { return localStorage.getItem("ownerCode") || ""; } catch (e) { return ""; }
  }

  function say(msg, kind) {
    if (window.toast) window.toast(msg, kind || "success");
  }

  function css() {
    if (document.getElementById("announce-style")) return;
    var st = document.createElement("style");
    st.id = "announce-style";
    st.textContent =
      ".ann-form{margin-top:12px;border:1px dashed rgba(255,255,255,.2);border-radius:12px;padding:12px}" +
      ".ann-form h4{font-size:11px;color:#fbbf24;margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em}" +
      ".ann-form input,.ann-form textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-size:12px;padding:8px;margin-bottom:8px;outline:none}" +
      ".ann-form input:focus,.ann-form textarea:focus{border-color:rgba(251,191,36,.6)}" +
      ".ann-form button{border:1px solid rgba(251,191,36,.45);background:rgba(251,191,36,.12);color:#fbbf24;border-radius:9px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".ann-form button:hover{background:rgba(251,191,36,.2)}" +
      ".ann-form button:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}" +
      /* The notify box sits with the buttons rather than under the fields, so it
         reads as a choice about sending rather than a third input. */
      ".ann-form-opt{display:flex;align-items:center;gap:7px;margin:0 0 9px;font-size:11px;color:rgba(255,255,255,.62);line-height:1.45;cursor:pointer}" +
      ".ann-form-opt input{width:auto;margin:0;flex-shrink:0;accent-color:#fbbf24}" +
      ".ann-form-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".ann-form-cancel{border-color:rgba(255,255,255,.2)!important;background:none!important;color:rgba(255,255,255,.7)!important}" +
      ".ann-manage{margin-top:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px}" +
      ".ann-manage h4{font-size:11px;color:#fbbf24;margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em}" +
      ".ann-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:9px;margin-bottom:5px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}" +
      ".ann-row-main{flex:1;min-width:0}" +
      ".ann-row-t{font-size:11.5px;font-weight:700;color:#fff;line-height:1.3;overflow-wrap:anywhere}" +
      ".ann-row-m{font-size:10.5px;color:rgba(255,255,255,.5);line-height:1.35;overflow-wrap:anywhere;" +
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      ".ann-row-when{font-size:10px;color:rgba(255,255,255,.32);margin-top:2px}" +
      ".ann-row-btn{flex-shrink:0;border:1px solid rgba(255,255,255,.16);background:none;color:rgba(255,255,255,.72);border-radius:8px;padding:4px 9px;font-size:10.5px;font-weight:700;cursor:pointer}" +
      ".ann-row-btn:hover{background:rgba(255,255,255,.09);color:#fff}" +
      ".ann-row-btn:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}" +
      ".ann-row-del{border-color:rgba(248,113,113,.3);color:rgba(248,113,113,.85)}" +
      ".ann-row-del:hover{background:rgba(248,113,113,.15);color:#fff}" +
      ".ann-empty{font-size:11px;color:rgba(255,255,255,.38);padding:6px 2px}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- the manage list ------------------------------------------------ */
  function loadList() {
    var box = document.getElementById("ann-manage-list");
    if (!box) return;
    fetch("/api/announcements?manage=1&code=" + encodeURIComponent(ownerCode()), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        var rows = (d && d.announcements) || [];
        if (!d || d.ok !== true) { box.innerHTML = '<div class="ann-empty">Could not load announcements.</div>'; return; }
        if (!rows.length) { box.innerHTML = '<div class="ann-empty">Nothing posted yet.</div>'; return; }
        box.innerHTML = rows.map(function (a) {
          return '<div class="ann-row" data-ann="' + esc(a.id) + '">' +
            '<div class="ann-row-main">' +
            '<div class="ann-row-t">' + esc(a.title || "(no title)") + "</div>" +
            '<div class="ann-row-m">' + esc(a.body || "") + "</div>" +
            '<div class="ann-row-when">' + esc(a.ts || "") +
            (a.rev > 1 ? " · edited, revision " + a.rev : "") + "</div>" +
            "</div>" +
            '<button type="button" class="ann-row-btn" data-ann-edit="' + esc(a.id) + '">Edit</button>' +
            '<button type="button" class="ann-row-btn ann-row-del" data-ann-del="' + esc(a.id) + '">Delete</button>' +
            "</div>";
        }).join("");
      });
  }

  function mount() {
    if (document.getElementById("ann-create")) return;
    var panel = document.getElementById("owner-panel");
    if (!panel) return;
    if (!ownerCode() && !window.__ownerStatsURL) return;
    css();

    var f = document.createElement("div");
    f.className = "ann-form";
    f.id = "ann-create";
    f.innerHTML =
      '<h4 id="ann-form-h">Post announcement</h4>' +
      '<input id="ann-f-title" maxlength="120" placeholder="Title (optional)">' +
      '<textarea id="ann-f-msg" rows="2" maxlength="500" placeholder="Announcement message…"></textarea>' +
      '<label class="ann-form-opt" id="ann-f-opt" hidden>' +
      '<input type="checkbox" id="ann-f-notify">' +
      "<span>Notify again — show this to everyone, including anyone who already dismissed it</span></label>" +
      '<div class="ann-form-row">' +
      '<button type="button" id="ann-f-go"><i class="fas fa-bullhorn"></i> <span id="ann-f-go-label">Announce</span></button>' +
      '<button type="button" class="ann-form-cancel" id="ann-f-cancel" hidden>Cancel</button>' +
      "</div>" +
      '<div class="ann-manage"><h4>Posted announcements</h4><div id="ann-manage-list"></div></div>';

    panel.appendChild(f);

    var titleEl = document.getElementById("ann-f-title");
    var msgEl = document.getElementById("ann-f-msg");
    var notifyEl = document.getElementById("ann-f-notify");
    var optEl = document.getElementById("ann-f-opt");
    var goEl = document.getElementById("ann-f-go");
    var goLabel = document.getElementById("ann-f-go-label");
    var cancelEl = document.getElementById("ann-f-cancel");
    var heading = document.getElementById("ann-form-h");

    /* Puts the form back into "compose a new one" state. Kept in one place so
       posting, cancelling and finishing an edit cannot drift apart. */
    function resetForm() {
      editingId = null;
      heading.textContent = "Post announcement";
      goLabel.textContent = "Announce";
      goEl.firstElementChild.className = "fas fa-bullhorn";
      optEl.hidden = true;
      cancelEl.hidden = true;
      notifyEl.checked = false;
      if (titleEl) titleEl.value = "";
      if (msgEl) msgEl.value = "";
      if (titleEl) titleEl.focus();
    }

    cancelEl.addEventListener("click", resetForm);

    goEl.addEventListener("click", function () {
      var msg = msgEl ? msgEl.value.trim() : "";
      if (!msg) { if (msgEl) msgEl.focus(); say("An announcement needs a message", "error"); return; }
      var title = titleEl ? titleEl.value.trim() : "";
      var editing = editingId;

      goEl.disabled = true;
      var opts = {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: ownerCode(),
          title: title,
          message: msg,
          id: editing || undefined,
          notify: editing ? !!notifyEl.checked : undefined,
        }),
      };

      fetch("/api/announcements", opts)
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .catch(function () { return { status: 0, j: { ok: false } }; })
        .then(function (out) {
          goEl.disabled = false;
          if (out.j && out.j.ok) {
            say(editing ? "Announcement updated" : "Announcement posted", "success");
            resetForm();
            loadList();
            return;
          }
          var why = out.status === 403 ? "Wrong owner code"
            : out.status === 404 ? "That announcement is gone"
            : out.status === 400 ? (out.j && out.j.error) || "Could not save"
            : "Could not save";
          say(why, "error");
        });
    });

    // Delegated, so the list can be re-rendered freely without rebinding.
    f.addEventListener("click", function (e) {
      var ed = e.target.closest && e.target.closest("[data-ann-edit]");
      if (ed) {
        var id = ed.getAttribute("data-ann-edit");
        fetch("/api/announcements?manage=1&code=" + encodeURIComponent(ownerCode()), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .catch(function () { return { ok: false }; })
          .then(function (d) {
            var rows = (d && d.announcements) || [];
            for (var i = 0; i < rows.length; i++) {
              if (String(rows[i].id) !== String(id)) continue;
              editingId = rows[i].id;
              heading.textContent = "Edit announcement";
              goLabel.textContent = "Update";
              goEl.firstElementChild.className = "fas fa-check";
              optEl.hidden = false;
              cancelEl.hidden = false;
              notifyEl.checked = false;
              if (titleEl) titleEl.value = rows[i].title || "";
              if (msgEl) msgEl.value = rows[i].body || "";
              if (msgEl) msgEl.focus();
              return;
            }
            say("Could not load that announcement", "error");
          });
        return;
      }

      var del = e.target.closest && e.target.closest("[data-ann-del]");
      if (del) {
        var did = del.getAttribute("data-ann-del");
        var row = del.closest(".ann-row");
        var what = row && row.querySelector(".ann-row-t") ? row.querySelector(".ann-row-t").textContent : "";
        /* Confirm inline rather than with window.confirm: this panel is a custom
           surface and a native dialog would break the look of everything around
           it, but deleting a notice that is live on the whole site deserves a
           deliberate second click. */
        if (del.dataset.armed !== "1") {
          del.dataset.armed = "1";
          del.textContent = "Really delete?";
          var row2 = del.closest(".ann-row");
          var b1 = row2 && row2.querySelector("[data-ann-edit]");
          if (b1) b1.disabled = true;
          setTimeout(function () {
            if (!del.isConnected) return;
            del.dataset.armed = "0";
            del.textContent = "Delete";
            var r3 = del.closest(".ann-row");
            var e1 = r3 && r3.querySelector("[data-ann-edit]");
            if (e1) e1.disabled = false;
          }, 4000);
          return;
        }
        fetch("/api/announcements", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: ownerCode(), id: did }),
        })
          .then(function (r) { return r.json(); })
          .catch(function () { return { ok: false }; })
          .then(function (d) {
            if (d && d.ok) {
              say("Announcement deleted", "success");
              if (editingId === did) resetForm();
              loadList();
            } else {
              say(d && d.error === "forbidden" ? "Wrong owner code" : "Could not delete", "error");
            }
          });
        void what;
      }
    });

    loadList();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  setInterval(mount, 10000);
})();
