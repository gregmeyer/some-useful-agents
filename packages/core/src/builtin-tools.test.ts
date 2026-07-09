import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';
import { getBuiltinTool, listBuiltinTools, isBuiltinTool, assertSafeUrl } from './builtin-tools.js';
import { MemorySecretsStore } from './secrets-store.js';

describe('Builtin tool registry', () => {
  it('lists all 10 built-in tools', () => {
    const tools = listBuiltinTools();
    expect(tools.length).toBe(10);
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      'csv-to-chart-json', 'file-read', 'file-write', 'http-get',
      'http-post', 'json-parse', 'json-path', 'oauth-loopback',
      'shell-exec', 'template',
    ]);
  });

  it('retrieves shell-exec by id', () => {
    const entry = getBuiltinTool('shell-exec');
    expect(entry).toBeDefined();
    expect(entry!.definition.source).toBe('builtin');
    expect(entry!.definition.implementation.type).toBe('builtin');
  });

  it('isBuiltinTool returns true for known ids', () => {
    expect(isBuiltinTool('shell-exec')).toBe(true);
    expect(isBuiltinTool('http-get')).toBe(true);
  });

  it('claude-code was removed in v0.21 — use type: llm-prompt instead', () => {
    expect(isBuiltinTool('claude-code')).toBe(false);
    expect(getBuiltinTool('claude-code')).toBeUndefined();
  });

  it('isBuiltinTool returns false for unknown ids', () => {
    expect(isBuiltinTool('not-a-tool')).toBe(false);
  });

  it('shell-exec executes a simple command', async () => {
    const entry = getBuiltinTool('shell-exec')!;
    const result = await entry.execute({ command: 'echo hello-tools' }, {});
    expect(result.stdout).toContain('hello-tools');
    expect(result.exit_code).toBe(0);
    expect(result.result).toContain('hello-tools');
  });

  it('json-parse parses valid JSON', async () => {
    const entry = getBuiltinTool('json-parse')!;
    const result = await entry.execute({ text: '{"a":1}' }, {});
    expect(result.value).toEqual({ a: 1 });
    expect(result.result).toBe('{"a":1}');
  });

  it('json-path extracts a nested value', async () => {
    const entry = getBuiltinTool('json-path')!;
    const result = await entry.execute({
      data: { items: [{ title: 'hello' }] },
      path: 'items.0.title',
    }, {});
    expect(result.value).toBe('hello');
    expect(result.result).toBe('hello');
  });

  it('template returns the text as-is', async () => {
    const entry = getBuiltinTool('template')!;
    const result = await entry.execute({ text: 'Hello {{name}}' }, {});
    expect(result.result).toBe('Hello {{name}}');
  });

  it('file-read reads a file', async () => {
    const entry = getBuiltinTool('file-read')!;
    const result = await entry.execute({ path: 'package.json' }, {});
    expect(result.content).toContain('some-useful-agents');
    expect(result.bytes).toBeGreaterThan(0);
  });

  describe('file-write', () => {
    let tmp: string;
    beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sua-fw-')); });
    afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

    it('writes content to a file (overwrite default)', async () => {
      const entry = getBuiltinTool('file-write')!;
      const result = await entry.execute(
        { path: 'out.txt', content: 'hello' },
        { workingDirectory: tmp },
      );
      expect(result.bytes).toBe(5);
      expect(result.append).toBe(false);
      expect(readFileSync(join(tmp, 'out.txt'), 'utf-8')).toBe('hello');
    });

    it('overwrites by default on second write', async () => {
      const entry = getBuiltinTool('file-write')!;
      await entry.execute({ path: 'out.txt', content: 'first' }, { workingDirectory: tmp });
      await entry.execute({ path: 'out.txt', content: 'second' }, { workingDirectory: tmp });
      expect(readFileSync(join(tmp, 'out.txt'), 'utf-8')).toBe('second');
    });

    it('appends when append: true', async () => {
      const entry = getBuiltinTool('file-write')!;
      await entry.execute({ path: 'log.txt', content: 'one\n' }, { workingDirectory: tmp });
      const result = await entry.execute(
        { path: 'log.txt', content: 'two\n', append: true },
        { workingDirectory: tmp },
      );
      expect(result.append).toBe(true);
      expect(readFileSync(join(tmp, 'log.txt'), 'utf-8')).toBe('one\ntwo\n');
    });

    it('refuses paths that escape the working directory', async () => {
      const entry = getBuiltinTool('file-write')!;
      await expect(
        entry.execute({ path: '../escape.txt', content: 'x' }, { workingDirectory: tmp }),
      ).rejects.toThrow(/escapes the working directory/);
    });
  });

  it('http-get fetches a URL (skipped without network)', async () => {
    // This test validates the function shape; real HTTP is tested in
    // integration. We just check it doesn't throw on construction.
    const entry = getBuiltinTool('http-get')!;
    expect(entry.definition.inputs.url.required).toBe(true);
    expect(entry.definition.outputs.status.type).toBe('number');
  });

  describe('http-get / http-post headers passthrough', () => {
    let originalFetch: typeof fetch;
    let captured: { url: string; init?: RequestInit }[];

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      captured = [];
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        captured.push({ url: String(url), init });
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('http-get sends the supplied headers on the request', async () => {
      const entry = getBuiltinTool('http-get')!;
      // Use a public-DNS-shaped URL that passes assertSafeUrl. The fetch
      // is mocked so no real network call goes out.
      await entry.execute({
        url: 'https://example.com/',
        headers: { Accept: 'application/json', 'User-Agent': 'sua-test' },
      }, {});
      expect(captured).toHaveLength(1);
      const sent = captured[0].init?.headers as Record<string, string>;
      expect(sent.Accept).toBe('application/json');
      expect(sent['User-Agent']).toBe('sua-test');
    });

    it('http-get tolerates JSON-string-shaped headers (templated upstream)', async () => {
      const entry = getBuiltinTool('http-get')!;
      await entry.execute({
        url: 'https://example.com/',
        headers: '{"Accept":"text/html"}',
      }, {});
      const sent = captured[0].init?.headers as Record<string, string>;
      expect(sent.Accept).toBe('text/html');
    });

    it('http-get drops non-string header values defensively', async () => {
      const entry = getBuiltinTool('http-get')!;
      await entry.execute({
        url: 'https://example.com/',
        headers: { Accept: 'application/json', BadValue: 42 as unknown as string },
      }, {});
      const sent = captured[0].init?.headers as Record<string, string>;
      expect(sent.Accept).toBe('application/json');
      expect(sent.BadValue).toBeUndefined();
    });

    it('http-post merges custom headers on top of default Content-Type', async () => {
      const entry = getBuiltinTool('http-post')!;
      await entry.execute({
        url: 'https://example.com/',
        body: { hello: 'world' },
        headers: { Authorization: 'Bearer x', Accept: 'application/vnd.api+json' },
      }, {});
      const sent = captured[0].init?.headers as Record<string, string>;
      expect(sent['Content-Type']).toBe('application/json');
      expect(sent.Authorization).toBe('Bearer x');
      expect(sent.Accept).toBe('application/vnd.api+json');
    });

    it('http-post lets the caller override Content-Type', async () => {
      const entry = getBuiltinTool('http-post')!;
      await entry.execute({
        url: 'https://example.com/',
        body: { hello: 'world' },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, {});
      const sent = captured[0].init?.headers as Record<string, string>;
      expect(sent['Content-Type']).toBe('application/x-www-form-urlencoded');
    });
  });
});

