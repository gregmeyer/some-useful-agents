/**
 * Client wiring for the page-intro lightbox (see page-intro.ts).
 *
 * On load: auto-open each intro modal the user has NOT yet dismissed
 * (localStorage key `sua-intro-<key>`). The ⓘ trigger reopens it on demand at
 * any time. "Got it" / backdrop click / Escape close it and remember the
 * dismissal so it never auto-opens again. If localStorage is unavailable the
 * modal still opens/closes for the session — never throws.
 *
 * Inlined via layout.ts, same pattern as PULSE_REFRESH_JS / CSP_ALLOW_JS.
 */
export const PAGE_INTRO_JS = `
  (function () {
    var modals = document.querySelectorAll('.page-intro-modal[data-intro-key]');
    if (!modals.length) return;
    for (var i = 0; i < modals.length; i++) {
      (function (modal) {
        var key = modal.getAttribute('data-intro-key');
        var storeKey = key ? 'sua-intro-' + key : null;
        function open() { modal.classList.add('is-open'); }
        function dismiss() {
          modal.classList.remove('is-open');
          try { if (storeKey) localStorage.setItem(storeKey, '1'); } catch (e) { /* ignore */ }
        }
        // Auto-open on first visit (not yet dismissed).
        var dismissed = false;
        try { dismissed = !!storeKey && localStorage.getItem(storeKey) === '1'; } catch (e) { /* storage blocked */ }
        if (!dismissed) open();
        // The ⓘ trigger(s) reopen on demand, even after dismissal.
        if (key) {
          var triggers = document.querySelectorAll('[data-intro-open="' + key + '"]');
          for (var t = 0; t < triggers.length; t++) triggers[t].addEventListener('click', open);
        }
        // Close affordances.
        var btn = modal.querySelector('[data-intro-dismiss]');
        if (btn) btn.addEventListener('click', dismiss);
        modal.addEventListener('click', function (e) { if (e.target === modal) dismiss(); });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && modal.classList.contains('is-open')) dismiss();
        });
      })(modals[i]);
    }
  })();
`;
