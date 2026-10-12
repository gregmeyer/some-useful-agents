/**
 * A fix sua proposes from a notebook's conversation doesn't change an agent
 * other things depend on: a shared agent (a bundled example, or one another
 * notebook searches with) is fixed as a copy for that notebook, which then
 * searches with the copy. Regression: on 2026-10-09 a fix made in one
 * notebook turned the general starter-research into a firmographics pipeline
 * that another notebook also searched with.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, NotebookStore, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { executeAgentEditor, withEditorBase } from './inbox-engine.js';
import { forkId } from '../lib/agent-fork.js';

type Ctx = ReturnType<typeof import('../context.js').getContext>;

let dir: string;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;

const yaml = (id: string, source: string, prompt: string, extra: string[] = []) => [
  `id: ${id}`, 'name: Research a topic', 'version: 1', `source: ${source}`, ...extra,
  'nodes:', '  - id: gather', '    type: llm-prompt', `    prompt: "${prompt}"`,
].join('\n');

function setup(source: 'examples' | 'local') {
  dir = mkdtempSync(join(tmpdir(), 'sua-agent-fork-'));
  const db = join(dir, 'runs.db');
  runStore = new RunStore(db);
  agentStore = new AgentStore(db);
  inboxStore = InboxStore.fromHandle(runStore.databaseHandle());
  agentStore.upsertAgent(parseAgent(yaml('researcher', source, 'Research the topic from two angles', ['permissions:', '  inboxRunnable: true'])), 'cli');
  const notebooks = NotebookStore.fromHandle(runStore.databaseHandle());
  const comps = notebooks.create({ title: 'Comp set', pipeline: ['researcher'] });
  const thread = inboxStore.add({ priority: 'medium', source: 'manual', title: 'Notebook: Comp set', body: '(empty)' });
  notebooks.setConversation(comps.id, thread.id);
  const ctx = { agentStore, inboxStore, runStore } as unknown as Ctx;
  return { ctx, notebooks, comps, thread };
}

afterEach(() => {
  for (const s of [agentStore, runStore]) { try { s?.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const fix = (prompt: string): InboxActionMeta => ({
  kind: 'action', status: 'proposed', agentId: 'agent-editor', effect: 'write',
  inputs: { AGENT_ID: 'researcher', NEW_YAML: yaml('researcher', 'local', prompt) },
});

describe('a fix from a notebook to a shared agent is a copy for that notebook', () => {
  it('another notebook searches with it: the fix becomes a copy, this notebook switches to it, the other keeps the original', () => {
    const { ctx, notebooks, comps, thread } = setup('local');
    const cabinet = notebooks.create({ title: 'Cabinet', pipeline: ['researcher'] });
    const card = withEditorBase(ctx, fix('Firmographics for the topic'), thread.id);
    expect(card.fork).toMatchObject({ id: 'researcher-comp-set', notebookId: comps.id, why: 'another notebook searches with it (Cabinet)' });
    expect(card.ctaLabel).toBe('Save as a copy');

    const res = executeAgentEditor(ctx, thread.id, { ...card, status: 'running' });
    expect(res.status).toBe('completed');
    expect(res.summary).toContain('Saved the fix as `researcher-comp-set` (v1), a copy for this notebook');
    expect(res.summary).toContain('`researcher` is unchanged');
    // The original is untouched; the copy has the fix, is local, keeps the run-from-a-conversation grant.
    expect(agentStore.getAgent('researcher')).toMatchObject({ version: 1, nodes: [{ prompt: 'Research the topic from two angles' }] });
    expect(agentStore.getAgent('researcher-comp-set')).toMatchObject({ source: 'local', status: 'active', name: 'Research a topic (Comp set)', permissions: { inboxRunnable: true }, nodes: [{ prompt: 'Firmographics for the topic' }] });
    expect(notebooks.get(comps.id)!.pipeline).toEqual(['researcher-comp-set']);
    expect(notebooks.get(cabinet.id)!.pipeline).toEqual(['researcher']);

    // The next fix to the copy (only this notebook uses it, and it's local) edits it in place.
    const next = withEditorBase(ctx, { ...fix('Firmographics, bounded'), inputs: { AGENT_ID: 'researcher-comp-set', NEW_YAML: yaml('researcher-comp-set', 'local', 'Firmographics, bounded') } }, thread.id);
    expect(next.fork).toBeUndefined();
  });

  it('an example agent is copied even when no other notebook uses it; fixing the original again updates the same copy', () => {
    const { ctx, comps, thread, notebooks } = setup('examples');
    const first = withEditorBase(ctx, fix('v2 prompt'), thread.id);
    expect(first.fork).toMatchObject({ id: 'researcher-comp-set', why: 'it’s one of sua’s example agents' });
    executeAgentEditor(ctx, thread.id, { ...first, status: 'running' });
    const again = withEditorBase(ctx, fix('v3 prompt'), thread.id);
    expect(again.fork?.id).toBe('researcher-comp-set');
    executeAgentEditor(ctx, thread.id, { ...again, status: 'running' });
    expect(agentStore.getAgent('researcher-comp-set')).toMatchObject({ version: 2, nodes: [{ prompt: 'v3 prompt' }] });
    expect(agentStore.getAgent('researcher')!.version).toBe(1);
    expect(notebooks.get(comps.id)!.pipeline).toEqual(['researcher-comp-set']);
  });

  it("edits in place when nothing else depends on it, or the fix wasn't asked from a notebook", () => {
    const { ctx, thread } = setup('local');
    // Only this notebook uses it.
    expect(withEditorBase(ctx, fix('x'), thread.id).fork).toBeUndefined();
    // Asked from the agent's own thread (not a notebook's).
    const own = inboxStore.add({ priority: 'medium', source: 'manual', title: 'researcher failed', body: 'b', agentId: 'researcher' });
    NotebookStore.fromHandle(runStore.databaseHandle()).create({ title: 'Other', pipeline: ['researcher'] });
    expect(withEditorBase(ctx, fix('x'), own.id).fork).toBeUndefined();
    const res = executeAgentEditor(ctx, own.id, { ...withEditorBase(ctx, fix('in place'), own.id), status: 'running' });
    expect(res.summary).toContain('Updated agent `researcher` to v2');
  });

  it('a copy id is the agent and notebook, kept short and unique', () => {
    expect(forkId('starter-research', 'build-a-comp-set-of-anaplan-peers', () => false)).toBe('starter-research-build-a-comp-set-of-anaplan-peers');
    expect(forkId('a', 'b', (id) => id === 'a-b')).toBe('a-b-2');
    expect(forkId('x'.repeat(50), 'y'.repeat(50), () => false).length).toBeLessThanOrEqual(60);
  });
});
