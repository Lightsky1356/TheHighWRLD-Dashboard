/* Developer docs: the "On this page" links are ordinary #hash anchors, but
   the SPA's hash routing treats a hash change as a navigation - clicking one
   reloaded the page and dropped the reader on /#api-basics instead of scrolling
   inside the docs. Scroll to the section directly and leave location alone. */
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var link = t.closest('#page-section-developers .api-side a[href^="#"]');
    if (!link) return;
    var id = link.getAttribute('href').slice(1);
    if (!id) return;
    var target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('#page-section-developers .api-side .api-nav-item').forEach(function (a) {
      a.classList.toggle('is-active', a === link);
    });
  });
})();
