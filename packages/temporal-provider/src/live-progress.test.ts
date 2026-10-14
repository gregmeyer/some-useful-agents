import { describe, expect, it } from 'vitest';
import { defaultPayloadConverter } from '@temporalio/client';
import { extractLiveProgress, heartbeatDetails } from './live-progress.js';

const live = { events: [{ nodeId: 'n', event: { timestamp: 't', type: 'turn_start' } }], text: { n: 'Hello' } };

describe('reading heartbeats from describe()', () => {
  it('decodes the payloads a real describe() has under raw.pendingActivities', () => {
    const desc = { raw: { pendingActivities: [{ heartbeatDetails: { payloads: [defaultPayloadConverter.toPayload({ live })] } }] } };
    expect(heartbeatDetails(desc)).toEqual([{ live }]);
    expect(extractLiveProgress(desc)).toEqual(live);
  });

  it('reads plain objects too, and nothing when there is no heartbeat', () => {
    expect(extractLiveProgress({ pendingActivities: [{ heartbeatDetails: { live } }] })).toEqual(live);
    expect(extractLiveProgress({ pendingActivities: [{ heartbeatDetails: [{ live }] }] })).toEqual(live);
    expect(extractLiveProgress({ raw: { pendingActivities: [{ heartbeatDetails: { payloads: [] } }] } })).toBeUndefined();
    expect(extractLiveProgress({})).toBeUndefined();
  });
});
