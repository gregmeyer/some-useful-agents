import { describe, it, expect } from 'vitest';
import express from 'express';
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
