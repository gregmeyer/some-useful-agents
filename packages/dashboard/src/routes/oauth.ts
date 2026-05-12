/**
 * OAuth callback route + connect/disconnect actions for integration kinds
 * that need provider authorisation (currently only `gmail`).
 *
 * Trust model — see docs/SECURITY.md "Public-repo secret hygiene":
 *  - Client credentials live in the encrypted secrets store, referenced
 *    by name from the integration row. The user creates their own
 *    Google OAuth client (Desktop app) and pastes the values via
 *    Settings → Secrets.
 *  - PKCE binds the authorisation code to a verifier we generated
 *    server-side. An attacker on the same loopback can't redeem a
 *    code they didn't authorise without our verifier.
 *  - State token (random 24 bytes, base64url) is consumed single-use
 *    by the callback. A replayed callback returns 400.
 *  - Refresh tokens are stored under a name derived from the
 *    integration id (`<id>__refresh_token`). Access tokens are
 *    short-lived and re-fetched per use; never persisted.
 */

import { Router, type Request, type Response } from 'express';
import {
  generatePkcePair,
  generateOauthState,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GMAIL_SCOPES,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const oauthRouter: Router = Router();

/** ms a single Connect flow stays in the in-memory state map. */
const FLOW_TTL_MS = 5 * 60 * 1000;

/** Suffix appended to integration id to name its persisted refresh-token secret. */
export function refreshTokenSecretName(integrationId: string): string {
  // Secret name regex is `[A-Z_][A-Z0-9_]*`. Convert the integration id
  // (lowercase with `:`/`-`) into that shape so a single namespace is
  // searchable in Settings → Secrets.
  const suffix = integrationId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `${suffix}__REFRESH_TOKEN`;
}

/**
 * POST /settings/integrations/:id/connect — kick off OAuth.
 *
 * Reads the integration's referenced client_id + client_secret from
 * the secrets store, generates state + PKCE, persists the flow in the
 * state store, redirects the user to the provider's consent screen.
 */
oauthRouter.post('/settings/integrations/:id/connect', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore || !ctx.oauthStateStore) {
    res.redirect(303, '/settings/integrations?error=OAuth+infrastructure+unavailable.');
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const integration = ctx.integrationsStore.getIntegration(id);
  if (!integration) {
    res.redirect(303, '/settings/integrations?error=Integration+not+found.');
    return;
  }
  if (integration.kind !== 'gmail') {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Kind "${integration.kind}" does not support OAuth connection.`)}`);
    return;
  }

  // Pull the two credential secret names from the integration row.
  // Default to GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET so a user who left
  // the field blank in the add-form still works after pasting those.
  const clientIdSecret = typeof integration.config.client_id_secret === 'string'
    ? integration.config.client_id_secret as string
    : 'GMAIL_CLIENT_ID';
  const clientSecretSecret = typeof integration.config.client_secret_secret === 'string'
    ? integration.config.client_secret_secret as string
    : 'GMAIL_CLIENT_SECRET';

  let clientId: string;
  let clientSecret: string;
  try {
    const all = await ctx.secretsStore.getAll();
    clientId = all[clientIdSecret] ?? '';
    clientSecret = all[clientSecretSecret] ?? '';
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Could not read secrets store: ${(err as Error).message}`)}`);
    return;
  }
  if (!clientId || !clientSecret) {
    const missing = [!clientId && clientIdSecret, !clientSecret && clientSecretSecret].filter(Boolean).join(', ');
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Set ${missing} in Settings → Secrets before connecting.`)}`);
    return;
  }

  const pkce = generatePkcePair();
  const state = generateOauthState();
  const redirectUri = computeRedirectUri(req);

  try {
    ctx.oauthStateStore.put(state, {
      integrationId: id,
      codeVerifier: pkce.codeVerifier,
      provider: 'gmail',
      returnTo: '/settings/integrations',
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent((err as Error).message)}`);
    return;
  }

  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri,
    scopes: GMAIL_SCOPES,
    state,
    codeChallenge: pkce.codeChallenge,
  });
  res.redirect(303, authUrl);
});

/**
 * GET /oauth/callback — the redirect_uri Google calls back to.
 *
 * Validates `state`, exchanges the `code` for tokens, persists the
 * refresh token + the user's email on the integration row.
 */
oauthRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore || !ctx.oauthStateStore) {
    res.status(503).redirect(303, '/settings/integrations?error=OAuth+infrastructure+unavailable.');
    return;
  }

  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const errorParam = typeof req.query.error === 'string' ? req.query.error : '';
  const codeParam = typeof req.query.code === 'string' ? req.query.code : '';

  if (errorParam) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`OAuth denied: ${errorParam}`)}`);
    return;
  }
  if (!stateParam || !codeParam) {
    res.redirect(303, '/settings/integrations?error=Missing+state+or+code+on+callback.');
    return;
  }

  const flow = ctx.oauthStateStore.consume(stateParam);
  if (!flow) {
    res.redirect(303, '/settings/integrations?error=OAuth+flow+expired+or+state+unknown.+Try+Connect+again.');
    return;
  }

  const integration = ctx.integrationsStore.getIntegration(flow.integrationId);
  if (!integration) {
    res.redirect(303, '/settings/integrations?error=Integration+disappeared+mid-flow.');
    return;
  }

  // Re-resolve client credentials from the secrets store. Mirrors the
  // /connect handler so a credential rotation between consent and
  // callback surfaces here rather than at the token endpoint.
  const clientIdSecret = (integration.config.client_id_secret as string | undefined) ?? 'GMAIL_CLIENT_ID';
  const clientSecretSecret = (integration.config.client_secret_secret as string | undefined) ?? 'GMAIL_CLIENT_SECRET';
  let clientId: string;
  let clientSecret: string;
  try {
    const all = await ctx.secretsStore.getAll();
    clientId = all[clientIdSecret] ?? '';
    clientSecret = all[clientSecretSecret] ?? '';
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Could not read secrets store on callback: ${(err as Error).message}`)}`);
    return;
  }
  if (!clientId || !clientSecret) {
    res.redirect(303, '/settings/integrations?error=Client+credentials+disappeared+mid-flow.');
    return;
  }

  const redirectUri = computeRedirectUri(req);
  let tokens;
  try {
    tokens = await exchangeGoogleCode({
      clientId,
      clientSecret,
      code: codeParam,
      codeVerifier: flow.codeVerifier,
      redirectUri,
    });
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Token exchange failed: ${(err as Error).message}`)}`);
    return;
  }
  if (!tokens.refresh_token) {
    // We asked with prompt=consent so Google should always issue one
    // on a fresh consent. If not, the user likely consented before
    // with a different prompt; re-Connect with prompt=consent will fix it.
    res.redirect(303, '/settings/integrations?error=Google+did+not+return+a+refresh_token.+Try+Connect+again.');
    return;
  }

  // Persist the refresh token under a derived secret name.
  const refreshSecretName = refreshTokenSecretName(integration.id);
  try {
    await ctx.secretsStore.set(refreshSecretName, tokens.refresh_token);
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Could not persist refresh token: ${(err as Error).message}`)}`);
    return;
  }

  // Fetch the user's email so the UI can show "Connected as foo@bar.com".
  let email = '';
  try {
    const info = await fetchGoogleUserInfo(tokens.access_token);
    email = info.email ?? '';
  } catch { /* non-fatal — leave email blank */ }

  // Update the integration row: mark connected + remember the account
  // and refresh-token secret name (so notify handlers know what to read).
  const nextConfig: Record<string, unknown> = { ...integration.config };
  nextConfig.connected_account = email || nextConfig.connected_account || '';
  nextConfig.connected_at = Date.now();
  nextConfig.refresh_token_secret = refreshSecretName;
  const secretRefs = Array.from(new Set([
    ...integration.secretRefs,
    clientIdSecret,
    clientSecretSecret,
    refreshSecretName,
  ]));
  try {
    ctx.integrationsStore.upsertIntegration({
      id: integration.id,
      packId: integration.packId,
      kind: integration.kind,
      name: integration.name,
      config: nextConfig,
      secretRefs,
    });
  } catch (err) {
    res.redirect(303, `/settings/integrations?error=${encodeURIComponent(`Could not save integration: ${(err as Error).message}`)}`);
    return;
  }

  res.redirect(303, `${flow.returnTo}?flash=${encodeURIComponent(email ? `Connected as ${email}.` : 'Connected.')}`);
});

