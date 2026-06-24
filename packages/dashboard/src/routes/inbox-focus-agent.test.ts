/**
 * resolveFocusAgentId picks the agent a thread is ABOUT so triage can be given
 * that agent's latest run output (run-awareness). Prefers the message target;
 * on a manual thread it walks actions newest-first and returns the real agent
 * the latest one touched — using inputs.AGENT_ID for system/route-handled
 * actions (analyzer/editor) and skipping system pseudo-agents.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, type InboxActionMeta } from '@some-useful-agents/core';
import { resolveFocusAgentId } from './inbox-engine.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-focus-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  return { agentStore, inboxStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function mkAgent(id: string): void {
  agentStore.createAgent({
    id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');
}

function addAction(msgId: string, meta: InboxActionMeta): void {
  inboxStore.addResponse(msgId, 'action', 'a', JSON.stringify(meta));
}

describe('resolveFocusAgentId', () => {
  it('returns the message target when present', () => {
    const ctx = setup();
    const r = resolveFocusAgentId(ctx, 'markets-today', []);
    expect(r).toBe('markets-today');
  });

  it('on a manual thread, resolves an agent-editor action target (inputs.AGENT_ID)', () => {
    const ctx = setup();
    mkAgent('markets-today');
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    addAction(m.id, { kind: 'action', status: 'completed', agentId: 'agent-editor', inputs: { AGENT_ID: 'markets-today', NEW_YAML: 'x' } });
    const r = resolveFocusAgentId(ctx, undefined, inboxStore.listResponses(m.id));
    expect(r).toBe('markets-today');
  });

  it('resolves a run-agent action target (the action agentId)', () => {
    const ctx = setup();
    mkAgent('weather');
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    addAction(m.id, { kind: 'action', status: 'completed', agentId: 'weather', inputs: {} });
    const r = resolveFocusAgentId(ctx, undefined, inboxStore.listResponses(m.id));
    expect(r).toBe('weather');
  });

  it('prefers the NEWEST action and skips system pseudo-agents with no real target', () => {
    const ctx = setup();
    mkAgent('markets-today');
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    addAction(m.id, { kind: 'action', status: 'completed', agentId: 'weather', inputs: {} }); // older, weather not installed
    addAction(m.id, { kind: 'action', status: 'completed', agentId: 'agent-analyzer', inputs: { AGENT_ID: 'markets-today' } });
    const r = resolveFocusAgentId(ctx, undefined, inboxStore.listResponses(m.id));
    expect(r).toBe('markets-today'); // newest action's real target
  });

  it('returns undefined when no action references an installed real agent', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    addAction(m.id, { kind: 'action', status: 'completed', agentId: 'agent-catalog-search', inputs: {} });
    const r = resolveFocusAgentId(ctx, undefined, inboxStore.listResponses(m.id));
    expect(r).toBeUndefined();
  });
});