describe('assertSafeUrl (SSRF guard)', () => {
  it('rejects non-HTTP schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow('Blocked URL scheme');
    await expect(assertSafeUrl('ftp://example.com')).rejects.toThrow('Blocked URL scheme');
  });

  it('rejects invalid URLs', async () => {
    await expect(assertSafeUrl('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects loopback addresses', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/secret')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://127.0.0.2:8080')).rejects.toThrow('private/reserved');
  });

  it('rejects RFC 1918 private ranges', async () => {
    await expect(assertSafeUrl('http://10.0.0.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://172.31.255.255/')).rejects.toThrow('private/reserved');
  });

  it('rejects link-local / cloud metadata (169.254.x.x)', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('private/reserved');
  });

  it('rejects 0.0.0.0', async () => {
    await expect(assertSafeUrl('http://0.0.0.0/')).rejects.toThrow('private/reserved');
  });

  it('allows public URLs (dns must resolve)', async () => {
    // example.com is IANA-reserved and resolves to a public IP
    await expect(assertSafeUrl('https://example.com')).resolves.toBeUndefined();
  });

  it('rejects localhost by name', async () => {
    await expect(assertSafeUrl('http://localhost:3000')).rejects.toThrow('private/reserved');
  });
});

describe('csv-to-chart-json', () => {
  const run = async (inputs: Record<string, unknown>) => {
    const tool = getBuiltinTool('csv-to-chart-json')!;
    return tool.execute(inputs, {});
  };

  it('parses simple shape (labels + values)', async () => {
    const out = await run({
      csv: 'month,revenue\nJan,100\nFeb,150\nMar,180',
      shape: 'simple',
    });
    expect(out.labels).toEqual(['Jan', 'Feb', 'Mar']);
    expect(out.values).toEqual([100, 150, 180]);
    expect(JSON.parse(String(out.data_json))).toEqual({ labels: ['Jan', 'Feb', 'Mar'], values: [100, 150, 180] });
  });

  it('parses series shape (labels + named series)', async () => {
    const out = await run({
      csv: 'quarter,org,paid\nQ1,10,5\nQ2,20,8\nQ3,35,14',
      shape: 'series',
    });
    expect(out.labels).toEqual(['Q1', 'Q2', 'Q3']);
    expect(out.series).toEqual([
      { name: 'org', values: [10, 20, 35] },
      { name: 'paid', values: [5, 8, 14] },
    ]);
  });

  it('parses cohort shape', async () => {
    const out = await run({
      csv: 'date,size,m1,m2\nSep 17,7262,95.6,33.5\nOct 17,8100,94.2,31.0',
      shape: 'cohort',
    });
    expect(out.cohorts).toEqual([
      { date: 'Sep 17', size: 7262, values: [95.6, 33.5] },
      { date: 'Oct 17', size: 8100, values: [94.2, 31.0] },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', async () => {
    const out = await run({
      csv: 'label,value\n"Jones, Inc.",42\n"Smith ""Co""",7',
      shape: 'simple',
    });
    expect(out.labels).toEqual(['Jones, Inc.', 'Smith "Co"']);
    expect(out.values).toEqual([42, 7]);
  });

  it('throws on non-numeric values', async () => {
    await expect(run({
      csv: 'label,value\nA,not-a-number',
      shape: 'simple',
    })).rejects.toThrow(/not a number/);
  });

  it('throws on empty input', async () => {
    await expect(run({ csv: '', shape: 'simple' })).rejects.toThrow(/non-empty/);
  });

  it('throws on unknown shape', async () => {
    await expect(run({ csv: 'a,b\n1,2', shape: 'bogus' })).rejects.toThrow(/unknown shape/);
  });
});

describe('oauth-loopback', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // Poll a producer until it yields a defined value (server startup / stderr race).
  async function pollFor<T>(fn: () => T | undefined, tries = 150, delayMs = 20): Promise<T> {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v !== undefined) return v;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error('pollFor: condition never became defined');
  }

  // Hit the tool's loopback redirect via raw node http (NOT the stubbed fetch),
  // retrying until the throwaway server is listening.
  function fireRedirect(port: number, path: string, params: Record<string, string>): Promise<void> {
    const qs = new URLSearchParams(params).toString();
    return new Promise<void>((res, rej) => {
      const attempt = (n: number): void => {
        const req = httpGet({ host: '127.0.0.1', port, path: `${path}?${qs}` }, (r) => {
          r.resume();
          r.on('end', () => res());
        });
        req.on('error', (e) => {
          if (n > 0) setTimeout(() => attempt(n - 1), 40);
          else rej(e);
        });
      };
      attempt(60); // ~2.4s of retries
    });
  }

  // Capture the authorize URL the tool prints to stderr so the test can learn
  // the internally-generated `state` and echo it back on the redirect.
  function spyStderrForAuthUrl(): { getUrl: () => string | undefined; restore: () => void } {
    const orig = process.stderr.write.bind(process.stderr);
    let seen: string | undefined;
    (process.stderr as unknown as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]): boolean => {
      const s = String(chunk);
      const m = s.match(/https?:\/\/\S+/);
      if (m && s.includes('authorize')) seen = m[0];
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    };
    return { getUrl: () => seen, restore: () => { (process.stderr as unknown as { write: unknown }).write = orig; } };
  }

  it('runs the auth-code flow, exchanges the code, and persists the refresh token to the vault', async () => {
    let tokenReqBody: string | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      tokenReqBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({ access_token: 'AT-xyz', refresh_token: 'RT-123', expires_in: 3600, scope: 'playlist-modify-public', token_type: 'Bearer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const store = new MemorySecretsStore();
    const entry = getBuiltinTool('oauth-loopback')!;
    const port = 8899;
    const spy = spyStderrForAuthUrl();
    try {
      const runP = entry.execute(
        {
          authorize_url: 'https://example.com/authorize',
          token_url: 'https://example.com/token',
          client_id_env: 'SPOTIFY_CLIENT_ID',
          client_secret_env: 'SPOTIFY_CLIENT_SECRET',
          scopes: 'playlist-modify-public',
          port,
          save_refresh_token_to: 'SPOTIFY_REFRESH_TOKEN',
          open_browser: false,
          timeout: 15,
        },
        { env: { SPOTIFY_CLIENT_ID: 'cid', SPOTIFY_CLIENT_SECRET: 'csec' }, secretsStore: store },
      );

      const state = await pollFor(() => {
        const u = spy.getUrl();
        return u ? new URL(u).searchParams.get('state') ?? undefined : undefined;
      });
      await fireRedirect(port, '/callback', { code: 'AUTHCODE', state });
      const out = await runP;

      expect(out.has_refresh_token).toBe(true);
      expect(out.saved_to).toEqual(['SPOTIFY_REFRESH_TOKEN']);
      expect(out.token_type).toBe('Bearer');
      expect(await store.get('SPOTIFY_REFRESH_TOKEN')).toBe('RT-123');
      // Tokens must never leak into the tool's structured output (goes to runs.db).
      expect(JSON.stringify(out)).not.toContain('RT-123');
      expect(JSON.stringify(out)).not.toContain('AT-xyz');
      // The exchange used the auth-code grant with the captured code + client creds.
      expect(tokenReqBody).toContain('grant_type=authorization_code');
      expect(tokenReqBody).toContain('code=AUTHCODE');
      expect(tokenReqBody).toContain('client_id=cid');
      expect(tokenReqBody).toContain('client_secret=csec');
    } finally {
      spy.restore();
    }
  });

  it('rejects a redirect whose state does not match (CSRF guard)', async () => {
    const store = new MemorySecretsStore();
    const entry = getBuiltinTool('oauth-loopback')!;
    const port = 8898;
    const spy = spyStderrForAuthUrl();
    try {
      const runP = entry.execute(
        {
          authorize_url: 'https://example.com/authorize',
          token_url: 'https://example.com/token',
          client_id_env: 'SPOTIFY_CLIENT_ID',
          port,
          save_refresh_token_to: 'SPOTIFY_REFRESH_TOKEN',
          open_browser: false,
          timeout: 15,
        },
        { env: { SPOTIFY_CLIENT_ID: 'cid' }, secretsStore: store },
      );
      await pollFor(() => (spy.getUrl() ? true : undefined));
      // Attach the rejection handler BEFORE triggering it, so there's no
      // unhandled-rejection window between fireRedirect and the assertion.
      const rejection = expect(runP).rejects.toThrow(/state mismatch/i);
      await fireRedirect(port, '/callback', { code: 'AUTHCODE', state: 'WRONG' });
      await rejection;
      expect(await store.get('SPOTIFY_REFRESH_TOKEN')).toBeUndefined();
    } finally {
      spy.restore();
    }
  });

  it('refuses to run without a save target (never returns raw tokens)', async () => {
    const entry = getBuiltinTool('oauth-loopback')!;
    await expect(
      entry.execute(
        { authorize_url: 'https://example.com/authorize', token_url: 'https://example.com/token', client_id_env: 'CID', open_browser: false },
        { env: { CID: 'cid' }, secretsStore: new MemorySecretsStore() },
      ),
    ).rejects.toThrow(/save_refresh_token_to/);
  });

  it('errors when the client id secret is missing from env', async () => {
    const entry = getBuiltinTool('oauth-loopback')!;
    await expect(
      entry.execute(
        { authorize_url: 'https://example.com/authorize', token_url: 'https://example.com/token', client_id_env: 'SPOTIFY_CLIENT_ID', save_refresh_token_to: 'X', open_browser: false },
        { env: {}, secretsStore: new MemorySecretsStore() },
      ),
    ).rejects.toThrow(/client id not found/i);
  });
});
