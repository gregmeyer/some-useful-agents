/**
 * Skills from a conversation (docs/skills.md "From a conversation"):
 *
 * - sua sees your skills (SKILLS) and reads one in full when the conversation
 *   names it (SKILLS_LINKED), so it can say what one does or which agents use it;
 * - `skill-draft` has the skill-drafter agent (which itself uses the
 *   writing-skills skill) write a new skill or change one, in the
 *   background, changing nothing; it posts a `skill-save` card;
 * - `skill-save` saves the card's skill (a new version, or your copy of a
 *   shipped one) and adds it to the agents named, all or nothing. sua can
 *   also post it with just SKILL and AGENT_IDS, to add a skill you have to
 *   agents.
 *
 * Nothing is saved that would leave an agent unable to run: the skill's own
 * checks, and every agent that lists it kept under 16 KB of skills.
 */
import { buildSkillsPreamble, extractSkillProposals, MAX_SKILLS_PREAMBLE_BYTES, type Agent, type InboxActionMeta, type InboxActionStatus, type LoadSkillsResult } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { inBackground } from './background.js';
import { checkCardSkills, parseCardSkills, saveCardSkills, type CardSkill } from './skill-proposals.js';
import { allSkills, kb, overAgentLimit, skillBytes, skillStore } from './skill-edit.js';

type Ctx = ReturnType<typeof getContext>;

export const SKILL_DRAFT = 'skill-draft';
export const SKILL_SAVE = 'skill-save';
export const SKILL_DRAFTER_ID = 'skill-drafter';
/** A skill sua reads in full when the conversation names it: at most this many. */
const MAX_LINKED = 2;
const MAX_CONVERSATION_CHARS = 16_000;
const MAX_AGENTS_PER_CARD = 6;

/** Ids from "a, b c" (or a JSON list). Pure. */
export function idsFrom(raw: string | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw) as unknown; if (Array.isArray(v)) return [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))]; } catch { /* a list in words */ }
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Your skills, as sua's conversation sees them (SKILLS): what each is for, where it's from, who uses it. */
export function skillsForTriage(ctx: Ctx): string {
  try {
    return JSON.stringify(allSkills(ctx).rows.map((r) => ({
      name: r.skill.name, for: r.skill.description,
      from: r.origin === 'shipped' ? 'shipped with sua' : r.origin === 'yours' ? 'yours' : 'your copy of a shipped one',
      size: kb(r.bytes), usedBy: r.usedBy.map((a) => a.id), link: `/skills/${r.skill.name}`,
    })));
  } catch { return '[]'; }
}

/**
 * Skills the latest message names (by name, or a /skills/<name> link), read
 * in full (SKILLS_LINKED). Empty when none is.
 */
export function skillsLinked(ctx: Ctx, latest: string): string {
  try {
    const { loaded } = allSkills(ctx);
    const named = [...loaded.byName.values()].filter((s) => new RegExp(`(^|[^a-z0-9-])${s.name.replace(/-/g, '\\-')}([^a-z0-9-]|$)`, 'i').test(latest)).slice(0, MAX_LINKED);
    return named.map((s) => `### ${s.name} — ${s.description}\n${s.body}`).join('\n\n');
  } catch { return ''; }
}

type Runner = (inputs: Record<string, string>) => Promise<{ text?: string; error?: string }>;

function drafter(ctx: Ctx): Runner | undefined {
  const fake = ctx.skillDrafterRun;
  if (fake) return async (inputs) => ({ text: await fake(inputs) });
  if (!ensureSystemAgentCurrent(ctx, SKILL_DRAFTER_ID, 'writing a skill')) return undefined;
  const agent = ctx.agentStore.getAgent(SKILL_DRAFTER_ID);
  if (!agent) return undefined;
  return async (inputs) => {
    const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
    return run.status === 'completed' ? { text: run.result ?? '' } : { error: run.error ?? run.status };
  };
}

function say(ctx: Ctx, threadId: string, words: string): void {
  const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
}

/** The thread as the drafter reads it, latest last, cut from the start when long. */
function conversationText(ctx: Ctx, threadId: string): string {
  const m = ctx.inboxStore?.get(threadId);
  if (!m) return '';
  const turns = [`you: ${m.body}`, ...ctx.inboxStore!.listResponses(threadId).filter((r) => r.role !== 'action').map((r) => `${r.role === 'user' ? 'you' : 'sua'}: ${r.body}`)];
  const all = turns.join('\n\n');
  return all.length > MAX_CONVERSATION_CHARS ? `…${all.slice(-MAX_CONVERSATION_CHARS)}` : all;
}

