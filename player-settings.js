(function(){
  var defaults = { keyboardShortcuts: true, shuffle: false, repeat: false };
  var storageKey = 'wrldPlayerSettings';
  var settings = {};
  try { settings = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch(e){ settings = {}; }
  function get(k){ return k in settings ? settings[k] : defaults[k]; }
  function set(k, v){ settings[k] = v; try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch(e){} }

  window.wrldPlayerSettings = { get: get, set: set };

  window.togglePlayerSettings = function(){
    var overlay = document.getElementById('player-settings-overlay');
    if(!overlay) return;
    overlay.classList.toggle('hidden');
    if(!overlay.classList.contains('hidden')){
      var kbToggle = document.getElementById('ps-keyboard-toggle');
      var shToggle = document.getElementById('ps-shuffle-toggle');
      var rpToggle = document.getElementById('ps-repeat-toggle');
      if(kbToggle) kbToggle.checked = get('keyboardShortcuts');
      if(shToggle) shToggle.checked = get('shuffle');
      if(rpToggle) rpToggle.checked = get('repeat');
    }
  };

  function bindClick(selector, fn){
    var el = document.querySelector(selector);
    if(el) el.addEventListener('click', fn);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var cog = document.getElementById('player-settings-cog');
    if(cog) cog.addEventListener('click', function(){ window.togglePlayerSettings(); });

    var overlay = document.getElementById('player-settings-overlay');
    if(overlay) overlay.addEventListener('click', function(e){ if(e.target === overlay) window.togglePlayerSettings(); });

    var closeBtn = overlay ? overlay.querySelector('.psp-close') : null;
    if(closeBtn) closeBtn.addEventListener('click', function(){ window.togglePlayerSettings(); });

    var kbToggle = document.getElementById('ps-keyboard-toggle');
    var shToggle = document.getElementById('ps-shuffle-toggle');
    var rpToggle = document.getElementById('ps-repeat-toggle');
    if(kbToggle) kbToggle.addEventListener('change', function(){ set('keyboardShortcuts', this.checked); });
    if(shToggle) shToggle.addEventListener('change', function(){ set('shuffle', this.checked); });
    if(rpToggle) rpToggle.addEventListener('change', function(){ set('repeat', this.checked); });
  });
})();
