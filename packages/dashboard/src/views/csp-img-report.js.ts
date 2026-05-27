/**
 * Client-side CSP-violation reporter for img-src blocks.
 *
 * Listens for `securitypolicyviolation` events, filters to `img-src`
 * directive violations, extracts the blocked hostname, walks up the
 * DOM to find the owning `.pulse-tile[data-agent-id]` (or any element
 * with `data-agent-id`), and POSTs `{agentId, host}` to
 * `/api/img-block-report`. The server records the pair in
 * BlockedImgHostsStore; the agent config page renders the entries as
 * one-click "Allow" pills.
 *
 * Deduped client-side within a single page load — repeated violations
 * for the same (agentId, host) tuple are only POSTed once per minute.
 * The server upserts a count column so multiple reports across loads
 * still accrue.
 *
 * Best-effort: any fetch failure is swallowed. The whole feature is a
 * UX nudge — losing a report doesn't break anything.
 */

export const CSP_IMG_REPORT_JS = `
(function () {
  if (typeof window === 'undefined' || !window.addEventListener) return;

  var REPORT_URL = '/api/img-block-report';
  var DEDUPE_WINDOW_MS = 60 * 1000;
  var seen = Object.create(null);

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

  function hostnameFromBlockedUri(uri) {
    if (!uri || typeof uri !== 'string') return null;
    // Browsers report 'inline' / 'eval' / 'data' / 'self' for non-URL
    // sources — those have no host, drop them.
    if (uri.indexOf('://') === -1) return null;
    try {
      var u = new URL(uri);
      return u.hostname.toLowerCase();
    } catch (e) {
      return null;
    }
  }

  function report(agentId, host) {
    var key = agentId + '|' + host;
    var now = Date.now();
    if (seen[key] && now - seen[key] < DEDUPE_WINDOW_MS) return;
    seen[key] = now;
    try {
      fetch(REPORT_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agentId, host: host }),
      }).catch(function () { /* swallow */ });
    } catch (e) { /* swallow */ }
  }

  document.addEventListener('securitypolicyviolation', function (e) {
    if (!e || e.violatedDirective !== 'img-src') return;
    var host = hostnameFromBlockedUri(e.blockedURI);
    if (!host) return;
    // sourceFile/target may be missing for non-element violations
    // (e.g. background-image in inline style on a non-img). Use the
    // event target as the climb root when available.
    var owner = findOwningAgentId(e.target);
    if (!owner) return;
    report(owner, host);
  });
})();
`;
