/**
 * Google OAuth + Gmail driver.
 *
 * - Builds the authorisation URL for the consent step.
 * - Exchanges the post-consent `code` for tokens.
 * - Refreshes an access token from a stored refresh token.
 * - Sends an email via the Gmail "users.messages.send" API.
 *
 * Trust model: sua does NOT ship a Google client_id / client_secret.
 * The user creates their own OAuth client in the Google Cloud console
 * ("Installed app" / "Desktop") and pastes the values into Settings →
 * Secrets. The integration row references those secret names. Refresh
 * tokens are written back to the secrets store under a name derived
 * from the integration id.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** Minimal scope to send mail as the user + read their email address. */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
];

export interface BuildAuthUrlArgs {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  /** 'offline' so Google returns a refresh_token on first consent. */
  accessType?: 'online' | 'offline';
  /** 'consent' forces re-consent each time — gives us a refresh_token even
   *  if the user previously consented without one. */
  prompt?: 'consent' | 'none' | 'select_account';
  loginHint?: string;
}

export function buildGoogleAuthUrl(args: BuildAuthUrlArgs): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scopes.join(' '),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    access_type: args.accessType ?? 'offline',
    prompt: args.prompt ?? 'consent',
    include_granted_scopes: 'true',
  });
  if (args.loginHint) params.set('login_hint', args.loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface TokenExchangeArgs {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleTokenResponse {
  access_token: string;
  /** Lifetime in seconds; typically 3600. */
  expires_in: number;
  /** Present on first consent with access_type=offline + prompt=consent. */
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
  id_token?: string;
}

export async function exchangeGoogleCode(args: TokenExchangeArgs): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code_verifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  });
  return doTokenPost(body, args.fetchImpl);
}

export interface RefreshArgs {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

export async function refreshGoogleToken(args: RefreshArgs): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
  });
  return doTokenPost(body, args.fetchImpl);
}

async function doTokenPost(body: URLSearchParams, fetchImpl?: typeof fetch): Promise<GoogleTokenResponse> {
  const fetchFn = fetchImpl ?? fetch;
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google token endpoint returned ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as GoogleTokenResponse;
  } catch {
    throw new Error(`Google token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export interface UserInfo {
  email?: string;
  name?: string;
  sub: string;
}

export async function fetchGoogleUserInfo(accessToken: string, fetchImpl?: typeof fetch): Promise<UserInfo> {
  const fetchFn = fetchImpl ?? fetch;
  const res = await fetchFn(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo returned ${res.status}`);
  }
  return res.json() as Promise<UserInfo>;
}

export interface SendGmailArgs {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  /** Optional From override — defaults to "me" (the authenticated account). */
  from?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Send an email via Gmail. Constructs an RFC 2822 message, base64url-
 * encodes it, and POSTs to the messages.send endpoint. Throws on any
 * non-2xx response so the dispatcher's per-handler try/catch logs +
 * skips.
 */
export async function sendGmail(args: SendGmailArgs): Promise<void> {
  const lines = [
    `To: ${args.to}`,
    args.from ? `From: ${args.from}` : '',
    `Subject: ${encodeRfc2047(args.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    args.body,
  ].filter(Boolean);
  const raw = Buffer.from(lines.join('\r\n'), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const fetchFn = args.fetchImpl ?? fetch;
  const res = await fetchFn(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail send returned ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * RFC 2047 "encoded-word" wrapper for non-ASCII subject lines. ASCII
 * subjects pass through unchanged so the test fixture stays readable.
 */
function encodeRfc2047(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = Buffer.from(s, 'utf-8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}
