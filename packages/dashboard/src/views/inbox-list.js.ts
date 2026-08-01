/**
 * Inbox list "load more" pagination (C3). Lives in the layout bundle; no-ops
 * unless the page has a [data-inbox-load-more] control. Clicking it fetches the
 * next window from GET /inbox/rows (with the current filters + offset), appends
 * the bare rows into [data-inbox-rows], and advances the offset. The
 * X-Inbox-Has-More response header decides whether the button stays. The
 * control is a real <a href> so it also works as a hard-nav fallback with JS
 * off. Row/modal/bulk handlers are all delegated on document, so appended rows
 * are immediately interactive.
 */
export const INBOX_LIST_JS = `
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-inbox-load-more]');
    if (!btn) return;
    e.preventDefault();
    if (btn.getAttribute('data-loading') === '1') return;
    var target = document.querySelector('[data-inbox-rows]');
    if (!target) return;
    var base = btn.getAttribute('data-base') || '/inbox/rows';
    var offset = parseInt(btn.getAttribute('data-offset') || '0', 10) || 0;
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'offset=' + offset;
    btn.setAttribute('data-loading', '1');
    btn.textContent = 'Loading…';
    var hasMore = false;
    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        if (!r.ok) return null;
        hasMore = r.headers.get('X-Inbox-Has-More') === '1';
        return r.text();
      })
      .then(function (htmlText) {
        if (htmlText == null) { btn.removeAttribute('data-loading'); btn.textContent = 'Load more'; return; }
        var tmp = document.createElement('div');
        tmp.innerHTML = htmlText;
        var added = tmp.querySelectorAll('.inbox-row2').length;
        while (tmp.firstChild) target.appendChild(tmp.firstChild);
        var wrap = btn.closest('[data-inbox-loadmore]');
        if (hasMore) {
          btn.setAttribute('data-offset', String(offset + added));
          var nb = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'offset=' + (offset + added);
          btn.setAttribute('href', nb);
          btn.removeAttribute('data-loading');
          btn.textContent = 'Load more';
        } else if (wrap) {
          wrap.parentNode && wrap.parentNode.removeChild(wrap);
        }
      })
      .catch(function () { btn.removeAttribute('data-loading'); btn.textContent = 'Load more'; });
  });
})();
`;
