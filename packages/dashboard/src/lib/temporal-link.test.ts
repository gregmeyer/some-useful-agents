import { describe, it, expect } from 'vitest';
import { temporalWorkflowLink, TEMPORAL_UI_URL } from './temporal-link.js';

describe('temporalWorkflowLink', () => {
  it('builds a Web UI deep link for a temporal run', () => {
    const link = temporalWorkflowLink({ id: 'abc-123', usedWorkflowProvider: 'temporal' });
    expect(link).toBe(`${TEMPORAL_UI_URL}/namespaces/default/workflows/sua-run-abc-123`);
  });

  it('honors a custom namespace', () => {
    const link = temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: 'temporal' }, 'prod');
    expect(link).toContain('/namespaces/prod/workflows/sua-run-r1');
  });

  it('returns undefined for local runs', () => {
    expect(temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: 'local' })).toBeUndefined();
    expect(temporalWorkflowLink({ id: 'r1', usedWorkflowProvider: undefined })).toBeUndefined();
  });
});
