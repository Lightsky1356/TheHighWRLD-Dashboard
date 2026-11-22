(function(){
  var defaults = {
    keyboardShortcuts: true,
    coverGradients: true,
    /* Autoplay similar songs — when the queue is empty and shuffle is off,
       stay inside the era of the song that just ended instead of walking
       through the vault in order. Off by default: a listener who never
       touched shuffle expects the next song to be the next song, not a
       random same-era pick. It can still be turned on in Player Settings. */
    autoplaySimilar: false,
    /* When you press play: whether picking a new song clears the queue.
       Off (Keep queue) is the site's historic behaviour. */
    replaceQueue: false,
    /* Song covers: 'song' shows each track's own art, 'era' shows the era's
       cover where the vault has one. */
    coversPref: 'song',
    /* Resume where you left off - reopen the site on the same song, same second. */
    resumeLast: true,
    /* Pause the audio when the tab is hidden. */
    pauseOnHidden: false,
    /* Playback speed as a string ('0.5','0.75','1','1.25','1.5','2'). */
    playbackRate: '1',
    /* Suggestion cards: the cards that offer the site to your home screen.
       Off means never. */
    suggestionCards: true,
    /* Moving colours: the drifting cover-colour circles behind the page. */
    movingColors: true,
    /* Member-picked accent (violet default), or 'custom' with customAccent. */
    accent: 'violet',
    customAccent: '#b7a3ff',
    /* Custom theme's two colours. */
    customTop: '#2563eb',
    customCorner: '#0093ac'
  };
  var storageKey = 'wrldPlayerSettings';
  var settings = {};
  try { settings = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch(e){ settings = {}; }

  /* One-time cleanup of the value presets.js used to write here.
     Focus and Minimal carried shortcuts:false and apply() persisted it, so a
     stored keyboardShortcuts:false is far more likely to be something a preset
     did behind the user's back than something they chose in this panel. There is
     no way to tell the two apart afterwards, so this drops it once and lets the
     default (on) take over.

     Guarded by its own flag rather than run unconditionally: after this, an
     explicit "off" from the toggle must survive reloads, and deleting the key
     on every load would quietly turn that back into a setting that cannot be
     kept off - which is the mirror image of the bug being fixed here.

     Only the keyboardShortcuts field is touched; anything else already in
     wrldPlayerSettings is left exactly as it was. */
  var migrationKey = storageKey + '.migration.shortcutOwnership.v1';
  try {
    if(!localStorage.getItem(migrationKey)){
      if(settings && 'keyboardShortcuts' in settings){
        delete settings.keyboardShortcuts;
        localStorage.setItem(storageKey, JSON.stringify(settings));
      }
      localStorage.setItem(migrationKey, '1');
    }
  } catch(e){ /* private mode, quota, or storage disabled - defaults still apply */ }

  function get(k){ return k in settings ? settings[k] : defaults[k]; }
  function set(k, v){ settings[k] = v; try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch(e){} }

  var isElectron = !!(window.highwrld);
  /* The desktop app cannot offer "press Ctrl+D to bookmark" - its chrome has no
     bookmark bar - and the hint is noise on phones too. Tag the page so CSS
     can hide the hint in both places. */
  try { if (isElectron) document.documentElement.classList.add("is-electron"); } catch (e) {}

  /* Localised strings with English fallback - same contract as account.js's _tt. */
  function _ptT(key, fb) {
    try {
      var lang = 'en';
      try { lang = localStorage.getItem('wantedLang') || 'en'; } catch (e) {}
      var D = window.SiteChromeI18N && window.SiteChromeI18N[lang];
      if (D && D[key]) return D[key];
    } catch (e) {}
    return fb;
  }

  /* ---------- Playback: resume, pause-on-hidden, speed -------------------
     resumeLast     - the vault reopens on the song and the second you left it
     pauseOnHidden  - switching the tab away pauses the audio
     playbackRate   - the persisted speed, applied to the media element
     All three are plain player-session behaviour; none of them touches the
     account. THWResume is the small live handle account.js talks to when a
     switch flips, exactly like the moving colours dispatch. */
  var RESUME_KEY = 'thw.resume.v1';
  function audioEl(){ return document.querySelector('audio'); }
  function resumeEnabled(){ return get('resumeLast') !== false; }
  var lastResumeSave = 0;
  function saveResume(){
    if(!resumeEnabled()) return;
    var a = audioEl();
    if(!a || !isFinite(a.currentTime)) return;
    var idx = -1;
    try { if (typeof currentTrackIndex === 'number') idx = currentTrackIndex; } catch(e){}
    if(idx < 0 || a.currentTime < 1) return;
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({ i: idx, s: Math.floor(a.currentTime), at: Date.now() })); } catch(e){}
  }
  function clearResume(){ try { localStorage.removeItem(RESUME_KEY); } catch(e){} }
  function applyResume(){
    var raw = null;
    try { raw = localStorage.getItem(RESUME_KEY); } catch(e){}
    if(!raw) return;
    var d = null;
    try { d = JSON.parse(raw); } catch(e){}
    if(!d || typeof d.i !== 'number' || !d.i && d.i !== 0) return;
    /* a position from more than a day ago is not "where you left off" */
    if(!d.at || Date.now() - Number(d.at) > 86400000) { clearResume(); return; }
    var idx = d.i, secs = Math.max(0, Math.floor(Number(d.s) || 0));
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      var ready = false;
      try { ready = typeof trackList !== 'undefined' && trackList && trackList.length > idx && typeof window.selectTrackFromList === 'function'; } catch(e){}
      if(ready){
        clearInterval(iv);
        try { window.selectTrackFromList(idx); } catch(e){}
        var a = audioEl();
        if(a){
          var seek = function(){
            try {
              var dur = isFinite(a.duration) ? a.duration : secs;
              a.currentTime = Math.min(secs, dur || secs);
            } catch(e){}
          };
          if(isFinite(a.duration) && a.duration > 0) seek();
          else a.addEventListener('loadedmetadata', seek, { once: true });
        }
      } else if(tries > 100){
        clearInterval(iv);
      }
    }, 100);
  }
  window.THWResume = {
    setEnabled: function(on){ if(!on) clearResume(); },
    setPauseOnHidden: function(){ /* the listener reads the live setting */ },
    setRate: function(r){ var a = audioEl(); if(a){ try { a.playbackRate = Number(r) || 1; } catch(e){} } }
  };
  (function bindResume(){
    var a = audioEl();
    if(!a){ setTimeout(bindResume, 1500); return; }
    a.addEventListener('timeupdate', function(){
      var now = Date.now();
      if(now - lastResumeSave < 5000) return;
      lastResumeSave = now;
      saveResume();
    });
    a.addEventListener('pause', saveResume);
    window.addEventListener('pagehide', saveResume);
    document.addEventListener('visibilitychange', function(){
      if(document.hidden && get('pauseOnHidden')){ try { a.pause(); } catch(e){} }
    });
    try { a.playbackRate = Number(get('playbackRate')) || 1; } catch(e){}
    applyResume();
  })();

  window.wrldPlayerSettings = { get: get, set: set };

  function lockScroll(){
    document.body.classList.add('ps-locked');
    document.documentElement.classList.add('ps-locked');
    if(!window.__psLk){
      window.__psLk = function(e){
        if(e.type === 'keydown'){
          var k = e.key;
          if(k===' ' || k==='Spacebar' || k==='ArrowUp' || k==='ArrowDown' || k==='PageUp' || k==='PageDown' || k==='Home' || k==='End' || e.code==='Space'){
            if(e.cancelable){ e.preventDefault(); e.stopPropagation(); }
          }
        } else if(e.cancelable){ e.preventDefault(); e.stopPropagation(); }
      };
      window.addEventListener('wheel', window.__psLk, { passive:false, capture:true });
      window.addEventListener('touchmove', window.__psLk, { passive:false, capture:true });
      window.addEventListener('keydown', window.__psLk, { passive:false, capture:true });
    }
  }
  function unlockScroll(){
    document.body.classList.remove('ps-locked');
    document.documentElement.classList.remove('ps-locked');
    if(window.__psLk){
      window.removeEventListener('wheel', window.__psLk, { capture:true });
      window.removeEventListener('touchmove', window.__psLk, { capture:true });
      window.removeEventListener('keydown', window.__psLk, { capture:true });
      window.__psLk = null;
    }
  }

  function applyDrpGate(){
    var drpToggle = document.getElementById('ps-drp-toggle');
    var drpDesc = document.getElementById('ps-drp-desc');
    if(!drpToggle) return;
    var signedIn = false;
    try{ signedIn = !!localStorage.getItem('wantedAuthUser'); }catch(e){}
    var row = drpToggle.closest('.psp-row');
    if(!isElectron){
      drpToggle.checked = false;
      if(row) row.style.opacity = '0.5';
      if(window.highwrld && window.highwrld.setEnabled) window.highwrld.setEnabled(false).catch(function(){});
      if(drpDesc) drpDesc.textContent = 'Display what you\'re listening to in the WRLD Player on your Discord profile. (Desktop app only - Windows, macOS & Linux)';
      refreshDrpStatus();
      return;
    }
    document.body.classList.add('drp-desktop');
    if(!signedIn){
      drpToggle.disabled = true;
      drpToggle.checked = false;
      if(window.highwrld && window.highwrld.setEnabled) window.highwrld.setEnabled(false).catch(function(){});
      if(row) row.style.opacity = '0.5';
      if(drpDesc) drpDesc.textContent = 'Display what you\'re listening to in the WRLD Player on your Discord profile. (MUST BE SIGNED IN TO USE DRP)';
      return;
    }
    drpToggle.disabled = false;
    if(row) row.style.opacity = '';
    if(drpDesc) drpDesc.textContent = 'Display what you\'re listening to in the WRLD Player on your Discord profile. (Connect Discord to your account)';
    window.highwrld.getStatus().then(function(s){
      drpToggle.checked = !!(s && s.enabled);
      refreshDrpStatus(s);
    }).catch(function(){});
  }

  function refreshDrpStatus(status){
    /* Keep the checkbox honest. The app can turn presence off or lose Discord
       on its own, and a toggle that still reads "on" is a lie. Done here so every
       path that learns the status - the initial getStatus, the toggle handler and
       a push from the app - lands in the same place. */
    if(isElectron && status && typeof status.enabled === 'boolean'){
      var tgl = document.getElementById('ps-drp-toggle');
      if(tgl && tgl.checked !== status.enabled) tgl.checked = status.enabled;
    }
    var el = document.getElementById('ps-nav-drp');
    if(!el) return;
    var txtEl = el.querySelector('.drp-txt');
    if(!isElectron){
      el.className = 'drp-off';
      if(txtEl) txtEl.textContent = 'Off';
      return;
    }
    document.body.classList.add('drp-desktop');
    var s = status || {};
    var enabled = !!s.enabled;
    var connected = !!(s.loggedIn && s.available);
    if(!enabled){
      el.className = 'drp-off';
      if(txtEl) txtEl.textContent = 'Off';
      return;
    }
    if(connected){
      el.className = 'drp-ok';
      if(txtEl) txtEl.textContent = 'Connected';
      return;
    }
    el.className = 'drp-wait';
    if(txtEl) txtEl.textContent = 'Connecting\u2026';
  }

  /* ---------------------------------------------- Discord Rich Presence
   * The desktop app hands the page window.highwrld (see electron-app/preload.js).
   * Nothing here runs in a browser: without that object there is no bridge, and
   * the toggle says so rather than pretending. The reporting loop watches the
   * mini player, which is the one piece of DOM that already knows what is playing. */
  function drpReport(){
    if(!isElectron || !window.highwrld || typeof window.highwrld.setActivity !== 'function') return;
    try{
      var title = (document.getElementById('deck-title') || {}).textContent || '';
      var cover = (document.getElementById('deck-cover') || {}).getAttribute && document.getElementById('deck-cover').getAttribute('src') || '';
      var audio = document.querySelector('audio');
      if(!title || /nothing playing/i.test(title)){
        window.highwrld.clearActivity();
        return;
      }
      var artist = 'Juice WRLD';
      try{
        if(typeof trackList !== 'undefined' && trackList && typeof currentTrackIndex === 'number'){
          var t = trackList[currentTrackIndex];
          if(t){ artist = t.artist || artist; if(t.album) title = t.title; }
        }
      }catch(e){}
      /* duration is NaN until the new track's metadata arrives, and sending 0
         puts a bogus "0 seconds" presence on screen for a moment. Only report a
         time once it is real - the app adds the timestamps when it has them. */
      var dur = (audio && isFinite(audio.duration) && audio.duration > 0) ? Math.round(audio.duration) : 0;
      window.highwrld.setActivity({
        title: title,
        artist: artist,
        /* Discord keys off the bare file name, not a path */
        cover: cover ? String(cover).split('/').pop().replace(/\.[a-z0-9]+$/i, '') : '',
        duration: dur,
        startedAt: dur ? Math.round(Date.now() / 1000 - (audio.currentTime || 0)) : 0,
        paused: !!(audio && audio.paused)
      }).catch(function(){});
    }catch(e){}
  }

  /* Switching track fires a burst of events - the title changes, playback starts,
     metadata loads - and Discord only needs to be told once. Sending each one
     spends its rate-limit budget, and the extras get rejected, which left the
     old track sitting on the profile until something else pushed an update. */
  var drpTimer = null;
  function scheduleDrpReport(){
    if(!isElectron || !window.highwrld) return;
    if(drpTimer) clearTimeout(drpTimer);
    drpTimer = setTimeout(function(){ drpTimer = null; drpReport(); }, 250);
  }

  function bindDrpReporting(){
    if(!isElectron || !window.highwrld) return;
    /* the mini player text changes on every track change, so watch it rather than
       polling a second copy of the player state */
    var title = document.getElementById('deck-title');
    if(title && window.MutationObserver){
      new MutationObserver(scheduleDrpReport).observe(title, { childList: true, characterData: true, subtree: true });
    }
    var audio = document.querySelector('audio');
    if(audio){
      /* loadstart and emptied catch a track change that never touches the title,
         and durationchange fires when a real length finally arrives; seeked
         catches a scrub, which rewinds the position without touching the title
         - without it the start timestamp stops matching the player */
      ['play','pause','ended','loadstart','emptied','loadedmetadata','durationchange','seeked'].forEach(function(ev){
        audio.addEventListener(ev, scheduleDrpReport);
      });
      /* Discord rate-limits updates (the main process retries and dedupes), so a
         slow beat is enough here: this catches a switch whose event lands after
         one of the bursts above, plus any drift the observers miss entirely. */
      setInterval(scheduleDrpReport, 4000);
    }
    if(typeof window.highwrld.onDrpEvent === 'function'){
      var drpUnavailable = 'Discord Rich Presence needs the Discord desktop app running, and this build has no Discord client id yet.';
      /* remembered so the normal wording comes back when Discord does show up */
      var drpDefaultDesc = null;
      /* Discord not answering is worth saying out loud: the presence is
         the thing people look at to see it is working, and a setting that
         quietly does nothing is worse than one that says it cannot. It
         is said once, not on every retry, and said again when Discord
         comes back. */
      var drpSaidNotAnswering = false;
      function sayAboutDiscord(st){
        var connected = !!(st && st.loggedIn && st.available);
        var enabled = !!(st && st.enabled);
        if(!enabled){ drpSaidNotAnswering = false; return; }
        if(connected){
          if(drpSaidNotAnswering){
            drpSaidNotAnswering = false;
            if(typeof showToastSimple === 'function'){
              showToastSimple(_ptT('toastDrpBackOnline', 'Discord is answering again - your status is showing.'), { type: 'success' });
            }
          }
          return;
        }
        if(drpSaidNotAnswering) return;
        drpSaidNotAnswering = true;
        var why = (st && st.error) ? String(st.error) : 'Discord is not answering';
        if(typeof showToastSimple === 'function'){
          showToastSimple(_ptT('toastDrpNotWorking', 'Discord Rich Presence is not working - {why}. Open the Discord desktop app and it will connect.').replace(/\{why\}/g, why), { type: 'error' });
        }
      }
      window.highwrld.onDrpEvent(function(payload){
        if(payload && payload.type === 'status'){
          var st = payload.status || {};
          try { sayAboutDiscord(st); } catch (e) {}
          /* looked up here on purpose: these live inside init() and applyDrpGate(),
             so referencing them from this scope would throw under Electron */
          var tgl = document.getElementById('ps-drp-toggle');
          if(tgl){ tgl.checked = !!st.enabled; }
          refreshDrpStatus(st);
          var desc = document.getElementById('ps-drp-desc');
          if(desc){
            if(drpDefaultDesc === null) drpDefaultDesc = desc.textContent;
            desc.textContent = (st.available === false) ? drpUnavailable : drpDefaultDesc;
          }
        }
      });
    }
    drpReport();
  }

  function togglePlayerSettings(){
    var overlay = document.getElementById('player-settings-overlay');
    if(!overlay) return;
    var opening = overlay.classList.contains('hidden');
    /* The settings are not on a phone - the cog is hidden there - so they
       are not opened there either.
       This used to test whether the cog was on the screen, and that was
       the wrong test: the cog lives in the WRLD Player's own page, which
       is hidden whenever somebody is on another page, and the settings
       have to open from there too - WRLD Deck's own settings button
       opens them from any page. The width is what says "a phone". */
    if(opening && window.innerWidth < 768) return;
    overlay.classList.toggle('hidden');
    if(opening){
      overlay.classList.add('open');
      lockScroll();
      var kbToggle = document.getElementById('ps-keyboard-toggle');
      if(kbToggle) kbToggle.checked = get('keyboardShortcuts');
      var cgToggle = document.getElementById('ps-cover-gradients-toggle');
      if(cgToggle) cgToggle.checked = coverGradientsOn();
      applyDrpGate();
    } else {
      overlay.classList.remove('open');
      unlockScroll();
    }
  }
  /* The cover gradients. */
  function coverGradientsOn(){ return get('coverGradients') !== false; }
  /* Turning them on or off redraws the covers. */
  function applyCoverGradients(){
    var on = coverGradientsOn();
    try { document.documentElement.classList.toggle('thw-no-cover-gradients', !on); } catch(e){}
    /* The memoised gradients are stale now. */
    try { if (typeof window.__thwClearCoverMemo === 'function') window.__thwClearCoverMemo(); } catch(e){}
    /* And everything that draws a cover is drawn again. */
    ['renderQueueUI', 'renderQueueDropdown', 'renderPlaylistUI', 'renderCustomPlaylistsUI', 'renderSidebarPlaylists', 'renderHubPlaylists', 'renderArtistPanel'].forEach(function (name) {
      try { if (typeof window[name] === 'function') window[name](); } catch(e){}
    });
    /* The title, the album and the controls are drawn by the player's own
       functions, so those are what have to be called again. The title in
       particular is not the style helper's business - it is the title, the
       album and the controls that go white when the gradients are off. */
    try {
      if (typeof window.paintDeckWash === 'function') window.paintDeckWash();
      if (typeof window.__thwRepaintDeck === 'function') window.__thwRepaintDeck();
    } catch (e) {}
    /* The deck's cover wash is painted by cover-pref.js from the same gradient
       helper - replay it so turning Cover Gradients off clears the deck too. */
    try {
      if (typeof trackList !== 'undefined' && trackList[currentTrackIndex]) {
        var cover = trackList[currentTrackIndex].cover || 'Juice-WRLD.png';
        if (typeof applyMainGradient === 'function') applyMainGradient(cover);
        if (typeof applyControlsGradient === 'function') applyControlsGradient(cover);
        if (typeof applyBackgroundGradient === 'function') applyBackgroundGradient(cover);
      }
    } catch(e){}
  }
  window.__thwApplyCoverGradients = applyCoverGradients;

  window.togglePlayerSettings = togglePlayerSettings;
  window.__togglePS = togglePlayerSettings;

  /* -------------------------------------------------------------------------- */

  /* Called by script.js when a playback key is pressed while the keyboard
     shortcuts are off.

     That path used to be a bare "return", so the key did nothing at all and
     nothing on screen explained why. Someone who does not know the shortcuts
     are switched off just concludes the player is broken - space and the arrow
     keys are the most obvious playback controls there are.

     Lives here because this file owns the keyboardShortcuts setting, so the
     message and the toggle can never disagree about wording.

     Throttled, and it ignores auto-repeat. Holding an arrow key fires keydown
     dozens of times a second; without this the toast would be replaced and
     re-shown continuously, which reads as a flicker rather than a message.
     One toast per press, and holding the key does not stack them. */
  var lastShortcutToast = 0;
  window.thwShortcutsOffToast = function(){
    var now = Date.now();
    if(now - lastShortcutToast < 1500) return;
    lastShortcutToast = now;
    try {
      if(typeof showToastSimple === 'function'){
        showToastSimple(_ptT('toastShortcutsOff', 'Keyboard shortcuts are off - enable them in Player Settings'), { type: 'info' });
      }
    } catch(e){ /* a missing toast must not break the key handler */ }
  };

  function closeSettings(){
    var overlay = document.getElementById('player-settings-overlay');
    if(overlay && !overlay.classList.contains('hidden')){
      overlay.classList.add('hidden');
      overlay.classList.remove('open');
      unlockScroll();
    }
  }

  function init(){
    /* The markup ships this checkbox with a hardcoded `checked`, so it starts
       reading "on" no matter what is stored. That happens to agree with the
       default, but it means the control can disagree with the real setting until
       the panel is opened - and togglePlayerSettings() is the only other thing
       that syncs it, which it cannot do while the cog is hidden in the blank
       state. Setting it here makes the visible control agree with the setting
       from the first paint, so `checked` in the HTML stops being a second
       source of truth that has to be kept in step by hand. */
    var kbSync = document.getElementById('ps-keyboard-toggle');
    if(kbSync) kbSync.checked = get('keyboardShortcuts');

    /* The cover gradients are applied from the first paint, for the same
       reason: the stored setting has to be what the page looks like before
       anybody touches anything. */
    var cgSync = document.getElementById('ps-cover-gradients-toggle');
    if(cgSync) cgSync.checked = coverGradientsOn();
    try { applyCoverGradients(); } catch(e){}

    var cog = document.getElementById('player-settings-cog');
    if(cog) cog.addEventListener('click', function(){ window.togglePlayerSettings(); });

    var overlay = document.getElementById('player-settings-overlay');
    if(overlay) overlay.addEventListener('click', function(e){ if(e.target === overlay) window.togglePlayerSettings(); });

    var closeBtn = overlay ? overlay.querySelector('.psp-close') : null;
    if(closeBtn) closeBtn.addEventListener('click', function(){ window.togglePlayerSettings(); });

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeSettings();
    });

    var kbToggle = document.getElementById('ps-keyboard-toggle');
    /* Bound once here for both platforms - the Electron branch below adds its own
       handler on top of this one, so anything added to this one fires exactly
       once either way.

       Switching the toggle itself says nothing: the checkbox is right there and
       shows the new state. The setting earns its feedback at the other end - see
       thwShortcutsOffToast below, which is what script.js calls when a playback
       key is pressed while the shortcuts are off. */
    if(kbToggle) kbToggle.addEventListener('change', function(){ set('keyboardShortcuts', this.checked); });

    /* The cover gradients.
       *
       * Turning them off takes the gradient off every cover and leaves the
       * colour, so the covers still look like themselves - they just stop
       * being gradients. The covers are drawn again straight away, because
       * a setting that only takes effect on the next page load is a setting
       * nobody believes. */
    var cgToggle = document.getElementById('ps-cover-gradients-toggle');
    if(cgToggle) cgToggle.addEventListener('change', function(){
      set('coverGradients', this.checked);
      applyCoverGradients();
      /* The toggle already says which way it is now - the toast says what
         that did to the screen, since the change is everywhere at once. */
      try {
        if(typeof showToastSimple === 'function'){
          showToastSimple(this.checked
            ? _ptT('toastCoverGradOn', 'Cover gradients on - titles and panels take their colour from the cover')
            : _ptT('toastCoverGradOff', 'Cover gradients off - covers keep their colour, text and panels go white and black'),
            { type: 'info' });
        }
      } catch(e){}
    });

    var drpToggle = document.getElementById('ps-drp-toggle');
    if(drpToggle){
      applyDrpGate();
      drpToggle.addEventListener('change', function(){
        if(this.disabled) return;
        if(isElectron){
          var signedIn = false;
          try{ signedIn = !!localStorage.getItem('wantedAuthUser'); }catch(e){}
          if(!signedIn){
            this.checked = false;
            return;
          }
          if(this.checked){
            refreshDrpStatus({enabled:true});
          }
          window.highwrld.setEnabled(this.checked).then(function(){if(window.highwrld.getStatus){window.highwrld.getStatus().then(function(s){refreshDrpStatus(s);}).catch(function(){});}}).catch(function(){});
        }
      });
    }

    if(isElectron){
      document.body.classList.add('drp-desktop');
      window.highwrld.getKeyboardShortcutsEnabled().then(function(s){
        if(!s || typeof s.enabled !== 'boolean') return;
        if(kbToggle) kbToggle.checked = !!s.enabled;
        set('keyboardShortcuts', !!s.enabled);
      }).catch(function(){});
      if(kbToggle) kbToggle.addEventListener('change', function(){
        set('keyboardShortcuts', this.checked);
        window.highwrld.setKeyboardShortcutsEnabled(this.checked).catch(function(){});
      });
      if(window.highwrld.onStatus){
        window.highwrld.onStatus(function(status){ refreshDrpStatus(status); });
      }
      if(window.highwrld.getStatus){
        window.highwrld.getStatus().then(function(s){ refreshDrpStatus(s); }).catch(function(){});
      }
      bindDrpReporting();
    } else {
      refreshDrpStatus();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
