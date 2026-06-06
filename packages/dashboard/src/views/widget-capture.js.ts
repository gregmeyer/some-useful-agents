/**
 * Client-side JS for the `capture-image` output-widget control.
 *
 * Renders as a stateless icon button (`[data-widget-capture]`). On click it
 * rasterizes the widget body (the controls row's next sibling) to a PNG via
 * html2canvas and triggers a download. html2canvas is vendored locally
 * (/assets/html2canvas.min.js) — CSP blocks CDN scripts — and lazy-loaded only
 * on first capture so it costs nothing on pages that never capture.
 *
 * Limitation surfaced to the user: external images that don't send CORS headers
 * taint the canvas (`useCORS: true` requests them with crossorigin, but a host
 * without CORS still can't be read back). On that failure we flash a clear
 * message rather than downloading a blank-image PNG silently. Inlined via
 * layout.ts; event-delegated.
 */
export const WIDGET_CAPTURE_JS = `
  // ── Widget capture-as-PNG ─────────────────────────────────────────
  (function () {
    var H2C_SRC = '/assets/html2canvas.min.js';
    var loading = null;
    function loadH2C() {
      if (window.html2canvas) return Promise.resolve(window.html2canvas);
      if (loading) return loading;
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = H2C_SRC;
        s.onload = function () { window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')); };
        s.onerror = function () { reject(new Error('failed to load html2canvas')); };
        document.head.appendChild(s);
      });
      return loading;
    }
    function findBody(btn) {
      var row = btn.closest('[data-widget-control-row]');
      return row ? row.nextElementSibling : null;
    }
    function flash(btn, ok, text) {
      var label = btn.querySelector('[data-widget-capture-label]');
      var prev = label && !btn.hasAttribute('data-flashing') ? label.textContent : (label ? label.textContent : '');
      var prevTitle = btn.getAttribute('data-prev-title') || btn.getAttribute('title') || 'Save as PNG';
      if (!btn.hasAttribute('data-prev-title')) btn.setAttribute('data-prev-title', prevTitle);
      if (!btn.hasAttribute('data-prev-label') && label) btn.setAttribute('data-prev-label', label.textContent || '');
      btn.classList.remove('wc-iconbtn--ok', 'wc-iconbtn--err');
      if (ok !== null) btn.classList.add(ok ? 'wc-iconbtn--ok' : 'wc-iconbtn--err');
      if (label) label.textContent = text;
      btn.setAttribute('title', text);
    }
    function restore(btn) {
      var label = btn.querySelector('[data-widget-capture-label]');
      setTimeout(function () {
        btn.classList.remove('wc-iconbtn--ok', 'wc-iconbtn--err');
        if (label) label.textContent = btn.getAttribute('data-prev-label') || '';
        btn.setAttribute('title', btn.getAttribute('data-prev-title') || 'Save as PNG');
        btn.removeAttribute('data-prev-title');
        btn.removeAttribute('data-prev-label');
      }, 2200);
    }
    function bgColor(el) {
      try {
        var c = getComputedStyle(el).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        return getComputedStyle(document.body).backgroundColor || '#ffffff';
      } catch (e) { return '#ffffff'; }
    }
    function download(canvas, name) {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (name || 'widget') + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }, 'image/png');
    }
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-widget-capture]') : null;
      if (!btn || btn.getAttribute('aria-busy') === 'true') return;
      e.preventDefault();
      var body = findBody(btn);
      if (!body) { flash(btn, false, 'No target'); restore(btn); return; }
      var name = (btn.getAttribute('data-widget-capture-filename') || 'widget').replace(/[^a-z0-9_-]+/gi, '-');
      btn.setAttribute('aria-busy', 'true');
      flash(btn, null, 'Saving…');
      loadH2C().then(function (h2c) {
        return h2c(body, { useCORS: true, backgroundColor: bgColor(body), logging: false, scale: window.devicePixelRatio || 1 });
      }).then(function (canvas) {
        download(canvas, name);
        btn.removeAttribute('aria-busy');
        flash(btn, true, 'Saved');
        restore(btn);
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        var m = String(err && err.message || err);
        var msg = /taint|secur|cors|cross-?origin/i.test(m) ? 'Image blocked (CORS)' : 'Capture failed';
        flash(btn, false, msg);
        restore(btn);
      });
    });
  })();
`;
