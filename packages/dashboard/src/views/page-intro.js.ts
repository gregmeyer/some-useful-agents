/**
 * Client wiring for the dismissible page intros (see page-intro.ts).
 *
 * On load: hide any intro the user has already dismissed (localStorage key
 * `sua-intro-<key>`), and wire each "Got it" button to hide + remember. If
 * localStorage is unavailable the intro stays visible and dismiss is a no-op
 * for that session — never throws.
 *
 * Inlined via layout.ts, same pattern as PULSE_REFRESH_JS / CSP_ALLOW_JS.
 */
export const PAGE_INTRO_JS = `
  (function () {
    var intros = document.querySelectorAll('.page-intro[data-intro-key]');
    if (!intros.length) return;
    for (var i = 0; i < intros.length; i++) {
      (function (el) {
        var key = el.getAttribute('data-intro-key');
        var storeKey = key ? 'sua-intro-' + key : null;
        try {
          if (storeKey && localStorage.getItem(storeKey) === '1') {
            el.style.display = 'none';
            return;
          }
        } catch (e) { /* storage blocked — leave the intro visible */ }
        var btn = el.querySelector('[data-intro-dismiss]');
        if (btn) btn.addEventListener('click', function () {
          el.style.display = 'none';
          try { if (storeKey) localStorage.setItem(storeKey, '1'); } catch (e) { /* ignore */ }
        });
      })(intros[i]);
    }
  })();
`;
