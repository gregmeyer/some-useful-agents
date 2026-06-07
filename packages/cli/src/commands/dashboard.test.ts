import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { dialableHost, isDashboardServing, probeServingDashboard, findListenerPids, reclaimPort } from './dashboard.js';

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

describe('probeServingDashboard', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('returns the serving build identity (commit + builtAt)', async () => {
    const s = await serveJson({
      status: 'ok',
      scheduler: { status: 'running' },
      commit: 'deadbee',
      builtAt: '2026-06-07T18:00:00.000Z',
    });
    close = s.close;
    expect(await probeServingDashboard('127.0.0.1', s.port)).toEqual({
      commit: 'deadbee',
      builtAt: '2026-06-07T18:00:00.000Z',
    });
  });

  it('returns null commit/builtAt when the dashboard predates the stamp', async () => {
    const s = await serveJson({ status: 'ok', scheduler: {} });
    close = s.close;
    expect(await probeServingDashboard('127.0.0.1', s.port)).toEqual({ commit: null, builtAt: null });
  });

  it('returns null for a foreign process on the port', async () => {
    const s = await serveJson({ hello: 'world' });
    close = s.close;
    expect(await probeServingDashboard('127.0.0.1', s.port)).toBeNull();
  });
});

describe('findListenerPids', () => {
  it('finds the pid of a process listening on a port', async () => {
    const s = await serveJson({});
    try {
      const pids = await findListenerPids(s.port);
      // lsof may be unavailable in some CI images; only assert when it returns.
      if (pids.length > 0) expect(pids).toContain(process.pid);
    } finally {
      await s.close();
    }
  });

  it('returns [] for a free port', async () => {
    const s = await serveJson({});
    const deadPort = s.port;
    await s.close();
    expect(await findListenerPids(deadPort)).toEqual([]);
  });
});

describe('reclaimPort', () => {
  it('reports success immediately when nothing holds the port', async () => {
    const s = await serveJson({});
    const deadPort = s.port;
    await s.close();
    expect(await reclaimPort(deadPort, [], 1000)).toBe(true);
  });
});
