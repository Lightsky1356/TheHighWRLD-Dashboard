/* Public Lobby chat — a small renderer over /api/chat.
 * Realtime arrives through the shared socket (thw:chat), with a poll fallback.
 */
(function () {
  "use strict";
  if (window.__thwChatMounted) return;
  window.__thwChatMounted = true;

  var API = "/api/chat";
  var list = null, input = null, sendBtn = null,ount = null;
  var messages = [], replyTo = 0, atBottom = true, loading = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function time(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
  }
  function signedIn() {
    try { return !!(window.__thwAuthSignedIn || el("nav-account-wrap")?.style.display === "flex"); } catch (e) { return false; }
  }

  function render() {
    if (!list) return;
    var nearBottom = atBottom;
    list.innerHTML = messages.map(function (m) {
      var mine = m.uid && m.uid === (window.__chatUid || "");
      var parent = replyTo && m.replyToId ? messages.find(function (x) { return x.id === m.replyToId; }) : null;
      return '<div class="thw-social-message' + (mine ? " mine" : "") + '" data-id="' + m.id + '">' +
        (m.replyToId ? '<div class="chat-reply-ref">Replying to ' + esc(parent ? parent.name : "a message") + '</div>' : '') +
        '<div class="thw-social-message-meta"><b class="thw-social-message-name"' +
          (m.uid ? ' data-profile-link="' + esc(m.uid) + '"' : '') + '>' + esc(m.name || "Member") + '</b>' +
          '<time>' + time(m.createdAt) + '</time></div>' +
        '<p class="thw-social-message-body">' + (m.deleted ? "<em>Message deleted</em>" : esc(m.body)) + '</p>' +
        (signedIn() && !m.deleted ? '<button type="button" class="chat-reply-btn" data-chat-reply="' + m.id + '" data-name="' + esc(m.name) + '"><i class="fas fa-reply"></i> Reply</button>' : '') +
        '</div>';
    }).join("") || '<p class="pv2-none">No messages yet. Say hello.</p>';
    if (nearBottom) list.scrollTop = list.scrollHeight;
    if (ount) ount.textContent = messages.length + (messages.length === 1 ? " message" : " messages");
    list.querySelectorAll("[data-chat-reply]").forEach(function (b) {
      b.addEventListener("click", function () {
        replyTo = parseInt(b.getAttribute("data-chat-reply"), 10);
        if (input) { input.placeholder = "Reply to " + b.getAttribute("data-name") + "\u2026"; input.focus(); }
      });
    });
  }

  async function load() {
    try {
      var r = await fetch(API, { cache: "no-store" });
      var d = await r.json();
      if (d && d.messages) { messages = d.messages; render(); }
    } catch (e) {}
  }

  async function send() {
    if (!input || !input.value.trim()) return;
    if (!signedIn()) { if (window.showAuthPage) window.showAuthPage("login"); return; }
    if (sendBtn) sendBtn.disabled = true;
    var r = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.value.trim(), replyToId: replyTo }),
    }).catch(() => null);
    var d = r ? await r.json().catch(() => null) : null;
    if (sendBtn) sendBtn.disabled = false;
    if (d && d.ok && d.message) {
      messages.push(d.message);
      input.value = "";
      replyTo = 0;
      if (input) input.placeholder = "Write a message\u2026";
      atBottom = true;
      render();
    } else if (d && d.error && window.showToastSimple) {
      window.showToastSimple(d.error, { type: "error" });
    }
  }

  function boot() {
    list = el("chat-list");
    input = el("chat-input");
    sendBtn = el("chat-send");
    ount = el("chat-count");
    if (!list || !input || !sendBtn) return;
    try { window.__chatUid = (JSON.parse(localStorage.getItem("wantedAuthUser") || "{}") || {}).uid || ""; } catch (e) {}
    if (!signedIn()) { input.disabled = true; input.placeholder = "Sign in to chat"; sendBtn.disabled = true; }
    list.addEventListener("scroll", function () { atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60; });
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } });
    window.addEventListener("thw:chat", function (e) {
      var m = e.detail && e.detail.message;
      if (!m) return;
      if (!messages.some(function (x) { return x.id === m.id; })) messages.push(m);
      render();
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    load();
    setInterval(load, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
