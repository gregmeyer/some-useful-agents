/**
 * agent-editor safety: an autonomous "apply YAML fix" must not corrupt a
 * working agent. Two guards: template escapes (`{ {` → `{{`) are repaired
 * before commit, and a structurally-invalid edit (e.g. agent-invoke with no
 * agentInvokeConfig) is rejected rather than overwriting the good agent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { executeAgentEditor } from './inbox-engine.js';

type Ctx = ReturnType<typeof import('../context.js').getContext>;

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;

function setup(): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-editor-safety-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  // Seed a working target agent (shell + apple tool + templates).
  agentStore.upsertAgent(parseAgent([
    'id: make-a-reminder', 'name: Make a reminder', 'version: 1', 'source: local',
    'nodes:', '  - id: create', '    type: shell', '    tool: apple.apple.reminder-create',
    '    toolInputs:', '      title: "{{inputs.TITLE}}"',
  ].join('\n')), 'cli');
  return { agentStore, inboxStore } as unknown as Ctx;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const editMeta = (newYaml: string): InboxActionMeta => ({
  kind: 'action', status: 'running', agentId: 'agent-editor', effect: 'write',
  inputs: { AGENT_ID: 'make-a-reminder', NEW_YAML: newYaml },
});

describe('executeAgentEditor safety', () => {
  it('repairs escaped templates ({ { -> {{) before committing', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // NEW_YAML that round-tripped through the templating pipeline (escaped).
    const escaped = [
      'id: make-a-reminder', 'name: Make a reminder', 'version: 1', 'source: local',
      'nodes:', '  - id: create', '    type: shell', '    tool: apple.apple.reminder-create',
      '    toolInputs:', '      title: "{ {inputs.TITLE}}"',
    ].join('\n');
    const res = executeAgentEditor(ctx, m.id, editMeta(escaped));
    expect(res.status).toBe('completed');
    const stored = agentStore.getAgent('make-a-reminder')!;
    const title = stored.nodes[0].toolInputs?.title as string;
    expect(title).toBe('{{inputs.TITLE}}');   // un-escaped
    expect(title).not.toContain('{ {');
  });

  it('refuses an agent-invoke edit with no agentInvokeConfig, leaving the good agent intact', () => {
    const ctx = setup();
    const before = agentStore.getAgent('make-a-reminder')!;
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // The exact corruption seen in the wild: shell -> agent-invoke, no config.
    const corrupt = [
      'id: make-a-reminder', 'name: Make a reminder', 'version: 1', 'source: local',
      'nodes:', '  - id: create', '    type: agent-invoke', '    tool: apple.apple.reminder-create',
    ].join('\n');
    const res = executeAgentEditor(ctx, m.id, editMeta(corrupt));
    expect(res.status).toBe('failed');
    expect(res.refusalReason).toMatch(/validation|agentInvokeConfig/i);
    // The working agent must be UNCHANGED — not overwritten by the broken edit.
    const after = agentStore.getAgent('make-a-reminder')!;
    expect(after.nodes[0].type).toBe('shell');
    expect(after.version).toBe(before.version);
  });
});

/**
 * The self-grading loop.
 *
 * `NEW_YAML` replaces the whole definition, so anything the model doesn't
 * re-emit is dropped. For `outcome:` / `successCriteria:` that's not a
 * preference — those are the criteria verify-on-resolve grades this very loop
 * against. Dropping them makes the next run trivially "pass" and the thread
 * auto-resolve while the agent is still broken.
 */
describe('executeAgentEditor preserves acceptance criteria', () => {
  const withOutcome = [
    'id: graded', 'name: Graded', 'version: 1', 'source: local',
    'outcome:',
    '  expected: A non-empty digest.',
    '  evidence:',
    '    - kind: nodeResult',
    '      nodeId: work',
    '  success:',
    '    - kind: regexMatch',
    '      nodeId: work',
    '      pattern: "[1-9]"',
    'successCriteria:',
    '  - kind: shellExitZero',
    '    nodeId: work',
    'maxLoopIterations: 3',
    'nodes:', '  - id: work', '    type: shell', '    command: echo 1',
  ].join('\n');

  const rewriteWithoutCriteria = [
    'id: graded', 'name: Graded', 'version: 1', 'source: local',
    'nodes:', '  - id: work', '    type: shell', '    command: echo 2',
  ].join('\n');

  const meta = (newYaml: string): InboxActionMeta => ({
    kind: 'action', status: 'running', agentId: 'agent-editor', effect: 'write',
    inputs: { AGENT_ID: 'graded', NEW_YAML: newYaml },
  });

  it('carries outcome and successCriteria across a rewrite that omits them', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(withOutcome), 'cli');

    const res = executeAgentEditor(ctx, 'msg-1', meta(rewriteWithoutCriteria));
    expect(res.status).toBe('completed');

    const after = agentStore.getAgent('graded')!;
    // The actual edit landed…
    expect(after.nodes[0].command).toContain('echo 2');
    // …but the loop did not quietly delete its own grading criteria.
    expect(after.outcome?.expected).toBe('A non-empty digest.');
    expect(after.outcome?.success).toHaveLength(1);
    expect(after.successCriteria).toEqual([{ kind: 'shellExitZero', nodeId: 'work' }]);
    expect(after.maxLoopIterations).toBe(3);
  });

  it('says so in the summary — a silent preservation is barely better than a silent deletion', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(withOutcome), 'cli');
    const res = executeAgentEditor(ctx, 'msg-1', meta(rewriteWithoutCriteria));
    expect(res.summary).toContain('Kept the existing outcome and successCriteria');
  });

  it('still honours an edit that deliberately rewrites the criteria', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(withOutcome), 'cli');

    const tightened = [
      'id: graded', 'name: Graded', 'version: 1', 'source: local',
      'outcome:',
      '  expected: A digest with at least ten items.',
      '  success:',
      '    - kind: regexMatch',
      '      nodeId: work',
      '      pattern: "[1-9][0-9]+"',
      'nodes:', '  - id: work', '    type: shell', '    command: echo 2',
    ].join('\n');

    executeAgentEditor(ctx, 'msg-1', meta(tightened));
    const after = agentStore.getAgent('graded')!;
    // Preservation is on OMISSION only — an explicit rewrite wins.
    expect(after.outcome?.expected).toBe('A digest with at least ten items.');
  });

  it('is a no-op for agents that never declared criteria', () => {
    const ctx = setup();
    const res = executeAgentEditor(ctx, 'msg-1', editMeta([
      'id: make-a-reminder', 'name: Make a reminder', 'version: 1', 'source: local',
      'nodes:', '  - id: create', '    type: shell', '    command: echo hi',
    ].join('\n')));
    expect(res.status).toBe('completed');
    expect(res.summary).not.toContain('Kept the existing');
    expect(agentStore.getAgent('make-a-reminder')!.outcome).toBeUndefined();
  });
});
