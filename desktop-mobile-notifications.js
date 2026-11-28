/* Desktop & mobile notification panel.
   Lives in Settings and uses the local settings store, so it works signed in
   or out, on desktop and on mobile. The test button sends a real notification
   through the browser's Notification API (or a native EXE one when present). */
(function () {
  "use strict";

  var NS = "notifApp";
  var DEFAULTS = {
    show: true,
    messages: false,
    leaks: true,
    groupBuys: true,
    snippets: true,
    suggestionCards: true,
  };
  var KEYS = {
    show: "show",
    messages: "messages",
    leaks: "leaks",
    groupBuys: "groupBuys",
    snippets: "snippets",
    suggestionCards: "suggestionCards",
  };

  function get(k) {
    try {
      var s = window.wrldPlayerSettings && window.wrldPlayerSettings.get(NS);
      if (s && typeof s === "object" && s[k] !== undefined) return s[k] !== false;
    } catch (e) {}
    return DEFAULTS[k];
  }
  function set(k, v) {
    try {
      var s = window.wrldPlayerSettings && window.wrldPlayerSettings.get(NS);
      s = s && typeof s === "object" ? s : {};
      s[k] = !!v;
      window.wrldPlayerSettings.set(NS, s);
    } catch (e) {}
  }

  function notify(title, body) {
    try {
      if (window.highwrld && typeof window.highwrld.notify === "function") {
        window.highwrld.notify(title, body);
        return;
      }
      if (typeof Notification === "function" && Notification.permission === "granted") {
        new Notification(title, { body: body });
        return;
      }
    } catch (e) {}
    if (window.showToast) window.showToast(title + " — " + body, "info", 2600);
  }

  function paint() {
    ["show", "messages", "leaks", "groupBuys", "snippets"].forEach(function (k) {
      var el = document.getElementById("notifApp-" + k);
      if (el) {
        var on = get(k);
        el.checked = on;
        if (el.closest(".toggle-row")) el.closest(".toggle-row").classList.toggle("is-off", !on);
      }
    });
    var pill = document.getElementById("notifAppPill");
    if (pill) {
      var on = get("show");
      pill.textContent = on ? "Notifications On" : "Notifications Disabled";
      pill.className = "thw-push-pill " + (on ? "" : "thw-push-pill--off");
    }
    var test = document.getElementById("notifAppTest");
    if (test) test.disabled = !get("show");
  }

  function bind() {
    ["show", "messages", "leaks", "groupBuys", "snippets"].forEach(function (k) {
      var el = document.getElementById("notifApp-" + k);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("change", function () {
        set(k, this.checked);
        paint();
      });
    });
    var test = document.getElementById("notifAppTest");
    if (test && !test.dataset.bound) {
      test.dataset.bound = "1";
      test.addEventListener("click", function () {
        notify("TheHighWRLD Dashboard", "Sent. It shows at the corner of your screen, or in the notification list while Do not disturb is on.");
      });
    }
  }

  function mount() {
    var host = document.getElementById("notifAppBlock");
    if (!host || host.dataset.bound) return;
    host.dataset.bound = "1";
    bind();
    paint();
  }

  if (document.readyState !== "loading") mount();
  else document.addEventListener("DOMContentLoaded", mount);
  if (typeof MutationObserver === "function") {
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener("thw:notification-test", function () { notify("TheHighWRLD Dashboard", "Test notification"); });
})();
