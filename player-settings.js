(function(){
  var defaults = { keyboardShortcuts: true };
  var storageKey = 'wrldPlayerSettings';
  var settings = {};
  try { settings = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch(e){ settings = {}; }
  function get(k){ return k in settings ? settings[k] : defaults[k]; }
  function set(k, v){ settings[k] = v; try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch(e){} }

  var isElectron = !!(window.highwrld);

  window.wrldPlayerSettings = { get: get, set: set };

  function lockScroll(){
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
      if(drpDesc) drpDesc.textContent = 'Display what you\'re listening to in the WRLD Player on your Discord profile. (ONLY ON THE EXE - NOT FOR THE WEB OR MOBILE)';
      return;
    }
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
    }).catch(function(){});
  }

  function togglePlayerSettings(){
    var overlay = document.getElementById('player-settings-overlay');
    if(!overlay) return;
    var opening = overlay.classList.contains('hidden');
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
    if(kbToggle) kbToggle.addEventListener('change', function(){ set('keyboardShortcuts', this.checked); });

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
          window.highwrld.setEnabled(this.checked).catch(function(){});
        }
      });
    }

    if(isElectron){
      window.highwrld.getKeyboardShortcutsEnabled().then(function(s){
        if(kbToggle) kbToggle.checked = !!(s && s.enabled);
        set('keyboardShortcuts', !!(s && s.enabled));
      }).catch(function(){});
      if(kbToggle) kbToggle.addEventListener('change', function(){
        set('keyboardShortcuts', this.checked);
        window.highwrld.setKeyboardShortcutsEnabled(this.checked).catch(function(){});
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