/**
 * POST /settings/integrations/:id/disconnect — clear the connected
 * state. Leaves the integration row but removes `connected_account`,
 * `connected_at`, and the refresh-token secret reference. The actual
 * refresh-token secret is also deleted from the encrypted store so a
 * stale token can't be used after the user explicitly disconnected.
 */
oauthRouter.post('/settings/integrations/:id/disconnect', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.integrationsStore) {
    res.redirect(303, '/settings/integrations?error=Integrations+store+unavailable.');
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const integration = ctx.integrationsStore.getIntegration(id);
  if (!integration) {
    res.redirect(303, '/settings/integrations?error=Integration+not+found.');
    return;
  }

  const refreshSecretName = (integration.config.refresh_token_secret as string | undefined)
    ?? refreshTokenSecretName(integration.id);
  try {
    await ctx.secretsStore.delete(refreshSecretName);
  } catch { /* missing is fine — disconnect should be idempotent */ }

  const nextConfig: Record<string, unknown> = { ...integration.config };
  delete nextConfig.connected_account;
  delete nextConfig.connected_at;
  delete nextConfig.refresh_token_secret;
  const secretRefs = integration.secretRefs.filter((s) => s !== refreshSecretName);
  ctx.integrationsStore.upsertIntegration({
    id: integration.id,
    packId: integration.packId,
    kind: integration.kind,
    name: integration.name,
    config: nextConfig,
    secretRefs,
  });
  res.redirect(303, `/settings/integrations?flash=${encodeURIComponent(`Disconnected ${integration.id}.`)}`);
});

/**
 * Build the absolute redirect_uri the user registered with Google. We
 * derive it from the request's host so loopback works in dev, in CI,
 * and behind a port-forwarded production deployment without needing
 * an env var.
 */
function computeRedirectUri(req: Request): string {
  // Express's req.protocol respects `app.set('trust proxy', true)`. Sua
  // doesn't, so over loopback this is always 'http'.
  const proto = req.protocol;
  const host = req.get('host') ?? `127.0.0.1:${process.env.SUA_DASHBOARD_PORT ?? '3000'}`;
  return `${proto}://${host}/oauth/callback`;
}
