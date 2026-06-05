/**
 * Tests for the inbox auto-commit of agent-builder builds. When a build
 * action completes, the designed agent only exists as a `<yaml>` block in the
 * run output — agent-builder never writes to the catalog. maybeCommitBuiltAgent
 * persists it as a draft so `/agents/<id>` resolves and triage can run it;
 * builtAgentIdsInThread surfaces those ids back into the proposable allowlist.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, RunStore, InboxStore } from '@some-useful-agents/core';
import { maybeCommitBuiltAgent, builtAgentIdsInThread } from './inbox.js';

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

    // A real system message with the working link is posted.
    const sys = inboxStore.listResponses(msg.id).find((r) => r.role === 'system');
    expect(sys?.body).toContain('/agents/random-xkcd');
    expect(sys?.metaJson).toContain('/agents/random-xkcd');
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
});

describe('builtAgentIdsInThread', () => {
  it('returns the id that maybeCommitBuiltAgent committed in the thread', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedBuildRun('run-1', XKCD_YAML);
    // Drive the real commit so the source-of-truth system message is posted.
    // This also proves the signal survives a <yaml>-shaped resultSummary
    // (the bug the live dogfood caught — JSON-parsing it threw).
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');

    expect(builtAgentIdsInThread(makeCtx() as never, msg.id)).toEqual(['random-xkcd']);
  });

  it('excludes an agent that was committed then deleted', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // A system message claims a commit, but the agent isn't in the store.
    inboxStore.addResponse(msg.id, 'system', 'Created **Ghost** as a draft.', JSON.stringify({
      committedAgentId: 'ghost-agent',
    }));
    expect(builtAgentIdsInThread(makeCtx() as never, msg.id)).toEqual([]);
  });

  it('ignores the clobber-guard system note (no committedAgentId)', () => {
    setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // Pre-existing non-draft agent → commit is refused, note has no committedAgentId.
    agentStore.createAgent({
      id: 'random-xkcd', name: 'Mine', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    seedBuildRun('run-1', XKCD_YAML);
    maybeCommitBuiltAgent(makeCtx() as never, msg.id, 'run-1');
    // The real agent exists, but it wasn't built by this thread, so it must
    // not be surfaced as proposable.
    expect(builtAgentIdsInThread(makeCtx() as never, msg.id)).toEqual([]);
  });
});
