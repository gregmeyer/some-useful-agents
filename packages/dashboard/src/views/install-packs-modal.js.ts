/**
 * Opens the server-rendered "Install from Packs" modal (#install-packs-modal)
 * when the dropdown's "+ Install from Packs" link ([data-install-packs-open])
 * is clicked. If the modal isn't on the page (e.g. /dashboards/:id, or the
 * packs store isn't wired) the link falls back to navigating to /packs.
 */
export const INSTALL_PACKS_MODAL_JS = `
  (function () {
    function modal() { return document.getElementById('install-packs-modal'); }

    function open(m) {
      m.classList.add('is-open');
      var first = m.querySelector('button, a');
      if (first) first.focus();
    }
    function close(m) { m.classList.remove('is-open'); }

    document.addEventListener('click', function (e) {
      var opener = e.target.closest && e.target.closest('[data-install-packs-open]');
      if (opener) {
        var m = modal();
        if (!m) return; // no modal on this page — let the link navigate to /packs
        e.preventDefault();
        // Close the <details> dropdown so it doesn't stay open behind the modal.
        var dd = opener.closest('details');
        if (dd) dd.removeAttribute('open');
        open(m);
        return;
      }
      var m2 = modal();
      if (!m2 || !m2.classList.contains('is-open')) return;
      // Backdrop click or explicit close button.
      if (e.target === m2 || (e.target.closest && e.target.closest('[data-install-packs-close]'))) {
        close(m2);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = modal();
      if (m && m.classList.contains('is-open')) close(m);
    });
  })();
`;
