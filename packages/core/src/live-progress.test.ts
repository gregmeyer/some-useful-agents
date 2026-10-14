import { describe, expect, it } from 'vitest';
import { createLiveProgress, newLiveCursor, takeNewProgress } from './live-progress.js';

describe('live progress', () => {
  it('folds text deltas per node and keeps other events in order', () => {
    const live = createLiveProgress();
    live.add('a', { timestamp: 't', type: 'turn_start', turn: 1 });
    live.add('a', { timestamp: 't', type: 'output_delta', message: 'Hi ' });
    live.add('a', { timestamp: 't', type: 'output_delta', message: 'there' });
    live.add('b', { timestamp: 't', type: 'output_delta', message: 'Other' });
    live.add('a', { timestamp: 't', type: 'tool_use', toolName: 'web-fetch' });
    const snap = live.snapshot();
    expect(snap.text).toEqual({ a: 'Hi there', b: 'Other' });
    expect(snap.events.map((e) => `${e.nodeId}:${e.event.type}`)).toEqual(['a:turn_start', 'a:tool_use']);
  });

  it('passes on only what is new since the cursor, text as one delta per node', () => {
    const cursor = newLiveCursor();
    const first = takeNewProgress({ events: [{ nodeId: 'a', event: { timestamp: 't', type: 'turn_start' } }], text: { a: 'Hel' } }, cursor);
    expect(first.map((x) => x.event.type)).toEqual(['turn_start', 'output_delta']);
    expect(first[1].event.message).toBe('Hel');
    const second = takeNewProgress({ events: [{ nodeId: 'a', event: { timestamp: 't', type: 'turn_start' } }], text: { a: 'Hello' } }, cursor);
    expect(second).toEqual([{ nodeId: 'a', event: expect.objectContaining({ type: 'output_delta', message: 'lo' }) }]);
    expect(takeNewProgress({ events: [{ nodeId: 'a', event: { timestamp: 't', type: 'turn_start' } }], text: { a: 'Hello' } }, cursor)).toEqual([]);
    expect(takeNewProgress(undefined, cursor)).toEqual([]);
  });
});
