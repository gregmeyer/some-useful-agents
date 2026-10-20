/**
 * A skill the analyzer (or builder) proposes rides on the fix card and is
 * saved with the agent when it's approved (docs/skills.md).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, SkillStore, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { maybeAutoProposeEditorAction, executeAgentEditor } from './inbox-engine.js';
import { enrichAgentAnalyzerInputs } from './inbox-catalog.js';
import { parseActionMeta } from './inbox-shared.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-skill-proposals-'));
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

const yaml = (extra: string[] = []) => [
  'id: filings-check', 'name: Filings Check', 'description: checks filings', 'status: active', ...extra,
  'nodes:', '  - id: look', '    type: llm-prompt', '    prompt: Check the filings.',
].join('\n');

const SKILL = '<skill name="cite-filings" description="Cite the filing, not the press release">\nQuote the filing itself; a press release rounds the numbers.\n</skill>';

function seedRun(runId: string, reply: string): void {
  const now = new Date().toISOString();
  runStore.createRun({ id: runId, agentName: 'agent-analyzer', status: 'completed', startedAt: now, completedAt: now, triggeredBy: 'dashboard' });
  runStore.createNodeExecution({ runId, nodeId: 'analyze', workflowVersion: 1, status: 'completed', startedAt: now, completedAt: now, result: reply });
}

function editorCard(messageId: string): InboxActionMeta | undefined {
  return inboxStore.listResponses(messageId).map((r) => parseActionMeta(r))
    .find((m): m is InboxActionMeta => Boolean(m && m.agentId === 'agent-editor'));
}

describe('a skill proposed with a fix', () => {
  it('rides on the fix card, and approving saves it with the agent', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(yaml()), 'dashboard', 'fixture');
    seedRun('an-1', `<yaml>\n${yaml(['skills: [cite-filings]'])}\n</yaml>\n${SKILL}`);
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });

    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    const card = editorCard(msg.id)!;
    expect(JSON.parse(card.inputs.NEW_SKILLS!)).toEqual([
      { name: 'cite-filings', description: 'Cite the filing, not the press release', body: 'Quote the filing itself; a press release rounds the numbers.', base: null },
    ]);

    const done = executeAgentEditor(ctx, msg.id, card);
    expect(done.status).toBe('completed');
    expect(done.summary).toContain('Saved the new skill `cite-filings`.');
    expect(SkillStore.fromHandle(runStore.databaseHandle()).get('cite-filings')).toMatchObject({ version: 1, source: 'local' });
    expect(agentStore.getAgent('filings-check')!.skills).toEqual(['cite-filings']);
  });

  it('shows "New skill" with its text on the card', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(yaml()), 'dashboard', 'fixture');
    seedRun('an-1', `<yaml>\n${yaml(['skills: [cite-filings]'])}\n</yaml>\n${SKILL}`);
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });
    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    const html = String(renderInboxDetailFragment({ message: inboxStore.get(msg.id)!, responses: inboxStore.listResponses(msg.id) } as never));
    expect(html).toContain('New skill');
    expect(html).toContain('cite-filings');
    expect(html).toContain('a press release rounds the numbers');
  });

  it('refuses, saving nothing, when the skill changed since it was proposed', () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(yaml()), 'dashboard', 'fixture');
    seedRun('an-1', `<yaml>\n${yaml(['skills: [cite-filings]'])}\n</yaml>\n${SKILL}`);
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });
    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    const skills = SkillStore.fromHandle(runStore.databaseHandle());
    skills.save({ name: 'cite-filings', description: 'Someone else wrote one', body: 'Different text.' }, 'cli');

    const done = executeAgentEditor(ctx, msg.id, editorCard(msg.id)!);
    expect(done.status).toBe('failed');
    expect(done.refusalReason).toContain('changed since this was proposed');
    expect(skills.get('cite-filings')!.body).toBe('Different text.');
    expect(agentStore.getAgent('filings-check')!.skills).toBeUndefined();
  });

  it("refuses a fix whose agent lists a skill that doesn't exist", () => {
    const ctx = setup();
    agentStore.upsertAgent(parseAgent(yaml()), 'dashboard', 'fixture');
    seedRun('an-1', `<yaml>\n${yaml(['skills: [no-such-skill]'])}\n</yaml>`);
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });
    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    const done = executeAgentEditor(ctx, msg.id, editorCard(msg.id)!);
    expect(done.status).toBe('failed');
    expect(done.refusalReason).toContain("`no-such-skill`, which isn't a skill");
  });

  it('changing a skill the agent lists saves a new version, and the analyzer sees its full text', () => {
    const ctx = setup();
    const skills = SkillStore.fromHandle(runStore.databaseHandle());
    skills.save({ name: 'cite-filings', description: 'Cite the filing', body: 'Quote the filing.' }, 'cli');
    agentStore.upsertAgent(parseAgent(yaml(['skills: [cite-filings]'])), 'dashboard', 'fixture');
    expect(enrichAgentAnalyzerInputs(ctx, 'filings-check', {}).DISCOVERY_CATALOG).toContain('### cite-filings (its full text)\nQuote the filing.');

    seedRun('an-1', `<yaml>\n${yaml(['skills: [cite-filings]', 'tags: [filings]'])}\n</yaml>\n${SKILL}`);
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'fix it' });
    maybeAutoProposeEditorAction(ctx, msg.id, 'an-1');
    const card = editorCard(msg.id)!;
    expect(JSON.parse(card.inputs.NEW_SKILLS!)[0].base).toMatchObject({ source: 'local', version: 1 });
    const done = executeAgentEditor(ctx, msg.id, card);
    expect(done.summary).toContain('Saved the skill `cite-filings` (v2).');
    expect(skills.listVersions('cite-filings').map((v) => v.version)).toEqual([2, 1]);
  });
});
