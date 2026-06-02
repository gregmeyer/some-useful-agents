import { describe, it, expect } from 'vitest';
import type { Provider } from '@some-useful-agents/core';
import { resolveRunBackend } from './run-backend.js';

const local = { name: 'local' } as unknown as Provider;
const temporal = { name: 'temporal', submitDagRun: async () => ({} as never) } as unknown as Provider;
const temporalNoDag = { name: 'temporal' } as unknown as Provider; // durable not available

describe('resolveRunBackend', () => {
  it('always local under a non-temporal provider', () => {
    expect(resolveRunBackend(local, {})).toBe('local');
    expect(resolveRunBackend(local, { runOn: 'temporal' })).toBe('local');
  });

  it('under temporal, defaults to temporal and honors runOn', () => {
    expect(resolveRunBackend(temporal, {})).toBe('temporal');                 // undefined => durable default
    expect(resolveRunBackend(temporal, { runOn: 'temporal' })).toBe('temporal');
    expect(resolveRunBackend(temporal, { runOn: 'local' })).toBe('local');    // opt out
  });

  it('falls back to local when the temporal provider has no submitDagRun', () => {
    expect(resolveRunBackend(temporalNoDag, {})).toBe('local');
  });
});
