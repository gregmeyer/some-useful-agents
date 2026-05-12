import { describe, it, expect, vi } from 'vitest';
import { createOauthStateStore } from './state-store.js';

function sampleFlow(overrides: Partial<Parameters<ReturnType<typeof createOauthStateStore>['put']>[1]> = {}) {
  return {
    integrationId: 'user:gmail-oncall',
    codeVerifier: 'verifier-abc',
    provider: 'gmail',
    returnTo: '/settings/integrations',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('createOauthStateStore', () => {
  it('round-trips put → consume', () => {
    const store = createOauthStateStore();
    const flow = sampleFlow();
    store.put('s1', flow);
    expect(store.consume('s1')).toEqual(flow);
  });

  it('consume is single-use', () => {
    const store = createOauthStateStore();
    store.put('s1', sampleFlow());
    store.consume('s1');
    expect(store.consume('s1')).toBeNull();
  });

  it('returns null for unknown state', () => {
    const store = createOauthStateStore();
    expect(store.consume('nope')).toBeNull();
  });

  it('refuses to overwrite a live state token', () => {
    const store = createOauthStateStore();
    store.put('s1', sampleFlow());
    expect(() => store.put('s1', sampleFlow())).toThrow(/reused/);
  });

  it('expires entries silently and reissues the state token', () => {
    const store = createOauthStateStore();
    const past = sampleFlow({ expiresAt: Date.now() - 1_000 });
    store.put('s1', past);
    expect(store.consume('s1')).toBeNull();
    // After consume cleared the expired entry, the state is available again.
    store.put('s1', sampleFlow());
    expect(store.consume('s1')).not.toBeNull();
  });

  it('clear wipes everything', () => {
    const store = createOauthStateStore();
    store.put('s1', sampleFlow());
    store.put('s2', sampleFlow({ integrationId: 'user:other' }));
    store.clear();
    expect(store.consume('s1')).toBeNull();
    expect(store.consume('s2')).toBeNull();
  });
});
