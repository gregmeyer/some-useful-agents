import { MAX_QUESTIONS_PER_NODE } from './human-questions.js';
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
import { webFetch } from './web-fetch/index.js';
import { applyBoardChanges, BoardConflictError, type BoardItem } from './boards.js';
import { webScrape } from './web-fetch/scrape.js';

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

const memoryOff = (): ToolOutput => ({
  result: 'Memory is off for this agent (set memory: true on the agent to use it).',
  isError: true,
});

/** memory-save / memory-search / memory-forget — per agent; see memory-store.ts. */
const MEMORY_TOOLS: BuiltinToolEntry[] = [
  def(
    'memory-save',
    'Save to memory',
    'Remember something for future runs of this agent: a fact you found, a user preference, a result worth reusing. One idea per memory, stated so it makes sense on its own later. Pin what should always be recalled.',
    {
      text: { type: 'string', required: true, description: 'What to remember, as a self-contained sentence or two.' },
      tags: { type: 'string', description: 'Optional comma-separated tags.' },
      pinned: { type: 'boolean', description: 'Always recall this at the start of a run.' },
    },
    { id: { type: 'string', description: 'The memory id.' } },
    async (inputs, ctx) => {
      if (!ctx.memory) return memoryOff();
      const m = ctx.memory.store.save({
        agentId: ctx.memory.agentId,
        text: String(inputs.text ?? ''),
        tags: typeof inputs.tags === 'string' ? inputs.tags.split(',') : Array.isArray(inputs.tags) ? inputs.tags.map(String) : [],
        pinned: inputs.pinned === true || inputs.pinned === 'true',
        sourceRunId: ctx.memory.runId,
        secretValues: ctx.memory.secretValues,
      });
      return { id: m.id, result: `Saved memory ${m.id}${m.pinned ? ' (pinned)' : ''}.` };
    },
  ),
  def(
    'memory-search',
    'Search memory',
    "Look through this agent's memories from earlier runs for anything relevant to a query.",
    {
      query: { type: 'string', required: true, description: 'What you are looking for.' },
      limit: { type: 'number', description: 'Most results to return (default 5, max 20).' },
    },
    { memories: { type: 'array', description: 'Matching memories: {id, text, pinned, updatedAt}.' } },
    async (inputs, ctx) => {
      if (!ctx.memory) return memoryOff();
      const limit = Math.max(1, Math.min(20, Number(inputs.limit) || 5));
      const found = ctx.memory.store.search(ctx.memory.agentId, String(inputs.query ?? ''), limit);
      const memories = found.map((m) => ({ id: m.id, text: m.text, pinned: m.pinned, updatedAt: m.updatedAt }));
      return {
        memories,
        result: memories.length ? memories.map((m) => `[${m.id}] ${m.text}`).join('\n') : 'No matching memories.',
      };
    },
  ),
  def(
    'memory-forget',
    'Forget a memory',
    'Delete one of this agent\'s memories by id — use it when a memory is wrong or out of date (save the corrected version too).',
    { id: { type: 'string', required: true, description: 'The memory id, e.g. from the recall list or memory-search.' } },
    { forgotten: { type: 'boolean', description: 'True when a memory was deleted.' } },
    async (inputs, ctx) => {
      if (!ctx.memory) return memoryOff();
      const id = String(inputs.id ?? '').replace(/^\[|\]$/g, '');
      const ok = ctx.memory.store.forget(ctx.memory.agentId, id);
      return { forgotten: ok, result: ok ? `Forgot memory ${id}.` : `No memory ${id} for this agent.`, isError: !ok };
    },
  ),
];

const boardsOff = (): ToolOutput => ({ result: 'Boards are not available in this run.', isError: true });

/** Parse an array input that a model may send as JSON text. */
function arrayInput(v: unknown): unknown {
  const parse = (x: unknown) => { if (typeof x === 'string') { try { return JSON.parse(x); } catch { return x; } } return x; };
  const out = parse(v);
  // Some models send each change as its own JSON string.
  return Array.isArray(out) ? out.map(parse) : out;
}