const tagged = (raw: string, tag: string): string | undefined => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(raw)?.[1]?.trim();

/**
 * sua's `skill-draft`: the skill-drafter writes the skill (or the change) in
 * the background, checked as a saved one would be (one more try told what
 * was wrong), then the `skill-save` card is posted. Returns at once.
 */
export function startSkillDraft(ctx: Ctx, messageId: string, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const ask = (meta.inputs.ASK ?? '').trim();
  if (!ask) return { status: 'failed', refusalReason: 'skill-draft needs inputs.ASK: what the skill should cover, in their words.' };
  if (!skillStore(ctx)) return { status: 'failed', refusalReason: "Skills can't be saved here: the run database isn't open." };
  const run = drafter(ctx);
  if (!run) return { status: 'failed', refusalReason: "sua can't write skills right now (its skill drafter isn't installed)." };
  const { loaded, rows } = allSkills(ctx);
  const name = (meta.inputs.NAME ?? '').trim();
  const current = name ? loaded.byName.get(name) : undefined;
  const agentIds = idsFrom(meta.inputs.AGENT_IDS).slice(0, MAX_AGENTS_PER_CARD);

  inBackground(ctx, SKILL_DRAFT, (async () => {
    try {
      const base = {
        ASK: ask,
        CONVERSATION: conversationText(ctx, messageId),
        SKILLS: rows.map((r) => `- ${r.skill.name}: ${r.skill.description}`).join('\n') || '(none yet)',
        CURRENT: current ? `name: ${current.name}\ndescription: ${current.description}\n\n${current.body}` : '',
        FIX: '',
      };
      let got: { name: string; description: string; body: string } | undefined;
      let why = '';
      let problem = '';
      for (let tries = 1; tries <= 2 && !got; tries++) {
        const reply = await run(tries === 1 ? base : { ...base, FIX: problem });
        if (reply.text === undefined) { problem = reply.error ?? 'it stopped'; break; }
        const { skills, problems } = extractSkillProposals(reply.text);
        why = tagged(reply.text, 'why')?.replace(/\s+/g, ' ') ?? '';
        const s = skills[0];
        if (!s) { problem = problems[0] ? `The skill can't be used: ${problems[0]}.` : 'The reply had no <skill name="…" description="…"> block.'; continue; }
        if (current && s.name !== current.name) { problem = `Keep the name ${current.name}: this is a change to that skill.`; continue; }
        if (!current && loaded.byName.has(s.name)) { problem = `There's already a skill called ${s.name}. Pick another name for a new one.`; continue; }
        got = s;
      }
      if (!got) { say(ctx, messageId, `I couldn't write that skill (${problem.slice(0, 200)}). Nothing changed.`); return; }
      const card: CardSkill = { ...got, base: current ? { source: current.source ?? 'shipped', version: current.version ?? 0, description: current.description, body: current.body } : null };
      if (card.base && card.base.body === card.body && card.base.description === card.description) {
        say(ctx, messageId, `The skill \`${got.name}\` already says that. Nothing changed.`);
        return;
      }
      const verb = current ? `A change to the skill \`${got.name}\`` : `A new skill, \`${got.name}\``;
      const summary = `${verb} (${kb(skillBytes(got.body))})${agentIds.length ? `, for ${agentIds.map((a) => `\`${a}\``).join(', ')}` : ''}.${why ? ` ${why}` : ''}`;
      const action: InboxActionMeta = {
        kind: 'action', status: 'proposed', agentId: SKILL_SAVE, effect: 'write',
        inputs: { NEW_SKILLS: JSON.stringify([card]), ...(agentIds.length ? { AGENT_IDS: agentIds.join(',') } : {}) },
        rationale: summary,
        ctaLabel: agentIds.length ? 'Save it and add it' : current ? 'Save the change' : 'Save the skill',
      };
      const resp = ctx.inboxStore!.addResponse(messageId, 'action', summary, JSON.stringify(action));
      publishInboxEvent(ctx, messageId, 'action:created', { responseId: resp.id, agentId: action.agentId, rationale: summary, inputs: action.inputs, createdAt: resp.createdAt });
      ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
    } catch (err) {
      try { say(ctx, messageId, `I couldn't write that skill: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}. Nothing changed.`); } catch { /* the thread is gone */ }
    }
  })());
  return { status: 'completed', summary: current ? `Drafting a change to \`${current.name}\`…` : 'Drafting the skill…' };
}

