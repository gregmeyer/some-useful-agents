/**
 * Tells the operator when their session has ended, instead of letting the page
 * quietly stop working.
 *
 * Before this, an expired session in an already-open tab produced no signal at
 * all. Every page holds an SSE stream (`/inbox/events`) and several polls; on
 * expiry those get a bare 401, `EventSource` reconnect-loops forever, buttons
 * do nothing, and nothing on screen says why. There was no 401 handling in any
 * client script — the tab was indistinguishable from a broken dashboard.
 *
 * Two detectors, because neither alone is sufficient:
 *
 *  1. A `window.fetch` wrapper. Every in-page request already goes through
 *     fetch, so wrapping it once covers the badge poll, the inbox row refresh,
 *     widget replay, build polling and everything added later — without
 *     touching those call sites. `requireAuth` tags its 401 body with
 *     `signedOut: true`, but we key off the status code so the guard still
 *     works for responses that carry no body.
 *
 *  2. A slow heartbeat. A tab left open on a page that issues no periodic
 *     fetches (the home feed, for one) would otherwise learn nothing until the
 *     operator clicked something and it silently failed. 60s is frequent
 *     enough to catch it before they try, and cheap — `/session/ping` does no
 *     work beyond passing through the auth middleware.
 *
 * The banner is deliberately not a modal: it must not trap someone mid-task or
 * hide what they were reading. Reloading is left to them — an automatic
 * redirect would discard whatever they had typed.
 */
export const SESSION_GUARD_JS = `
(function () {
  var BANNER_ID = 'sua-session-banner';
  var signaled = false;

  function banner() {
    if (document.getElementById(BANNER_ID)) return;
    var el = document.createElement('div');
    el.id = BANNER_ID;
    el.className = 'session-banner';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<strong>You have been signed out.</strong>' +
      '<span>This page is no longer live and buttons will not work. ' +
      'Anything you typed here is still on screen — copy it before reloading.</span>' +
      '<a class="btn btn--sm" href="/auth?expired=1">Sign in again</a>';
    if (document.body) document.body.appendChild(el);
  }

  function signalSignedOut() {
    if (signaled) return;
    signaled = true;
    banner();
    try { window.dispatchEvent(new CustomEvent('sua:signed-out')); } catch (e) { /* noop */ }
  }
  window.__suaSignedOut = signalSignedOut;

  // 1. Notice any same-origin request that comes back 401.
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return nativeFetch(input, init).then(function (res) {
        // Only same-origin responses say anything about OUR session; a 401
        // from some third-party URL an agent widget fetched is not a sign-out.
        try {
          var url = new URL(res.url || String(input), window.location.href);
          if (res.status === 401 && url.origin === window.location.origin) signalSignedOut();
        } catch (e) { /* opaque or unparseable — ignore */ }
        return res;
      });
    };
  }

  // 2. Heartbeat, for pages that make no other requests.
  function ping() {
    if (signaled) return;
    nativePing('/session/ping');
  }
  function nativePing(url) {
    // Goes through the wrapped fetch above, so a 401 here is handled by the
    // same path as any other request.
    try {
      window.fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .catch(function () { /* offline or daemon down — not a sign-out */ });
    } catch (e) { /* noop */ }
  }
  setInterval(ping, 60000);
})();
`;
