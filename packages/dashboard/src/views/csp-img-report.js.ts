/**
 * Client-side CSP-violation handler for img-src blocks.
 *
 * Does two things on every `securitypolicyviolation` event filtered to
 * the `img-src` directive:
 *
 *   1. POST `{agentId, host}` to `/api/img-block-report` so the agent
 *      config page can surface "Recently blocked" pills. (Server side:
 *      BlockedImgHostsStore.)
 *
 *   2. Replace the failed `<img>` in place with a small "Image blocked"
 *      card that shows an inline `+ Allow <host>` button. Clicking the
 *      button POSTs to `/agents/:id/permissions/allow-host`; on success
 *      the card is swapped for a fresh `<img>` using the original src
 *      (which now loads because the CSP allows the host). This closes
 *      the friction loop without forcing the user to navigate to the
 *      agent's config page.
 *
 * Coordinates with widget-img-fallback.js.ts: we mark the original img
 * with `data-img-fallback="1"` so the fallback's `error` listener
 * doesn't also swap it to the generic broken-image placeholder.
 *
 * Best-effort throughout — fetch failures, malformed hosts, missing
 * agent context all silently degrade (no inline UI, but render path
 * never throws).
 */

export const CSP_IMG_REPORT_JS = `
(function () {
  if (typeof window === 'undefined' || !window.addEventListener) return;

  var REPORT_URL = '/api/img-block-report';
  var DEDUPE_WINDOW_MS = 60 * 1000;
  var reported = Object.create(null);

  function findOwningAgentId(element) {
    var node = element && element.nodeType === 1 ? element : null;
    while (node) {
      if (node.getAttribute) {
        var id = node.getAttribute('data-agent-id');
        if (id && id.charAt(0) !== '_') return id;
      }
      node = node.parentElement;
    }
    return null;
  }

  // For img-src CSP violations Chrome sets event.target to the
  // HTMLDocument, not the <img> element that triggered the block. To
  // find the actual element we scan all <img> tags and match on src
  // (or the failed-src marker widget-img-fallback writes when it
  // swaps the image to the placeholder before our handler runs).
  function findImgByBlockedUri(blockedUri) {
    if (!blockedUri) return null;
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.currentSrc === blockedUri || img.src === blockedUri) return img;
      if (img.getAttribute('data-failed-src') === blockedUri) return img;
    }
    return null;
  }

  function hostnameFromBlockedUri(uri) {
    if (!uri || typeof uri !== 'string') return null;
    if (uri.indexOf('://') === -1) return null;
    try { return new URL(uri).hostname.toLowerCase(); } catch (e) { return null; }
  }

  function reportToServer(agentId, host) {
    var key = agentId + '|' + host;
    var now = Date.now();
    if (reported[key] && now - reported[key] < DEDUPE_WINDOW_MS) return;
    reported[key] = now;
    try {
      fetch(REPORT_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agentId, host: host }),
      }).catch(function () { /* swallow */ });
    } catch (e) { /* swallow */ }
  }

  // Inline "Allow this host" card. Replaces the failed img with a
  // small, themed card so the user can fix the block in one click,
  // without leaving the page. After the host is allowed the card is
  // swapped back to a fresh img that loads successfully (the CSP
  // header on subsequent responses now includes the host; the existing
  // page's CSP was set at request time and can't be widened in place,
  // so we recreate the img element which triggers a fresh fetch
  // against the new policy on the next request — for the CURRENT
  // page we set the src directly, which still works because the
  // browser uses the CSP from the document, not per-element).
  //
  // Caveat: the current page's CSP is fixed for its lifetime. Setting
  // a fresh src on this page will be blocked again. So the card's
  // success path tells the user "added — refresh to see it" and
  // includes a refresh button.
  function renderAllowCard(img, agentId, host) {
    if (!img || !img.parentNode) return;
    if (img.getAttribute('data-csp-allow-card') === '1') return; // already rendered

    // Mark the img so widget-img-fallback skips it.
    img.setAttribute('data-csp-allow-card', '1');
    img.setAttribute('data-img-fallback', '1');
    img.setAttribute('data-failed-src', img.currentSrc || img.src || '');

    var card = document.createElement('div');
    card.setAttribute('data-csp-allow-host-card', host);
    card.style.cssText = [
      'display: inline-flex',
      'flex-direction: column',
      'gap: 6px',
      'padding: 10px 12px',
      'border: 1px dashed var(--color-border)',
      'border-radius: var(--radius-sm, 6px)',
      'background: var(--color-surface-raised, rgba(255,255,255,0.04))',
      'font-size: var(--font-size-xs, 12px)',
      'color: var(--color-text-muted, #8b93a7)',
      'max-width: 340px',
      'align-items: flex-start',
    ].join(';');

    var line = document.createElement('div');
    line.textContent = 'Image blocked by CSP.';
    card.appendChild(line);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '+ Allow ' + host;
    btn.style.cssText = [
      'appearance: none',
      'border: 1px solid var(--color-border-strong, #5b6275)',
      'background: var(--color-surface, #1f2430)',
      'color: var(--color-text, #e2e6f0)',
      'padding: 4px 8px',
      'border-radius: var(--radius-sm, 6px)',
      'cursor: pointer',
      'font: inherit',
      'font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)',
    ].join(';');

    var status = document.createElement('div');
    status.style.cssText = 'font-size: 11px; color: var(--color-text-muted);';
    status.setAttribute('aria-live', 'polite');

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Allowing...';
      try {
        fetch('/agents/' + encodeURIComponent(agentId) + '/permissions/allow-host', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: host }),
        })
          .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'bad response' }; }); })
          .then(function (data) {
            if (data && data.ok) {
              btn.textContent = '✓ Allowed';
              status.textContent = 'Refresh to load the image.';
              // Inline refresh affordance — the existing page's CSP
              // header is frozen for this document, so an in-place
              // retry would still be blocked. A second page render
              // emits the widened CSP.
              var refresh = document.createElement('button');
              refresh.type = 'button';
              refresh.textContent = 'Refresh';
              refresh.style.cssText = btn.style.cssText;
              refresh.addEventListener('click', function () { window.location.reload(); });
              card.appendChild(refresh);
            } else {
              btn.disabled = false;
              btn.textContent = '+ Allow ' + host;
              status.textContent = 'Failed: ' + (data && data.error ? data.error : 'unknown error');
            }
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = '+ Allow ' + host;
            status.textContent = 'Network error.';
          });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '+ Allow ' + host;
        status.textContent = 'Request failed.';
      }
    });

    card.appendChild(btn);
    card.appendChild(status);

    img.style.display = 'none';
    img.parentNode.insertBefore(card, img.nextSibling);
  }

  function handle(blockedURI, target) {
    var host = hostnameFromBlockedUri(blockedURI);
    if (!host) return;
    // Chrome reports e.target as HTMLDocument for img-src violations,
    // not the actual <img>. Climb from there gives no agent id. Fall
    // back to matching the blocked URI against every <img> on the page.
    var img = (target && target.tagName === 'IMG') ? target : findImgByBlockedUri(blockedURI);
    var owner = findOwningAgentId(img || target);
    if (!owner) return;
    reportToServer(owner, host);
    if (img) {
      try { renderAllowCard(img, owner, host); } catch (err) { /* swallow */ }
    }
  }

  // Drain any violations buffered in <head> before this script was
  // parsed. See layout.ts for the buffering shim — img-src blocks
  // fire on the initial fetch attempt, well before the script bundle
  // at the end of <body> runs.
  if (window.__suaCspBuffer && window.__suaCspBuffer.length) {
    var buffered = window.__suaCspBuffer.slice();
    window.__suaCspBuffer = [];
    for (var i = 0; i < buffered.length; i++) {
      handle(buffered[i].blockedURI, buffered[i].target);
    }
  }

  document.addEventListener('securitypolicyviolation', function (e) {
    if (!e || e.violatedDirective !== 'img-src') return;
    handle(e.blockedURI, e.target);
  });
})();
`;
