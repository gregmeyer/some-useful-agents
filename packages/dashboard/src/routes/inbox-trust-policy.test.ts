/**
 * Operator-tunable trust policy (B2): the store's autonomy-mode + per-agent
 * trust methods, and the engine's isAutoApproved/isAutoApprovable resolution
 * (global mode → explicit per-agent → compiled default). Deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { isAutoApproved, isAutoApprovable } from './inbox-engine.js';

type Ctx = ReturnType<typeof import('../context.js').getContext>;

let dir: string;
let store: InboxStore;

function setup(): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-trust-'));
  store = new InboxStore(join(dir, 'runs.db'));
  return { inboxStore: store } as unknown as Ctx;
}

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('InboxStore trust policy', () => {
  it('defaults to full autonomy and no per-agent overrides', () => {
    setup();
    expect(store.getAutonomyMode()).toBe('full');
    expect(store.getAgentTrust('agent-builder')).toBeUndefined();
    expect(store.listAgentTrust()).toEqual([]);
  });

  it('round-trips the global autonomy mode', () => {
    setup();
    store.setAutonomyMode('propose-only');
    expect(store.getAutonomyMode()).toBe('propose-only');
    store.setAutonomyMode('off');
    expect(store.getAutonomyMode()).toBe('off');
    store.setAutonomyMode('full');
    expect(store.getAutonomyMode()).toBe('full');
    expect(() => store.setAutonomyMode('bogus' as never)).toThrow(/invalid mode/);
  });

  it('sets, lists, and clears per-agent trust', () => {
    setup();
    store.setAgentTrust('agent-builder', 'propose');
    store.setAgentTrust('my-agent', 'auto');
    expect(store.getAgentTrust('agent-builder')).toBe('propose');
    expect(store.listAgentTrust()).toEqual([
      { agentId: 'agent-builder', level: 'propose' },
      { agentId: 'my-agent', level: 'auto' },
    ]);
    store.clearAgentTrust('agent-builder');
    expect(store.getAgentTrust('agent-builder')).toBeUndefined();
    expect(store.listAgentTrust()).toEqual([{ agentId: 'my-agent', level: 'auto' }]);
  });

  it('keeps the global row out of the per-agent list and rejects setting it as an agent', () => {
    setup();
    store.setAutonomyMode('off');
    store.setAgentTrust('a', 'auto');
    expect(store.listAgentTrust()).toEqual([{ agentId: 'a', level: 'auto' }]);
    expect(() => store.setAgentTrust('*', 'auto')).toThrow();
    expect(store.getAgentTrust('*')).toBeUndefined();
  });

  it('migration is idempotent across reopen and preserves rows', () => {
    setup();
    store.setAutonomyMode('propose-only');
    store.setAgentTrust('agent-editor', 'propose');
    const dbPath = join(dir, 'runs.db');
    store.close();
    store = new InboxStore(dbPath);
    expect(store.getAutonomyMode()).toBe('propose-only');
    expect(store.getAgentTrust('agent-editor')).toBe('propose');
  });
});

describe('isAutoApproved (global mode → per-agent → default)', () => {
  it('falls back to the compiled default set with an empty policy table', () => {
    const ctx = setup();
    expect(isAutoApproved(ctx, 'agent-builder')).toBe(true);   // in default set
    expect(isAutoApproved(ctx, 'random-agent')).toBe(false);   // not in default set
  });

  it('propose-only and off suppress ALL auto-run, even for the default set', () => {
    const ctx = setup();
    store.setAutonomyMode('propose-only');
    expect(isAutoApproved(ctx, 'agent-builder')).toBe(false);
    store.setAutonomyMode('off');
    expect(isAutoApproved(ctx, 'agent-builder')).toBe(false);
  });

  it('an explicit per-agent policy overrides the default (both directions)', () => {
    const ctx = setup();
    // Take a default-trusted agent OUT of auto:
    store.setAgentTrust('agent-builder', 'propose');
    expect(isAutoApproved(ctx, 'agent-builder')).toBe(false);
    // Opt a non-default agent INTO auto:
    store.setAgentTrust('my-agent', 'auto');
    expect(isAutoApproved(ctx, 'my-agent')).toBe(true);
  });

  it('per-agent auto still yields to a non-full global mode', () => {
    const ctx = setup();
    store.setAgentTrust('my-agent', 'auto');
    store.setAutonomyMode('propose-only');
    expect(isAutoApproved(ctx, 'my-agent')).toBe(false);
  });
});

describe('isAutoApprovable (ignores global mode — drives which cards show the toggle)', () => {
  it('is true for the default set and explicit-auto, false otherwise', () => {
    const ctx = setup();
    expect(isAutoApprovable(ctx, 'agent-analyzer')).toBe(true);  // default set
    expect(isAutoApprovable(ctx, 'nobody')).toBe(false);
    store.setAgentTrust('nobody', 'auto');
    expect(isAutoApprovable(ctx, 'nobody')).toBe(true);
    store.setAgentTrust('agent-analyzer', 'propose');
    expect(isAutoApprovable(ctx, 'agent-analyzer')).toBe(false);
  });

  it('stays true under propose-only/off (the card still offers the toggle)', () => {
    const ctx = setup();
    store.setAutonomyMode('off');
    expect(isAutoApprovable(ctx, 'agent-builder')).toBe(true);
  });
});
