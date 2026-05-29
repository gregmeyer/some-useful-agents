import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InboxEventBus, type InboxBufferedEvent } from './inbox-event-bus.js';

describe('InboxEventBus', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('publishes events with monotonic ids per channel', () => {
    const bus = new InboxEventBus();
    const e1 = bus.publish('m1', { type: 'state', data: { phase: 'thinking' } });
    const e2 = bus.publish('m1', { type: 'state', data: { phase: 'responding' } });
    const e3 = bus.publish('m2', { type: 'state', data: { phase: 'thinking' } });
    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    // Different channels get independent counters.
    expect(e3.id).toBe(1);
  });

  it('subscribers receive live publishes synchronously', () => {
    const bus = new InboxEventBus();
    const received: InboxBufferedEvent[] = [];
    bus.subscribe('m1', (ev) => received.push(ev));
    bus.publish('m1', { type: 'a', data: {} });
    bus.publish('m1', { type: 'b', data: {} });
    expect(received.map((e) => e.type)).toEqual(['a', 'b']);
  });

  it('unsubscribe stops the listener from receiving further publishes', () => {
    const bus = new InboxEventBus();
    const received: string[] = [];
    const unsub = bus.subscribe('m1', (ev) => received.push(ev.type));
    bus.publish('m1', { type: 'a', data: {} });
    unsub();
    bus.publish('m1', { type: 'b', data: {} });
    expect(received).toEqual(['a']);
  });

  it('late subscriber with sinceId gets replayed buffered events', () => {
    const bus = new InboxEventBus();
    bus.publish('m1', { type: 'a', data: {} });
    bus.publish('m1', { type: 'b', data: {} });
    bus.publish('m1', { type: 'c', data: {} });
    const replayed: number[] = [];
    bus.subscribe('m1', (ev) => replayed.push(ev.id), 1);
    // Should replay events with id > 1 → ids 2 and 3.
    expect(replayed).toEqual([2, 3]);
  });

  it('sinceId without a matching event returns nothing replayed', () => {
    const bus = new InboxEventBus();
    bus.publish('m1', { type: 'a', data: {} });
    const replayed: number[] = [];
    bus.subscribe('m1', (ev) => replayed.push(ev.id), 5);
    expect(replayed).toEqual([]);
  });

  it('ring buffer trims oldest events at overflow', () => {
    const bus = new InboxEventBus({ ringSize: 3 });
    for (let i = 0; i < 5; i++) bus.publish('m1', { type: 'x', data: { i } });
    const buffer = bus.bufferSnapshot('m1');
    expect(buffer.map((e) => e.id)).toEqual([3, 4, 5]);
    // A reconnecting client that missed nothing-but-old events would
    // still get all 3 buffered ones.
    const replayed: number[] = [];
    bus.subscribe('m1', (ev) => replayed.push(ev.id), 0);
    expect(replayed).toEqual([3, 4, 5]);
  });

  it('lastEventId reflects the highest id in the ring buffer', () => {
    const bus = new InboxEventBus();
    expect(bus.lastEventId('m1')).toBeUndefined();
    bus.publish('m1', { type: 'a', data: {} });
    bus.publish('m1', { type: 'b', data: {} });
    expect(bus.lastEventId('m1')).toBe(2);
  });

  it('idle GC drops a channel after the configured timeout when no listeners remain', () => {
    const bus = new InboxEventBus({ idleGcMs: 1000 });
    const unsub = bus.subscribe('m1', () => { /* noop */ });
    bus.publish('m1', { type: 'a', data: {} });
    expect(bus.channelCount()).toBe(1);
    unsub();
    // Not yet — timer is pending.
    expect(bus.channelCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(bus.channelCount()).toBe(0);
  });

  it('a new subscriber within the GC window cancels the timer', () => {
    const bus = new InboxEventBus({ idleGcMs: 1000 });
    const unsub1 = bus.subscribe('m1', () => { /* noop */ });
    unsub1();
    vi.advanceTimersByTime(500);
    // Reconnect before the timer fires.
    const received: number[] = [];
    bus.subscribe('m1', (ev) => received.push(ev.id));
    vi.advanceTimersByTime(1000);
    expect(bus.channelCount()).toBe(1);
    // And it still works.
    bus.publish('m1', { type: 'a', data: {} });
    expect(received).toEqual([1]);
  });

  it('dropChannel removes the channel immediately', () => {
    const bus = new InboxEventBus();
    bus.publish('m1', { type: 'a', data: {} });
    expect(bus.channelCount()).toBe(1);
    bus.dropChannel('m1');
    expect(bus.channelCount()).toBe(0);
    // Listener count is 0 even though it never had one.
    expect(bus.listenerCount('m1')).toBe(0);
  });

  it('a throwing listener does not starve other listeners', () => {
    const bus = new InboxEventBus();
    const received: string[] = [];
    bus.subscribe('m1', () => { throw new Error('bad listener'); });
    bus.subscribe('m1', (ev) => received.push(ev.type));
    bus.publish('m1', { type: 'a', data: {} });
    expect(received).toEqual(['a']);
  });

  it('publish to a channel with no subscribers still buffers for later replay', () => {
    const bus = new InboxEventBus();
    bus.publish('m1', { type: 'a', data: {} });
    bus.publish('m1', { type: 'b', data: {} });
    const replayed: string[] = [];
    bus.subscribe('m1', (ev) => replayed.push(ev.type), 0);
    expect(replayed).toEqual(['a', 'b']);
  });

  it('multiple subscribers each receive each event exactly once', () => {
    const bus = new InboxEventBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe('m1', (ev) => a.push(ev.id));
    bus.subscribe('m1', (ev) => b.push(ev.id));
    bus.publish('m1', { type: 'x', data: {} });
    bus.publish('m1', { type: 'y', data: {} });
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  it('unsubscribe is idempotent', () => {
    const bus = new InboxEventBus();
    const received: number[] = [];
    const unsub = bus.subscribe('m1', (ev) => received.push(ev.id));
    unsub();
    unsub();
    bus.publish('m1', { type: 'a', data: {} });
    expect(received).toEqual([]);
  });
});
