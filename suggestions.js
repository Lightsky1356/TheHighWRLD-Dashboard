/* Community suggestions page + top-nav Community dropdown */
(function () {
  function getUid() {
    try { return localStorage.getItem("wantedUserId") || ""; } catch (e) { return ""; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function relTime(ts) {
    if (!ts) return "";
    var d = Date.now() - Date.parse(ts);
    if (isNaN(d)) return "";
    var s = Math.floor(d / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  var STATUS = {
    open: ["Open", "bg-amber-500/10 border-amber-500/30 text-amber-300"],
    wip: ["In the works", "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"],
    done: ["Implemented", "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"]
  };

  function renderList(rows) {
    var list = document.getElementById("suggList");
    if (!list) return;
    if (!rows || !rows.length) {
      list.innerHTML = '<p class="text-xs text-gray-500 py-2">No suggestions yet - share your first idea above.</p>';
      return;
    }
    list.innerHTML = rows.map(function (s) {
      var st = STATUS[String(s.status || "open")] || STATUS.open;
      return '<div class="relative border border-white/10 rounded-xl bg-white/3 p-4">' +
        '<div class="flex items-center gap-2 pr-10">' +
        '<span class="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border ' + st[1] + '">' + st[0] + '</span>' +
        '<span class="text-[10px] font-mono text-gray-600">' + relTime(s.created_at) + '</span>' +
        '<button type="button" data-delsugg="' + s.id + '" class="absolute right-3 top-3 text-gray-600 hover:text-red-400 transition-colors" title="Delete"><i class="fas fa-trash text-xs"></i></button>' +
        '</div>' +
        '<p class="text-xs sm:text-sm text-gray-200 leading-relaxed mt-2 whitespace-pre-wrap">' + esc(s.text) + '</p>' +
        '</div>';
    }).join("");
    list.querySelectorAll("[data-delsugg]").forEach(function (b) {
      b.addEventListener("click", function () {
        fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteSuggestion", user: getUid(), id: parseInt(b.getAttribute("data-delsugg"), 10) })
        }).then(function (r) { return r.json(); }).then(function () { renderSuggestions(); }).catch(function () {});
      });
    });
  }

  window.renderSuggestions = function () {
    var uid = getUid();
    var list = document.getElementById("suggList");
    var input = document.getElementById("suggInput");
    var submit = document.getElementById("suggSubmitBtn");
    if (!list) return;
    if (!uid) {
      list.innerHTML = '<p class="text-xs text-gray-500 py-2">Sign in to submit and track your suggestions.</p>';
      if (input) input.disabled = true;
      if (submit) submit.disabled = true;
      return;
    }
    if (input) input.disabled = false;
    if (submit) submit.disabled = false;
    fetch("/api/account?user=" + encodeURIComponent(uid), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) renderList(d.suggestions || []);
      })
      .catch(function () {});
  };

  function setResult(msg, ok) {
    var r = document.getElementById("suggResult");
    if (!r) return;
    r.textContent = msg || "";
    r.style.display = msg ? "" : "none";
    r.className = "text-xs font-semibold mt-3 " + (ok ? "text-emerald-400" : "text-red-400");
  }

  function submitSuggestion() {
    var input = document.getElementById("suggInput");
    var submit = document.getElementById("suggSubmitBtn");
    var uid = getUid();
    if (!input) return;
    var v = input.value.trim();
    if (!uid) { setResult("Sign in to submit a suggestion.", false); return; }
    if (!v) { setResult("Please write a suggestion first.", false); return; }
    if (submit) submit.disabled = true;
    fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addSuggestion", user: uid, text: v })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (submit) submit.disabled = false;
      if (d && d.ok) {
        setResult("Suggestion sent - the owner will see it.", true);
        input.value = "";
        var c = document.getElementById("suggCount");
        if (c) c.textContent = "0 / 400";
        renderSuggestions();
      } else {
        setResult((d && d.error) || "Could not send suggestion.", false);
      }
    }).catch(function () {
      if (submit) submit.disabled = false;
      setResult("Could not send suggestion.", false);
    });
  }

  window.toggleCommMenu = function () {
    var w = document.getElementById("nav-comm-wrap");
    if (!w) return;
    w.classList.toggle("open");
    var btn = document.getElementById("page-nav-wanted");
    if (btn) btn.setAttribute("aria-expanded", w.classList.contains("open") ? "true" : "false");
  };
  window.closeCommMenu = function () {
    var w = document.getElementById("nav-comm-wrap");
    if (!w) return;
    w.classList.remove("open");
    var btn = document.getElementById("page-nav-wanted");
    if (btn) btn.setAttribute("aria-expanded", "false");
  };

  document.addEventListener("DOMContentLoaded", function () {
    var input = document.getElementById("suggInput");
    var submit = document.getElementById("suggSubmitBtn");
    if (submit) submit.addEventListener("click", submitSuggestion);
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitSuggestion(); }
      });
      input.addEventListener("input", function () {
        var c = document.getElementById("suggCount");
        if (c) c.textContent = input.value.length + " / 400";
      });
    }
    document.addEventListener("click", function (e) {
      var w = document.getElementById("nav-comm-wrap");
      if (w && !w.contains(e.target)) closeCommMenu();
    });
  });
})();
