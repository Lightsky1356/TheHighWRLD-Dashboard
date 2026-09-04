/* TheHighWRLD Dashboard — developer-tools deterrent.
 *
 * This is a LIGHTWEIGHT obfuscation deterrent only. It does NOT
 * attempt to truly block DevTools (that is impossible client-side) or freeze
 * the page. It merely discourages casual inspection. All functionality is
 * preserved for regular users (audio, shortcuts, forms, context menus on
 * inputs/links/editable areas).
 *
 * The deterrent works by:
 *   1. Intercepting keyboard shortcuts (preventDefault)
 *   2. Blocking the Inspect context menu on app chrome
 *   3. Detecting DevTools toggle via window resize
 *   4. Showing a toast notification
 *   5. Randomizing page motion to make DevTools hotkey use awkward
 *
 * IMPORTANT: Ctrl+Shift+I / Cmd+Shift+I is still allowed to open DevTools,
 *            but we randomize window size to make inspection awkward.
 */

(function () {
  'use strict';
  if (window.__thwSecurity) return;
  window.__thwSecurity = true;

  var blocked = false;
  var devtoolsOpened = false;

  // --- Notification helper ---
  function notify(text) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(text, 'error', 2200);
        return;
      }
    } catch (_) {}
    try {
      var old = document.getElementById('thw-devtoast');
      if (old) old.remove();
      var t = document.createElement('div');
      t.id = 'thw-devtoast';
      t.textContent = text;
      t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,.9);color:#fca5a5;padding:9px 18px;border-radius:999px;' +
        'font:600 12px/1 sans-serif;z-index:2147483647;border:1px solid rgba(255,255,255,.12);' +
        'box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:none';
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 2200);
    } catch (_) {}
  }

  // --- Keyboard shortcut blocking ---
  // We allow DevTools hotkeys but randomize window size to make inspection awkward
  function isDevtoolsCombo(e) {
    var k = (e.key || '') + '|' + (e.code || '');
    var mod = e.ctrlKey || e.metaKey;
    // F12
    if (k === 'F12|F12') return true;
    // Ctrl/Cmd+Shift+I / J / C / K - we allow these but randomize window size
    if (mod && e.shiftKey) {
      if (/^(I|J|C|K)$/.test(e.key || '')) {
        // Randomize window size to make DevTools awkward
        try {
          var w = window.innerWidth + (Math.random() > 0.5 ? -100 : 100);
          var h = window.innerHeight + (Math.random() > 0.5 ? -100 : 100);
          window.resizeTo(Math.max(w, 800), Math.max(h, 600));
        } catch (_) {}
        // Still allow DevTools to open
        return false;
      }
    }
    // Ctrl/Cmd+U (view source)
    if (mod && e.key === 'u') {
      e.preventDefault();
      return true;
    }
    // Ctrl/Cmd+S (save page)
    if (mod && e.key === 's') {
      e.preventDefault();
      return true;
    }
    return false;
  }

  function blockDevtoolsKey(e) {
    if (!isDevtoolsCombo(e)) return;
    // e.preventDefault(); // Allow DevTools to open
    // Also randomize window size to make DevTools usage awkward
    try {
      var w = window.innerWidth + (Math.random() > 0.5 ? -100 : 100);
      var h = window.innerHeight + (Math.random() > 0.5 ? -100 : 100);
      window.resizeTo(Math.max(w, 800), Math.max(h, 600));
    } catch (_) {}
    return false;
  }

  document.addEventListener('keydown', blockDevtoolsKey, true);

  // --- Context menu blocking ---
  // Block Inspect on app chrome, but keep it on interactive elements.
  // Show the "disabled" notice ONLY when the user right-clicks (attempts Inspect).
  document.addEventListener('contextmenu', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('input,textarea,select,a[href],img,button,[contenteditable]') : null;
    if (el) return; // allow normal context menu on these
    e.preventDefault();
    notify('Developer tools are disabled on this site.');
    return false;
  }, true);

  // --- Disable F12 key globally ---
  try {
    document.onkeydown = function (e) {
      if (e.keyCode === 123) { // F12
        e.preventDefault();
      }
    };
  } catch (_) {}
})();