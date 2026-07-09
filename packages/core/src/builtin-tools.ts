import { execSync, spawn, type ExecSyncOptions } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import type {
  ToolDefinition,
  ToolOutput,
  BuiltinToolEntry,
  BuiltinToolContext,
} from './tool-types.js';

/**
 * SSRF guard: resolve the hostname to an IP and reject private, loopback,
 * link-local, and cloud-metadata addresses before making an outbound request.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Resolve to IP (catches DNS rebind to private ranges)
  let ip: string;
  try {
    const result = await lookup(hostname);
    ip = result.address;
  } catch {
    throw new Error(`DNS lookup failed for ${hostname}`);
  }

  if (isPrivateIp(ip)) {
    throw new Error(
      `Blocked request to private/reserved IP ${ip} (resolved from ${hostname}). ` +
      `SSRF protection: only public addresses are allowed.`,
    );
  }
}

function isPrivateIp(ip: string): boolean {
  // IPv4
  if (ip.startsWith('127.')) return true;                // loopback
  if (ip.startsWith('10.')) return true;                 // RFC 1918
  if (ip.startsWith('192.168.')) return true;            // RFC 1918
  if (ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true;            // link-local / cloud metadata
  // 172.16.0.0/12
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6
  if (ip === '::1') return true;                         // loopback
  if (ip === '::') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local
  if (ip.startsWith('fe80')) return true;                // link-local

  return false;
}

/**
 * Built-in tool registry. Each entry provides a ToolDefinition (schema)
 * plus a Node-native execute function the executor calls directly —
 * no child process spawn needed for the hot path.
 *
 * Built-ins are always trusted (source: 'builtin'); the community-shell
 * gate doesn't apply.
 */

/**
 * Normalize a free-form `headers` tool input into the `Record<string, string>`
 * shape `fetch` expects. Accepts either an object literal from a templated
 * input (`{Accept: 'application/json'}`), a JSON string (when the tool input
 * arrives as serialized text from upstream nodes), or undefined. Drops
 * non-string values defensively — fetch will throw on those.
 */
function normalizeHeaders(raw: unknown): Record<string, string> {
  if (raw == null) return {};
  let obj: unknown = raw;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return {}; }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return out;
}

/** URL-safe base64 with no padding (for PKCE verifier/challenge). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Best-effort launch of the OS default browser. Non-fatal: OAuth still works
 * if the user opens the URL manually (it's also emitted to stderr).
 */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no browser / no opener — ignore
    child.unref();
  } catch {
    /* non-fatal */
  }
}

/**
 * Bind a one-shot loopback HTTP server on 127.0.0.1:<port>, wait for the OAuth
 * redirect at <redirectPath>, validate `state` (CSRF guard), and resolve with
 * the authorization code. Rejects on a provider `?error=`, a state mismatch, a
 * missing code, a bind failure, or timeout. The server is always closed before
 * the promise settles.
 */
function waitForOauthRedirect(opts: {
  port: number;
  redirectPath: string;
  expectedState: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    let settled = false;
    function done(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    }
    const respond = (res: import('node:http').ServerResponse, ok: boolean, msg: string): void => {
      res.statusCode = ok ? 200 : 400;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">` +
          `<h2>${ok ? 'Authorization complete' : 'Authorization failed'}</h2>` +
          `<p>${msg}</p><p style="color:#666">You can close this tab and return to the terminal.</p>` +
          `</body></html>`,
      );
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);
      if (url.pathname !== opts.redirectPath) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (err) {
        respond(res, false, `Provider returned error: ${err}`);
        done(() => rejectPromise(new Error(`OAuth provider returned error: ${err}`)));
        return;
      }
      if (state !== opts.expectedState) {
        respond(res, false, 'State mismatch — request ignored (possible CSRF).');
        done(() => rejectPromise(new Error('OAuth state mismatch — aborting (possible CSRF).')));
        return;
      }
      if (!code) {
        respond(res, false, 'No authorization code in the redirect.');
        done(() => rejectPromise(new Error('OAuth redirect missing the authorization code.')));
        return;
      }
      respond(res, true, 'Token exchange in progress.');
      done(() => resolvePromise(code));
    });
    const timer = setTimeout(() => {
      done(() =>
        rejectPromise(
          new Error(
            `Timed out after ${Math.round(opts.timeoutMs / 1000)}s waiting for the OAuth redirect on ` +
              `127.0.0.1:${opts.port}${opts.redirectPath}.`,
          ),
        ),
      );
    }, opts.timeoutMs);
    server.on('error', (e) =>
      done(() => rejectPromise(new Error(`Failed to bind loopback server on 127.0.0.1:${opts.port}: ${(e as Error).message}`))),
    );
    server.listen(opts.port, '127.0.0.1');
  });
}

