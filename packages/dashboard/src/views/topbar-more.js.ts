/**
 * The top bar's More menu (layout.ts topbarNav) and the Agents tabs' More
 * (section-tabs.ts): each a <details> that closes when
 * you click anywhere else, press Escape, or pick a link.
 */
export const TOPBAR_MORE_JS = `
  (function () {
    var menus = document.querySelectorAll('[data-topbar-more], [data-tab-more]');
    if (!menus.length) return;
    document.addEventListener('click', function (e) {
      for (var i = 0; i < menus.length; i++) if (menus[i].open && !menus[i].contains(e.target)) menus[i].open = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      for (var i = 0; i < menus.length; i++) if (menus[i].open) { menus[i].open = false; var s = menus[i].querySelector('summary'); if (s) s.focus(); }
    });
  })();
`;
