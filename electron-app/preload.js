/* Preload - the only surface the page can reach.
 *
 * The site is a normal web page, so it gets a deliberately small, named API
 * rather than any part of node. Everything here is a promise and takes plain
 * JSON: no ipcRenderer, no require, nothing to leak.
 *
 * The names below are the contract player-settings.js already calls:
 * getStatus / setEnabled / onStatus / getKeyboardShortcutsEnabled /
 * setKeyboardShortcutsEnabled, plus the activity reporting the player needs. */
const { contextBridge, ipcRenderer } = require("electron");

/* The main process pushes state changes and this hands them to the page as a
   callback. Two shapes, because the page asks for two shapes:
   onStatus(fn)     -> fn(status)     the status object itself
   onDrpEvent(fn)   -> fn({type,...})  the event, with the status inside
   Getting this wrong means the settings panel never updates its toggle. */
const statusListeners = new Set();
const eventListeners = new Set();
const playbackListeners = new Set();

function each(set, fn) {
  set.forEach(function (listener) {
    try { fn(listener); } catch (e) { /* a broken listener must not break the rest */ }
  });
}

ipcRenderer.on("highwrld:status", function (_event, status) {
  each(statusListeners, function (fn) { fn(status); });
});

ipcRenderer.on("highwrld:drp", function (_event, payload) {
  /* the status arrives on its own channel too, so both styles of listener hear it */
  if (payload && payload.type === "status") each(statusListeners, function (fn) { fn(payload.status); });
  each(eventListeners, function (fn) { fn(payload); });
});

/* Media keys pressed in the desktop app arrive here as a plain action. */
ipcRenderer.on("highwrld:playback-shortcut", function (_event, payload) {
  each(playbackListeners, function (fn) { fn(payload); });
});

/* Tray state: pause every page animation while the window is hidden. */
ipcRenderer.on("highwrld:exe-hidden", function () {
  try { document.documentElement.classList.add("exe-hidden"); } catch (e) {}
});
ipcRenderer.on("highwrld:exe-shown", function () {
  try { document.documentElement.classList.remove("exe-hidden"); } catch (e) {}
});

contextBridge.exposeInMainWorld("highwrld", {
  /* what the app can do, so the page can hide controls it cannot reach */
  isDesktop: true,
  platform: process.platform,

  getStatus: function () {
    return ipcRenderer.invoke("highwrld:drp-status");
  },

  setEnabled: function (enabled) {
    return ipcRenderer.invoke("highwrld:drp-set-enabled", { enabled: !!enabled });
  },

  /* Called when the track changes. Nothing is sent while DRP is off - the main
     process drops it, so the page can call this freely. */
  setActivity: function (activity) {
    return ipcRenderer.invoke("highwrld:drp-activity", activity || null);
  },

  clearActivity: function () {
    return ipcRenderer.invoke("highwrld:drp-clear");
  },

  /* the page's existing name for "tell me when the presence changes" */
  onStatus: function (fn) {
    if (typeof fn !== "function") return function () {};
    statusListeners.add(fn);
    return function () { statusListeners.delete(fn); };
  },
  onDrpEvent: function (fn) {
    if (typeof fn !== "function") return function () {};
    eventListeners.add(fn);
    return function () { eventListeners.delete(fn); };
  },

  /* Keyboard shortcuts live on the main process, so the accelerators can work
     even when the page has no focus. */
  getKeyboardShortcutsEnabled: function () {
    return ipcRenderer.invoke("highwrld:get-keyboard-shortcuts");
  },
  setKeyboardShortcutsEnabled: function (enabled) {
    return ipcRenderer.invoke("highwrld:set-keyboard-shortcuts", { enabled: !!enabled });
  },

  /* Subscribe to the playback actions sent by the main process for media keys. */
  onPlaybackShortcut: function (fn) {
    if (typeof fn !== "function") return function () {};
    playbackListeners.add(fn);
    return function () { playbackListeners.delete(fn); };
  },

  /* The custom EXE title bar calls these instead of being given node access. */
  win: {
    minimize: function () { ipcRenderer.send("highwrld:win-minimize"); },
    maximize: function () { ipcRenderer.send("highwrld:win-maximize"); },
    close: function () { ipcRenderer.send("highwrld:win-close"); },
    back: function () { ipcRenderer.send("highwrld:win-back"); },
    forward: function () { ipcRenderer.send("highwrld:win-forward"); },
    reload: function () { ipcRenderer.send("highwrld:win-reload"); },
  },
});