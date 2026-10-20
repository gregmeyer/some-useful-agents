/**
 * Skills the builder or analyzer proposes (docs/skills.md), carried on the
 * card that installs or fixes the agent and saved when it's approved.
 *
 * The reply's `<skill name description>` blocks become the card's NEW_SKILLS
 * input: JSON, each with the skill as it was when proposed (`base`), so
 * approving can't silently overwrite a change made since. Approving saves
 * each skill as a new version (rollback-able), then the agent; if the agent
 * can't be saved, the skills are taken back.
 */

import { extractSkillProposals, loadSkills, SkillStore, skillProblem, type Agent, type SkillProposal } from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** A proposal on a card, with the skill it would replace (null: a new one). */
export interface CardSkill extends SkillProposal {
  base: { source: 'shipped' | 'local'; version: number; description: string; body: string } | null;
}

/** At most this many skills ride on one card. */
export const MAX_SKILLS_PER_CARD = 2;

function skillStore(ctx: Ctx): SkillStore | undefined {
  try { return SkillStore.fromHandle(ctx.runStore.databaseHandle()); } catch { return undefined; }
}

function base(skill: { source?: 'shipped' | 'local'; version?: number; description: string; body: string } | undefined): CardSkill['base'] {
  return skill ? { source: skill.source ?? 'shipped', version: skill.version ?? 0, description: skill.description, body: skill.body } : null;
}

/**
 * NEW_SKILLS for a card, from the first of these node replies that proposes
 * any; undefined when none does, or when each one matches what's there.
 */
export function proposedSkillsJson(ctx: Ctx, replies: readonly string[]): string | undefined {
  for (const reply of replies) {
    const { skills } = extractSkillProposals(reply);
    if (skills.length === 0) continue;
    const { byName } = loadSkills(skillStore(ctx));
    const out: CardSkill[] = skills.slice(0, MAX_SKILLS_PER_CARD)
      .map((s) => ({ ...s, base: base(byName.get(s.name)) }))
      .filter((s) => !(s.base && s.base.body === s.body && s.base.description === s.description));
    return out.length ? JSON.stringify(out) : undefined;
  }
  return undefined;
}

/** The card's skills; an unreadable NEW_SKILLS reads as none. */
export function parseCardSkills(raw: string | undefined): CardSkill[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((s): s is CardSkill => !!s && typeof s === 'object'
      && typeof (s as CardSkill).name === 'string' && typeof (s as CardSkill).body === 'string'
      && typeof (s as CardSkill).description === 'string');
  } catch {
    return [];
  }
}

/**
 * Whether the card's skills can be saved with this agent: each one usable,
 * none changed since it was proposed, and every skill the agent lists there
 * (or on the card). The error says what to do.
 */
export function checkCardSkills(ctx: Ctx, raw: string | undefined, agent: Pick<Agent, 'id' | 'skills'>): { skills: CardSkill[]; error?: string } {
  const skills = parseCardSkills(raw);
  const { byName } = loadSkills(skillStore(ctx));
  for (const s of skills) {
    const problem = skillProblem(s.name, s.description, s.body);
    if (problem) return { skills, error: `The skill \`${s.name}\` can't be saved: ${problem}.` };
    const now = base(byName.get(s.name));
    const moved = s.base === null ? now !== null : !now || now.source !== s.base.source || now.version !== s.base.version;
    if (moved) return { skills, error: `The skill \`${s.name}\` changed since this was proposed. Ask sua to look again so it starts from the current one.` };
  }
  const missing = (agent.skills ?? []).filter((n) => !byName.has(n) && !skills.some((s) => s.name === n));
  if (missing.length) {
    return { skills, error: `\`${agent.id}\` lists ${missing.map((n) => `\`${n}\``).join(', ')}, which ${missing.length === 1 ? "isn't a skill" : "aren't skills"}. Ask sua for a fix that adds ${missing.length === 1 ? 'it' : 'them'}, or one without.` };
  }
  return { skills };
}

/**
 * Save the card's skills, each as its next version. `undo` takes them back
 * (the agent couldn't be saved); `note` says what was saved, for the summary.
 */
export function saveCardSkills(ctx: Ctx, skills: readonly CardSkill[]): { undo: () => void; note: string } {
  if (skills.length === 0) return { undo: () => {}, note: '' };
  const store = skillStore(ctx);
  if (!store) throw new Error("Skills can't be saved: the run database isn't open.");
  const saved: Array<{ name: string; version: number; label: string }> = [];
  const undo = () => { for (const s of [...saved].reverse()) { try { store.undoSave(s.name, s.version); } catch { /* best effort */ } } };
  try {
    for (const s of skills) {
      const before = store.get(s.name)?.version;
      const version = store.save(s, 'dashboard', s.base ? 'Changed with an agent fix' : 'Proposed with an agent');
      if (version === before) continue;
      const label = s.base === null ? `the new skill \`${s.name}\``
        : s.base.source === 'shipped' ? `your copy of the skill \`${s.name}\``
        : `the skill \`${s.name}\` (v${version})`;
      saved.push({ name: s.name, version, label });
    }
  } catch (err) {
    undo();
    throw err;
  }
  const note = saved.length
    ? ` Saved ${saved.map((s) => s.label).join(' and ')}.`
    : '';
  return { undo, note };
}