function def(
  id: string,
  name: string,
  description: string,
  inputs: ToolDefinition['inputs'],
  outputs: ToolDefinition['outputs'],
  execute: BuiltinToolEntry['execute'],
): BuiltinToolEntry {
  return {
    definition: {
      id,
      name,
      description,
      source: 'builtin',
      inputs,
      outputs,
      implementation: { type: 'builtin', builtinName: id },
    },
    execute,
  };
}

const BUILTINS: BuiltinToolEntry[] = [
  def(
    'shell-exec',
    'Shell exec',
    'Run an arbitrary shell command. Backcompat tool for v0.15 type:shell nodes.',
    {
      command: { type: 'string', description: 'Shell command to execute.' },
    },
    {
      stdout: { type: 'string', description: 'Full stdout.' },
      stderr: { type: 'string', description: 'Full stderr.' },
      exit_code: { type: 'number', description: 'Process exit code.' },
      result: { type: 'string', description: 'Alias for stdout (v0.15 compat).' },
    },
    async (inputs, ctx) => {
      const command = String(inputs.command ?? '');
      const opts: ExecSyncOptions = {
        cwd: ctx.workingDirectory,
        env: { ...process.env, ...ctx.env },
        timeout: (ctx.timeout ?? 300) * 1000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      try {
        const stdout = execSync(command, opts) as unknown as string;
        return { stdout, stderr: '', exit_code: 0, result: stdout };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        const stdout = String(e.stdout ?? '');
        const stderr = String(e.stderr ?? '');
        return { stdout, stderr, exit_code: e.status ?? 1, result: stdout };
      }
    },
  ),

  def(
    'http-get',
    'HTTP GET',
    'Issue an HTTP GET and return the response. JSON bodies are auto-parsed.',
    {
      url: { type: 'string', description: 'Absolute URL to fetch.', required: true },
      timeout: { type: 'number', description: 'Timeout in seconds.', default: 30 },
      headers: {
        type: 'object',
        description: 'Optional request headers ({"Accept":"application/json","User-Agent":"…"}). Many APIs return HTML instead of JSON without an explicit Accept header.',
      },
    },
    {
      status: { type: 'number', description: 'HTTP status code.' },
      body: { type: 'json', description: 'Response body (JSON-decoded if applicable, else string).' },
      headers: { type: 'object', description: 'Response headers.' },
      duration_ms: { type: 'number', description: 'Request duration in milliseconds.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      await assertSafeUrl(url);
      const timeout = Number(inputs.timeout ?? 30) * 1000;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: normalizeHeaders(inputs.headers),
        });
        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        return {
          status: res.status,
          body,
          headers: Object.fromEntries(res.headers.entries()),
          duration_ms: Date.now() - start,
          result: typeof body === 'string' ? body : JSON.stringify(body),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  ),

  def(
    'http-post',
    'HTTP POST',
    'Issue an HTTP POST with a JSON body.',
    {
      url: { type: 'string', description: 'Absolute URL.', required: true },
      body: { type: 'json', description: 'Request body (JSON-encoded).' },
      timeout: { type: 'number', description: 'Timeout in seconds.', default: 30 },
      headers: {
        type: 'object',
        description: 'Optional request headers. Merged on top of the default Content-Type: application/json (caller can override).',
      },
    },
    {
      status: { type: 'number', description: 'HTTP status code.' },
      body: { type: 'json', description: 'Response body.' },
      headers: { type: 'object', description: 'Response headers.' },
      duration_ms: { type: 'number', description: 'Request duration in milliseconds.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      await assertSafeUrl(url);
      const timeout = Number(inputs.timeout ?? 30) * 1000;
      const reqBody = inputs.body !== undefined ? JSON.stringify(inputs.body) : undefined;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const customHeaders = normalizeHeaders(inputs.headers);
        const headers: Record<string, string> = {
          ...(reqBody ? { 'Content-Type': 'application/json' } : {}),
          ...customHeaders,
        };
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: reqBody,
          signal: controller.signal,
        });
        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }
        return {
          status: res.status,
          body,
          headers: Object.fromEntries(res.headers.entries()),
          duration_ms: Date.now() - start,
          result: typeof body === 'string' ? body : JSON.stringify(body),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  ),

  def(
    'file-read',
    'File read',
    'Read a file from the project directory.',
    {
      path: { type: 'string', description: 'Relative path within the project.', required: true },
    },
    {
      content: { type: 'string', description: 'File content as UTF-8.' },
      bytes: { type: 'number', description: 'File size in bytes.' },
      result: { type: 'string', description: 'Alias for content.' },
    },
    async (inputs, ctx) => {
      const cwd = ctx.workingDirectory ?? process.cwd();
      const filePath = resolve(cwd, String(inputs.path));
      if (!filePath.startsWith(resolve(cwd) + '/') && filePath !== resolve(cwd)) {
        throw new Error(`Path "${String(inputs.path)}" escapes the working directory.`);
      }
      const content = readFileSync(filePath, 'utf-8');
      return { content, bytes: Buffer.byteLength(content), result: content };
    },
  ),

  def(
    'file-write',
    'File write',
    'Write content to a file in the project directory. Optionally append.',
    {
      path: { type: 'string', description: 'Relative path within the project.', required: true },
      content: { type: 'string', description: 'Content to write.', required: true },
      append: { type: 'boolean', description: 'When true, append to the file instead of overwriting. Default false.' },
    },
    {
      bytes: { type: 'number', description: 'Bytes written.' },
      path: { type: 'string', description: 'Resolved file path.' },
      append: { type: 'boolean', description: 'Whether the write was an append.' },
      result: { type: 'string', description: 'Resolved file path.' },
    },
    async (inputs, ctx) => {
      const cwd = ctx.workingDirectory ?? process.cwd();
      const filePath = resolve(cwd, String(inputs.path));
      if (!filePath.startsWith(resolve(cwd) + '/') && filePath !== resolve(cwd)) {
        throw new Error(`Path "${String(inputs.path)}" escapes the working directory.`);
      }
      const content = String(inputs.content);
      const append = inputs.append === true;
      writeFileSync(filePath, content, { encoding: 'utf-8', flag: append ? 'a' : 'w' });
      return { bytes: Buffer.byteLength(content), path: filePath, append, result: filePath };
    },
  ),

  def(
    'json-parse',
    'JSON parse',
    'Parse a JSON string into a structured value.',
    {
      text: { type: 'string', description: 'JSON string to parse.', required: true },
    },
    {
      value: { type: 'json', description: 'Parsed value.' },
      result: { type: 'string', description: 'Re-serialized JSON.' },
    },
    async (inputs) => {
      const text = String(inputs.text ?? '');
      const value = JSON.parse(text);
      return { value, result: JSON.stringify(value) };
    },
  ),

  def(
    'json-path',
    'JSON path',
    'Extract a value from a JSON object using a dot-separated path.',
    {
      data: { type: 'json', description: 'Input object/array.', required: true },
      path: { type: 'string', description: 'Dot-separated path (e.g. "items.0.title").', required: true },
    },
    {
      value: { type: 'json', description: 'Extracted value.' },
      result: { type: 'string', description: 'Extracted value as string.' },
    },
    async (inputs) => {
      const data = inputs.data;
      const path = String(inputs.path ?? '');
      let current: unknown = data;
      for (const segment of path.split('.')) {
        if (current === null || current === undefined) break;
        if (typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment];
        } else {
          current = undefined;
        }
      }
      const str = current === undefined ? '' : typeof current === 'string' ? current : JSON.stringify(current);
      return { value: current, result: str };
    },
  ),

  def(
    'template',
    'Template',
    'Literal text with {{inputs.X}} interpolation. No side effects.',
    {
      text: { type: 'string', description: 'Template text.', required: true },
    },
    {
      result: { type: 'string', description: 'Interpolated text.' },
    },
    async (inputs) => {
      return { result: String(inputs.text ?? '') };
    },
  ),

  def(
    'csv-to-chart-json',
    'CSV → chart JSON',
    'Parse CSV into the shape modern-graphics-generate-graphic expects. "simple" shape → {labels,values}; "series" shape → {labels,series:[{name,values}]}; "cohort" shape → {cohorts:[{date,size,values}]}. First row is the header. Quoted fields and commas inside quotes are supported.',
    {
      csv: {
        type: 'string',
        description: 'Raw CSV text. Either csv or path is required.',
      },
      path: {
        type: 'string',
        description: 'Path to a CSV file (read relative to the run cwd). Used if csv is empty.',
      },
      shape: {
        type: 'string',
        description: '"simple" | "series" | "cohort". Default "simple".',
        default: 'simple',
      },
    },
    {
      data_json: { type: 'string', description: 'JSON string ready for generate_graphic.' },
      labels: { type: 'array', description: 'Parsed labels (simple/series shape).' },
      values: { type: 'array', description: 'Parsed values (simple shape).' },
      series: { type: 'array', description: 'Parsed series (series shape).' },
      cohorts: { type: 'array', description: 'Parsed cohorts (cohort shape).' },
      result: { type: 'string', description: 'Alias for data_json.' },
    },
    async (inputs, ctx) => {
      const csvRaw = String(inputs.csv ?? '');
      const path = String(inputs.path ?? '');
      const shape = String(inputs.shape ?? 'simple');

      let text = csvRaw;
      if (!text && path) {
        const { readFileSync } = await import('node:fs');
        const { resolve, isAbsolute, join } = await import('node:path');
        const abs = isAbsolute(path) ? path : resolve(join(ctx.workingDirectory ?? process.cwd(), path));
        text = readFileSync(abs, 'utf-8');
      }
      if (!text.trim()) {
        throw new Error('csv-to-chart-json: provide non-empty `csv` or a readable `path`.');
      }

      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error('csv-to-chart-json: CSV must have a header row plus at least one data row.');
      }
      const header = rows[0];
      const body = rows.slice(1);

      if (shape === 'simple') {
        // First column → labels, second column → values (numeric).
        if (header.length < 2) throw new Error('simple shape: need at least 2 columns (label,value).');
        const labels = body.map((r) => r[0] ?? '');
        const values = body.map((r) => toNumber(r[1], header[1]));
        const data = { labels, values };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      if (shape === 'series') {
        // First column → labels, remaining columns → series (header row = series names).
        if (header.length < 2) throw new Error('series shape: need at least 2 columns (label + one series).');
        const labels = body.map((r) => r[0] ?? '');
        const series = header.slice(1).map((name, i) => ({
          name,
          values: body.map((r) => toNumber(r[i + 1], name)),
        }));
        const data = { labels, series };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      if (shape === 'cohort') {
        // Columns: date,size,value_0,value_1,...
        if (header.length < 3) throw new Error('cohort shape: need at least 3 columns (date,size,value0,...).');
        const cohorts = body.map((r) => ({
          date: r[0] ?? '',
          size: toNumber(r[1], header[1]),
          values: r.slice(2).map((v, i) => toNumber(v, header[i + 2])),
        }));
        const data = { cohorts };
        return { ...data, data_json: JSON.stringify(data), result: JSON.stringify(data) };
      }

      throw new Error(`csv-to-chart-json: unknown shape "${shape}". Use simple | series | cohort.`);
    },
  ),

  def(
    'oauth-loopback',
    'OAuth loopback',
    'One-time OAuth2 authorization-code flow over a local 127.0.0.1 redirect. Opens the ' +
      'provider consent screen, captures the redirect on a throwaway loopback server, exchanges ' +
      'the code for tokens, and writes the refresh (and/or access) token straight into the ' +
      'secrets vault. Client id/secret are read from the node\'s declared secrets (via env). ' +
      'Tokens are NEVER returned in the output — set save_refresh_token_to to persist one.',
    {
      authorize_url: { type: 'string', description: 'Provider authorization endpoint (e.g. https://accounts.spotify.com/authorize).', required: true },
      token_url: { type: 'string', description: 'Provider token endpoint (e.g. https://accounts.spotify.com/api/token).', required: true },
      client_id_env: { type: 'string', description: 'Name of the declared secret / env var holding the OAuth client id.', default: 'CLIENT_ID' },
      client_secret_env: { type: 'string', description: 'Name of the declared secret / env var holding the client secret. Optional for PKCE-only providers.', default: 'CLIENT_SECRET' },
      scopes: { type: 'string', description: 'Space-separated OAuth scopes.', default: '' },
      port: { type: 'number', description: 'Loopback port to bind. redirect_uri = http://127.0.0.1:<port><redirect_path>.', default: 8888 },
      redirect_path: { type: 'string', description: 'Path the provider redirects back to.', default: '/callback' },
      save_refresh_token_to: { type: 'string', description: 'Secret name to persist the refresh token into. Required to capture a refresh token (never returned in output).' },
      save_access_token_to: { type: 'string', description: 'Optional secret name to persist the access token into.' },
      use_pkce: { type: 'boolean', description: 'Add a PKCE (S256) challenge/verifier. Enable for public clients / PKCE-only providers.', default: false },
      open_browser: { type: 'boolean', description: 'Attempt to open the authorize URL in the default browser.', default: true },
      timeout: { type: 'number', description: 'Seconds to wait for the redirect before giving up.', default: 300 },
      extra_authorize_params: { type: 'object', description: 'Extra query params appended to the authorize URL (e.g. {"show_dialog":"true"}).' },
    },
    {
      saved_to: { type: 'array', description: 'Secret names written to the vault.', items: { type: 'string' } },
      has_refresh_token: { type: 'boolean', description: 'Whether the provider returned a refresh token.' },
      expires_in: { type: 'number', description: 'Access-token lifetime in seconds, if returned.' },
      scope: { type: 'string', description: 'Granted scopes, if returned.' },
      token_type: { type: 'string', description: 'Token type, if returned (e.g. Bearer).' },
      authorize_url_used: { type: 'string', description: 'The full authorize URL that was opened.' },
      result: { type: 'string', description: 'Human-readable summary. Contains no token values.' },
    },
    async (inputs, ctx) => {
      const authorizeUrl = String(inputs.authorize_url ?? '');
      const tokenUrl = String(inputs.token_url ?? '');
      if (!authorizeUrl || !tokenUrl) {
        throw new Error('oauth-loopback: authorize_url and token_url are required.');
      }

      const clientIdEnv = String(inputs.client_id_env ?? 'CLIENT_ID');
      const clientSecretEnv = String(inputs.client_secret_env ?? 'CLIENT_SECRET');
      const env = ctx.env ?? {};
      const clientId = env[clientIdEnv];
      if (!clientId) {
        throw new Error(
          `oauth-loopback: client id not found in env var "${clientIdEnv}". Add it to the node's ` +
            `secrets: [${clientIdEnv}] and set the value under Settings → Secrets.`,
        );
      }
      const clientSecret = env[clientSecretEnv] || undefined;

      const saveRefreshTo = String(inputs.save_refresh_token_to ?? '').trim();
      const saveAccessTo = String(inputs.save_access_token_to ?? '').trim();
      if (!saveRefreshTo && !saveAccessTo) {
        throw new Error(
          'oauth-loopback: set save_refresh_token_to (and/or save_access_token_to). The tool never ' +
            'returns raw tokens in its output — it only writes them to the encrypted secrets vault.',
        );
      }
      if (!ctx.secretsStore) {
        throw new Error('oauth-loopback: no secrets store is available in this context — cannot persist the token.');
      }

      const port = Number(inputs.port ?? 8888);
      const redirectPath = String(inputs.redirect_path ?? '/callback');
      const redirectUri = `http://127.0.0.1:${port}${redirectPath}`;
      const scopes = String(inputs.scopes ?? '');
      const usePkce = inputs.use_pkce === true || inputs.use_pkce === 'true';
      const openBrowserFlag = inputs.open_browser !== false && inputs.open_browser !== 'false';
      const timeoutMs = Number(inputs.timeout ?? 300) * 1000;

      // authorize/token URLs must be public (SSRF hygiene). The loopback we bind
      // is a server we own, not a fetched URL, so it isn't subject to this check.
      await assertSafeUrl(authorizeUrl);
      await assertSafeUrl(tokenUrl);

      const state = randomBytes(16).toString('hex');
      let codeVerifier: string | undefined;
      let codeChallenge: string | undefined;
      if (usePkce) {
        codeVerifier = base64url(randomBytes(32));
        codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
      }

      const authUrl = new URL(authorizeUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      if (scopes) authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('state', state);
      if (usePkce && codeChallenge) {
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
      }
      for (const [k, v] of Object.entries(normalizeHeaders(inputs.extra_authorize_params))) {
        authUrl.searchParams.set(k, v);
      }
      const authorizeUrlUsed = authUrl.toString();

      // Surface the URL (contains client_id + state, no secrets) and optionally open it.
      process.stderr.write(`\n[oauth-loopback] Open this URL to authorize:\n${authorizeUrlUsed}\n\n`);
      if (openBrowserFlag) openBrowser(authorizeUrlUsed);

      const code = await waitForOauthRedirect({ port, redirectPath, expectedState: state, timeoutMs });

      // Exchange the code for tokens.
      const form = new URLSearchParams();
      form.set('grant_type', 'authorization_code');
      form.set('code', code);
      form.set('redirect_uri', redirectUri);
      form.set('client_id', clientId);
      if (clientSecret) form.set('client_secret', clientSecret);
      if (usePkce && codeVerifier) form.set('code_verifier', codeVerifier);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let tokenJson: Record<string, unknown>;
      try {
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: form.toString(),
          signal: controller.signal,
        });
        const text = await res.text();
        try { tokenJson = JSON.parse(text) as Record<string, unknown>; } catch { tokenJson = { raw: text }; }
        if (!res.ok) {
          const errCode = String(tokenJson.error ?? '');
          const errDesc = String(tokenJson.error_description ?? text);
          throw new Error(`oauth-loopback: token exchange failed (${res.status}): ${errCode} ${errDesc}`.trim());
        }
      } finally {
        clearTimeout(timer);
      }

      const refreshToken = typeof tokenJson.refresh_token === 'string' ? tokenJson.refresh_token : '';
      const accessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : '';

      const savedTo: string[] = [];
      if (saveRefreshTo && refreshToken) {
        await ctx.secretsStore.set(saveRefreshTo, refreshToken);
        savedTo.push(saveRefreshTo);
      }
      if (saveAccessTo && accessToken) {
        await ctx.secretsStore.set(saveAccessTo, accessToken);
        savedTo.push(saveAccessTo);
      }

      let summary: string;
      if (saveRefreshTo && !refreshToken) {
        summary =
          `Authorized, but the provider returned no refresh token, so ${saveRefreshTo} was not written. ` +
          `Some providers only issue one on first consent — try adding show_dialog/prompt to extra_authorize_params.`;
      } else if (savedTo.length) {
        summary = `Authorized. Saved ${savedTo.join(', ')} to the secrets vault.`;
      } else {
        summary = 'Authorized, but no tokens matched the configured save targets.';
      }

      return {
        saved_to: savedTo,
        has_refresh_token: Boolean(refreshToken),
        expires_in: Number(tokenJson.expires_in ?? 0),
        scope: String(tokenJson.scope ?? scopes),
        token_type: String(tokenJson.token_type ?? ''),
        authorize_url_used: authorizeUrlUsed,
        result: summary,
      };
    },
  ),
];

function toNumber(raw: string | undefined, column: string): number {
  const v = Number(String(raw ?? '').trim());
  if (Number.isNaN(v)) throw new Error(`csv-to-chart-json: "${raw}" in column "${column}" is not a number.`);
  return v;
}

/**
 * Minimal CSV parser. Supports double-quoted fields and escaped quotes ("")
 * inside quoted fields. Does NOT support multi-line quoted fields.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(parseCsvLine(line));
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"' && cur === '') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const REGISTRY = new Map<string, BuiltinToolEntry>();
for (const entry of BUILTINS) {
  REGISTRY.set(entry.definition.id, entry);
}

export function getBuiltinTool(id: string): BuiltinToolEntry | undefined {
  return REGISTRY.get(id);
}

export function listBuiltinTools(): ToolDefinition[] {
  return BUILTINS.map((e) => e.definition);
}

export function isBuiltinTool(id: string): boolean {
  return REGISTRY.has(id);
}
