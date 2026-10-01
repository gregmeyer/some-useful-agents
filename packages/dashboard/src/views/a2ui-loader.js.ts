/**
 * Loads the A2UI renderer (/assets/a2ui-sua.js, ~330 KB with the vendored
 * library) only on pages that show an A2UI surface: now, or later (a tile
 * refresh, a chat reply, an inbox thread). Once loaded, a2ui-sua.js mounts
 * every surface itself, including ones added afterwards.
 */
export const A2UI_LOADER_JS = `
(function () {
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.type = 'module';
    s.src = '/assets/a2ui-sua.js';
    document.head.appendChild(s);
  }
  function check() { if (!loaded && document.querySelector('[data-a2ui-surface]')) load(); }
  check();
  if (loaded || typeof MutationObserver === 'undefined') return;
  var mo = new MutationObserver(function () { check(); if (loaded) mo.disconnect(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
`;
