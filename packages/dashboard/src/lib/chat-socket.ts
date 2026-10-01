import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ChatMessageError,
  NotConversationalError,
  SessionNotFoundError,
  SessionStore,
  checkCookieToken,
  checkHost,
  checkOrigin,
} from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';
import { readCookie } from '../auth-middleware.js';
import { SESSION_COOKIE } from '../session.js';
import { chatBus, sessionChannel, startChatTurn } from './chat-turn.js';
import type { InboxEventBus } from './inbox-event-bus.js';
import { addInboxReply } from '../routes/inbox.js';

/**
 * The dashboard's chat WebSocket, `GET /ws` (upgrade). One connection per
 * tab carries every live conversation: the client subscribes to a session's
 * channel (replaying what it missed after `since`), sends messages, and
 * cancels turns. Events come from the chat bus (lib/chat-turn.ts).
 *
 * Auth is the same as any page: allowed Host, the session cookie, and an
 * allowed Origin, which is REQUIRED here (browsers always send one on a
 * WebSocket; a missing Origin means a non-browser client, which has no
 * business holding a cookie session either). See docs/conversations.md.
 *
 * Protocol (JSON text frames):
 *   client → server
 *     {type:'subscribe', channel:'session:<id>' | 'inbox:<messageId>', since?}  (since: replay buffered events with id > since; -1 = all)   {type:'unsubscribe', channel}
 *     {type:'chat.send', agentId, sessionId?, text, ref?}  {type:'chat.cancel', runId}
 *     {type:'inbox.send', threadId, text, ref?}            (a reply in an inbox thread; triage answers on inbox:<id>)
 *     {type:'ping'}
 *   server → client
 *     {type:'hello'}  {type:'pong'}
 *     {type:'event', channel, id, event, data}             (see chat-turn.ts for events)
 *     {type:'chat.started', ref?, agentId, sessionId, runId}  {type:'inbox.sent', ref?, threadId}
 *     {type:'error', ref?, message}
 */
export const CHAT_SOCKET_PATH = '/ws';
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_MINUTE = 120;
const HEARTBEAT_MS = 25_000;

export interface ChatSocketHandle {
  close(): void;
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Whether an upgrade request may open the chat socket. */
export function authorizeUpgrade(ctx: DashboardContext, req: IncomingMessage): { ok: true } | { ok: false; status: number; error: string } {
  const host = checkHost(req.headers.host, ctx.allowlist);
  if (!host.ok) return { ok: false, status: host.status, error: host.error };
  const origin = req.headers.origin;
  if (!origin) return { ok: false, status: 403, error: 'Origin required' };
  const originCheck = checkOrigin(origin, ctx.allowlist);
  if (!originCheck.ok) return { ok: false, status: originCheck.status, error: originCheck.error };
  const cookie = checkCookieToken(readCookie(req.headers.cookie, SESSION_COOKIE), ctx.token);
  if (!cookie.ok) return { ok: false, status: cookie.status, error: cookie.error };
  return { ok: true };
}

export function attachChatSocket(server: Server, ctx: DashboardContext): ChatSocketHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const sessions = () => SessionStore.fromHandle(ctx.runStore.databaseHandle());

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== CHAT_SOCKET_PATH) return; // not ours; leave it alone
    const auth = authorizeUpgrade(ctx, req);
    if (!auth.ok) { reject(socket, auth.status, auth.error); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const subs = new Map<string, () => void>();
    let alive = true;
    let windowStart = Date.now();
    let count = 0;
    const send = (frame: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - windowStart > 60_000) { windowStart = now; count = 0; }
      if (++count > MAX_MESSAGES_PER_MINUTE) { send({ type: 'error', message: 'Too many messages; slow down.' }); return; }
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)) as Record<string, unknown>; } catch { send({ type: 'error', message: 'Frames must be JSON.' }); return; }
      const ref = typeof msg.ref === 'string' ? msg.ref.slice(0, 64) : undefined;
      void handle(msg, ref).catch((err) => send({ type: 'error', ref, message: err instanceof Error ? err.message : String(err) }));
    });

    function subscribe(channel: string, since?: number, bus: InboxEventBus = chatBus(ctx), busChannel: string = channel): void {
      if (subs.has(channel)) return;
      subs.set(channel, bus.subscribe(busChannel, (ev) => {
        send({ type: 'event', channel, id: ev.id, event: ev.type, data: ev.data });
      }, since));
    }

    async function handle(msg: Record<string, unknown>, ref: string | undefined): Promise<void> {
      switch (msg.type) {
        case 'ping': send({ type: 'pong' }); return;
        case 'subscribe': {
          const channel = typeof msg.channel === 'string' ? msg.channel : '';
          const since = typeof msg.since === 'number' ? msg.since : undefined;
          const s = /^session:([\w-]{1,64})$/.exec(channel);
          if (s) {
            if (!sessions().get(s[1])) { send({ type: 'error', ref, message: 'No such conversation.' }); return; }
            subscribe(channel, since);
            return;
          }
          // An inbox thread: the inbox's own bus, keyed by the message id.
          const t = /^inbox:([\w-]{1,64})$/.exec(channel);
          if (t) {
            if (!ctx.inboxEventBus || !ctx.inboxStore?.get(t[1])) { send({ type: 'error', ref, message: 'No such inbox thread.' }); return; }
            subscribe(channel, since, ctx.inboxEventBus, t[1]);
            return;
          }
          send({ type: 'error', ref, message: `Unknown channel "${channel}".` });
          return;
        }
        case 'unsubscribe': {
          const channel = String(msg.channel ?? '');
          subs.get(channel)?.();
          subs.delete(channel);
          return;
        }
        case 'chat.send': {
          const agentId = typeof msg.agentId === 'string' ? msg.agentId : '';
          const text = typeof msg.text === 'string' ? msg.text : '';
          const sessionId = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : undefined;
          const agent = ctx.agentStore.getAgent(agentId);
          if (!agent) { send({ type: 'error', ref, message: `No agent "${agentId}".` }); return; }
          try {
            // Subscribe before the turn publishes anything, so even a brand-new
            // conversation's first events reach this client.
            const { session, runId } = await startChatTurn(ctx, sessions(), agent, {
              message: text, sessionId, onSession: (s) => subscribe(sessionChannel(s.id)),
            });
            send({ type: 'chat.started', ref, agentId: agent.id, sessionId: session.id, runId });
          } catch (err) {
            if (err instanceof ChatMessageError || err instanceof SessionNotFoundError || err instanceof NotConversationalError) {
              send({ type: 'error', ref, message: err.message });
              return;
            }
            throw err;
          }
          return;
        }
        case 'inbox.send': {
          const threadId = typeof msg.threadId === 'string' ? msg.threadId : '';
          const out = addInboxReply(ctx, threadId, typeof msg.text === 'string' ? msg.text : '');
          if (!out.ok) { send({ type: 'error', ref, message: out.message }); return; }
          send({ type: 'inbox.sent', ref, threadId });
          return;
        }
        case 'chat.cancel': {
          const runId = typeof msg.runId === 'string' ? msg.runId : '';
          const controller = ctx.activeRuns.get(runId);
          if (controller) controller.abort();
          else send({ type: 'error', ref, message: 'That run is not running here.' });
          return;
        }
        default:
          send({ type: 'error', ref, message: `Unknown message type "${String(msg.type)}".` });
      }
    }

    ws.on('close', () => {
      clearInterval(heartbeat);
      for (const off of subs.values()) off();
      subs.clear();
    });
    send({ type: 'hello' });
  });

  return {
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
