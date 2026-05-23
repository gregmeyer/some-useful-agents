/**
 * CSP image-block helper for the run-detail page.
 *
 * When a widget renders an <img> from a host that isn't in the page CSP
 * `img-src` allowlist, the browser blocks it silently (only the console
 * shows the violation). This listener catches those `securitypolicyviolation`
 * events, collects the blocked hosts, and — on a page that declares a single
 * owning agent via `[data-csp-agent]` (the run-detail container) — shows a
 * banner with a one-click "Allow" that merges each host into the agent's
 * `permissions.imgSrc` via POST /agents/:id/permissions/allow-host, then
 * reloads so the now-allowed images render.
 *
 * Inert on pages without `[data-csp-agent]` (e.g. Pulse / dashboards, where
 * a global violation can't be attributed to one agent).
 */
export const CSP_ALLOW_JS = `
(function () {
  var agentEl = document.querySelector('[data-csp-agent]');
  if (!agentEl) return;
  var agentId = agentEl.getAttribute('data-csp-agent');
  if (!agentId) return;

  var blockedHosts = {};   // host -> true
  var banner = null;

  function hostFromUri(uri) {
    if (!uri) return '';
    try {
      // blockedURI may be a full URL or 'inline'/'eval' for non-resource
      // violations. Only parse http(s) resource URIs.
      if (uri.indexOf('http') !== 0) return '';
      return new URL(uri).hostname.toLowerCase();
    } catch (e) { return ''; }
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function renderBanner() {
    var hosts = Object.keys(blockedHosts);
    if (hosts.length === 0) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'flash flash--info';
      banner.style.cssText = 'margin: var(--space-3) 0; display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;';
      // Mount just above the run container so it's visible near the result.
      var anchor = document.querySelector('[data-run-container]') || document.body;
      anchor.insertBefore(banner, anchor.firstChild);
    }
    var chips = hosts.map(function (h) {
      return '<code style="font-size:var(--font-size-xs);background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:var(--radius-sm);">' + esc(h) + '</code>';
    }).join(' ');
    banner.innerHTML =
      '<div style="flex:1;min-width:200px;">' +
        '<strong>' + hosts.length + ' image host' + (hosts.length === 1 ? '' : 's') + ' blocked by the page security policy.</strong> ' +
        '<span class="dim" style="font-size:var(--font-size-xs);">' + chips + '</span>' +
        '<div class="dim" style="font-size:var(--font-size-xs);margin-top:var(--space-1);">Allowing adds ' +
        (hosts.length === 1 ? 'it' : 'them') + ' to <code>' + esc(agentId) + '</code> permissions.imgSrc (creates a new agent version).</div>' +
      '</div>' +
      '<span style="display:inline-flex;gap:var(--space-2);flex-shrink:0;">' +
        '<button type="button" class="btn btn--sm btn--ghost" id="csp-dismiss">Dismiss</button>' +
        '<button type="button" class="btn btn--sm btn--primary" id="csp-allow">Allow ' + (hosts.length === 1 ? 'host' : 'all ' + hosts.length) + '</button>' +
      '</span>';

    document.getElementById('csp-dismiss').addEventListener('click', function () {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
    });
    document.getElementById('csp-allow').addEventListener('click', function () {
      var btn = document.getElementById('csp-allow');
      btn.disabled = true; btn.textContent = 'Allowing...';
      var pending = hosts.slice();
      var failures = [];
      function next() {
        if (pending.length === 0) {
          if (failures.length > 0) {
            btn.disabled = false; btn.textContent = 'Retry';
            var msg = document.createElement('div');
            msg.className = 'dim';
            msg.style.cssText = 'font-size:var(--font-size-xs);width:100%;color:var(--color-danger,#a00);';
            msg.textContent = 'Failed: ' + failures.join(', ');
            banner.appendChild(msg);
            return;
          }
          window.location.reload();
          return;
        }
        var host = pending.shift();
        fetch('/agents/' + encodeURIComponent(agentId) + '/permissions/allow-host', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: host }),
        })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d.ok) failures.push(host); next(); })
        .catch(function () { failures.push(host); next(); });
      }
      next();
    });
  }

  window.addEventListener('securitypolicyviolation', function (e) {
    var directive = (e.effectiveDirective || e.violatedDirective || '');
    if (directive.indexOf('img-src') === -1) return;
    var host = hostFromUri(e.blockedURI);
    if (!host || blockedHosts[host]) return;
    blockedHosts[host] = true;
    renderBanner();
  });
})();
`;
