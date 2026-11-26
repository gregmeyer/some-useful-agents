/**
 * Skills from a conversation (lib/skill-actions.ts): sua sees them, the
 * skill-drafter writes one (changing nothing), and the skill-save card saves
 * it and adds it to agents, all or nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, SkillStore, loadShippedSkills, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { executeSkillSave, skillsForTriage, skillsLinked, startSkillDraft, SKILL_SAVE } from '../lib/skill-actions.js';
import { BackgroundTasks } from '../lib/background.js';
import { parseActionMeta } from './inbox-shared.js';
import { parseProposedActions } from './inbox-plan.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
type Ctx = ReturnType<typeof import('../context.js').getContext>;

function setup(drafter?: (inputs: Record<string, string>) => Promise<string | undefined>): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-skills-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  for (const id of ['news-digest', 'job-finder']) {
    agentStore.upsertAgent(parseAgent([`id: ${id}`, `name: ${id}`, 'source: local', 'nodes:', '  - id: a', '    type: shell', '    command: echo hi'].join('\n')), 'cli', 'fixture');
  }
  return { agentStore, inboxStore, runStore, background: new BackgroundTasks(), ...(drafter ? { skillDrafterRun: drafter } : {}) } as never as Ctx;
}
afterEach(() => {
  for (const s of [agentStore, inboxStore, runStore]) { try { s.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const skills = () => SkillStore.fromHandle(runStore.databaseHandle());

const DRAFT = `<skill name="evaluate-software" description="Evaluate software for a job: gates, a 0–4 rubric, unknown never zero.">
## Objective
Select a defensible path to an outcome, not a category winner.
</skill>
<why>The workflow and rubric; economics can be a second skill.</why>`;

async function draft(ctx: Ctx, inputs: Record<string, string>) {
  const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'Make a skill from this: Evaluate software…' });
  const r = startSkillDraft(ctx, msg.id, { kind: 'action', status: 'running', agentId: 'skill-draft', effect: 'read', inputs });
  await (ctx as unknown as { background: BackgroundTasks }).background.drain(5000);
  const responses = inboxStore.listResponses(msg.id);
  const card = responses.map((x) => parseActionMeta(x)).find((m): m is InboxActionMeta => !!m && m.agentId === SKILL_SAVE);
  const said = responses.filter((x) => x.role === 'triage').map((x) => x.body).join('\n');
  return { r, card, said, msg };
}

describe('what sua sees', () => {
  it('lists every skill, and reads the ones the latest message names in full', () => {
    const ctx = setup();
    const list = JSON.parse(skillsForTriage(ctx)) as Array<{ name: string; from: string; link: string }>;
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(['research-shape', 'web-search', 'writing-skills']));
    expect(list.find((s) => s.name === 'web-search')).toMatchObject({ from: 'shipped with sua', link: '/skills/web-search' });
    const linked = skillsLinked(ctx, 'what does research-shape say?');
    expect(linked).toMatch(/^### research-shape — /);
    expect(linked).toContain('research-fanout');
    expect(skillsLinked(ctx, 'research shapes are fun')).toBe('');
  });

  it('the skill-drafter uses the writing-skills skill, which ships and passes its own checks', () => {
    expect(loadShippedSkills().byName.get('writing-skills')?.body).toContain('One kind of work per skill');
  });
});

describe('skill-draft → the skill-save card', () => {
  it('drafts with the conversation and the skills there are, then posts the card; nothing is saved', async () => {
    let seen: Record<string, string> = {};
    const ctx = setup(async (inputs) => { seen = inputs; return DRAFT; });
    const { r, card } = await draft(ctx, { ASK: 'turn what I pasted into a skill', AGENT_IDS: 'job-finder' });
    expect(r).toMatchObject({ status: 'completed', summary: 'Drafting the skill…' });
    expect(seen.CONVERSATION).toContain('Evaluate software…');
    expect(seen.SKILLS).toContain('- research-shape:');
    expect(card).toMatchObject({ status: 'proposed', ctaLabel: 'Save it and add it', inputs: { AGENT_IDS: 'job-finder' } });
    expect(JSON.parse(card!.inputs.NEW_SKILLS)[0]).toMatchObject({ name: 'evaluate-software', base: null });
    expect(skills().get('evaluate-software')).toBeUndefined();
  });

  it('tries once more when a draft can\'t be used, and says so when neither can', async () => {
    const replies = ['<skill name="Bad Name" description="x">text</skill>', DRAFT];
    let fix = '';
    const ctx = setup(async (inputs) => { fix = inputs.FIX; return replies.shift(); });
    const { card } = await draft(ctx, { ASK: 'a skill for evaluating software' });
    expect(fix).toMatch(/can't be used: Bad Name: name is missing or not lowercase-with-hyphens/);
    expect(card).toBeDefined();
    const ctx2 = setup(async () => 'no block here');
    const { card: none, said } = await draft(ctx2, { ASK: 'a skill' });
    expect(none).toBeUndefined();
    expect(said).toContain("I couldn't write that skill");
  });

  it('a change keeps its name and carries the skill as it was', async () => {
    const ctx = setup(async () => '<skill name="web-search" description="How to search.">Search twice before reading.</skill>');
    const { card, msg } = await draft(ctx, { ASK: 'add: search twice', NAME: 'web-search' });
    const s = JSON.parse(card!.inputs.NEW_SKILLS)[0];
    expect(s.base).toMatchObject({ source: 'shipped' });
    expect(card!.ctaLabel).toBe('Save the change');
    const html = String(renderInboxDetailFragment({ message: inboxStore.get(msg.id)!, responses: inboxStore.listResponses(msg.id) } as never));
    expect(html).toContain('Save the skill <span class="mono">web-search</span>');
    expect(html).toContain('Changes skill');
    expect(html).toContain('Saved as your copy; the shipped one stays as it is.');
  });
});

describe('the skill-save card', () => {
  it('saves the skill and adds it to the agents, each a new version', async () => {
    const ctx = setup(async () => DRAFT);
    const { card } = await draft(ctx, { ASK: 'x', AGENT_IDS: 'job-finder,news-digest' });
    const r = executeSkillSave(ctx, card!);
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('[evaluate-software](/skills/evaluate-software)');
    expect(skills().get('evaluate-software')?.version).toBe(1);
    expect(agentStore.getAgent('job-finder')).toMatchObject({ skills: ['evaluate-software'], version: 2 });
    expect(agentStore.getAgent('news-digest')?.skills).toEqual(['evaluate-software']);
  });

  it('adds a skill they have to an agent; refuses past 16 KB with nothing saved', () => {
    const ctx = setup();
    expect(executeSkillSave(ctx, { kind: 'action', status: 'running', agentId: SKILL_SAVE, effect: 'write', inputs: { SKILL: 'web-search', AGENT_IDS: 'news-digest' } }).status).toBe('completed');
    expect(agentStore.getAgent('news-digest')?.skills).toEqual(['web-search']);
    const big = (n: string) => ({ name: n, description: n, body: 'y'.repeat(5800), base: null });
    skills().save(big('big-one'), 'dashboard'); skills().save(big('big-two'), 'dashboard');
    const a = agentStore.getAgent('job-finder')!;
    agentStore.createNewVersion(a.id, { ...a, skills: ['big-one', 'big-two'] }, 'dashboard', 'two big ones');
    const r = executeSkillSave(ctx, { kind: 'action', status: 'running', agentId: SKILL_SAVE, effect: 'write', inputs: { NEW_SKILLS: JSON.stringify([big('big-three')]), AGENT_IDS: 'job-finder' } });
    expect(r).toMatchObject({ status: 'failed' });
    expect(r.refusalReason).toContain("job-finder's skills would be over 16 KB together");
    expect(skills().get('big-three')).toBeUndefined();
  });

  it("refuses when the skill changed since it was drafted", async () => {
    const ctx = setup(async () => '<skill name="web-search" description="How to search.">Search twice.</skill>');
    const { card } = await draft(ctx, { ASK: 'search twice', NAME: 'web-search' });
    skills().save({ name: 'web-search', description: 'Mine', body: 'Mine.' }, 'dashboard');
    expect(executeSkillSave(ctx, card!).refusalReason).toContain('changed since this was proposed');
  });
});

describe("sua's plan", () => {
  it('accepts skill-draft (read) and skill-save for a skill and agents; refuses what is missing', () => {
    const { accepted, rejected } = parseProposedActions([
      { type: 'skill-draft', inputs: { ASK: 'make a skill from this', AGENT_IDS: ['job-finder'] } },
      { type: 'skill-save', inputs: { SKILL: 'web-search', AGENT_IDS: ['news-digest'] } },
      { type: 'skill-draft', inputs: {} },
      { type: 'skill-save', inputs: { SKILL: 'web-search' } },
    ], [], []);
    expect(accepted.map((a) => [a.agentId, a.effect, a.ctaLabel])).toEqual([['skill-draft', 'read', 'Draft it'], ['skill-save', 'write', 'Add it']]);
    expect(accepted[0].inputs).toEqual({ ASK: 'make a skill from this', AGENT_IDS: 'job-finder' });
    expect(rejected.map((r) => r.reason)).toEqual([expect.stringContaining('skill-draft needs inputs.ASK')]);
    const alone = parseProposedActions([{ type: 'skill-save', inputs: { SKILL: 'web-search' } }], [], []);
    expect(alone.accepted).toHaveLength(0);
    expect(alone.rejected[0].reason).toContain('skill-save needs inputs.SKILL (a skill they have) and AGENT_IDS');
  });
});
