/**
 * In-memory pub/sub for inbox conversation events. Powers the SSE
 * endpoint at `GET /inbox/:id/events`, replacing the existing 1.5s
 * fragment polling for active conversations.
 *
 * Design:
 *  - One channel per inbox messageId, lazily created on first publish
 *    or subscribe.
 *  - Each channel maintains a small ring buffer (RING_SIZE events) so
 *    a reconnecting EventSource client carrying a Last-Event-ID
 *    header can catch up the events it missed during the disconnect
 *    without rebuilding state from `/fragment`.
 *  - Per-channel monotonic event id. The composite SSE id surfaced to
 *    the client is `messageId:N` so a client that switches between
 *    modals can't accidentally replay events from a different thread.
 *  - When the last subscriber leaves a channel, a GC timer fires
 *    after IDLE_GC_MS. A new subscriber within the window cancels
 *    the timer so the buffer survives a quick reconnect.
 *
 * Decoupling: this module knows nothing about Express or SSE wire
 * format. The route layer reads + serialises.
 */

/** Event shape published by the runtime. `data` is JSON-serialised by the route. */
export interface InboxEvent {
  /** Event type — matches the SSE `event:` field on the wire. */
  type: string;
  /** Payload object. Shape varies per event type. */
  data: Record<string, unknown>;
}

/** Internal envelope held in the ring buffer; includes the channel id. */
export interface InboxBufferedEvent extends InboxEvent {
  /** Channel-local sequence number, monotonic from 1. */
  id: number;
  /** Wall-clock ms-since-epoch the publish happened. Used for GC + debug. */
  at: number;
}

export type InboxEventListener = (event: InboxBufferedEvent) => void;

interface Channel {
  /** Newest events at the END of the array. Trimmed to RING_SIZE on push. */
  buffer: InboxBufferedEvent[];
  /** Next id to assign. Starts at 1; never reset. */
  nextId: number;
  listeners: Set<InboxEventListener>;
  /** Pending GC timer when the channel has no listeners. */
  gcTimer: ReturnType<typeof setTimeout> | null;
}

export interface InboxEventBusOptions {
  /** Per-channel ring buffer size. Default 50 — enough for a few minutes of token streaming + lifecycle. */
  ringSize?: number;
  /**
   * Idle time in ms before a channel with no listeners is GC'd. Default
   * 5 minutes. Long enough to survive a tab switch / tunnel reconnect
   * without losing replay history, short enough that an abandoned tab
   * doesn't leak buffers forever.
   */
  idleGcMs?: number;
}

export class InboxEventBus {
  private readonly channels = new Map<string, Channel>();
  private readonly ringSize: number;
  private readonly idleGcMs: number;

  constructor(opts: InboxEventBusOptions = {}) {
    this.ringSize = opts.ringSize ?? 50;
    this.idleGcMs = opts.idleGcMs ?? 5 * 60_000;
  }

  /**
   * Publish a single event to a message's channel. Assigns the next
   * sequence id, appends to the ring buffer (trimming the oldest if
   * over RING_SIZE), and synchronously notifies every current
   * listener. Listener throws are caught so one bad subscriber can't
   * starve the rest.
   */
  publish(messageId: string, event: InboxEvent): InboxBufferedEvent {
    const ch = this.getOrCreate(messageId);
    const buffered: InboxBufferedEvent = {
      ...event,
      id: ch.nextId++,
      at: Date.now(),
    };
    ch.buffer.push(buffered);
    if (ch.buffer.length > this.ringSize) {
      ch.buffer.splice(0, ch.buffer.length - this.ringSize);
    }
    for (const fn of ch.listeners) {
      try { fn(buffered); } catch { /* swallow — telemetry path, never break a publisher */ }
    }
    return buffered;
  }

  /**
   * Subscribe to a message's channel. The listener is invoked
   * synchronously for every subsequent publish on this channel.
   *
   * `sinceId` (optional) replays buffered events with `id > sinceId`
   * BEFORE adding the listener — used by the SSE route to honor a
   * client's `Last-Event-ID` header. Replays are best-effort: events
   * trimmed from the ring buffer are silently lost.
   *
   * Returns an unsubscribe function. Idempotent — calling it twice
   * is a no-op.
   */
  subscribe(messageId: string, fn: InboxEventListener, sinceId?: number): () => void {
    const ch = this.getOrCreate(messageId);
    // Cancel any pending GC — we have a live subscriber again.
    if (ch.gcTimer) {
      clearTimeout(ch.gcTimer);
      ch.gcTimer = null;
    }
    // Replay anything newer than the caller's checkpoint. Done BEFORE
    // adding the listener so a publish racing the subscribe doesn't
    // arrive twice.
    if (typeof sinceId === 'number') {
      for (const ev of ch.buffer) {
        if (ev.id > sinceId) {
          try { fn(ev); } catch { /* swallow */ }
        }
      }
    }
    ch.listeners.add(fn);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      ch.listeners.delete(fn);
      if (ch.listeners.size === 0) this.scheduleGc(messageId, ch);
    };
  }

  /** Return the most recent event id on the channel, or undefined if none. */
  lastEventId(messageId: string): number | undefined {
    const ch = this.channels.get(messageId);
    if (!ch || ch.buffer.length === 0) return undefined;
    return ch.buffer[ch.buffer.length - 1].id;
  }

  /** Inspection helper for tests + diagnostics. */
  bufferSnapshot(messageId: string): readonly InboxBufferedEvent[] {
    return this.channels.get(messageId)?.buffer ?? [];
  }

  /** Listener count for a channel — diagnostics + tests. */
  listenerCount(messageId: string): number {
    return this.channels.get(messageId)?.listeners.size ?? 0;
  }

  /** Channel count — useful to assert GC ran. */
  channelCount(): number {
    return this.channels.size;
  }

  /**
   * Force-clear a channel. Used by tests and by the route on inbox
   * message dismissal — once a message is terminal, no more events
   * will ever fire on it, so the buffer can drop now rather than
   * waiting on the idle timer.
   */
  dropChannel(messageId: string): void {
    const ch = this.channels.get(messageId);
    if (!ch) return;
    if (ch.gcTimer) clearTimeout(ch.gcTimer);
    ch.listeners.clear();
    this.channels.delete(messageId);
  }

  /** Drop ALL channels. Used on dashboard shutdown. */
  dropAll(): void {
    for (const ch of this.channels.values()) {
      if (ch.gcTimer) clearTimeout(ch.gcTimer);
      ch.listeners.clear();
    }
    this.channels.clear();
  }

  private getOrCreate(messageId: string): Channel {
    let ch = this.channels.get(messageId);
    if (!ch) {
      ch = { buffer: [], nextId: 1, listeners: new Set(), gcTimer: null };
      this.channels.set(messageId, ch);
    }
    return ch;
  }

  private scheduleGc(messageId: string, ch: Channel): void {
    if (ch.gcTimer) clearTimeout(ch.gcTimer);
    ch.gcTimer = setTimeout(() => {
      // Double-check at fire time: a new subscriber may have arrived.
      if (ch.listeners.size > 0) return;
      this.channels.delete(messageId);
    }, this.idleGcMs);
    // Don't keep the Node process alive just to GC empty channels.
    if (typeof ch.gcTimer === 'object' && ch.gcTimer && 'unref' in ch.gcTimer) {
      (ch.gcTimer as { unref: () => void }).unref();
    }
  }
}
