/**
 * Re-exports of the shared HTTP auth helpers that used to live here. The
 * canonical implementations moved to `@some-useful-agents/core/http-auth`
 * in v0.12.0 so both the MCP server and the dashboard can share them.
 * Keeping the names stable here so existing `./auth.js` imports inside
 * this package don't need to change.
 */
export {
  checkAuthorization,
  checkCookieToken,
  buildLoopbackAllowlist,
  checkHost,
  checkOrigin,
  type AuthCheckResult,
} from '@some-useful-agents/core';
