import { describe, it, expect } from 'vitest';
import { normalizeAgentUrl, fetchYaml } from './registry.js';

describe('normalizeAgentUrl', () => {
  it('rewrites GitHub /blob/<branch>/<path> URLs to raw.githubusercontent.com', () => {
    const out = normalizeAgentUrl(
      'https://github.com/some-org/sua-agents/blob/main/weekly-digest.yaml',
    );
    expect(out).toBe(
      'https://raw.githubusercontent.com/some-org/sua-agents/main/weekly-digest.yaml',
    );
  });

  it('rewrites GitHub /raw/<branch>/<path> URLs to raw host', () => {
    const out = normalizeAgentUrl(
      'https://github.com/some-org/sua-agents/raw/main/agents/foo.yaml',
    );
    expect(out).toBe(
      'https://raw.githubusercontent.com/some-org/sua-agents/main/agents/foo.yaml',
    );
  });

  it('rejects bare GitHub repo URLs (no /blob/ path)', () => {
    expect(() =>
      normalizeAgentUrl('https://github.com/some-org/sua-agents'),
    ).toThrow(/must point at a file/);
  });

  it('rewrites gist.github.com URLs to gist.githubusercontent.com /raw', () => {
    const out = normalizeAgentUrl('https://gist.github.com/alice/abc123');
    expect(out).toBe('https://gist.githubusercontent.com/alice/abc123/raw');
  });

  it('keeps gist URLs that already include /raw', () => {
    const url = 'https://gist.github.com/alice/abc123/raw/rev42/agent.yaml';
    expect(normalizeAgentUrl(url)).toBe(url);
  });

  it('passes plain HTTPS URLs through unchanged', () => {
    const url = 'https://example.com/agents/foo.yaml';
    expect(normalizeAgentUrl(url)).toBe(url);
  });

  it('rejects file: and other unsupported schemes', () => {
    expect(() => normalizeAgentUrl('file:///etc/passwd')).toThrow(/Unsupported URL scheme/);
  });

  it('rejects malformed URLs', () => {
    expect(() => normalizeAgentUrl('not a url')).toThrow(/Invalid URL/);
  });
});

describe('fetchYaml', () => {
  function makeFetch(body: string, opts: { status?: number; contentLength?: number } = {}): typeof fetch {
    return (async () => {
      const buf = Buffer.from(body, 'utf-8');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buf);
          controller.close();
        },
      });
      const headers = new Headers();
      if (opts.contentLength !== undefined) {
        headers.set('content-length', String(opts.contentLength));
      }
      return new Response(stream, {
        status: opts.status ?? 200,
        headers,
      });
    }) as unknown as typeof fetch;
  }

  it('returns the body for a 200 response under the cap', async () => {
    const yaml = 'id: foo\nname: foo\n';
    const result = await fetchYaml('https://example.com/foo.yaml', {
      fetchImpl: makeFetch(yaml),
    });
    expect(result.text).toBe(yaml);
    expect(result.bytes).toBe(Buffer.byteLength(yaml, 'utf-8'));
  });

  it('throws on non-2xx', async () => {
    const f = (async () => new Response('nope', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(
      fetchYaml('https://example.com/missing.yaml', { fetchImpl: f }),
    ).rejects.toThrow(/404/);
  });

  it('refuses to read when Content-Length declares oversize', async () => {
    await expect(
      fetchYaml('https://example.com/big.yaml', {
        fetchImpl: makeFetch('hi', { contentLength: 999_999 }),
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/byte cap/);
  });

  it('aborts the stream when the body exceeds the cap mid-read', async () => {
    const big = 'x'.repeat(2048);
    await expect(
      fetchYaml('https://example.com/big.yaml', {
        fetchImpl: makeFetch(big),
        maxBytes: 100,
      }),
    ).rejects.toThrow(/exceeds.*byte cap/);
  });

  it('forwards the Authorization header when authHeader is provided', async () => {
    let seenAuth: string | null = null;
    const f = (async (_url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seenAuth = h.get('authorization');
      return new Response('ok');
    }) as unknown as typeof fetch;
    await fetchYaml('https://example.com/foo.yaml', {
      fetchImpl: f,
      authHeader: 'Bearer xyz',
    });
    expect(seenAuth).toBe('Bearer xyz');
  });

  it('translates AbortError into a timeout message', async () => {
    const f = (async (_url: string, init?: RequestInit) => {
      // Wait until the caller's signal aborts, then throw the way fetch does.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    await expect(
      fetchYaml('https://example.com/slow.yaml', { fetchImpl: f, timeoutMs: 5 }),
    ).rejects.toThrow(/timed out/);
  });
});
