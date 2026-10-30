/**
 * Express error-handling middleware for the dashboard.
 *
 * Must be the LAST middleware registered on the app (4-arg signature is
 * what Express uses to recognise it as an error handler). Without this,
 * any route that throws synchronously or rejects without handling
 * propagates to Node's default error handler — which writes a generic
 * 500 to the response and leaves NOTHING in the dashboard log. Operators
 * end up with the symptom "dashboard crashed, log is empty" and no way
 * to diagnose.
 *
 * Writes the method, path, status, message, and stack to `process.stderr`
 * so the daemon supervisor pipes it to `dashboard.log`, then sends a
 * minimal-but-informative 500 to the client.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { SESSION_COOKIE } from './session.js';

export function buildDashboardErrorHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const ts = new Date().toISOString();
    const status = (typeof (err as { status?: unknown }).status === 'number')
      ? (err as { status: number }).status
      : 500;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : '';
    process.stderr.write(
      `[${ts}] ERROR ${req.method} ${req.originalUrl} → ${status}: ${message}\n${stack}\n`,
    );
    if (res.headersSent) return;
    res.status(status).type('text/plain').send(
      `Internal Server Error\n\nThe dashboard hit an unhandled error on ${req.method} ${req.originalUrl}. ` +
      `Check the dashboard log for the stack trace.`,
    );
  };
}

/**
 * Logs a button press the dashboard refused or failed (a POST, PUT, PATCH or
 * DELETE that ended 400 or above): method, path, status, and whether it came
 * with a session cookie and from where. Without this, a press that never did
 * anything (signed out, a foreign Origin, a card that's gone) left nothing in
 * the dashboard log to tell why. The path only, never the query or body: no
 * token or text you typed is written.
 *
 * Register it first, so it also sees what requireAuth and the Origin check
 * turn away.
 */
export function buildRefusedWriteLogger(write: (line: string) => void = (l) => { process.stderr.write(l); }): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      const cookie = (req.headers.cookie ?? '').split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`)) ? 'with' : 'without';
      const origin = typeof req.headers.origin === 'string' ? `, from ${req.headers.origin}` : '';
      write(`[${new Date().toISOString()}] REFUSED ${req.method} ${req.path} → ${String(res.statusCode)} (${cookie} a session cookie${origin})\n`);
    });
    next();
  };
}
