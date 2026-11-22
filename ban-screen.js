/* Account-ban screen — shown when the signed-in account has an ACTIVE ban.
 * Server-authoritative: a single /api/banstatus check (session-derived uid)
 * on boot when signed in, re-checkable via window.checkBanStatus().
 * No polling, no observers. Phase 1 enforcement remains the real boundary;
 * this overlay is the user experience. Sign Out reuses window.authSignOut. */
(function () {
  "use strict";
  if (window.__banScreenMounted) return;
  window.__banScreenMounted = true;

  var OV = "ban-screen-ov";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function signedIn() {
    try { return !!localStorage.getItem("wantedAuthUser"); } catch (e) { return false; }
  }

  function fmtDate(iso) {
    try {
      var dt = new Date(String(iso).replace(" ", "T") + "Z");
      if (isNaN(dt.getTime())) return "";
      return dt.toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }


  function show(ban) {
    if (document.getElementById(OV)) return;
    var exp = ban.expires_at ? fmtDate(ban.expires_at) : "Permanent";
    var ov = document.createElement("div");
    ov.className = "ban-screen-ov";
    ov.id = OV;
    ov.setAttribute("role", "alertdialog");
    ov.setAttribute("aria-label", "Account banned");
    ov.innerHTML =
      '<div class="ban-screen-panel">' +
      '<div class="ban-screen-ico"><i class="fas fa-shield-halved"></i></div>' +
      "<h1>ACCOUNT BANNED</h1>" +
      '<p class="ban-screen-sub">Your account currently cannot access protected TheHighWRLD Dashboard features.</p>' +
      '<div class="ban-screen-rows">' +
      '<div class="ban-screen-row"><span class="ban-screen-k">Reason</span><span class="ban-screen-v">' + esc(ban.reason || "No reason given.") + "</span></div>" +
      '<div class="ban-screen-row"><span class="ban-screen-k">Issued</span><span class="ban-screen-v">' + esc(fmtDate(ban.created_at) || "—") + "</span></div>" +
      '<div class="ban-screen-row"><span class="ban-screen-k">Expires</span><span class="ban-screen-v">' + esc(exp) + "</span></div>" +
      '<div class="ban-screen-row"><span class="ban-screen-k">Ban ID</span><span class="ban-screen-v">#' + esc(String(ban.id)) + "</span></div>" +
      "</div>" +
      '<div class="ban-appeal" id="ban-appeal"><p style="font-size:11px;color:rgba(255,255,255,.45)">Checking appeal status…</p></div>' +
      '<button type="button" class="ban-screen-out" data-ban-out><i class="fas fa-right-from-bracket"></i> Sign Out</button></div>';
    loadAppeal(ban);
    ov.addEventListener("click", function (e) {
      var send = e.target.closest ? e.target.closest("[data-ban-send]") : null;
      if (send) {
        var ta = document.getElementById("ban-appeal-text");
        var err = ov.querySelector("[data-ban-err]");
        var text = ta ? ta.value.trim() : "";
        if (text.length < 10) {
          if (err) err.textContent = "Please write at least a sentence (10+ characters).";
          if (ta) ta.focus();
          return;
        }
        send.disabled = true;
        if (err) err.textContent = "Submitting…";
        fetch("/api/appeals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "submit", body: text.slice(0, 2000) })
        }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; })
          .then(function (d) {
            if (d && d.ok) {
              loadAppeal(ban);
              try { if (window.toast) window.toast("Appeal submitted", "success"); } catch (e2) {}
            } else {
              send.disabled = false;
              var msg = (d && d.error === "appeal already pending")
                ? "You already have a pending appeal."
                : (d && d.error) || "Could not submit.";
              if (err) err.textContent = msg;
              else if (window.toast) { try { window.toast(msg, "error"); } catch (e3) {} }
              if (d && d.error === "appeal already pending") loadAppeal(ban);
            }
          });
        return;
      }
      var b = e.target.closest ? e.target.closest("[data-ban-out]") : null;
      if (!b) return;
      b.disabled = true;
      try {
        if (typeof window.authSignOut === "function") window.authSignOut();
        else fetch("/api/auth/logout", { method: "POST" }).catch(function () {});
      } catch (err) {}
      setTimeout(function () {
        var o = document.getElementById(OV);
        if (o) o.remove();
        unlockScroll();
        try { window.location.reload(); } catch (err2) {}
      }, 600);
    });
    document.body.appendChild(ov);
    try {
      document.documentElement.classList.add("thw-ban-lock");
      document.body.classList.add("thw-ban-lock");
    } catch (e) {}
  }

  function unlockScroll() {
    try {
      document.documentElement.classList.remove("thw-ban-lock");
      document.body.classList.remove("thw-ban-lock");
    } catch (e) {}
  }

  function appealFormHTML() {
    return "<h2>Appeal this ban</h2>" +
      "<p>If you believe this ban should be reviewed, explain why below. A moderator will review it.</p>" +
      '<label for="ban-appeal-text" style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5)">Explain why you believe this ban should be reviewed.</label>' +
      '<textarea id="ban-appeal-text" maxlength="2000" placeholder="Write your appeal…" style="margin-top:6px"></textarea>' +
      '<button type="button" class="ban-appeal-send" data-ban-send>Submit Appeal</button>' +
      '<p class="ban-appeal-err" data-ban-err></p>';
  }

  function loadAppeal(ban) {
    var box = document.getElementById("ban-appeal");
    if (!box) return;
    fetch("/api/appeals?action=mine", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) {
        var el = document.getElementById("ban-appeal");
        if (!el) return;
        var list = (d && d.ok === true && d.appeals) || [];
        var mine = null;
        for (var i = 0; i < list.length; i++) {
          if (Number(list[i].ban_id) === Number(ban.id)) { mine = list[i]; break; }
        }
        if (!mine) {
          el.innerHTML = appealFormHTML();
          return;
        }
        if (mine.status === "pending") {
          el.innerHTML = '<div class="ban-appeal-state"><b>Appeal Pending</b><br>Submitted ' +
            esc(fmtDate(mine.created_at) || "recently") +
            ". Moderators will review it — no further action is needed from you.</div>";
          return;
        }
        if (mine.status === "approved") {
          el.innerHTML = '<div class="ban-appeal-state ok"><b>Appeal Approved</b><br>Your ban has been lifted. Reloading normal access…</div>';
          setTimeout(function () { unlockScroll(); try { window.location.reload(); } catch (e) {} }, 2500);
          return;
        }
        el.innerHTML = '<div class="ban-appeal-state no"><b>Appeal Denied</b>' +
          (mine.reviewed_at ? "<br>Decided " + esc(fmtDate(mine.reviewed_at)) : "") +
          (mine.moderator_response ? "<br>Response: " + esc(mine.moderator_response) : "") +
          "<br>Your ban remains active.</div>";
      });
  }

  function check() {
    if (document.getElementById(OV)) return Promise.resolve(false);
    if (!signedIn()) return Promise.resolve(false);
    return fetch("/api/banstatus", { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) {
        // Never false-claim: only exact banned:true with a ban object shows.
        if (d && d.ok === true && d.banned === true && d.ban && d.ban.id) {
          show(d.ban);
          return true;
        }
        return false;
      });
  }

  window.checkBanStatus = check;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  function init() {
    setTimeout(check, 1200);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !document.getElementById(OV)) check();
    });
  }
})();
