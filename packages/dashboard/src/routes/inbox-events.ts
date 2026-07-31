/**
 * SSE endpoints for inbox streams.
 *
 *   GET /inbox/events      — the coarse, inbox-wide channel ('*'): thread
 *                            created / status changed. Powers the global
 *                            badge + live list. No per-message existence
 *                            check (the channel is not a thread).
 *   GET /inbox/:id/events  — one conversation's stream. Replaces the 1.5s
 *                            fragment poll for an open thread.
 *
 * Both share the same wire mechanics (headers, 2KB pad, 15s heartbeat,
 * Last-Event-ID replay, cleanup) via `streamChannel`. The composite SSE
 * id is `<channel>:<seq>`, so the global stream echoes `*:N` on reconnect
 * and `parseSinceId` restores its checkpoint unchanged.
 *
 * Auth: the dashboard's standard `requireAuth` middleware already sits
 * above the inbox router. EventSource cannot set custom headers but DOES
 * send cookies on same-origin requests, so cookie auth works unchanged.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { GLOBAL_INBOX_CHANNEL, type InboxBufferedEvent } from '../lib/inbox-event-bus.js';

export const inboxEventsRouter: Router = Router();

/** ping comment every 15s — keeps proxies + tabs from idle-closing. */
const HEARTBEAT_MS = 15_000;

/**
 * Serialise one event as an SSE frame.
 *
 * Format:
 *   id: <channel>:<seq>
 *   event: <type>
 *   data: <JSON>
 *   \n
 *
 * The `id` field is what the browser echoes back on reconnect via
 * `Last-Event-ID`. Composite `channel:seq` so a client switching
 * between modal threads (or between a thread and the global stream)
 * can't accidentally restore the wrong channel's checkpoint.
 */
function serialiseEvent(channel: string, ev: InboxBufferedEvent): string {
  return `id: ${channel}:${ev.id}\n`
    + `event: ${ev.type}\n`
    + `data: ${JSON.stringify(ev.data)}\n\n`;
}

/**
 * Parse the `Last-Event-ID` header. The browser sends back whatever
 * id we last wrote, e.g. `m1:7` or `*:12`. Anything that doesn't match
 * the current channel is treated as no checkpoint (client reconnected
 * after switching threads).
 */
function parseSinceId(req: Request, channel: string): number | undefined {
  const raw = req.get('last-event-id');
  if (!raw) return undefined;
  const colon = raw.lastIndexOf(':');
  if (colon < 0) return undefined;
  const prefix = raw.slice(0, colon);
  if (prefix !== channel) return undefined;
  const n = Number(raw.slice(colon + 1));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Open an SSE stream on `channel` and keep it live: headers, 2KB
 * anti-buffering pad, 15s heartbeat, replay from Last-Event-ID, then
 * one frame per subsequent publish. Cleans up on disconnect. Shared by
 * the per-thread and global routes — the ONLY difference between them is
 * the channel key and whether a thread-existence check runs first.
 */
function streamChannel(req: Request, res: Response, channel: string): void {
  const ctx = getContext(req.app.locals);
  // Non-null by the callers' guard, but keep the local check for types.
  if (!ctx.inboxEventBus) {
    res.status(503).type('text/plain').send('inbox event bus not configured');
    return;
  }
  const bus = ctx.inboxEventBus;

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
  const sinceId = parseSinceId(req, channel);
  const unsubscribe = bus.subscribe(channel, (ev) => {
    try { res.write(serialiseEvent(channel, ev)); } catch { /* socket gone — cleanup runs on close */ }
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
}

// Global inbox stream. Registered BEFORE the `/inbox/:id/events` route
// so the literal `events` segment can't be captured as an `:id`.
inboxEventsRouter.get('/inbox/events', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxEventBus) {
    res.status(503).type('text/plain').send('inbox event bus not configured');
    return;
  }
  // No thread-existence check — the '*' channel is not a message.
  streamChannel(req, res, GLOBAL_INBOX_CHANNEL);
});

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
  streamChannel(req, res, id);
});
