import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { InboxStore } from './inbox-store.js';
import { executeAgentDag, type DagExecutorDeps } from './dag-executor.js';
import { HumanQuestionStore, matchChoice } from './human-questions.js';
import { parseAgent } from './agent-yaml.js';
import type { Agent } from './agent-v2-types.js';

let dir: string;
let runStore: RunStore;
let questions: HumanQuestionStore;
let inbox: InboxStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-ask-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  questions = HumanQuestionStore.fromHandle(runStore.databaseHandle());
  inbox = InboxStore.fromHandle(runStore.databaseHandle());
});
afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

const agent: Agent = {
  id: 'publisher', name: 'Publisher', status: 'active', source: 'local', mcp: false, version: 1,
  inputs: { TOPIC: { type: 'string', required: true } },
  nodes: [
    { id: 'draft', type: 'shell', command: 'echo "draft about $TOPIC"' },
    { id: 'approve', type: 'ask', question: 'Publish this? {{upstream.draft.result}}', choices: ['Publish', 'Skip'], dependsOn: ['draft'] },
    { id: 'publish', type: 'shell', command: 'echo published', dependsOn: ['approve'], onlyIf: { upstream: 'approve', field: 'choice', equals: 'Publish' } },
  ],
};

const deps = (): DagExecutorDeps => ({
  runStore,
  spawnNode: async (node, env) => ({ result: node.id === 'draft' ? `draft about ${env.TOPIC}` : 'published', exitCode: 0 }),
});

describe('ask node', () => {
  it('stops the run in waiting, records the question and raises it in the inbox', async () => {
    const run = await executeAgentDag(agent, { triggeredBy: 'dashboard', inputs: { TOPIC: 'owls' } }, deps());
    expect(run.status).toBe('waiting');
    expect(run.completedAt).toBeFalsy();
    const nodes = runStore.listNodeExecutions(run.id);
    expect(nodes.map((n) => `${n.nodeId}:${n.status}`)).toEqual(['draft:completed', 'approve:waiting']);

    const q = questions.pendingForRun(run.id)!;
    expect(q.question).toBe('Publish this? draft about owls');
    expect(q.choices).toEqual(['Publish', 'Skip']);
    expect(q.inboxMessageId).toBeTruthy();
    const item = inbox.get(q.inboxMessageId!)!;
    expect(item).toMatchObject({ source: 'question', priority: 'high', agentId: 'publisher', runId: run.id });
    expect(item.title).toBe('Publisher is asking: Publish this? draft about owls');
    expect(inbox.listAutoTriageCandidates({ olderThanMs: 0, limit: 10 }).map((m) => m.id)).not.toContain(item.id);
    expect(runStore.getRun(run.id)!.resumeContext).toEqual({ inputs: { TOPIC: 'owls' } });
  });

  it('resumes with the answer as the node\'s result and choice, from the stored inputs', async () => {
    const first = await executeAgentDag(agent, { triggeredBy: 'dashboard', inputs: { TOPIC: 'owls' } }, deps());
    const q = questions.pendingForRun(first.id)!;
    expect(questions.answer(q.id, ' publish ')).toBe(true);
    expect(questions.answer(q.id, 'Skip')).toBe(false); // once only

    let draftRuns = 0;
    const run = await executeAgentDag(agent, { triggeredBy: 'dashboard', runId: first.id, resume: true }, {
      runStore,
      spawnNode: async (node) => { if (node.id === 'draft') draftRuns += 1; return { result: 'published', exitCode: 0 }; },
    });
    expect(run.status).toBe('completed');
    expect(draftRuns).toBe(0);
    const approve = runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'approve')!;
    expect(approve).toMatchObject({ status: 'completed', result: 'publish' });
    expect(JSON.parse(approve.outputsJson!)).toEqual({ answer: 'publish', choice: 'Publish' });
    expect(runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'publish')?.status).toBe('completed');
  });

  it('takes the other branch on a different answer', async () => {
    const first = await executeAgentDag(agent, { triggeredBy: 'cli', inputs: { TOPIC: 'owls' } }, deps());
    questions.answer(questions.pendingForRun(first.id)!.id, 'Skip');
    const run = await executeAgentDag(agent, { triggeredBy: 'cli', runId: first.id, resume: true }, deps());
    expect(run.status).toBe('completed');
    expect(runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'publish')).toMatchObject({ status: 'skipped', errorCategory: 'condition_not_met' });
  });

  it('fails the node when the question expired or was cancelled', async () => {
    for (const status of ['expired', 'cancelled'] as const) {
      const first = await executeAgentDag(agent, { triggeredBy: 'cli', inputs: { TOPIC: 'owls' } }, deps());
      questions.closeQuestion(questions.pendingForRun(first.id)!.id, status);
      const run = await executeAgentDag(agent, { triggeredBy: 'cli', runId: first.id, resume: true }, deps());
      expect(run.status).toBe('failed');
      const approve = runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'approve')!;
      expect(approve.errorCategory).toBe(status === 'expired' ? 'timeout' : 'cancelled');
      expect(approve.error).toMatch(status === 'expired' ? /Nobody answered .* within 72 hours/ : /cancelled/);
    }
  });

  it('can\'t wait inside an agent another agent called', async () => {
    runStore.createRun({ id: 'parent', agentName: 'boss', status: 'running', startedAt: new Date().toISOString(), triggeredBy: 'cli' });
    const run = await executeAgentDag(agent, { triggeredBy: 'cli', inputs: { TOPIC: 'x' }, parentRunId: 'parent', parentNodeId: 'n' }, deps());
    expect(run.status).toBe('failed');
    expect(runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'approve')?.error).toMatch(/inside an agent that another agent called/);
    expect(questions.pendingForRun(run.id)).toBeUndefined();
  });

  it('parses from YAML and rejects an ask node without a question', () => {
    const yaml = `id: a\nname: A\nnodes:\n  - id: ok\n    type: ask\n    question: "Go?"\n    choices: [Yes, No]\n    timeoutHours: 4\n`;
    expect(parseAgent(yaml).nodes[0]).toMatchObject({ type: 'ask', question: 'Go?', choices: ['Yes', 'No'], timeoutHours: 4 });
    expect(() => parseAgent(`id: a\nname: A\nnodes:\n  - id: bad\n    type: ask\n`)).toThrow(/question \(ask\)/);
  });
});

