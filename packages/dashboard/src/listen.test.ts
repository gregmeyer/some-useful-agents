import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { listenWithErrors } from './index.js';

describe('listenWithErrors', () => {
  it('resolves a genuinely listening server on a free port', async () => {
    const server = await listenWithErrors(express(), 0, '127.0.0.1');
    try {
      expect(server.listening).toBe(true);
      expect(server.address()).not.toBeNull();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('rejects with EADDRINUSE on a busy port instead of resolving an unbound server', async () => {
    // Grab an ephemeral port, then try to bind it again.
    const first = await listenWithErrors(express(), 0, '127.0.0.1');
    const port = (first.address() as AddressInfo).port;
    try {
      await expect(listenWithErrors(express(), port, '127.0.0.1')).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await new Promise<void>((r) => first.close(() => r()));
    }
  });
});

describe('graceful shutdown with an open SSE/keep-alive connection', () => {
  // Regression: the dashboard close() used to be `server.close(cb)` alone, which
  // only resolves once existing connections drain. The inbox SSE stream never
  // closes on its own, so SIGTERM hung forever and left a zombie on the port.
  // The fix pairs server.close() with server.closeAllConnections(); this test
  // proves that pattern resolves even while a never-ending response is open.
  it('resolves close() even with a never-ending SSE response open', async () => {
    const app = express();
    // An SSE-style handler that writes headers and then never ends — exactly the
    // shape of the inbox stream / poll keep-alive that wedged the old shutdown.
    app.get('/stream', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': open\n\n');
      // intentionally never res.end()
    });

    const server = await listenWithErrors(app, 0, '127.0.0.1');
    const port = (server.address() as AddressInfo).port;

    // Open the long-lived connection and wait until the server has actually
    // accepted it, so close() has a live socket to force-terminate.
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream' }, (res) => {
        res.on('data', () => resolve());
        res.on('error', () => {});
      });
      req.on('error', reject);
    });

    // The close() pattern under test. Without closeAllConnections() this never
    // resolves; the test's own timeout would then fail it.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

    expect(server.listening).toBe(false);
  });
});
