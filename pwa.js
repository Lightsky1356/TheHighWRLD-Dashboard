/* TheHighWRLD Dashboard — PWA bootstrap.
 * Registers the service worker, wires the "Install App" button on the
 * Downloads page, and surfaces installability across platforms.
 */
(function () {
  'use strict';
  if (window.__thwPwa) return;
  window.__thwPwa = true;

  var deferredPrompt = null;
  var installBtn = null;

  // Capture the browser's install prompt (beforeinstallprompt).
  window.addEventListener('beforeinstallprompt', function (e) {
    // Prevent the default mini-infobar so we control when it appears.
    e.preventDefault();
    deferredPrompt = e;
    exposeInstallable(true);
  });

  function exposeInstallable(show) {
    var btn = document.getElementById('dl-install-btn');
    if (!btn) return;
    if (show) {
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Install TheHighWRLD';
    }
  }

  function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          showInstallMsg('Thanks — check your apps/home screen!');
        } else {
          showInstallMsg('You can install any time from the Downloads page.');
        }
        deferredPrompt = null;
        exposeInstallable(false);
      }).catch(function () {});
    } else if (isIOS()) {
      showInstallMsg('On iPhone/iPad: tap Share, then "Add to Home Screen".');
    } else if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      showInstallMsg('Already installed as an app.');
    } else {
      showInstallMsg('Open your browser menu, then "Install app" / "Add to Home Screen".');
    }
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform && /iPad|iPhone|iPod/i.test(navigator.platform));
  }

  function showInstallMsg(text) {
    try { if (typeof window.showToast === 'function') { window.showToast(text, 'info', 3000); return; } } catch (_) {}
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('#dl-install-btn') : null;
    if (btn) { e.preventDefault(); promptInstall(); }
  }, true);

  // ----- Live-wire the Downloads page binary links when builds exist -----
  function wireDownload(id, url, label, size) {
    var a = document.getElementById(id);
    var sp = document.getElementById(id.replace('dl-', 'dl-').replace('-btn', '-label'));
    if (!a) return;
    if (url) {
      a.setAttribute('href', url);
      (sp || {}).textContent = label + (size ? ' · ' + size : '');
      a.style.opacity = '1';
    } else {
      a.setAttribute('href', '#');
      a.addEventListener('click', function (e) { e.preventDefault(); showInstallMsg('Build coming soon.'); });
    }
  }
  window.__thwPwaWireDownload = wireDownload;

  // Expose a way for the app to refresh binary availability (called later when
  // desktop/android artifacts exist).
  window.__thwPwaRefreshDownloads = function (builds) {
    builds = builds || window.__THW_BUILDS || {};
    wireDownload('dl-win-btn', builds.windowsUrl, builds.windowsLabel || 'Windows');
    wireDownload('dl-android-btn', builds.androidUrl, builds.androidLabel || 'Android');
  };

  // Register the service worker (only over HTTPS or localhost).
  if ('serviceWorker' in navigator) {
    try {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').then(function () {
          // Optionally refresh downloads once the shell is live.
          if (window.__thwPwaRefreshDownloads) window.__thwPwaRefreshDownloads();
        }).catch(function () {});
      });
    } catch (_) {}
  }

  // Initial install state.
  exposeInstallable(false);
  window.addEventListener('change', function () { exposeInstallable(!!deferredPrompt); });
})();
