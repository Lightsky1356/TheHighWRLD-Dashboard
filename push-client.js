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
    state.loaded = true;
        state.devices = d.devices || [];
        return d;
      });
  }

  /* PushSubscription.keys is a method in the spec and is absent on some engines -
   on iPhone sub.keys was undefined, so sub.keys.p256dh threw and the POST was
   never sent. toJSON().keys is the cross-browser shape and is synchronous in both
   Chrome and Safari. The old property access is kept only as a fallback, and a
   missing key set now produces a named error instead of a TypeError from inside an
   object literal. */
  function subscriptionKeys(sub) {
    try {
      if (typeof sub.toJSON === "function") {
        var json = sub.toJSON();
        if (json && json.keys && json.keys.p256dh && json.keys.auth) return json.keys;
      }
    } catch (_) {}
    try {
      if (sub.keys && sub.keys.p256dh && sub.keys.auth) return sub.keys;
    } catch (_) {}
    return null;
  }

  function sendSubscription(sub) {
    var keys = subscriptionKeys(sub);
    if (!keys) return Promise.reject(new Error("no_subscription_keys"));
    return fetch(API, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-THW-Device": deviceLabel(navigator.userAgent) },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: keys }),
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
      headers: { "Content-Type": "application/json", "X-THW-Device": deviceLabel(navigator.userAgent) },
      body: JSON.stringify({ endpoint: endpoint }),
    }).then(function (r) { return r.json(); });
  }

  function removeAll() {
    return fetch(API, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-THW-Device": deviceLabel(navigator.userAgent) },
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
        /* wasSubscribed used to be a parameter of the first callback but was read
           in the second, which cannot see it - so the success toast threw
           ReferenceError and the catch reported "Could not turn off" on every
           path, including a successful unsubscribe. Declared out here instead. */
        var wasSubscribed = false;
        return steps.then(function (didHave) {
          wasSubscribed = didHave;
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

  /* A readable device name derived from the stored User-Agent.

     The panel used to print the raw UA, which made two devices indistinguishable
     and hid a real problem: iOS Home Screen web apps report a desktop-class UA, so
     "Macintosh; Intel Mac OS X" with no "Mobile/" token is a Mac, not a phone.
     That is exactly how the registered device was identified as a Mac. */
  /* The server returns only a prefix of each endpoint, by design: the full value
     is a credential for that device's push channel and is never echoed into a
     page. A 48-character prefix is still enough to tell devices apart. */
  function endpointPrefix(endpoint) {
    return String(endpoint || "").slice(0, 48);
  }

  function serverKnowsEndpoint(endpoint) {
    var want = endpointPrefix(endpoint);
    if (!want) return true;
    var list = state.devices || [];
    for (var i = 0; i < list.length; i++) {
      var got = String((list[i] && list[i].endpointPreview) || "").replace(/\.$/, "");
      if (got && got === want) return true;
    }
    return false;
  }

  // A local subscription the server has never seen means no push can ever arrive,
  // yet the panel reads healthy and offers only Turn off. Re-register it.
  function resyncUnknownSubscription(sub) {
    if (!sub || !sub.endpoint) return;
    if (state.resyncing) return;
    if (serverKnowsEndpoint(sub.endpoint)) return;
    state.resyncing = true;
    sendSubscription(sub)
      .then(function () { return loadState(); })
      .then(function () { return render(); })
      .catch(function () {
        /* Leave state.resyncing set: a failing POST should not retry on every
           render. The next successful loadState + render clears it below. */
        state.resyncing = false;
      });
  }

  // A readable device name. platform and maxTouchPoints are included because
  // iPadOS reports a Macintosh UA identical to a real Mac; only
  // platform === "MacIntel" with maxTouchPoints > 1 tells them apart.
  // A stored value that is not a User-Agent is already a label and passes through.
  // A readable device name.
  //
  // The User-Agent cannot be trusted for Apple hardware. Request Desktop Website
  // makes an iPhone report a Macintosh UA with platform MacIntel and maxTouchPoints
  // 5 - identical in all three respects to an iPad, which is how this once reported
  // a phone as "iPad 5-point touch". screen.width is the signal that does not lie:
  // no iPhone reaches 768 CSS px, every iPad does, and it describes the physical
  // panel rather than the emulated viewport, so desktop mode cannot fake it.
  // A stored value that is not a User-Agent is already a label and passes through.
  function deviceLabel(ua) {
    var s = String(ua || "");
    if (!/mozilla\//i.test(s)) return s || "This device";
    var lower = s.toLowerCase();
    var nav = (typeof navigator !== "undefined") ? navigator : {};
    var touch = nav.maxTouchPoints || 0;
    var screenW = (typeof screen !== "undefined" && screen && screen.width) || 0;
    var base = "";

    if (lower.indexOf("android") !== -1) base = "Android";
    else if (/iphone|ipod/.test(lower)) base = "iPhone";
    else if (/ipad/.test(lower)) base = "iPad";
    else if (lower.indexOf("cros") !== -1) base = "Chromebook";
    else if (lower.indexOf("windows") !== -1) base = "Windows PC";
    else if (lower.indexOf("macintosh") !== -1) {
      if (lower.indexOf("mobile") !== -1) {
        base = "iPhone";
      } else if (touch > 0 && screenW && screenW <= 1200) {
        // Desktop-mode iPhone or an iPad - the UA is identical for both. The boundary
        // is 500, not 768: the widest iPhone is about 440 CSS px and the smallest
        // iPad is 744, so 768 would call an iPad mini a phone.
        base = screenW < 500 ? "iPhone" : "iPad";
      } else {
        // A Mac. macOS reports maxTouchPoints > 0 on any Mac with a Touch Bar or a
        // touchscreen, so touch alone would label those an iPad. Every iPad tops out
        // around 1024 CSS px and every Mac is wider than 1200, which settles it.
        base = "Mac";
      }
    } else if (lower.indexOf("linux") !== -1) base = "Linux PC";

    if (!base) base = "This device";

    var model = "";
    var m = s.match(/iPhone(\d+[,_]\d+)/);
    if (m) model = m[1].replace(",", " ");
    if (!model) { var g = s.match(/Android\s+([\d.]+)/); if (g) model = g[1]; }
    if (!model) { var w = s.match(/Windows NT\s+([\d.]+)/); if (w) model = w[1]; }
    return model ? base + " " + model : base;
  }

  // Reads the service worker's push trace, so we can tell a push that never
  // arrived from one that arrived and was suppressed by the OS.
  function readPushTrace() {
    if (!("caches" in window)) return Promise.resolve(null);
    return caches.match("/__thw_push_trace")
      .then(function (r) { return r ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ---------------- delivery indicator ----------------

     Four states, chosen to match what can actually be known:

       off        not subscribed for this device
       confirmed  a push reached the service worker (kind:'push' in the trace)
       problem    the worker received one and it threw; the message is shown
       waiting    subscribed, worker live, but no push has arrived yet

     "waiting" is the interesting one. It is the state that distinguishes a working
     server from a working phone, which is the entire remaining question here: a
     push service can return 201 and iOS still discard it before the worker runs. */

  function setLive(dot, text, tone, msg) {
    dot.className = "thw-push-dot" + (tone ? " thw-push-dot--" + tone : "");
    text.textContent = msg;
  }

  function paintLive(dot, text, t, subscribed) {
    if (!subscribed) {
      setLive(dot, text, "", "Push is off for this device.");
      return;
    }
    if (t && t.error) {
      setLive(dot, text, "bad", "A push reached the app but failed: " + t.error);
      return;
    }
    if (t && t.kind === "push") {
      setLive(dot, text, "good",
        "Delivery confirmed at " + new Date(t.at || Date.now()).toLocaleTimeString() + ".");
      return;
    }
    // A kind:'ready' entry means this worker activated and has not been pushed to
    // since. No entry at all means an older worker is still running, which is worth
    // saying plainly rather than reporting the same "waiting" state for both.
    if (!t) {
      setLive(dot, text, "warn", "This device is running an older worker. Reopen the app to update it.");
      return;
    }
    setLive(dot, text, "warn", "Subscribed, but no push has reached this device yet.");
  }

  /* Sends a real push at this account and then watches the worker's trace, so the
     answer to "is it working?" comes back in the panel instead of needing someone
     with server access to fire one by hand. 30s: Apple accepted one of these in
     under a second, so if nothing lands inside that window it is not in flight. */
  var TEST_WAIT_MS = 30_000;

  function runPushTest(btn, dot, text) {
    btn.disabled = true;
    btn.textContent = "Sending…";
    setLive(dot, text, "wait", "Test sent. Waiting for this device…");

    fetch(API.replace(/\/push(\?|$)/, "/push-test$1"), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: "http_" + r.status }; })
          .then(function (d) {
            if (!r.ok || !d || d.ok !== true) throw new Error((d && d.error) || ("http_" + r.status));
            return d;
          });
      })
      .then(function (d) {
        if (d.skipped) {
          setLive(dot, text, "wait", "Just tested — give it a moment.");
          return null;
        }
        if (!d.sent) {
          throw new Error("the push service refused it");
        }
        return pollForPush(dot, text, btn);
      })
      .catch(function (err) {
        setLive(dot, text, "bad", "Test failed: " + ((err && err.message) || "unknown error"));
        btn.disabled = false;
        btn.textContent = "Send a test push";
      });
  }

  function pollForPush(dot, text, btn) {
    var deadline = Date.now() + TEST_WAIT_MS;
    var tick = function () {
      readPushTrace().then(function (t) {
        if (t && t.kind === "push" && !t.error) {
          setLive(dot, text, "good",
            "Delivery confirmed at " + new Date(t.at || Date.now()).toLocaleTimeString() + ".");
          return true;
        }
        return false;
      }).then(function (arrived) {
        if (arrived) return;
        if (Date.now() >= deadline) {
          setLive(dot, text, "warn", "Nothing arrived within 30 seconds. The server accepted it; this device did not get it.");
          btn.disabled = false;
          btn.textContent = "Send a test push";
          return;
        }
        setTimeout(tick, 2500);
      }).catch(function () { /* cache read failed; the deadline branch recovers */ });
    };
    tick();
  }
  function render() {
    var host = document.getElementById("thw-push-section");
    if (!host) return;

    host.innerHTML = "";

    currentSubscription().then(function (sub) {
      if (!document.getElementById("thw-push-section")) return;
      // state.devices is what makes a mismatch detectable. Fetch it first if it has
      // not been loaded, otherwise an empty list on first paint would look like a
      // mismatch and fire a spurious POST.
      if (!state.loaded) {
        loadState().then(function () {
          state.resyncing = false;
          return render();
        }).catch(render);
        return;
      }
      resyncUnknownSubscription(sub);
      var info = statusLine(sub);
      var canEnable = supportsPush() && Notification.permission !== "denied" && !(isIOS() && !isStandalone());

      var wrap = el("div", "thw-push");
      var status = el("p", "thw-push-status thw-push-status--" + info.tone, info.text);
      wrap.appendChild(status);
      /* Delivery indicator. A plain "enabled" line cannot express the thing that
         actually matters here: the push service can accept a payload with HTTP 201
         and iOS still drop it before the service worker is involved. Only the
         worker's own trace can tell those apart, so it drives the indicator. */
      var live = el("div", "thw-push-live");
      var dot = el("span", "thw-push-dot thw-push-dot--wait");
      var liveText = el("span", "thw-push-live-text", "Checking whether pushes arrive…");
      live.appendChild(dot);
      live.appendChild(liveText);
      wrap.appendChild(live);

      readPushTrace().then(function (t) {
        paintLive(dot, liveText, t, !!sub);
      });

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
      if (sub) {
        var test = el("button", "thw-push-btn thw-push-btn--test", "Send a test push");
        test.type = "button";
        test.addEventListener("click", function () { runPushTest(test, dot, liveText); });
        row.appendChild(test);
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
          var name = el("span", "thw-push-device-name", deviceLabel(d.userAgent));
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