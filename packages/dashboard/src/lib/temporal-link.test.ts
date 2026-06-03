import { describe, it, expect } from 'vitest';
import { temporalWorkflowLink, TEMPORAL_UI_URL } from './temporal-link.js';

describe('temporalWorkflowLink', () => {
  it('deep-links a durable per-run workflow to its history page', () => {
    const link = temporalWorkflowLink({ id: 'abc-123', usedWorkflowProvider: 'temporal', temporalRunId: 'run-xyz' });
    expect(link).toBe(`${TEMPORAL_UI_URL}/namespaces/default/workflows/sua-run-abc-123/run-xyz/history`);
  });

  it('honors a custom namespace', () => {
    const link = temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: 'temporal', temporalRunId: 'x' }, 'prod');
    expect(link).toContain('/namespaces/prod/workflows/sua-run-r1/x/history');
  });

  it('lands on the workflows list for a per-node temporal run (no stored runId)', () => {
    const link = temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: 'temporal' });
    expect(link).toBe(`${TEMPORAL_UI_URL}/namespaces/default/workflows`);
  });

  it('returns undefined for local runs', () => {
    expect(temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: 'local' })).toBeUndefined();
    expect(temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: undefined })).toBeUndefined();
  });
});