function boardSummary(b: { id: string; name: string; version: number; items: BoardItem[] }): string {
  const lines = b.items.map((i) => {
    const what = i.kind === 'agent' ? `agent ${i.agentId}` : i.kind === 'system' ? `system ${i.tileId}` : `${i.kind} "${i.text.length > 40 ? `${i.text.slice(0, 40)}…` : i.text}"`;
    return `[${i.id}] ${what} at x=${i.x} y=${i.y}, ${i.w}x${i.h}`;
  });
  return `Board "${b.name}" (${b.id}), version ${b.version}, 12 columns, ${b.items.length} item${b.items.length === 1 ? '' : 's'}${lines.length ? `:\n${lines.join('\n')}` : ' (empty).'}`;
}

/** board-read / board-place — let an agent arrange Pulse or a named dashboard. See boards.ts. */
const BOARD_TOOLS: BuiltinToolEntry[] = [
  def(
    'board-read',
    'Read a board',
    'See how a board (Pulse or a named dashboard) is laid out: its items with their ids, positions and sizes on a 12-column grid. Leave board empty to list the boards you can arrange.',
    { board: { type: 'string', description: 'Board id: "pulse" or a dashboard id like "user:morning-briefing". Empty lists the boards.' } },
    {
      board: { type: 'object', description: 'The board: {id, name, version, items}.' },
      boards: { type: 'array', description: 'When listing: [{id, name, saved}].' },
    },
    async (inputs, ctx) => {
      if (!ctx.boards) return boardsOff();
      const id = String(inputs.board ?? '').trim();
      if (!id) {
        const boards = ctx.boards.listAll();
        return { boards, result: boards.map((b) => `${b.id} — ${b.name}`).join('\n') };
      }
      const b = ctx.boards.loadOrDerive(id);
      if (!b) return { result: `There's no board "${id}". Call board-read with no board to list them.`, isError: true };
      return { board: { id: b.id, name: b.name, version: b.version, items: b.items }, result: boardSummary(b) };
    },
  ),
  def(
    'board-place',
    'Arrange a board',
    'Add, move, resize or remove tiles on a board (Pulse or a named dashboard). The grid is 12 columns wide; rows are 40px; tiles never overlap and float up into gaps. Changes are saved as a new version the person can undo. Read the board first to get item ids.',
    {
      board: { type: 'string', required: true, description: 'Board id: "pulse" or a dashboard id.' },
      changes: {
        type: 'array',
        required: true,
        description: 'Changes in order. Each is one of: {"op":"add","kind":"agent","agentId":"…","size":"1x1|2x1|1x2|2x2"} (optionally x,y,w,h; without x/y it goes in the first free spot), {"op":"add","kind":"heading","text":"…"}, {"op":"add","kind":"note","text":"…"}, {"op":"move","id":"…","x":0,"y":0}, {"op":"resize","id":"…","w":6,"h":5}, {"op":"remove","id":"…"}. id is an item id from board-read (an agent id also works for agent tiles).',
      },
      version: { type: 'number', description: 'The version you read. If the board changed since, nothing is saved and you get the current version back.' },
    },
    { board: { type: 'object', description: 'The saved board: {id, name, version, items}.' } },
    async (inputs, ctx) => {
      if (!ctx.boards) return boardsOff();
      const id = String(inputs.board ?? '').trim();
      const current = ctx.boards.loadOrDerive(id);
      if (!current) return { result: `There's no board "${id}". Call board-read with no board to list them.`, isError: true };
      if (current.doc) return { result: `Nothing was changed: "${id}" is arranged as a canvas, which these tile changes can't edit yet. Ask the person to arrange it on its canvas page.`, isError: true };
      let items: BoardItem[];
      try {
        items = applyBoardChanges(current.items, arrayInput(inputs.changes));
      } catch (err) {
        const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues;
        const why = issues?.length ? issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message;
        return { result: `Nothing was changed: ${why}`, isError: true };
      }
      const missing = ctx.boards.missingAgents(items.flatMap((i) => (i.kind === 'agent' && !current.items.some((c) => c.kind === 'agent' && c.agentId === i.agentId) ? [i.agentId] : [])));
      if (missing.length) return { result: `Nothing was changed: no installed agent ${missing.map((m) => `"${m}"`).join(', ')}.`, isError: true };
      const version = typeof inputs.version === 'number' ? inputs.version : Number.isFinite(Number(inputs.version)) && inputs.version !== undefined && inputs.version !== '' ? Number(inputs.version) : current.version;
      try {
        const saved = ctx.boards.save({ id, name: current.name, packId: current.packId, items, expectedVersion: version });
        return { board: { id: saved.id, name: saved.name, version: saved.version, items: saved.items }, result: `Saved. ${boardSummary(saved)}` };
      } catch (err) {
        if (err instanceof BoardConflictError) return { result: `Nothing was changed: the board is now at version ${err.current}. Read it again and redo your changes.`, isError: true };
        return { result: `Nothing was changed: ${(err as Error).message}`, isError: true };
      }
    },
  ),
];

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
    'web-fetch',
    'Web fetch',
    'Fetch a public web page and return clean, readable text. Give it a URL; the tool handles HTTP, strips navigation/scripts/boilerplate, and (only if needed) renders the page in a headless browser. Use this whenever you need to read the contents of a web page.',
    {
      url: { type: 'string', description: 'Absolute http(s) URL of the page to read.', required: true },
      max_chars: { type: 'number', description: 'Max characters of content to return.', default: 30000 },
      timeout: { type: 'number', description: 'Per-attempt timeout in seconds.', default: 20 },
      browser: { type: 'string', description: "Browser fallback: 'auto' (default, escalate only if HTTP yields too little), 'never', or 'always'.", default: 'auto' },
    },
    {
      url: { type: 'string', description: 'Final URL after redirects.' },
      title: { type: 'string', description: 'Page title (null if unavailable).' },
      content: { type: 'string', description: 'Clean Markdown/plaintext content (null on failure).' },
      method: { type: 'string', description: "How it was retrieved: 'http' or 'browser'." },
      status: { type: 'number', description: 'HTTP status code (null if never fetched).' },
      truncated: { type: 'boolean', description: 'True if content was cut to max_chars.' },
      error: { type: 'string', description: 'Plain-English failure reason, or null on success.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      const browserRaw = String(inputs.browser ?? 'auto');
      const browser = browserRaw === 'never' || browserRaw === 'always' ? browserRaw : 'auto';
      const r = await webFetch(url, {
        maxChars: inputs.max_chars != null ? Number(inputs.max_chars) : undefined,
        timeoutSec: inputs.timeout != null ? Number(inputs.timeout) : undefined,
        browser,
      });
      // `result` is the node's stdout: the clean content, or the error so a
      // downstream text consumer (or small model) sees why it failed.
      return { ...r, result: r.content ?? (r.error ?? '') };
    },
  ),

  def(
    'web-scrape',
    'Web scrape',
    'Extract STRUCTURED data from a web page: JSON-LD (schema.org — products, offers, prices, articles), page metadata (title, og/meta tags), and optionally the raw HTML. Use this when you need data fields rather than readable prose (use web-fetch for prose). Renders the page in a headless browser only if needed.',
    {
      url: { type: 'string', description: 'Absolute http(s) URL to scrape.', required: true },
      render: { type: 'string', description: "Browser render: 'auto' (default, render if HTTP has no JSON-LD), 'never', or 'always'.", default: 'auto' },
      include_html: { type: 'boolean', description: 'Include the raw/rendered HTML in the result (capped). Default false.', default: false },
      max_html_chars: { type: 'number', description: 'Max characters of HTML to return when include_html is set.', default: 50000 },
    },
    {
      url: { type: 'string', description: 'Final URL after redirects.' },
      status: { type: 'number', description: 'HTTP status code (null if never fetched).' },
      method: { type: 'string', description: "How it was retrieved: 'http' or 'browser'." },
      json_ld: { type: 'array', description: 'Parsed JSON-LD objects found on the page.' },
      meta: { type: 'object', description: 'Title + og/meta tags as a flat map.' },
      html: { type: 'string', description: 'Raw/rendered HTML (null unless include_html).' },
      truncated: { type: 'boolean', description: 'True if html was cut to max_html_chars.' },
      error: { type: 'string', description: 'Plain-English failure reason, or null on success.' },
    },
    async (inputs) => {
      const url = String(inputs.url ?? '');
      const renderRaw = String(inputs.render ?? 'auto');
      const render = renderRaw === 'never' || renderRaw === 'always' ? renderRaw : 'auto';
      const r = await webScrape(url, {
        render,
        includeHtml: inputs.include_html === true || inputs.include_html === 'true',
        maxHtmlChars: inputs.max_html_chars != null ? Number(inputs.max_html_chars) : undefined,
      });
      // stdout: the structured payload as JSON when present, else html, else error.
      const result = r.json_ld.length > 0
        ? JSON.stringify(r.json_ld)
        : (r.html ?? r.error ?? JSON.stringify(r.meta));
      return { ...r, result };
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
BUILTINS.push(...MEMORY_TOOLS);
BUILTINS.push(...BOARD_TOOLS);

/**
 * ask-human — the model asks the person something mid-step. The question
 * goes to the inbox, this step stops, and the run waits; once answered, the
 * step starts again with the question and answer in front of it. See
 * human-questions.ts / docs/ask-a-person.md.
 */
BUILTINS.push(def(
  'ask-human',
  'Ask the person',
  'Ask the person you work for a question when you need a decision, an approval, or a fact only they have, and cannot sensibly go on without it. This step stops and waits for their answer (it may take hours); you will be started again with the answer. Offer choices when the answer is one of a few options. Do not use it for things you can find out yourself.',
  {
    question: { type: 'string', required: true, description: 'The question, self-contained: the person sees only this (and the agent name).' },
    choices: { type: 'string', description: 'Optional answers to offer as buttons, separated by " | " (e.g. "Yes | No").' },
  },
  { questionId: { type: 'string', description: 'The id of the recorded question.' } },
  async (inputs, ctx) => {
    const ask = ctx.askHuman;
    if (!ask) return { result: 'Asking the person is not available in this step.', isError: true };
    if (ask.unavailable) return { result: ask.unavailable, isError: true };
    const question = String(inputs.question ?? '').trim();
    if (!question) return { result: 'The question is empty.', isError: true };
    const earlier = ask.store.listForNode(ask.runId, ask.nodeId);
    // One question at a time: a second call in the same turn (models batch
    // tool calls) joins the question already waiting instead of adding one.
    const waiting = earlier.find((q) => q.status === 'pending');
    if (waiting) {
      ask.onAsked();
      return { questionId: waiting.id, result: 'A question is already waiting for the person\'s answer. Stop here and end your turn.' };
    }
    const asked = earlier.length;
    if (asked >= MAX_QUESTIONS_PER_NODE) {
      return { result: `You have already asked ${asked} questions in this step, the most allowed. Carry on with what you have.`, isError: true };
    }
    const choices = String(inputs.choices ?? '').split('|').map((c) => c.trim()).filter(Boolean).slice(0, 10).map((c) => c.slice(0, 80));
    const q = ask.store.ask({ runId: ask.runId, nodeId: ask.nodeId, agentId: ask.agentId, question: question.slice(0, 4000), choices });
    ask.onAsked();
    return {
      questionId: q.id,
      result: 'Your question has been sent to the person. Stop here and end your turn: this step pauses and will start again with their answer.',
    };
  },
));
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
