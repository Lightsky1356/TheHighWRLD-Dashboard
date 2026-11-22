/* ==========================================================================
   DESKTOP PLAYBACK SHORTCUTS

   The Electron app registers media keys (play/pause, next, previous) and sends
   them here as plain actions. The player functions already live on the page as
   globals, so this bridge only translates an action into a call - it keeps one
   source of truth for playback instead of duplicating it in the main process.

   On the web this file is inert: window.highwrld only exists in the EXE.
   ========================================================================== */
(function () {
  "use strict";
  var api = window.highwrld;
  if (!api || !api.isDesktop || typeof api.onPlaybackShortcut !== "function") return;

  api.onPlaybackShortcut(function (payload) {
    var action = payload && payload.action;
    try {
      if (action === "playpause") {
        if (typeof window.isPlaying !== "undefined" && window.isPlaying && typeof window.shadowPause === "function") window.shadowPause();
        else if (typeof window.playAudio === "function") window.playAudio();
      } else if (action === "next" && typeof window.nextTrack === "function") {
        window.nextTrack();
      } else if (action === "prev" && typeof window.handlePrevTrack === "function") {
        window.handlePrevTrack();
      }
    } catch (e) { /* a shortcut must never break the page */ }
  });
})();
