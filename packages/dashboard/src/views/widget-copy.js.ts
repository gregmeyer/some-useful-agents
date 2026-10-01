/**
 * Client-side JS for the `copy` output-widget control.
 *
 * Renders as a stateless icon button (`[data-widget-copy]`) inside the widget
 * controls row. The widget body is the controls row's next sibling, so we copy
 * its rendered text (`innerText`) to the clipboard. Reuses the same
 * clipboard-with-execCommand-fallback approach as the inbox copy button
 * (inbox-modal.js.ts). Inlined via layout.ts; event-delegated so it covers
 * widgets injected after load (inbox inline widgets, tile refreshes).
 */
export const WIDGET_COPY_JS = `
  // ── Widget copy-to-clipboard ──────────────────────────────────────
  (function () {
    function findBody(btn) {
      var row = btn.closest('[data-widget-control-row]');
      return row ? row.nextElementSibling : null;
    }
    function flash(btn, ok, text) {
      var label = btn.querySelector('[data-widget-copy-label]');
      var prev = label ? label.textContent : '';
      var prevTitle = btn.getAttribute('title') || 'Copy to clipboard';
      btn.classList.remove('wc-iconbtn--ok', 'wc-iconbtn--err');
      btn.classList.add(ok ? 'wc-iconbtn--ok' : 'wc-iconbtn--err');
      if (label) label.textContent = text;
      btn.setAttribute('title', text);
      setTimeout(function () {
        btn.classList.remove('wc-iconbtn--ok', 'wc-iconbtn--err');
        if (label) label.textContent = prev;
        btn.setAttribute('title', prevTitle);
      }, 1500);
    }
    // innerText doesn't reach into shadow roots, where A2UI widgets render;
    // walk them so a copied A2UI widget isn't empty.
    function deepText(el) {
      if (!el.querySelector || !el.querySelector('a2ui-surface')) return el.innerText || el.textContent || '';
      var out = [];
      (function walk(n) {
        if (n.nodeType === 3) { var t = n.nodeValue.replace(/\\s+/g, ' ').trim(); if (t) out.push(t); return; }
        if (n.nodeType !== 1 && n.nodeType !== 11) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        if (n.shadowRoot) walk(n.shadowRoot);
        for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      })(el);
      return out.join('\\n');
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error('execCommand failed'));
        } catch (e) { reject(e); }
      });
    }
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-widget-copy]') : null;
      if (!btn) return;
      e.preventDefault();
      var body = findBody(btn);
      var text = body ? deepText(body).trim() : '';
      if (!text) { flash(btn, false, 'Empty'); return; }
      copyText(text)
        .then(function () { flash(btn, true, 'Copied!'); })
        .catch(function () { flash(btn, false, 'Failed'); });
    });
  })();
`;
