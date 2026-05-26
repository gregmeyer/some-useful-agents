/**
 * Broken-image fallback for widget output.
 *
 * Agents frequently emit image URLs that resolve to a 404 — e.g. an LLM
 * hand-writes a Wikimedia path with the wrong hash. When the host IS in
 * `permissions.imgSrc` (so CSP allows the request) the run completes and the
 * widget renders an `<img>` that the browser then fails to load, leaving an
 * ugly broken-image glyph with no explanation.
 *
 * We can't use an inline `onerror=` attribute — the HTML sanitizer strips event
 * handlers and the page CSP forbids inline handlers anyway. Instead we listen
 * for image load errors in the CAPTURE phase (error events don't bubble) and
 * swap the failed `<img>` for an inline SVG placeholder (a `data:` URI, which
 * the CSP `img-src` allowlist permits). The original URL is preserved in a
 * tooltip + data attribute so the cause stays debuggable.
 *
 * Scoped to widget/result output so we never touch unrelated chrome images.
 */
export const WIDGET_IMG_FALLBACK_JS = `
(function () {
  var PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
      '<rect width="100%" height="100%" fill="#1f2430"/>' +
      '<g fill="none" stroke="#5b6275" stroke-width="2">' +
        '<rect x="120" y="74" width="80" height="60" rx="6"/>' +
        '<circle cx="142" cy="96" r="7"/>' +
        '<path d="M124 130l24-22 14 12 16-16 22 26"/>' +
      '</g>' +
      '<text x="50%" y="168" fill="#8b93a7" font-family="system-ui,sans-serif" font-size="13" text-anchor="middle">Image unavailable</text>' +
    '</svg>'
  );

  function isWidgetImage(el) {
    return el && el.tagName === 'IMG' && typeof el.closest === 'function' &&
      el.closest('.ai-template-widget, [data-poll-region="result"], .pulse-tile, [data-widget]');
  }

  // Capture phase: error events from <img> don't bubble, so a non-capturing
  // document listener would never see them.
  window.addEventListener('error', function (e) {
    var img = e.target;
    if (!isWidgetImage(img)) return;
    if (img.getAttribute('data-img-fallback') === '1') return; // already swapped — avoid loops
    var failed = img.currentSrc || img.src || '';
    img.setAttribute('data-img-fallback', '1');
    img.setAttribute('data-failed-src', failed);
    img.removeAttribute('srcset');
    img.src = PLACEHOLDER;
    img.style.objectFit = 'contain';
    // Keep the broken-image state compact: a tall hero <img> shouldn't leave a
    // giant placeholder box. Cap the height; the SVG stays centered via contain.
    img.style.maxHeight = '200px';
    img.title = failed ? ('Image failed to load: ' + failed) : 'Image failed to load';
  }, true);
})();
`;
