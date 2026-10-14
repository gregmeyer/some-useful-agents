/**
 * Reading live progress (core live-progress.ts) out of a Temporal workflow's
 * pending activity heartbeat.
 */
import { defaultPayloadConverter } from '@temporalio/client';
import type { LiveRunProgress } from '@some-useful-agents/core';

type Payload = { metadata?: unknown; data?: unknown };
type PendingActivity = { heartbeatDetails?: unknown };
export interface DescribeLike {
  pendingActivities?: PendingActivity[];
  raw?: { pendingActivities?: PendingActivity[] | null };
}

/**
 * Each pending activity's latest heartbeat details, decoded. A real
 * `describe()` has them under `raw.pendingActivities`, as encoded payloads
 * (`{ payloads: [...] }`); plain objects at the top level are read too.
 */
export function heartbeatDetails(description: DescribeLike): unknown[] {
  const acts = description.raw?.pendingActivities ?? description.pendingActivities ?? [];
  const out: unknown[] = [];
  for (const act of acts) {
    const d = act?.heartbeatDetails as { payloads?: Payload[] | null } | unknown[] | undefined;
    if (d && !Array.isArray(d) && typeof d === 'object' && 'payloads' in d) {
      const first = d.payloads?.[0];
      if (!first) continue;
      try { out.push(defaultPayloadConverter.fromPayload(first as never)); } catch { /* not ours */ }
    } else {
      out.push(Array.isArray(d) ? d[0] : d);
    }
  }
  return out;
}

/** The live report in a workflow `describe()` result's pending activity heartbeat, if any. */
export function extractLiveProgress(description: DescribeLike): LiveRunProgress | undefined {
  for (const obj of heartbeatDetails(description)) {
    const live = (obj as { live?: unknown } | undefined)?.live as LiveRunProgress | undefined;
    if (live && typeof live === 'object' && Array.isArray(live.events)) return live;
  }
  return undefined;
}
