/* ============================================================================
   BLUETOOTH - playing through a speaker without wires
   ---------------------------------------------------------------------------
   A phone with a Bluetooth speaker is the commonest way to listen to
   something, and the web had no way to ask for one: the browser plays to
   whatever the system says, and the site never mentions it.

   So there is a button in the WRLD Deck and one in the WRLD Player, and
   both do the same thing, in the order that gives the reader the most:

     1. The browser's own output picker, where there is one. It knows the
        speakers that are paired, and it is the picker the reader has
        already used a hundred times.
     2. The Audio Output API, where there is not: the speakers are listed
        and the music is sent to the one that is chosen.
     3. Pairing a device over Web Bluetooth, for a speaker the system does
        not list.
     4. A word about it, when the browser cannot do any of that.

   Whatever the browser gives is remembered, so the music goes to the same
   speaker next time.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__thwBluetooth) return;
  window.__thwBluetooth = true;

  var SINK_KEY = "thw-bt-sink";
  var sinkId = "";

  try { sinkId = localStorage.getItem(SINK_KEY) || ""; } catch (e) {}

  function audio() { return document.querySelector("audio"); }

  function toast(text, kind) {
    try {
      if (typeof window.showToastSimple === "function") window.showToastSimple(text, kind || "info", 3200);
      else if (typeof window.showToast === "function") window.showToast(text, kind || "info");
    } catch (e) {}
  }

  function el(id) { return document.getElementById(id); }

  /* ---- what this browser can do ---- */
  function canPick() {
    try {
      return !!(navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === "function");
    } catch (e) { return false; }
  }
  function canRoute() {
    var a = audio();
    return !!(a && typeof a.setSinkId === "function");
  }
  function canPair() {
    try { return typeof navigator !== "undefined" && !!navigator.bluetooth; } catch (e) { return false; }
  }
  function supported() { return canPick() || canRoute() || canPair(); }

  /* ---- the speakers the system knows about ---- */
  function outputs() {
    var list = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve(list);
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        if (d.kind === "audiooutput" && d.deviceId) {
          list.push({ id: d.deviceId, label: d.label || "Speaker" });
        }
      }
      return list;
    }).catch(function () { return list; });
  }

  /* ---- sending the music there ---- */
  function route(id, label) {
    var a = audio();
    if (!a || typeof a.setSinkId !== "function") return Promise.reject(new Error("no sink"));
    return a.setSinkId(id || "").then(function () {
      sinkId = id || "";
      try { localStorage.setItem(SINK_KEY, sinkId); } catch (e) {}
      paint();
      toast(label ? "Playing through " + label : "Playing through the system default", "success");
    });
  }

  function pick() {
    /* The browser's own picker. It knows the paired speakers, and it is the
       picker the reader already knows. */
    if (canPick()) {
      return navigator.mediaDevices.selectAudioOutput().then(function (device) {
        if (!device) return;
        var a = audio();
        if (a && typeof a.setSinkId === "function") return a.setSinkId(device.deviceId).then(function () {
          sinkId = device.deviceId;
          try { localStorage.setItem(SINK_KEY, sinkId); } catch (e) {}
          paint();
          toast("Playing through " + (device.label || "your speaker"), "success");
        });
        sinkId = device.deviceId || "";
        try { localStorage.setItem(SINK_KEY, sinkId); } catch (e) {}
        paint();
        toast("Playing through " + (device.label || "your speaker"), "success");
      }).catch(function (err) {
        if (err && err.name === "NotAllowedError") return;
        toast("Could not reach the speaker", "error");
      });
    }

    /* The Audio Output API: the speakers are listed, and the music is sent
       to the one that is chosen. */
    if (canRoute()) {
      return outputs().then(function (list) {
        if (!list.length) return pair();
        if (list.length === 1) return route("", "the system default");
        /* More than one: the reader picks. */
        var names = list.map(function (d, i) { return (i ? "\\n" + (i + 1) + ") " : "") + d.label; }).join("");
        var pickOne = window.prompt("Play through which speaker?\n\n" + names, "1");
        if (pickOne === null) return;
        var n = Math.max(1, parseInt(pickOne, 10) || 1);
        var chosen = list[n - 1];
        if (chosen) return route(chosen.id, chosen.label);
      }).catch(function () { return pair(); });
    }

    return pair();
  }

  /* ---- pairing a speaker the system does not list ---- */
  function pair() {
    if (!canPair()) {
      toast("This browser cannot talk to Bluetooth", "error");
      return Promise.resolve(false);
    }
    return navigator.bluetooth.requestDevice({ acceptAllDevices: true }).then(function (device) {
      var name = (device && device.name) || "the speaker";
      toast("Paired with " + name, "success");
      paint(name);
      return true;
    }).catch(function (err) {
      if (err && err.name === "NotFoundError") return false;
      toast("Could not reach the speaker", "error");
      return false;
    });
  }

  /* ---- the button ---- */
  function paint(pairedName) {
    var buttons = document.querySelectorAll("[data-thw-bluetooth]");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.classList.toggle("is-on", !!sinkId || !!pairedName);
      var label = pairedName ? ("Bluetooth: " + pairedName) : (sinkId ? "Bluetooth speaker" : "Bluetooth");
      b.setAttribute("title", label);
      b.setAttribute("aria-label", label);
    }
  }

  function wire() {
    var buttons = document.querySelectorAll("[data-thw-bluetooth]");
    for (var i = 0; i < buttons.length; i++) {
      (function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          e.preventDefault();
          pick();
        });
      })(buttons[i]);
    }
    /* The buttons are only shown where the browser can do something. */
    if (!supported()) {
      for (var k = 0; k < buttons.length; k++) buttons[k].hidden = true;
    }
    paint();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  /* The buttons live in the Deck and in the player, and the Deck is built
     with the page, so the wiring runs again once the page is ready. */
  window.addEventListener("load", wire);

  window.__thwBluetoothPick = pick;
  window.__thwBluetoothSupported = supported;
})();
