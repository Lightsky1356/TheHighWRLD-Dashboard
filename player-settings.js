(function(){
  var defaults = { keyboardShortcuts: true, shuffle: false, repeat: false };
  var storageKey = 'wrldPlayerSettings';
  var settings = {};
  try { settings = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch(e){ settings = {}; }
  function get(k){ return k in settings ? settings[k] : defaults[k]; }
  function set(k, v){ settings[k] = v; try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch(e){} }

  var isElectron = !!(window.highwrld);

  window.wrldPlayerSettings = { get: get, set: set };

  window.togglePlayerSettings = function(){
    var overlay = document.getElementById('player-settings-overlay');
    if(!overlay) return;
    var opening = overlay.classList.contains('hidden');
    overlay.classList.toggle('hidden');
    if(opening){
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      var kbToggle = document.getElementById('ps-keyboard-toggle');
      var shToggle = document.getElementById('ps-shuffle-toggle');
      var rpToggle = document.getElementById('ps-repeat-toggle');
      if(kbToggle) kbToggle.checked = get('keyboardShortcuts');
      if(shToggle) shToggle.checked = get('shuffle');
      if(rpToggle) rpToggle.checked = get('repeat');
      if(isElectron){
        window.highwrld.getStatus().then(function(s){
          var drp = document.getElementById('ps-drp-toggle');
          if(drp) drp.checked = !!(s && s.enabled);
        }).catch(function(){});
      }
    } else {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  };

  function closeSettings(){
    var overlay = document.getElementById('player-settings-overlay');
    if(overlay && !overlay.classList.contains('hidden')){
      overlay.classList.add('hidden');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
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
    var shToggle = document.getElementById('ps-shuffle-toggle');
    var rpToggle = document.getElementById('ps-repeat-toggle');
    if(kbToggle) kbToggle.addEventListener('change', function(){ set('keyboardShortcuts', this.checked); });
    if(shToggle) shToggle.addEventListener('change', function(){ set('shuffle', this.checked); });
    if(rpToggle) rpToggle.addEventListener('change', function(){ set('repeat', this.checked); });

    var drpToggle = document.getElementById('ps-drp-toggle');
    var drpDesc = document.getElementById('ps-drp-desc');
    if(drpToggle){
      if(isElectron){
        if(drpDesc) drpDesc.textContent = 'Shows the Current song you are playing on the WRLD Player';
        window.highwrld.getStatus().then(function(s){
          drpToggle.checked = !!(s && s.enabled);
        }).catch(function(){});
        drpToggle.addEventListener('change', function(){
          window.highwrld.setEnabled(this.checked).catch(function(){});
        });
      } else {
        drpToggle.disabled = true;
        if(drpDesc) drpDesc.textContent = 'Only Available for the EXE version Windows, MacOS, and Linux';
        drpToggle.closest('.psp-row').style.opacity = '0.5';
      }
    }

    if(isElectron){
      window.highwrld.getKeyboardShortcuts().then(function(s){
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
