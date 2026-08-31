/* TheHighWRLD Dashboard — best-effort developer-tools deterrent.
 *
 * This is a LIGHTWEIGHT, NON-INVASIVE obfuscation deterrent only. It does NOT
 * attempt to truly block DevTools (that is impossible client-side) or freeze
 * the page. It merely discourages casual inspection. All functionality is
 * preserved for regular users (audio, shortcuts, forms, context menus on
 * inputs/links/editable areas).
 *
 * Blocked only as a convenience deterrent:
 *   - F12
 *   - Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (and Cmd equivalents)
 *   - Ctrl+Shift+K (Firefox devtools console)
 *   - Right-click "Inspect" on non-interactive chrome (not inputs/links/img)
 */
(function () {
  'use strict';
  if (window.__thwSecurity) return;
  window.__thwSecurity = true;

  var blocked = false;

  // Minimal fallback toast in case the app's showToast isn't loaded yet.
  function notify(text) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(text, 'error', 2200); return; }
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

  function isDevtoolsCombo(e) {
    var k = (e.key || '') + '|' + (e.code || '');
    var mod = e.ctrlKey || e.metaKey;
    // F12
    if (k === 'F12|F12') return true;
    // Ctrl/Cmd+Shift+I / J / C / K
    if (mod && e.shiftKey) {
      if (/^(I|J|C|K)$/.test(e.key || '')) return true;
    }
    // Ctrl/Cmd+U (view source), Ctrl/Cmd+S (save page)
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (isDevtoolsCombo(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!blocked) { notify('Developer tools are disabled on this site.'); blocked = true; setTimeout(function () { blocked = false; }, 3000); }
      return false;
    }
  }, true);

  // Block the "Inspect Element" context menu on app chrome, but keep it on
  // interactive/editable/content elements so paste/copy/save-image still work.
  document.addEventListener('contextmenu', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('input,textarea,select,a[href],img,button,[contenteditable]') : null;
    if (el) return; // allow normal context menu on these
    e.preventDefault();
    return false;
  }, true);

  // Detect when DevTools is opened via the menu (window size shrink) — UI only.
  var lastW = window.outerWidth, lastH = window.outerHeight;
  var flagged = false;
  setInterval(function () {
    try {
      var ow = window.outerWidth, oh = window.outerHeight;
      if (ow > 0 && oh > 0 && (Math.abs(ow - lastW) > 200 || Math.abs(oh - lastH) > 200) && !flagged) {
        flagged = true;
        notify('Developer tools are disabled on this site.');
        setTimeout(function () { flagged = false; }, 4000);
      }
      lastW = ow; lastH = oh;
    } catch (_) {}
  }, 1500);
})();
