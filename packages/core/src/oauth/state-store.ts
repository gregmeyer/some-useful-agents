/**
 * In-memory OAuth state map.
 *
 * Each `state` token issued for an in-flight OAuth flow maps to a small
 * record (integration id + PKCE verifier + expiry). The /oauth/callback
 * route consumes the entry — single-use — when the provider redirects
 * the user back with `?code=…&state=…`.
 *
 * Lifetime: process memory only. A daemon restart cancels every
 * in-flight flow, which is fine — the user just clicks Connect again.
 * Persisting the verifier on disk would defeat the point of PKCE.
 *
 * The store is also self-pruning: entries past their expiry are
 * removed lazily on each `consume`, and `clear` is exposed for tests.
 */

export interface OauthFlowState {
  /** Integration id this flow is connecting (used to write back on success). */
  integrationId: string;
  /** PKCE verifier sent back to the provider during token exchange. */
  codeVerifier: string;
  /** Driver/provider kind ('gmail', etc.) — distinguishes endpoint URLs. */
  provider: string;
  /** Where the user came from. We redirect back here after success/failure. */
  returnTo: string;
  /** ms since epoch when this entry expires. */
  expiresAt: number;
}

export interface OauthStateStore {
  /** Store a flow under `state`. Throws if the same state is reused. */
  put(state: string, flow: OauthFlowState): void;
  /** Read + delete in one call. Returns null if expired or unknown. */
  consume(state: string): OauthFlowState | null;
  /** Test helper. */
  clear(): void;
}

export function createOauthStateStore(): OauthStateStore {
  const entries = new Map<string, OauthFlowState>();

  function pruneExpired(now: number): void {
    for (const [k, v] of entries) {
      if (v.expiresAt <= now) entries.delete(k);
    }
  }

  return {
    put(state, flow): void {
      const now = Date.now();
      pruneExpired(now);
      if (entries.has(state)) {
        throw new Error(`OAuth state "${state.slice(0, 6)}…" reused — refuse to overwrite.`);
      }
      entries.set(state, flow);
    },
    consume(state): OauthFlowState | null {
      const now = Date.now();
      pruneExpired(now);
      const got = entries.get(state);
      if (!got) return null;
      entries.delete(state);
      if (got.expiresAt <= now) return null;
      return got;
    },
    clear(): void {
      entries.clear();
    },
  };
}
