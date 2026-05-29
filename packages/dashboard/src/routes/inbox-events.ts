/**
 * SSE endpoint for inbox conversation streams.
 *
 *   GET /inbox/:id/events
 *
 * Replaces the existing 1.5s fragment poll for active conversations.
 * The route subscribes the client to its message's channel on
 * `InboxEventBus`, replays any buffered events newer than the
 * client's `Last-Event-ID` header (set automatically by EventSource
 * on reconnect), then keeps the connection open and writes each
 * subsequent event as an SSE frame.
 *
 * Auth: the dashboard's standard `requireAuth` middleware already
 * sits above the inbox router. EventSource cannot set custom headers
 * but DOES send cookies on same-origin requests, so the session
 * cookie auth path works unchanged.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import type { InboxBufferedEvent } from '../lib/inbox-event-bus.js';

export const inboxEventsRouter: Router = Router();

/** ping comment every 15s — keeps proxies + tabs from idle-closing. */
const HEARTBEAT_MS = 15_000;

/**
 * Serialise one event as an SSE frame.
 *
 * Format:
 *   id: <messageId>:<seq>
 *   event: <type>
 *   data: <JSON>
 *   \n
 *
 * The `id` field is what the browser echoes back on reconnect via
 * `Last-Event-ID`. Composite `messageId:seq` so a client switching
 * between modal threads can't accidentally restore the wrong
 * channel's checkpoint.
 */
function serialiseEvent(messageId: string, ev: InboxBufferedEvent): string {
  return `id: ${messageId}:${ev.id}\n`
    + `event: ${ev.type}\n`
    + `data: ${JSON.stringify(ev.data)}\n\n`;
}

/**
 * Parse the `Last-Event-ID` header. The browser sends back whatever
 * id we last wrote, e.g. `m1:7`. Anything that doesn't match the
 * current messageId is treated as no checkpoint (client reconnected
 * after switching threads).
 */
function parseSinceId(req: Request, messageId: string): number | undefined {
  const raw = req.get('last-event-id');
  if (!raw) return undefined;
  const colon = raw.lastIndexOf(':');
  if (colon < 0) return undefined;
  const prefix = raw.slice(0, colon);
  if (prefix !== messageId) return undefined;
  const n = Number(raw.slice(colon + 1));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

inboxEventsRouter.get('/inbox/:id/events', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxEventBus) {
    res.status(503).type('text/plain').send('inbox event bus not configured');
    return;
  }
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    res.status(404).type('text/plain').send('inbox message not found');
    return;
  }

  // SSE headers. `X-Accel-Buffering: no` disables buffering on nginx
  // / reverse proxies that might otherwise hold our writes until the
  // response ends. `Cache-Control: no-transform` keeps middleboxes
  // from gzip-buffering the stream.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // Flush the headers immediately so the browser knows the stream is
  // open. flushHeaders is on http.ServerResponse in Node 18+.
  if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as { flushHeaders: () => void }).flushHeaders();
  }

  // Initial padding: 2KB of comment lines defeats early-buffering
  // intermediaries that hold the first chunk until they've seen
  // enough bytes. Cheap insurance, otherwise mostly invisible.
  res.write(':' + ' '.repeat(2048) + '\n\n');
  res.write(`: open ${new Date().toISOString()}\n\n`);

  // Heartbeat to keep the connection live. Comment lines are ignored
  // by EventSource but reset proxy/idle-timeout clocks.
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* socket gone */ }
  }, HEARTBEAT_MS);
  if (typeof (heartbeat as unknown as { unref?: () => void }).unref === 'function') {
    (heartbeat as unknown as { unref: () => void }).unref();
  }

  // Subscribe (with optional replay). The listener writes each event
  // synchronously. We wrap in try/catch so a socket that died between
  // ticks doesn't crash the publisher loop.
  const sinceId = parseSinceId(req, id);
  const unsubscribe = ctx.inboxEventBus.subscribe(id, (ev) => {
    try { res.write(serialiseEvent(id, ev)); } catch { /* socket gone — cleanup runs on close */ }
  }, sinceId);

  // On client disconnect: stop heartbeat + unsubscribe. `close` fires
  // for both clean tab-close and dropped sockets. `aborted` covers
  // some older proxies that close without a FIN.
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});
