/**
 * Verifies the dashboard's Express error middleware writes a structured
 * line to stderr (the daemon supervisor pipes it to dashboard.log) and
 * responds with a meaningful 500 instead of Node's default. The whole
 * point: "dashboard crashed, log was empty" must never happen again —
 * if this test passes, the operator always has a stack trace.
 *
 * Standalone Express app to keep the test focused; the integration
 * surface (buildDashboardApp registers this middleware as the last
 * 4-arg handler) is verified by inspection.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { buildDashboardErrorHandler } from './error-middleware.js';

function makeApp() {
  const app = express();
  app.get('/throw-sync', (_req: Request, _res: Response) => {
    throw new Error('synthetic sync explosion');
  });
  app.get('/throw-async', async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await Promise.reject(new Error('synthetic async explosion'));
    } catch (e) {
      next(e);
    }
  });
  app.get('/throw-with-status', (_req: Request, _res: Response) => {
    const err = new Error('forbidden by policy') as Error & { status: number };
    err.status = 403;
    throw err;
  });
  app.use(buildDashboardErrorHandler());
  return app;
}

function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const writes: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr.write as unknown as (s: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as unknown as typeof process.stderr.write;
  return fn().then(
    (result) => { process.stderr.write = orig; return { result, logged: writes.join('') }; },
    (err) => { process.stderr.write = orig; throw err; },
  );
}

describe('buildDashboardErrorHandler', () => {
  it('catches synchronous throws, writes a stack to stderr, sends 500', async () => {
    const app = makeApp();
    const { result: res, logged } = await captureStderr(() =>
      request(app).get('/throw-sync'),
    );
    expect(res.status).toBe(500);
    expect(res.text).toContain('Internal Server Error');
    expect(res.text).toContain('GET /throw-sync');
    expect(logged).toMatch(/ERROR GET \/throw-sync .*→ 500: synthetic sync explosion/);
    expect(logged).toContain('Error: synthetic sync explosion');
    expect(logged).toMatch(/at \w+/); // stack frame present
  });

  it('catches errors forwarded via next(err)', async () => {
    const app = makeApp();
    const { result: res, logged } = await captureStderr(() =>
      request(app).get('/throw-async'),
    );
    expect(res.status).toBe(500);
    expect(logged).toMatch(/ERROR GET \/throw-async .*→ 500: synthetic async explosion/);
  });

  it('honours err.status when set (e.g. 403 instead of 500)', async () => {
    const app = makeApp();
    const { result: res, logged } = await captureStderr(() =>
      request(app).get('/throw-with-status'),
    );
    expect(res.status).toBe(403);
    expect(logged).toMatch(/→ 403: forbidden by policy/);
  });

});
