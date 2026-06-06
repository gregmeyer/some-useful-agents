/**
 * Tests for the inbox auto-commit of agent-builder builds. When a build
 * action completes, the designed agent only exists as a `<yaml>` block in the
 * run output — agent-builder never writes to the catalog. maybeCommitBuiltAgent
 * persists it as a draft (stamped inboxRunnable) so `/agents/<id>` resolves
 * and triage can run it inline via the runnable-agent model.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, RunStore, InboxStore } from '@some-useful-agents/core';
import { maybeCommitBuiltAgent } from './inbox.js';

let dir: string;
let agentStore: AgentStore;
let runStore: RunStore;
let inboxStore: InboxStore;

const XKCD_YAML = `id: random-xkcd
name: Random XKCD
source: local
description: Shows a random XKCD comic.
nodes:
  - id: fetch
    type: shell
    command: echo hi
    dependsOn: []
`;

/** Minimal ctx — maybeCommitBuiltAgent only touches these three stores
 *  plus the optional inboxEventBus (left undefined so events no-op). */
function makeCtx(): { inboxStore: InboxStore; runStore: RunStore; agentStore: AgentStore } {
  return { inboxStore, runStore, agentStore };
}

function seedBuildRun(runId: string, yamlBody: string, nodeStatus = 'completed'): void {
  runStore.createRun({
    id: runId,
    agentName: 'agent-builder',
    status: 'completed',
    startedAt: new Date(0).toISOString(),
    triggeredBy: 'dashboard',
  });
  runStore.createNodeExecution({
    runId,
    nodeId: 'design',
    workflowVersion: 1,
    status: nodeStatus as 'completed',
    startedAt: new Date(0).toISOString(),
    result: `<yaml>\n${yamlBody}</yaml>`,
  });
}

function setup(): void {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-build-'));
  const dbPath = join(dir, 'runs.db');
  agentStore = new AgentStore(dbPath);
  runStore = new RunStore(dbPath);
  inboxStore = new InboxStore(dbPath);
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('maybeCommitBuiltAgent', () => {
  it('commits the built agent as a draft so /agents/<id> resolves', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'build xkcd', body: 'b' });
    seedBuildRun('run-1', XKCD_YAML);

    expect(agentStore.getAgent('random-xkcd')).toBeNull();
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');

    const committed = agentStore.getAgent('random-xkcd');
    expect(committed).not.toBeNull();
    expect(committed?.status).toBe('draft');
    // Stamped runnable so triage can run it from the thread.
    expect(committed?.permissions?.inboxRunnable).toBe(true);

    // A real system message with the working link is posted.
    const sys = inboxStore.listResponses(msg.id).find((r) => r.role === 'system');
    expect(sys?.body).toContain('/agents/random-xkcd');
    expect(sys?.metaJson).toContain('/agents/random-xkcd');
  });

  it('un-escapes "{ {outputs.X}}" in the widget template via autoFixYaml', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // The build pipeline escapes {{ -> { { to stop re-expansion; the inbox
    // path must repair it (as the wizard does) or the widget renders the
    // literal "{ {outputs.X}}".
    seedBuildRun('run-1', `id: tmpl-agent
name: Tmpl Agent
source: local
nodes:
  - id: n
    type: shell
    command: echo hi
    dependsOn: []
outputWidget:
  type: ai-template
  template: "XKCD #{ {outputs.comic_num}} - { {outputs.title}}"
`);
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');
    const committed = agentStore.getAgent('tmpl-agent');
    expect(committed?.outputWidget?.template).toContain('{{outputs.comic_num}}');
    expect(committed?.outputWidget?.template).not.toContain('{ {');
  });

  it('forces draft status even when the YAML declares active', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedBuildRun('run-1', `id: forced\nname: Forced\nsource: local\nstatus: active\nnodes:\n  - id: n\n    type: shell\n    command: echo hi\n    dependsOn: []\n`);
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');
    expect(agentStore.getAgent('forced')?.status).toBe('draft');
  });

  it('refuses to overwrite an existing non-draft agent of the same id', () => {
    setup();
    agentStore.createAgent({
      id: 'random-xkcd', name: 'My Real One', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'keep', type: 'shell', command: 'echo mine', dependsOn: [] }],
    }, 'cli');
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedBuildRun('run-1', XKCD_YAML);

    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');

    // The real agent is untouched (name + node preserved).
    const still = agentStore.getAgent('random-xkcd');
    expect(still?.name).toBe('My Real One');
    expect(still?.status).toBe('active');
    const sys = inboxStore.listResponses(msg.id).find((r) => r.role === 'system');
    expect(sys?.body).toContain('not overwriting');
  });

  it('no-ops when the run has no <yaml> block', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    runStore.createRun({ id: 'run-1', agentName: 'agent-builder', status: 'completed', startedAt: new Date(0).toISOString(), triggeredBy: 'dashboard' });
    runStore.createNodeExecution({ runId: 'run-1', nodeId: 'design', workflowVersion: 1, status: 'completed', startedAt: new Date(0).toISOString(), result: 'no yaml here' });
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');
    expect(inboxStore.listResponses(msg.id)).toHaveLength(0);
  });

  it('stamps inboxRunnable so the built draft is runnable from the thread', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedBuildRun('run-1', XKCD_YAML);
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');
    expect(agentStore.getAgent('random-xkcd')?.permissions?.inboxRunnable).toBe(true);
  });
});
