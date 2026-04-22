/**
 * Client-side JS for interactive widget action buttons.
 * Handles POST requests triggered by [data-widget-action] buttons.
 *
 * Extracted as a separate module for clarity. Inlined via layout.ts.
 */
export const OUTPUT_WIDGET_ACTIONS_JS = `
  // ── Output widget actions ──────────────────────────────────────────
  // Handles clicks on widget action buttons (data-widget-action).
  // POSTs to the declared endpoint with the payload field's value.
  (function () {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-widget-action]') : null;
      if (!btn) return;
      e.preventDefault();

      var actionId = btn.getAttribute('data-widget-action');
      var endpoint = btn.getAttribute('data-widget-endpoint');
      var method = btn.getAttribute('data-widget-method') || 'POST';
      var payloadField = btn.getAttribute('data-widget-payload-field');

      if (!endpoint) return;

      // Build payload from the widget's extracted field data.
      var payload = {};
      if (payloadField) {
        // Look for a pre/code/textarea element that contains the field value.
        var widget = btn.closest('.output-widget');
        if (widget) {
          var codeEl = widget.querySelector('pre');
          if (codeEl) payload[payloadField] = codeEl.textContent || '';
        }
      }

      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working...';

      fetch(endpoint, {
        method: method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      .then(function (res) {
        if (res.redirected) {
          window.location.href = res.url;
          return;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return; // redirected
        if (data.ok) {
          btn.textContent = 'Done!';
          btn.className = btn.className.replace('btn--primary', 'btn--ghost');
          if (data.redirect) window.location.href = data.redirect;
        } else {
          btn.disabled = false;
          btn.textContent = originalText;
          var flash = document.createElement('div');
          flash.className = 'flash flash--error';
          flash.style.cssText = 'margin-top:var(--space-2);font-size:var(--font-size-xs);';
          flash.textContent = data.error || 'Action failed';
          btn.parentElement.appendChild(flash);
          setTimeout(function () { flash.remove(); }, 5000);
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = originalText;
      });
    });
  })();
`;