describe('HumanQuestionStore', () => {
  it('expires by deadline and matches choices loosely', () => {
    const q = questions.ask({ runId: 'r', nodeId: 'n', agentId: 'a', question: 'Q?', timeoutHours: 1 });
    expect(questions.listExpired(new Date(Date.now() + 30 * 60_000))).toEqual([]);
    expect(questions.listExpired(new Date(Date.now() + 2 * 3_600_000)).map((x) => x.id)).toEqual([q.id]);
    expect(() => questions.answer(q.id, '   ')).toThrow(/empty/);
    expect(matchChoice(' yes ', ['Yes', 'No'])).toBe('Yes');
    expect(matchChoice('maybe', ['Yes', 'No'])).toBe('');
  });
});

describe('structured outputs in downstream prompts', () => {
  it('resolves {{upstream.<ask>.choice}} in a later llm prompt after the answer', async () => {
    const a: Agent = {
      id: 'picker', name: 'Picker', status: 'active', source: 'local', mcp: false, version: 1,
      nodes: [
        { id: 'pick', type: 'ask', question: 'Which?', choices: ['Red', 'Blue'] },
        { id: 'use', type: 'llm-prompt', prompt: 'Chosen: {{upstream.pick.choice}} / said: {{upstream.pick.result}}', dependsOn: ['pick'] },
      ],
    };
    const first = await executeAgentDag(a, { triggeredBy: 'cli' }, { runStore });
    questions.answer(questions.pendingForRun(first.id)!.id, 'blue');
    let prompt = '';
    await executeAgentDag(a, { triggeredBy: 'cli', runId: first.id, resume: true }, {
      runStore,
      spawnNode: async (node, env) => {
        // What the real spawner would build from env: the template resolver sees both.
        const { resolveUpstreamTemplate } = await import('./node-templates.js');
        prompt = resolveUpstreamTemplate(node.prompt!, { pick: env.UPSTREAM_PICK_RESULT }, { pick: JSON.parse(env.UPSTREAM_PICK_OUTPUTS) });
        return { result: 'ok', exitCode: 0 };
      },
    });
    expect(prompt).toBe('Chosen: Blue / said: blue');
  });
});
