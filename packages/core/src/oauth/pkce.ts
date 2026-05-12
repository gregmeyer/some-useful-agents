import { randomBytes, createHash } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange) helpers — RFC 7636.
 *
 * Why: sua's OAuth flow exposes `/oauth/callback` on a fixed loopback
 * port (the dashboard's own port). Anyone on the same machine can
 * theoretically race to that callback. PKCE binds the authorisation
 * code to the verifier we generated server-side, so even if an
 * attacker intercepts the code they can't exchange it without our
 * verifier.
 *
 * We use S256 (SHA-256) — the only method Google accepts beyond the
 * deprecated `plain` method.
 */

const VERIFIER_BYTES = 48;            // → 64-char base64url, well under the 128-char RFC max

export interface PkcePair {
  /** Random URL-safe string. Stored server-side, sent with the token exchange. */
  codeVerifier: string;
  /** Base64url(SHA-256(verifier)). Sent to the authorisation endpoint. */
  codeChallenge: string;
  /** Always 'S256' for sua — Google rejects 'plain' on installed apps anyway. */
  codeChallengeMethod: 'S256';
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(VERIFIER_BYTES));
  const hash = createHash('sha256').update(codeVerifier).digest();
  return {
    codeVerifier,
    codeChallenge: base64UrlEncode(hash),
    codeChallengeMethod: 'S256',
  };
}

/** OAuth state token — opaque, used for CSRF protection on the callback. */
export function generateOauthState(): string {
  return base64UrlEncode(randomBytes(24));
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