/** The skills a card ends with: its own over what's there. */
function withCard(loaded: LoadSkillsResult, skills: readonly CardSkill[]): LoadSkillsResult {
  const byName = new Map(loaded.byName);
  for (const s of skills) byName.set(s.name, { ...(byName.get(s.name) ?? { file: '' }), name: s.name, description: s.description, body: s.body });
  return { byName, problems: [] };
}

/**
 * The `skill-save` card: save its skill(s) and add them to the agents named,
 * all or none. With no NEW_SKILLS, SKILL names a skill you have to add.
 */
export function executeSkillSave(ctx: Ctx, meta: InboxActionMeta): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const fail = (refusalReason: string) => ({ status: 'failed' as const, refusalReason });
  const skills = parseCardSkills(meta.inputs.NEW_SKILLS).slice(0, 2);
  const { loaded } = allSkills(ctx);
  const names = skills.length ? skills.map((s) => s.name) : [(meta.inputs.SKILL ?? '').trim()].filter(Boolean);
  if (!names.length) return fail('skill-save needs NEW_SKILLS, or SKILL (a skill you have) and AGENT_IDS.');
  if (!skills.length && !loaded.byName.has(names[0])) return fail(`There's no skill called ${names[0]}.`);
  if (skills.length) {
    const checked = checkCardSkills(ctx, meta.inputs.NEW_SKILLS, { id: '(card)', skills: [] });
    if (checked.error) return fail(checked.error.replace(/ with this agent/, ''));
    for (const s of skills) { const over = overAgentLimit(ctx, loaded, s); if (over) return fail(`${over}.`); }
  }
  const ids = idsFrom(meta.inputs.AGENT_IDS).slice(0, MAX_AGENTS_PER_CARD);
  const after = withCard(loaded, skills);
  const toChange: Array<{ agent: Agent; skills: string[] }> = [];
  for (const id of ids) {
    const agent = ctx.agentStore.getAgent(id);
    if (!agent) return fail(`There's no agent called ${id}.`);
    const next = [...new Set([...(agent.skills ?? []), ...names])];
    if (next.length === (agent.skills ?? []).length) continue;
    try { buildSkillsPreamble(next, after); } catch { return fail(`${id}'s skills would be over ${String(MAX_SKILLS_PREAMBLE_BYTES / 1024)} KB together. Take one off it first, or make this one shorter.`); }
    toChange.push({ agent, skills: next });
  }
  if (!skills.length && !toChange.length) return { status: 'completed', summary: `${ids.join(', ') || 'Those agents'} already use \`${names[0]}\`. Nothing changed.` };
  let saved: { undo: () => void; note: string };
  try { saved = saveCardSkills(ctx, skills); } catch (err) { return fail((err as Error).message); }
  const changed: Agent[] = [];
  try {
    for (const c of toChange) {
      ctx.agentStore.createNewVersion(c.agent.id, { ...c.agent, skills: c.skills }, 'dashboard', `Uses the skill${names.length === 1 ? '' : 's'} ${names.join(', ')}`);
      changed.push(c.agent);
    }
  } catch (err) {
    // All or none: the agents changed so far go back, then the skills.
    for (const a of changed.reverse()) { try { ctx.agentStore.createNewVersion(a.id, a, 'dashboard', 'Undo: a skill could not be added to every agent'); } catch { /* best effort */ } }
    saved.undo();
    return fail(`Couldn't add it to ${toChange[changed.length]?.agent.id ?? 'an agent'}: ${(err as Error).message}. Nothing was saved.`);
  }
  const link = names.map((n) => `[${n}](/skills/${n})`).join(' and ');
  const added = changed.length ? ` ${changed.map((a) => `\`${a.id}\``).join(', ')} ${changed.length === 1 ? 'uses' : 'use'} it now (a new version of ${changed.length === 1 ? 'it' : 'each'}).` : '';
  return { status: 'completed', summary: `${saved.note.trim() || `Added ${names.join(', ')}.`}${added} Open ${link} to read or change it.` };
}
