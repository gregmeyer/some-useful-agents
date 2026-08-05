/**
 * Global behaviors for the persistent "sua ›" ask band (rendered in the layout
 * chrome on every page). Two things, both document-delegated so they cover the
 * single band regardless of which page rendered it:
 *
 *   1. Focus hotkey — Cmd/Ctrl+K (primary, command-palette convention) or a
 *      bare "/" focuses the band. "/" is suppressed while you're typing in
 *      another field or while the thread modal is open, so it never steals a
 *      keystroke; Esc blurs the band when it's focused and empty.
 *   2. Draft persistence — the in-progress ask is mirrored to localStorage and
 *      restored on the next page, so navigating away doesn't lose what you
 *      typed. Cleared on a successful submit by the composer handler in
 *      inbox-modal.js.ts.
 *
 * Submit / Enter-to-send / auto-grow are NOT here — those are the shared
 * `data-home-ask` handlers in inbox-modal.js.ts, which already fire globally.
 */
export const APP_ASK_JS = `
(function () {
  var DRAFT_KEY = 'sua-ask-draft';
  function band() { return document.querySelector('[data-home-ask-input]'); }

  // Restore an in-progress draft on load (one band per page).
  function restoreDraft() {
    var el = band();
    if (!el) return;
    try {
      var d = localStorage.getItem(DRAFT_KEY);
      if (d && !el.value) {
        el.value = d;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, Math.floor(window.innerHeight * 0.4)) + 'px';
      }
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreDraft);
  } else {
    restoreDraft();
  }

  // Persist the draft as the operator types.
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-home-ask-input')) return;
    try { localStorage.setItem(DRAFT_KEY, t.value || ''); } catch (er) {}
  });

  function isEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }
  function modalOpen() {
    var m = document.getElementById('inbox-modal');
    return !!(m && !m.hasAttribute('hidden'));
  }

  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var isK = meta && (e.key === 'k' || e.key === 'K');
    var isSlash = !meta && !e.altKey && !e.shiftKey && e.key === '/';
    if (isK || isSlash) {
      // Never hijack a keystroke while a modal is up, and "/" only when the
      // operator isn't already typing somewhere.
      if (modalOpen()) return;
      if (isSlash && isEditable(document.activeElement)) return;
      var el = band();
      if (!el) return;
      e.preventDefault();
      el.focus();
      try { var len = (el.value || '').length; el.setSelectionRange(len, len); } catch (er) {}
      return;
    }
    if (e.key === 'Escape') {
      var a = document.activeElement;
      if (a && a.hasAttribute && a.hasAttribute('data-home-ask-input') && !(a.value || '').trim()) {
        a.blur();
      }
    }
  });
})();
`;
