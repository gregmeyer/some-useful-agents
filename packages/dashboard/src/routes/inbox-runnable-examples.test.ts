/**
 * Inbox runnable gating by source. `examples`-source agents are first-party
 * and must be inbox-runnable (allowlist) / enable-and-runnable (candidates),
 * gated only by SYSTEM_AGENT_IDS — not excluded wholesale by source. Regression
 * for a dead-end where an examples agent with inboxRunnable:true was neither
 * runnable nor a candidate, so triage couldn't broker running it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, type Agent } from '@some-useful-agents/core';
import { getSubAgentAllowlist, getRunnableCandidates } from './inbox-catalog.js';

let dir: string;
let agentStore: AgentStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-runnable-src-'));
  agentStore = new AgentStore(join(dir, 'runs.db'));
  // Give inbox-triage an explicit (empty) sub-agent override so the system
  // auto-import path is skipped — isolates the user-agent source gating.
  agentStore.createAgent({
    id: 'inbox-triage', name: 'Inbox Triage', status: 'active', source: 'examples', mcp: false,
    allowedSubAgents: [],
    nodes: [{ id: 'n', type: 'shell', command: 'echo', dependsOn: [] }],
  } as unknown as Agent, 'cli');
  return { agentStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

function mkAgent(id: string, source: string, inboxRunnable: boolean) {
  agentStore.createAgent({
    id, name: id, status: 'active', source, mcp: false,
    ...(inboxRunnable ? { permissions: { inboxRunnable: true } } : {}),
    nodes: [{ id: 'n', type: 'shell', command: 'echo', dependsOn: [] }],
  } as unknown as Agent, 'cli');
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('inbox runnable gating includes examples-source agents', () => {
  it('an examples agent with inboxRunnable is in the allowlist', () => {
    const ctx = setup();
    mkAgent('adr-logger', 'examples', true);
    expect(getSubAgentAllowlist(ctx)).toContain('adr-logger');
  });

  it('an examples agent WITHOUT inboxRunnable is an enable-and-run candidate', () => {
    const ctx = setup();
    mkAgent('adr-logger', 'examples', false);
    expect(getRunnableCandidates(ctx)).toContain('adr-logger');
    expect(getSubAgentAllowlist(ctx)).not.toContain('adr-logger');
  });

  it('local + community runnable agents still work (no regression)', () => {
    const ctx = setup();
    mkAgent('local-one', 'local', true);
    mkAgent('community-one', 'community', true);
    const allow = getSubAgentAllowlist(ctx);
    expect(allow).toContain('local-one');
    expect(allow).toContain('community-one');
  });

  it('system agents are still excluded even as examples source', () => {
    const ctx = setup();
    // agent-analyzer is a SYSTEM_AGENT_ID; even examples + inboxRunnable must not
    // leak into the user-runnable set via the source relaxation.
    mkAgent('agent-analyzer', 'examples', true);
    expect(getSubAgentAllowlist(ctx)).not.toContain('agent-analyzer');
    expect(getRunnableCandidates(ctx)).not.toContain('agent-analyzer');
  });
});
