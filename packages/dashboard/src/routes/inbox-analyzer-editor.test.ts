/**
 * After agent-analyzer completes, `maybeAutoProposeEditorAction` extracts the
 * corrected `<yaml>` from the analyzer's run and auto-inserts the "approve the
 * fix" `agent-editor` card. Regression: it must target the YAML's OWN agent id
 * (the agent the analyzer corrected) so the card appears on a MANUAL thread
 * (no message.agentId) and when analyzing any agent — not just the thread's.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { maybeAutoProposeEditorAction } from './inbox-engine.js';
import { parseActionMeta } from './inbox-shared.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-analyzer-editor-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  return { agentStore, inboxStore, runStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  try { runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const CORRECTED_YAML = [
  'id: markets-today',
  'name: Markets Today',
  'description: fixed-marker',
  'nodes:',
  '  - id: noop',
  '    type: shell',
  '    command: echo ok',
].join('\n');

/** Seed a completed analyzer run whose `analyze` node emits the corrected YAML. */
function seedAnalyzerRun(runId: string, yaml = CORRECTED_YAML): void {
  const now = new Date().toISOString();
  runStore.createRun({ id: runId, agentName: 'agent-analyzer', status: 'completed', startedAt: now, completedAt: now, triggeredBy: 'dashboard' });
  runStore.createNodeExecution({
    runId, nodeId: 'analyze', workflowVersion: 1, status: 'completed',
    startedAt: now, completedAt: now, result: `<yaml>\n${yaml}\n</yaml>`,
  });
}

describe('maybeAutoProposeEditorAction', () => {
  it('proposes the agent-editor card on a MANUAL thread, targeting the YAML id', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(CORRECTED_YAML), 'dashboard', 'fixture'); // markets-today installed
    seedAnalyzerRun('an-1');
    // Manual thread — no agentId. This is the case that used to drop the card.
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });

    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');

    const editor = inboxStore.listResponses(msg.id)
      .map((r) => parseActionMeta(r))
      .find((m): m is InboxActionMeta => Boolean(m && m.agentId === 'agent-editor'));
    expect(editor).toBeDefined();
    expect(editor!.status).toBe('proposed');
    expect(editor!.inputs.AGENT_ID).toBe('markets-today');
    expect(editor!.inputs.NEW_YAML).toContain('markets-today');
  });

  it('no-ops when the YAML targets an agent that is not installed', () => {
    const ctx = setup();
    seedAnalyzerRun('an-1'); // markets-today NOT installed
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });

    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');

    const hasEditor = inboxStore.listResponses(msg.id).some((r) => parseActionMeta(r)?.agentId === 'agent-editor');
    expect(hasEditor).toBe(false);
  });

  it('no-ops when there is no <yaml> block in the run', () => {
    const ctx = setup();
    const now = new Date().toISOString();
    runStore.createRun({ id: 'an-1', agentName: 'agent-analyzer', status: 'completed', startedAt: now, completedAt: now, triggeredBy: 'dashboard' });
    runStore.createNodeExecution({ runId: 'an-1', nodeId: 'analyze', workflowVersion: 1, status: 'completed', startedAt: now, completedAt: now, result: 'no yaml here' });
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });

    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    expect(inboxStore.listResponses(msg.id).some((r) => parseActionMeta(r)?.agentId === 'agent-editor')).toBe(false);
  });

  it('does not double-propose the same YAML while one is still pending', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(CORRECTED_YAML), 'dashboard', 'fixture');
    seedAnalyzerRun('an-1');
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });

    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1'); // re-run analyzer, same YAML

    const editors = inboxStore.listResponses(msg.id).filter((r) => parseActionMeta(r)?.agentId === 'agent-editor');
    expect(editors).toHaveLength(1);
  });
});
