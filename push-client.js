/* TheHighWRLD Dashboard - Web Push client.
 *
 * Renders a device control inside the EXISTING Friends & Messages settings card,
 * directly under the "Friends & Messages notifications" switch. It deliberately
 * does not add a competing notification toggle: the switch above it already maps
 * to user_privacy.notifications_enabled, which the server checks before it
 * dispatches anything. This only manages the *device subscription* - whether this
 * browser is registered to receive pushes at all.
 *
 * Rules this file follows:
 *   - Permission is NEVER requested on page load. There is exactly one user
 *     action (the button) that can trigger a prompt.
 *   - "Subscribed" is never claimed just because a push request was accepted. It
 *     reflects the browser's actual push subscription state.
 *   - A denied or unsupported browser is reported honestly, never hidden.
 */
(function () {
  "use strict";
  if (window.__thwPush) return;
  window.__thwPush = true;

  var API = "/api/push";
  var state = { mounted: false, publicKey: "", devices: [] };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function toast(msg, kind) {
    try {
      if (typeof window.showToast === "function") { window.showToast(msg, kind || "info", 3500); return; }
    } catch (_) {}
  }

  /* iOS Safari only exposes PushManager to web apps that were added to the Home
     Screen AND launched from there. In a normal Safari tab, Notification exists
     but serviceWorker.pushManager does not, so this must be checked before
     offering the button rather than failing at subscribe time. */
  function isIOS() {
    var ua = navigator.userAgent || "";
    var iPadOS = /Macintosh/.test(ua) && "ontouchend" in document && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/i.test(ua) || iPadOS;
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }
  function supportsPush() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  /* applicationServerKey is base64url; the Push API wants raw bytes. */
  function urlB64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* navigator.serviceWorker.ready is not guaranteed to settle. It stays pending
     when registration is blocked (enterprise policy, insecure context) and can
     also hang behind a stalled install. Awaiting it unguarded leaves the whole
     control permanently blank with no explanation, which is worse than saying
     so - so the wait is bounded and the caller renders an honest fallback. */
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error(label)); }, ms);
      }),
    ]);
  }

  function currentSubscription() {
    return withTimeout(
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }),
      /* The shell is 113 precache entries / ~4.96MB (measured against
         production, all 200). That install overran the old 5s budget even
         from a warm desktop, so a phone timed out while the worker was
         still installing perfectly normally. */
      30000,
      "sw_ready_timeout"
    );
  }

  /* ---------------- server sync ---------------- */

  function loadState() {
    return fetch(API, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok !== true) throw new Error("push_state_unavailable");
        state.publicKey = d.publicKey || "";
        state.devices = d.devices || [];
        return d;
      });
  }

  function sendSubscription(sub) {
    return fetch(API, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }),
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.ok !== true) throw new Error("subscribe_failed");
        return d;
      });
  }

  function removeSubscription(endpoint) {
    return fetch(API, {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: endpoint }),
    }).then(function (r) { return r.json(); });
  }

  function removeAll() {
    return fetch(API, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unsubscribeAll" }),
    }).then(function (r) { return r.json(); });
  }

  /* ---------------- enable / disable ---------------- */

  function enable() {
    if (!supportsPush()) { render(); return; }

    /* iOS gate: without Home Screen installation there is no pushManager to use. */
    if (isIOS() && !isStandalone()) { render(); return; }
    if (!state.publicKey) {
      toast("Push is not configured on the server yet.", "error");
      return;
    }

    // The ONLY place permission is requested, and only from a user gesture.
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") {
        toast(perm === "denied"
          ? "Notifications are blocked for this site. Re-enable them in your browser settings."
          : "Notification permission was not granted.", "error");
        render();
        return;
      }
      return navigator.serviceWorker.ready
        .then(function (reg) {
          return reg.pushManager.getSubscription().then(function (existing) {
            if (existing) return existing;
            return reg.pushManager.subscribe({
              // Required by Chrome and correct here anyway: a push that shows
              // nothing is a silent push, which is not what we want.
              userVisibleOnly: true,
              applicationServerKey: urlB64ToUint8Array(state.publicKey),
            });
          });
        })
        .then(function (sub) {
          if (!sub) throw new Error("no_subscription");
          return sendSubscription(sub);
        })
        .then(function () { toast("Push notifications enabled for this device.", "success"); })
        .catch(function (err) { toast("Could not enable push: " + ((err && err.message) || "unknown error"), "error"); });
    }).catch(function () {
      toast("Could not enable push: " + ((err && err.message) || "unknown error"), "error");
    }).then(function () {
      loadState().then(render).catch(render);
    });
  }

  function disableThisDevice() {
    currentSubscription()
      .then(function (sub) {
        var endpoint = sub ? sub.endpoint : null;
        var steps = sub ? sub.unsubscribe().then(function () { return true; }) : Promise.resolve(false);
        return steps.then(function (wasSubscribed) {
          // Only tell the server to drop it if the browser actually had one.
          return endpoint ? removeSubscription(endpoint) : null;
        }).then(function () {
          toast(wasSubscribed ? "Push notifications turned off for this device." : "This device was already off.", "success");
        });
      })
      .catch(function (err) { toast("Could not turn off: " + ((err && err.message) || "unknown error"), "error"); })
      .then(function () { loadState().then(render).catch(render); });
  }

  /* ---------------- render ---------------- */

  function statusLine(sub) {
    if (!supportsPush()) {
      return { tone: "warn", text: "This browser does not support Web Push notifications." };
    }
    if (isIOS() && !isStandalone()) {
      return {
        tone: "warn",
        text: "On iPhone and iPad, add this site to your Home Screen, then open it from there to enable notifications.",
      };
    }
    if (Notification.permission === "denied") {
      return { tone: "warn", text: "Notifications are blocked for this site. Re-enable them in your browser or device settings." };
    }
    if (sub) {
      return { tone: "ok", text: "This device will receive notifications when TheHighWRLD is closed." };
    }
    if (Notification.permission === "granted") {
      return { tone: "idle", text: "Permission granted, but this device is not subscribed yet." };
    }
    return { tone: "idle", text: "Turn on notifications to get friend requests and messages when TheHighWRLD is closed." };
  }

  function render() {
    var host = document.getElementById("thw-push-section");
    if (!host) return;

    host.innerHTML = "";

    currentSubscription().then(function (sub) {
      if (!document.getElementById("thw-push-section")) return;
      var info = statusLine(sub);
      var canEnable = supportsPush() && Notification.permission !== "denied" && !(isIOS() && !isStandalone());

      var wrap = el("div", "thw-push");
      var status = el("p", "thw-push-status thw-push-status--" + info.tone, info.text);
      wrap.appendChild(status);

      var row = el("div", "thw-push-actions");

      if (sub) {
        var off = el("button", "thw-push-btn thw-push-btn--off", "Turn off for this device");
        off.type = "button";
        off.addEventListener("click", disableThisDevice);
        row.appendChild(off);
      } else {
        var on = el("button", "thw-push-btn thw-push-btn--on", "Enable Push Notifications");
        on.type = "button";
        if (!canEnable) {
          on.disabled = true;
          on.setAttribute("aria-disabled", "true");
        }
        on.addEventListener("click", enable);
        row.appendChild(on);
      }
      wrap.appendChild(row);

      /* Server-side device list, so a user can revoke a phone they no longer
         have. Counted separately from this device's own subscription. */
      var total = state.devices.length;
      if (total > 0) {
        var list = el("ul", "thw-push-devices");
        var head = el("li", "thw-push-devices-head",
          total === 1 ? "1 registered device" : total + " registered devices");
        list.appendChild(head);
        state.devices.slice(0, 8).forEach(function (d) {
          var li = el("li", "thw-push-device");
          var name = el("span", "thw-push-device-name", (d.userAgent || "Device").slice(0, 48));
          var when = el("span", "thw-push-device-when", (d.createdAt || "").slice(0, 10));
          li.appendChild(name);
          li.appendChild(when);
          list.appendChild(li);
        });
        wrap.appendChild(list);

        var clear = el("button", "thw-push-btn thw-push-btn--danger", "Remove all devices");
        clear.type = "button";
        clear.addEventListener("click", function () {
          if (!window.confirm("Stop push notifications on every device signed in to this account?")) return;
          removeAll().then(function () {
            // Drop this browser's own subscription too, or it would keep a
            // subscription the server has no record of.
            return currentSubscription().then(function (sub) { return sub ? sub.unsubscribe() : null; });
          }).then(function () {
            toast("All devices removed.", "success");
            loadState().then(render).catch(render);
          }).catch(function () { toast("Could not remove devices.", "error"); });
        });
        wrap.appendChild(clear);
      }

      host.appendChild(wrap);
    }).catch(function (err) {
      if (!document.getElementById("thw-push-section")) return;
      var timedOut = err && err.message === "sw_ready_timeout";
      /* The install is still running, not broken. Re-render the moment the
         worker goes active so the real state appears on its own, rather than
         making the user close and reopen the app to come back to this screen. */
      if (timedOut && "serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(function () {
          if (document.getElementById("thw-push-section")) render();
        }).catch(function () {});
      }
      var w = el("div", "thw-push");
      w.appendChild(el("p", "thw-push-status thw-push-status--warn", timedOut
        ? "Still downloading the offline app. This will update on its own in a moment."
        : "Could not read the push subscription for this device. Notifications may still work; recheck after reopening the app."));
      host.appendChild(w);
    });
  }

  /* Mount inside the existing settings card, directly under the notifications
     switch. Guarded so re-entering the settings view cannot duplicate it. */
  function mount() {
    if (state.mounted) return;
    var card = document.getElementById("thw-social-settings");
    if (!card) return;
    if (document.getElementById("thw-push-section")) { state.mounted = true; return; }

    var section = el("div");
    section.id = "thw-push-section";
    var heading = el("h4", "thw-social-settings-group", "Notifications on this device");
    card.appendChild(heading);
    card.appendChild(section);
    state.mounted = true;

    loadState().then(render).catch(function () {
      // Server not configured (no VAPID key yet) - still show accurate device state.
      render();
    });
  }

  /* The settings card is built lazily when the Settings view is first opened,
     so watch for it instead of racing mount() at load. */
  function watchForCard() {
    var tries = 0;
    (function poll() {
      if (document.getElementById("thw-social-settings")) { mount(); return; }
      if (++tries > 200) return;
      window.setTimeout(poll, 250);
    })();
  }

  /* A notification click is routed by the service worker. pwa.js owns the single
     message listener (it loads first and must catch clicks that arrive during a
     cold start, before this file has run); it calls __thwPushReady, and stores
     the destination in __thwPwaPendingClick if we were not ready yet. Defining
     __thwPushReady here is therefore the only entry point - adding a second
     message listener in this file would route the same click twice. */
  function handlePushClick(target) {
    var S = window.THWSocial;
    if (!S) { window.setTimeout(function () { handlePushClick(target); }, 400); return; }
    if (target === "social:requests") S.goRequests();
    else if (target === "social:friends") S.goFriends();
    else S.goMessages();
  }

  window.__thwPushReady = function (target) {
    window.__thwPwaPendingClick = null;
    handlePushClick(target);
    // A push click is also a strong hint the user should see the badge cleared.
    try { window.dispatchEvent(new CustomEvent("thw:push-click", { detail: { target: target } })); } catch (_) {}
  };

  // Cold start: pwa.js may have captured the destination before we loaded.
  if (window.__thwPwaPendingClick) {
    var pending = window.__thwPwaPendingClick;
    window.__thwPwaPendingClick = null;
    handlePushClick(pending);
  }

  watchForCard();

  /* Exposed so other UI (e.g. a future banner) can reuse the same logic rather
     than duplicating permission handling. */
  window.THWPush = {
    enable: enable,
    disableThisDevice: disableThisDevice,
    state: state,
    supportsPush: supportsPush,
    isIOS: isIOS,
    isStandalone: isStandalone,
    refresh: function () { loadState().then(render).catch(render); },
  };
})();