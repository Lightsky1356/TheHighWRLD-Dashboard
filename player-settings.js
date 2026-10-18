(function(){
  var defaults = {
    keyboardShortcuts: true
  };
  var storageKey = 'wrldPlayerSettings';
  var settings = {};
  try { settings = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch(e){ settings = {}; }
  function get(k){ return k in settings ? settings[k] : defaults[k]; }
  function set(k, v){ settings[k] = v; try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch(e){} }

  var isElectron = !!(window.highwrld);

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
      var title = (document.getElementById('mini-title') || {}).textContent || '';
      var cover = (document.getElementById('mini-cover') || {}).getAttribute && document.getElementById('mini-cover').getAttribute('src') || '';
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
    var title = document.getElementById('mini-title');
    if(title && window.MutationObserver){
      new MutationObserver(scheduleDrpReport).observe(title, { childList: true, characterData: true, subtree: true });
    }
    var audio = document.querySelector('audio');
    if(audio){
      /* loadstart and emptied catch a track change that never touches the title,
         and durationchange fires when a real length finally arrives */
      ['play','pause','ended','loadstart','emptied','loadedmetadata','durationchange'].forEach(function(ev){
        audio.addEventListener(ev, scheduleDrpReport);
      });
    }
    if(typeof window.highwrld.onDrpEvent === 'function'){
      var drpUnavailable = 'Discord Rich Presence needs the Discord desktop app running, and this build has no Discord client id yet.';
      /* remembered so the normal wording comes back when Discord does show up */
      var drpDefaultDesc = null;
      window.highwrld.onDrpEvent(function(payload){
        if(payload && payload.type === 'status'){
          var st = payload.status || {};
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
    /* settings UI is hidden on this platform (e.g. mobile web): never open an
       invisible panel that would still lock scrolling */
    var cog = document.getElementById('player-settings-cog');
    if(opening && cog && !cog.offsetParent) return;
    overlay.classList.toggle('hidden');
    if(opening){
      overlay.classList.add('open');
      lockScroll();
      var kbToggle = document.getElementById('ps-keyboard-toggle');
      if(kbToggle) kbToggle.checked = get('keyboardShortcuts');
      applyDrpGate();
    } else {
      overlay.classList.remove('open');
      unlockScroll();
    }
  }
  window.togglePlayerSettings = togglePlayerSettings;
  window.__togglePS = togglePlayerSettings;

  function closeSettings(){
    var overlay = document.getElementById('player-settings-overlay');
    if(overlay && !overlay.classList.contains('hidden')){
      overlay.classList.add('hidden');
      overlay.classList.remove('open');
      unlockScroll();
    }
  }

  function init(){
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

       The toast is deliberately one-directional. Turning the shortcuts ON puts
       the overlay on screen, which is its own confirmation; turning them OFF only
       makes an overlay disappear, and nothing left visible says the setting just
       changed - so it reads as the toggle doing nothing rather than as a
       preference being remembered. */
    if(kbToggle) kbToggle.addEventListener('change', function(){
      set('keyboardShortcuts', this.checked);
      if(!this.checked){
        try {
          if(typeof showToastSimple === 'function') showToastSimple('Keyboard shortcuts turned off', { type: 'info' });
        } catch(e){ /* a missing toast must not break the toggle */ }
      }
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
