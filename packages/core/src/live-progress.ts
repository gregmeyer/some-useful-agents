/**
 * Live progress across the Temporal boundary. The worker can't call the
 * dashboard's listeners, so it reports progress in its activity heartbeat and
 * the dashboard polls it (temporal-provider live-progress.ts), about once a
 * second (the worker's heartbeat throttle). Text deltas are folded into one string per
 * node so the report is the size of the reply, not one event per token; other
 * events (tool calls, whole messages) are kept in order.
 */
import type { LiveRunProgress } from './types.js';
import type { SpawnProgress } from './node-spawner.js';

/** The worker's side: collect a run's (or one node's) progress as it happens. */
export function createLiveProgress(): { add(nodeId: string, event: SpawnProgress): void; snapshot(): LiveRunProgress } {
  const live: LiveRunProgress = { events: [], text: {} };
  return {
    add(nodeId, event) {
      if (event.type === 'output_delta') {
        if (event.message) live.text[nodeId] = (live.text[nodeId] ?? '') + event.message;
        return;
      }
      live.events.push({ nodeId, event });
    },
    snapshot: () => live,
  };
}

/** How much of a report has been passed on: events by count, text by length per node. */
export interface LiveCursor { events: number; text: Record<string, number> }

export function newLiveCursor(): LiveCursor {
  return { events: 0, text: {} };
}

/**
 * What's new in a report since `cursor` (which it advances): the new events,
 * then each node's new text as one `output_delta`. Events and text are each in
 * order; how they interleave within one poll isn't kept.
 */
export function takeNewProgress(report: LiveRunProgress | undefined, cursor: LiveCursor): Array<{ nodeId: string; event: SpawnProgress }> {
  if (!report) return [];
  const out: Array<{ nodeId: string; event: SpawnProgress }> = [];
  const events = Array.isArray(report.events) ? report.events : [];
  for (let i = cursor.events; i < events.length; i++) out.push(events[i]);
  cursor.events = Math.max(cursor.events, events.length);
  for (const [nodeId, text] of Object.entries(report.text ?? {})) {
    const seen = cursor.text[nodeId] ?? 0;
    if (typeof text !== 'string' || text.length <= seen) continue;
    out.push({ nodeId, event: { timestamp: new Date().toISOString(), type: 'output_delta', message: text.slice(seen) } });
    cursor.text[nodeId] = text.length;
  }
  return out;
}
