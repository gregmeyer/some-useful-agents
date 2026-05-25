import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { dialableHost, isDashboardServing } from './dashboard.js';

/** Spin up a throwaway HTTP server returning `body` (JSON) for any request. */
async function serveJson(body: unknown, status = 200): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return {
    port: addr.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('dialableHost', () => {
  it('maps wildcard bind hosts to loopback', () => {
    expect(dialableHost('0.0.0.0')).toBe('127.0.0.1');
    expect(dialableHost('::')).toBe('127.0.0.1');
  });
  it('leaves real hosts untouched', () => {
    expect(dialableHost('127.0.0.1')).toBe('127.0.0.1');
    expect(dialableHost('localhost')).toBe('localhost');
  });
});

describe('isDashboardServing', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('returns true for a sua-dashboard /health signature', async () => {
    const s = await serveJson({ status: 'ok', scheduler: { status: 'running' }, commit: 'abc' });
    close = s.close;
    expect(await isDashboardServing('127.0.0.1', s.port)).toBe(true);
  });

  it('returns false when the port is held by something else', async () => {
    const s = await serveJson({ hello: 'world' });
    close = s.close;
    expect(await isDashboardServing('127.0.0.1', s.port)).toBe(false);
  });

  it('returns false on a non-200 response', async () => {
    const s = await serveJson({ status: 'ok', scheduler: {} }, 503);
    close = s.close;
    expect(await isDashboardServing('127.0.0.1', s.port)).toBe(false);
  });

  it('returns false when nothing is listening', async () => {
    // Bind then immediately release to get a port that is (almost certainly) free.
    const s = await serveJson({});
    const deadPort = s.port;
    await s.close();
    expect(await isDashboardServing('127.0.0.1', deadPort)).toBe(false);
  });
});
